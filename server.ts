import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import * as webpush from 'web-push';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  PartAvailability,
  PartCondition,
  PartRequest,
  PublicShopInfo,
  RequestWithQuotes,
  Shop,
  ShopQuote,
  ShopStatus,
  ShopTariff,
  TelegramSubscriber,
  WsEvent,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  role: 'driver' | 'shop' | 'admin';
  orderId?: string;
  shopId?: string;
  createdAt: string;
}

interface DbSchema {
  authSecret: string;
  vapidKeys?: {
    publicKey: string;
    privateKey: string;
  };
  settings: {
    adminWhatsapp: string;
    adminPasswordHash?: string;
  };
  shops: Shop[];
  requests: PartRequest[];
  quotes: ShopQuote[];
  pushSubscriptions?: PushSubscriptionRecord[];
}

function normalizePhoneDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return `994${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `994${digits}`;
  }
  return digits;
}

function formatDisplayPhone(raw: string): string {
  const d = normalizePhoneDigits(raw);
  if (d.length === 12 && d.startsWith('994')) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
  }
  return raw.trim();
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureYmd(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function isShopExpired(shop: Shop): boolean {
  if (!shop.expiresAt) return false;
  return shop.expiresAt < todayYmd();
}

function isShopEffectivelyActive(shop: Shop): boolean {
  return shop.status === 'Aktiv' && !isShopExpired(shop);
}

function toPublicShop(shop: Shop): PublicShopInfo {
  const expired = isShopExpired(shop);
  return {
    id: shop.id,
    name: shop.name,
    district: shop.district,
    whatsapp: shop.whatsapp,
    telegramChatId: shop.telegramChatId,
    tariff: shop.tariff,
    expiresAt: shop.expiresAt,
    status: shop.status,
    isExpired: expired,
    isEffectivelyActive: shop.status === 'Aktiv' && !expired,
  };
}

function createInitialDb(): DbSchema {
  return {
    authSecret: crypto.randomBytes(32).toString('hex'),
    vapidKeys: webpush.generateVAPIDKeys(),
    settings: {
      adminWhatsapp: '+994 50 777 00 00',
    },
    shops: [],
    requests: [],
    quotes: [],
    pushSubscriptions: [],
  };
}

function loadDb(): DbSchema {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const initial = createInitialDb();
    saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DbSchema>;
    const initial = createInitialDb();
    return {
      authSecret: parsed.authSecret || initial.authSecret,
      vapidKeys:
        parsed.vapidKeys?.publicKey && parsed.vapidKeys?.privateKey
          ? parsed.vapidKeys
          : initial.vapidKeys,
      settings: {
        adminWhatsapp: parsed.settings?.adminWhatsapp || initial.settings.adminWhatsapp,
        adminPasswordHash: parsed.settings?.adminPasswordHash,
      },
      shops: Array.isArray(parsed.shops) ? parsed.shops : initial.shops,
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      pushSubscriptions: Array.isArray(parsed.pushSubscriptions) ? parsed.pushSubscriptions : [],
    };
  } catch {
    const initial = createInitialDb();
    saveDb(initial);
    return initial;
  }
}

function saveDb(data: DbSchema): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

let db: DbSchema = loadDb();
if (!db.vapidKeys?.publicKey || !db.vapidKeys?.privateKey) {
  db.vapidKeys = webpush.generateVAPIDKeys();
  saveDb(db);
}
if (!Array.isArray(db.pushSubscriptions)) {
  db.pushSubscriptions = [];
}
webpush.setVapidDetails(
  'mailto:admin@avtotap.az',
  db.vapidKeys.publicKey,
  db.vapidKeys.privateKey
);

function hashAdminPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

function verifyAdminPassword(pw: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  const derived = crypto.scryptSync(pw, salt, 32);
  const storedBuf = Buffer.from(hexHash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', db.authSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', db.authSecret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as Record<string, unknown>;
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function resolveBaseUrl(req: express.Request): string {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (typeof protoHeader === 'string' ? protoHeader.split(',')[0].trim() : '') || req.protocol || 'http';
  const hostHeader = req.headers['x-forwarded-host'];
  const host = (typeof hostHeader === 'string' ? hostHeader.split(',')[0].trim() : '') || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function sortQuotesForDriver(quotes: ShopQuote[]): ShopQuote[] {
  return [...quotes].sort((a, b) => {
    if (a.isVip !== b.isVip) {
      return a.isVip ? -1 : 1;
    }
    if (a.priceAzn !== b.priceAzn) {
      return a.priceAzn - b.priceAzn;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function buildRequestWithQuotes(reqItem: PartRequest): RequestWithQuotes {
  const reqQuotes = sortQuotesForDriver(db.quotes.filter((q) => q.requestId === reqItem.id));
  return {
    ...reqItem,
    quotes: reqQuotes,
    quoteCount: reqQuotes.length,
  };
}

async function dispatchTelegramAlerts(
  reqItem: PartRequest,
  activeShops: Shop[],
  baseUrl: string
): Promise<number> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return 0;

  const targetShops = activeShops.filter((s) => Boolean(s.telegramChatId && s.telegramChatId.trim()));
  if (targetShops.length === 0) return 0;

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const cleanBase = baseUrl.replace(/\/$/, '');

  const results = await Promise.allSettled(
    targetShops.map(async (shop) => {
      const quickToken = signToken({
        role: 'shop',
        shopId: shop.id,
        exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
      });
      const quickReplyUrl = `${cleanBase}/?quickReply=${encodeURIComponent(reqItem.id)}&st=${encodeURIComponent(quickToken)}`;

      const textLines = [
        `🚗 Yeni ehtiyat hissəsi sorğusu!`,
        ``,
        `Avtomobil: ${reqItem.carBrandModel}`,
        `Buraxılış ili: ${reqItem.year}`,
        `Detal: ${reqItem.partName}`,
        ``,
        `Qiymət və vəziyyəti göndərmək üçün linkə keçin:`,
        quickReplyUrl,
      ].join('\n');

      const body: Record<string, unknown> = {
        chat_id: shop.telegramChatId!.trim(),
        text: textLines,
        disable_web_page_preview: true,
      };

      if (cleanBase.startsWith('https://')) {
        body.reply_markup = {
          inline_keyboard: [[{ text: 'Qiymət göndər', url: quickReplyUrl }]],
        };
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error(`Telegram sendMessage failed for shop ${shop.id}:`, errBody);
        throw new Error(errBody);
      }
    })
  );

  return results.filter((r) => r.status === 'fulfilled').length;
}

async function dispatchWebPush(
  filter: (sub: PushSubscriptionRecord) => boolean,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<void> {
  const subs = db.pushSubscriptions || [];
  if (subs.length === 0) return;

  const seenEndpoints = new Set<string>();
  const targets = subs.filter((sub) => {
    if (!filter(sub)) return false;
    if (seenEndpoints.has(sub.endpoint)) return false;
    seenEndpoints.add(sub.endpoint);
    return true;
  });
  if (targets.length === 0) return;

  const deadEndpoints = new Set<string>();
  const jsonPayload = JSON.stringify(payload);

  await Promise.allSettled(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          jsonPayload,
          { urgency: 'high', TTL: 3600 }
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          deadEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (deadEndpoints.size > 0) {
    db.pushSubscriptions = (db.pushSubscriptions || []).filter(
      (s) => !deadEndpoints.has(s.endpoint)
    );
    saveDb(db);
  }
}

interface WsClientMeta {
  ws: WebSocket;
  role: 'driver' | 'shop' | 'admin';
  orderId?: string;
  shopId?: string;
}

const wsClients = new Set<WsClientMeta>();

function broadcastWs(event: WsEvent, filter?: (meta: WsClientMeta) => boolean): void {
  const payload = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (filter && !filter(client)) continue;
    client.ws.send(payload);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/public/config', (_req, res) => {
    const activeShopCount = db.shops.filter(isShopEffectivelyActive).length;
    res.json({
      activeShopCount,
      adminWhatsapp: db.settings.adminWhatsapp,
    });
  });

  app.get('/api/push/vapid-key', (_req, res) => {
    res.json({ publicKey: db.vapidKeys?.publicKey || '' });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const { subscription, role, orderId } = req.body ?? {};
    const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint.trim() : '';
    const p256dh = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh.trim() : '';
    const auth = typeof subscription?.keys?.auth === 'string' ? subscription.keys.auth.trim() : '';

    if (!endpoint || !p256dh || !auth) {
      res.status(400).json({ error: 'Push abunəlik məlumatı natamamdır.' });
      return;
    }

    let resolvedRole: 'driver' | 'shop' | 'admin' = 'driver';
    let shopId: string | undefined;

    if (role === 'shop' || role === 'admin') {
      const token = extractBearerToken(req);
      const claims = token ? verifyToken(token) : null;
      if (claims && claims.role === 'shop' && typeof claims.shopId === 'string') {
        resolvedRole = 'shop';
        shopId = claims.shopId;
      } else if (claims && claims.role === 'admin') {
        resolvedRole = 'admin';
      } else {
        res.status(401).json({ error: 'İcazə tələb olunur.' });
        return;
      }
    }

    const cleanOrderId =
      resolvedRole === 'driver' && typeof orderId === 'string' && orderId.trim()
        ? orderId.trim()
        : undefined;

    const record: PushSubscriptionRecord = {
      endpoint,
      keys: { p256dh, auth },
      role: resolvedRole,
      orderId: cleanOrderId,
      shopId,
      createdAt: new Date().toISOString(),
    };

    const existingList = db.pushSubscriptions || [];
    const filtered = existingList.filter(
      (s) => !(s.endpoint === endpoint && s.role === resolvedRole)
    );
    db.pushSubscriptions = [record, ...filtered].slice(0, 1000);
    saveDb(db);

    res.json({ ok: true });
  });

  // Driver creates a part request
  app.post('/api/requests', (req, res) => {
    const { carBrandModel, year, partName, photoDataUrl, driverWhatsapp, note, acceptedTerms } =
      req.body ?? {};

    if (!acceptedTerms) {
      res.status(400).json({ error: 'İstifadəçi razılaşması və Məxfilik siyasəti ilə razılaşmalısınız.' });
      return;
    }

    const cleanBrand = String(carBrandModel || '').trim();
    const cleanYear = String(year || '').trim();
    const cleanPart = String(partName || '').trim();
    const cleanPhone = String(driverWhatsapp || '').trim();

    if (!cleanBrand || !cleanYear || !cleanPart || normalizePhoneDigits(cleanPhone).length < 9) {
      res.status(400).json({ error: 'Zəhmət olmasa bütün vacib sahələri düzgün doldurun.' });
      return;
    }

    let safePhoto: string | undefined;
    if (typeof photoDataUrl === 'string' && photoDataUrl.startsWith('data:image/')) {
      if (photoDataUrl.length <= 5_000_000) {
        safePhoto = photoDataUrl;
      }
    }

    const newRequest: PartRequest = {
      id: `req_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      carBrandModel: cleanBrand.slice(0, 120),
      year: cleanYear.slice(0, 10),
      partName: cleanPart.slice(0, 200),
      photoDataUrl: safePhoto,
      driverWhatsapp: formatDisplayPhone(cleanPhone),
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : undefined,
      createdAt: new Date().toISOString(),
    };

    db.requests.unshift(newRequest);
    saveDb(db);

    const activeShops = db.shops.filter(isShopEffectivelyActive);
    const activeShopIds = new Set(activeShops.map((s) => s.id));
    const fullReq = buildRequestWithQuotes(newRequest);

    broadcastWs({ type: 'request:created', payload: fullReq }, (client) => {
      return client.role === 'shop' || client.role === 'admin';
    });

    const baseUrl = resolveBaseUrl(req);
    void dispatchTelegramAlerts(newRequest, activeShops, baseUrl);

    void dispatchWebPush(
      (sub) => sub.role === 'shop' && (!sub.shopId || activeShopIds.has(sub.shopId)),
      {
        title: `Yeni sorğu: ${newRequest.carBrandModel} (${newRequest.year})`,
        body: newRequest.partName,
        url: `/?tab=shop&reply=${encodeURIComponent(newRequest.id)}`,
        tag: `req-${newRequest.id}`,
      }
    );

    void dispatchWebPush((sub) => sub.role === 'admin', {
      title: `Yeni sürücü sorğusu: ${newRequest.carBrandModel}`,
      body: `${newRequest.partName} (${newRequest.year})`,
      url: '/#admin',
      tag: `admin-req-${newRequest.id}`,
    });

    res.status(201).json({
      request: fullReq,
      notifiedShopsCount: activeShops.length,
    });
  });

  // Driver fetches single order + live quotes
  app.get('/api/requests/:id', (req, res) => {
    const item = db.requests.find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Sorğu tapılmadı və ya silinib.' });
      return;
    }
    res.json({
      request: buildRequestWithQuotes(item),
      activeShopCount: db.shops.filter(isShopEffectivelyActive).length,
    });
  });

  // Shop login
  app.post('/api/shop/login', (req, res) => {
    const { whatsapp, pin } = req.body ?? {};
    const targetDigits = normalizePhoneDigits(String(whatsapp || ''));
    const cleanPin = String(pin || '').trim();

    if (!targetDigits || !cleanPin) {
      res.status(400).json({ error: 'Telefon nömrəsi və PIN kodu daxil edin.' });
      return;
    }

    const shop = db.shops.find(
      (s) => normalizePhoneDigits(s.whatsapp) === targetDigits && s.pin === cleanPin
    );

    if (!shop) {
      res.status(401).json({ error: 'Telefon nömrəsi və ya PIN kod yanlışdır.' });
      return;
    }

    const token = signToken({
      role: 'shop',
      shopId: shop.id,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });

    res.json({
      token,
      shop: toPublicShop(shop),
      adminWhatsapp: db.settings.adminWhatsapp,
    });
  });

  // Shop quick-reply loader from Telegram direct link
  app.get('/api/shop/quick-reply/:requestId', (req, res) => {
    const token = extractBearerToken(req);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.role !== 'shop' || typeof claims.shopId !== 'string') {
      res.status(401).json({ error: 'Bu cavab linki etibarsızdır və ya vaxtı bitib.' });
      return;
    }

    const shop = db.shops.find((s) => s.id === claims.shopId);
    if (!shop) {
      res.status(401).json({ error: 'Mağaza hesabı tapılmadı.' });
      return;
    }

    const publicShop = toPublicShop(shop);
    if (!publicShop.isEffectivelyActive) {
      res.json({
        shop: publicShop,
        adminWhatsapp: db.settings.adminWhatsapp,
        request: null,
        myQuote: null,
      });
      return;
    }

    const targetReq = db.requests.find((r) => r.id === req.params.requestId);
    if (!targetReq) {
      res.status(404).json({ error: 'Sorğu tapılmadı və ya silinib.' });
      return;
    }

    const myQuote = db.quotes.find((q) => q.requestId === targetReq.id && q.shopId === shop.id) || null;
    res.json({
      shop: publicShop,
      adminWhatsapp: db.settings.adminWhatsapp,
      request: targetReq,
      myQuote,
    });
  });

  // Shop authenticated dashboard
  app.get('/api/shop/me', (req, res) => {
    const token = extractBearerToken(req);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.role !== 'shop' || typeof claims.shopId !== 'string') {
      res.status(401).json({ error: 'Mağaza hesabına daxil olun.' });
      return;
    }

    const shop = db.shops.find((s) => s.id === claims.shopId);
    if (!shop) {
      res.status(401).json({ error: 'Mağaza hesabı tapılmadı.' });
      return;
    }

    const publicShop = toPublicShop(shop);
    if (!publicShop.isEffectivelyActive) {
      res.json({
        shop: publicShop,
        adminWhatsapp: db.settings.adminWhatsapp,
        requests: [],
      });
      return;
    }

    const feed = db.requests.slice(0, 100).map((r) => {
      const myQuote = db.quotes.find((q) => q.requestId === r.id && q.shopId === shop.id) || null;
      const totalQuotes = db.quotes.filter((q) => q.requestId === r.id).length;
      return {
        ...r,
        myQuote,
        totalQuotes,
      };
    });

    res.json({
      shop: publicShop,
      adminWhatsapp: db.settings.adminWhatsapp,
      requests: feed,
    });
  });

  // Shop submits quote for a request
  app.post('/api/shop/quotes', (req, res) => {
    const token = extractBearerToken(req);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.role !== 'shop' || typeof claims.shopId !== 'string') {
      res.status(401).json({ error: 'Sessiya bitib, yenidən daxil olun.' });
      return;
    }

    const shop = db.shops.find((s) => s.id === claims.shopId);
    if (!shop) {
      res.status(401).json({ error: 'Mağaza tapılmadı.' });
      return;
    }

    if (!isShopEffectivelyActive(shop)) {
      res.status(403).json({ error: 'Abunəliyiniz deaktivdir və ya müddəti bitib.' });
      return;
    }

    const { requestId, priceAzn, condition, availability, comment } = req.body ?? {};
    const targetReq = db.requests.find((r) => r.id === requestId);
    if (!targetReq) {
      res.status(404).json({ error: 'Sorğu tapılmadı və ya silinib.' });
      return;
    }

    const numericPrice = Number(priceAzn);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0 || numericPrice > 1_000_000) {
      res.status(400).json({ error: 'Düzgün qiymət (AZN) daxil edin.' });
      return;
    }

    const validConditions: PartCondition[] = ['Orijinal', 'Dublikat', 'Üstən çıxma'];
    const safeCondition: PartCondition = validConditions.includes(condition) ? condition : 'Orijinal';

    const validAvailability: PartAvailability[] = ['Mövcuddur', 'Sifarişlə (1-2 gün)', 'Anbarda son ədəd'];
    const safeAvailability: PartAvailability = validAvailability.includes(availability)
      ? availability
      : 'Mövcuddur';

    db.quotes = db.quotes.filter((q) => !(q.requestId === targetReq.id && q.shopId === shop.id));

    const quote: ShopQuote = {
      id: `qt_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      requestId: targetReq.id,
      shopId: shop.id,
      shopName: shop.name,
      shopDistrict: shop.district,
      shopWhatsapp: shop.whatsapp,
      shopTariff: shop.tariff,
      isVip: shop.tariff === 'VIP 40 AZN',
      priceAzn: Math.round(numericPrice * 100) / 100,
      condition: safeCondition,
      availability: safeAvailability,
      comment: typeof comment === 'string' && comment.trim() ? comment.trim().slice(0, 180) : undefined,
      createdAt: new Date().toISOString(),
    };

    db.quotes.unshift(quote);
    saveDb(db);

    broadcastWs(
      { type: 'quote:created', payload: { requestId: targetReq.id, quote } },
      (client) =>
        client.role === 'admin' ||
        (client.role === 'driver' && client.orderId === targetReq.id)
    );

    void dispatchWebPush(
      (sub) => sub.role === 'driver' && (!sub.orderId || sub.orderId === targetReq.id),
      {
        title: `Yeni qiymət: ${quote.priceAzn} AZN (${quote.shopName})`,
        body: `${targetReq.partName} · ${quote.condition} · ${quote.availability}`,
        url: `/?order=${encodeURIComponent(targetReq.id)}`,
        tag: `quote-${quote.id}`,
      }
    );

    void dispatchWebPush((sub) => sub.role === 'admin', {
      title: `Yeni cavab: ${quote.shopName} — ${quote.priceAzn} AZN`,
      body: `${targetReq.carBrandModel} · ${targetReq.partName}`,
      url: '/#admin',
      tag: `admin-quote-${quote.id}`,
    });

    res.status(201).json({ quote });
  });

  // Admin login
  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body ?? {};
    const given = String(password || '').trim();

    let isValid = false;
    if (db.settings.adminPasswordHash) {
      isValid = verifyAdminPassword(given, db.settings.adminPasswordHash);
    } else {
      let rawExpected = String(process.env.ADMIN_PASSWORD || '').trim();
      if (
        (rawExpected.startsWith('"') && rawExpected.endsWith('"')) ||
        (rawExpected.startsWith("'") && rawExpected.endsWith("'"))
      ) {
        rawExpected = rawExpected.slice(1, -1).trim();
      }
      const expected = rawExpected || 'AvtoTapAdmin2026';
      const givenBuf = Buffer.from(given);
      const expectedBuf = Buffer.from(expected);
      isValid = givenBuf.length === expectedBuf.length && crypto.timingSafeEqual(givenBuf, expectedBuf);
    }

    if (!isValid) {
      res.status(401).json({ error: 'Admin şifrəsi yanlışdır.' });
      return;
    }

    const token = signToken({
      role: 'admin',
      exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });

    res.json({ token });
  });

  function requireAdmin(req: express.Request, res: express.Response): boolean {
    const token = extractBearerToken(req);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.role !== 'admin') {
      res.status(401).json({ error: 'Admin icazəsi tələb olunur.' });
      return false;
    }
    return true;
  }

  app.get('/api/admin/dashboard', (req, res) => {
    if (!requireAdmin(req, res)) return;

    const requestsWithQuotes = db.requests.map(buildRequestWithQuotes);

    res.json({
      shops: db.shops.map((s) => ({
        ...s,
        isExpired: isShopExpired(s),
        isEffectivelyActive: isShopEffectivelyActive(s),
        quoteCount: db.quotes.filter((q) => q.shopId === s.id).length,
      })),
      requests: requestsWithQuotes,
      settings: {
        adminWhatsapp: db.settings.adminWhatsapp,
        telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      },
    });
  });

  // Fetch recent Telegram users who pressed /start via Bot API getUpdates
  app.get('/api/admin/telegram/updates', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken) {
      res.status(400).json({
        error: 'TELEGRAM_BOT_TOKEN təyin edilməyib. Zəhmət olmasa Secrets/env bölməsinə əlavə edin.',
      });
      return;
    }

    try {
      const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
      const tgJson = (await tgResp.json()) as {
        ok: boolean;
        description?: string;
        result?: Array<{
          update_id: number;
          message?: {
            date?: number;
            text?: string;
            chat?: {
              id: number;
              type?: string;
              first_name?: string;
              last_name?: string;
              username?: string;
              title?: string;
            };
          };
          my_chat_member?: {
            date?: number;
            chat?: {
              id: number;
              type?: string;
              first_name?: string;
              last_name?: string;
              username?: string;
              title?: string;
            };
          };
        }>;
      };

      if (!tgJson.ok) {
        res.status(400).json({
          error: tgJson.description || 'Telegram API xəta qaytardı.',
        });
        return;
      }

      const byChatId = new Map<string, TelegramSubscriber>();
      for (const upd of tgJson.result || []) {
        const msg = upd.message || upd.my_chat_member;
        const chat = msg?.chat;
        if (!chat || typeof chat.id !== 'number') continue;

        const chatId = String(chat.id);
        const fullName =
          chat.title ||
          [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() ||
          (chat.username ? `@${chat.username}` : `Chat ${chatId}`);

        const itemDate = msg?.date || 0;
        const existing = byChatId.get(chatId);
        if (!existing || itemDate >= existing.date) {
          byChatId.set(chatId, {
            chatId,
            displayName: fullName,
            username: chat.username,
            lastText: upd.message?.text,
            date: itemDate,
          });
        }
      }

      const subscribers = Array.from(byChatId.values()).sort((a, b) => b.date - a.date);
      res.json({ subscribers });
    } catch {
      res.status(502).json({ error: 'Telegram API ilə əlaqə yaradılmadı.' });
    }
  });

  app.post('/api/admin/shops', (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { name, district, whatsapp, telegramChatId, pin, tariff, expiresAt, status } = req.body ?? {};
    const cleanName = String(name || '').trim();
    const cleanDistrict = typeof district === 'string' ? district.trim() : '';
    const cleanWhatsapp = String(whatsapp || '').trim();
    const cleanTelegramChatId = typeof telegramChatId === 'string' ? telegramChatId.trim() : '';
    const cleanPin = String(pin || '').trim();

    if (!cleanName || normalizePhoneDigits(cleanWhatsapp).length < 9 || cleanPin.length < 4) {
      res.status(400).json({ error: 'Mağaza adı, WhatsApp nömrəsi və ən azı 4 rəqəmli PIN vacibdir.' });
      return;
    }

    const validTariffs: ShopTariff[] = ['Test', 'Bazis 25 AZN', 'VIP 40 AZN'];
    const safeTariff: ShopTariff = validTariffs.includes(tariff) ? tariff : 'Bazis 25 AZN';
    const safeStatus: ShopStatus = status === 'Deaktiv' ? 'Deaktiv' : 'Aktiv';
    const safeExpiresAt = typeof expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)
      ? expiresAt
      : futureYmd(30);

    const newShop: Shop = {
      id: `shop_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      name: cleanName.slice(0, 100),
      district: cleanDistrict ? cleanDistrict.slice(0, 80) : undefined,
      whatsapp: formatDisplayPhone(cleanWhatsapp),
      telegramChatId: cleanTelegramChatId.slice(0, 40),
      pin: cleanPin.slice(0, 12),
      tariff: safeTariff,
      expiresAt: safeExpiresAt,
      status: safeStatus,
      createdAt: new Date().toISOString(),
    };

    db.shops.unshift(newShop);
    saveDb(db);

    res.status(201).json({ shop: newShop });
  });

  app.patch('/api/admin/shops/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;

    const idx = db.shops.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Mağaza tapılmadı.' });
      return;
    }

    const current = db.shops[idx];
    const body = req.body ?? {};
    const validTariffs: ShopTariff[] = ['Test', 'Bazis 25 AZN', 'VIP 40 AZN'];

    const updated: Shop = {
      ...current,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : current.name,
      district:
        typeof body.district === 'string'
          ? body.district.trim().slice(0, 80) || undefined
          : current.district,
      whatsapp:
        typeof body.whatsapp === 'string' && normalizePhoneDigits(body.whatsapp).length >= 9
          ? formatDisplayPhone(body.whatsapp)
          : current.whatsapp,
      telegramChatId:
        typeof body.telegramChatId === 'string'
          ? body.telegramChatId.trim().slice(0, 40)
          : current.telegramChatId,
      pin: typeof body.pin === 'string' && body.pin.trim().length >= 4 ? body.pin.trim().slice(0, 12) : current.pin,
      tariff: validTariffs.includes(body.tariff) ? body.tariff : current.tariff,
      expiresAt:
        typeof body.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt)
          ? body.expiresAt
          : current.expiresAt,
      status: body.status === 'Aktiv' || body.status === 'Deaktiv' ? body.status : current.status,
    };

    db.shops[idx] = updated;
    db.quotes = db.quotes.map((q) =>
      q.shopId === updated.id
        ? {
            ...q,
            shopName: updated.name,
            shopDistrict: updated.district,
            shopWhatsapp: updated.whatsapp,
            shopTariff: updated.tariff,
            isVip: updated.tariff === 'VIP 40 AZN',
          }
        : q
    );
    saveDb(db);

    broadcastWs(
      { type: 'shop:updated', payload: { shopId: updated.id } },
      (client) => client.role === 'shop' && client.shopId === updated.id
    );

    res.json({ shop: updated });
  });

  app.delete('/api/admin/shops/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const before = db.shops.length;
    db.shops = db.shops.filter((s) => s.id !== req.params.id);
    if (db.shops.length === before) {
      res.status(404).json({ error: 'Mağaza tapılmadı.' });
      return;
    }
    saveDb(db);
    res.json({ ok: true });
  });

  app.delete('/api/admin/requests/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const before = db.requests.length;
    db.requests = db.requests.filter((r) => r.id !== req.params.id);
    if (db.requests.length === before) {
      res.status(404).json({ error: 'Sorğu tapılmadı.' });
      return;
    }
    db.quotes = db.quotes.filter((q) => q.requestId !== req.params.id);
    saveDb(db);

    broadcastWs({ type: 'request:deleted', payload: { requestId: req.params.id } });
    res.json({ ok: true });
  });

  app.patch('/api/admin/settings', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { adminWhatsapp } = req.body ?? {};
    if (typeof adminWhatsapp === 'string' && normalizePhoneDigits(adminWhatsapp).length >= 9) {
      db.settings.adminWhatsapp = formatDisplayPhone(adminWhatsapp);
      saveDb(db);
    }
    res.json({
      settings: {
        adminWhatsapp: db.settings.adminWhatsapp,
        telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      },
    });
  });

  app.patch('/api/admin/password', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const newPassword = String(req.body?.newPassword || '').trim();
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Yeni şifrə ən azı 6 simvol olmalıdır.' });
      return;
    }
    db.settings.adminPasswordHash = hashAdminPassword(newPassword);
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/admin/restore-snapshot', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { shops, adminWhatsapp } = req.body ?? {};
    const validTariffs: ShopTariff[] = ['Test', 'Bazis 25 AZN', 'VIP 40 AZN'];
    let restoredCount = 0;

    if (typeof adminWhatsapp === 'string' && normalizePhoneDigits(adminWhatsapp).length >= 9) {
      db.settings.adminWhatsapp = formatDisplayPhone(adminWhatsapp);
    }

    if (Array.isArray(shops)) {
      const existingIds = new Set(db.shops.map((s) => s.id));
      for (const raw of shops) {
        if (!raw || typeof raw !== 'object') continue;
        const name = String(raw.name || '').trim();
        const whatsapp = String(raw.whatsapp || '').trim();
        const pin = String(raw.pin || '').trim();
        if (!name || normalizePhoneDigits(whatsapp).length < 9 || pin.length < 4) continue;
        const id =
          typeof raw.id === 'string' && raw.id.trim()
            ? raw.id.trim().slice(0, 80)
            : `shop_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
        if (existingIds.has(id)) continue;

        const restoredShop: Shop = {
          id,
          name: name.slice(0, 100),
          district: typeof raw.district === 'string' && raw.district.trim() ? raw.district.trim().slice(0, 80) : undefined,
          whatsapp: formatDisplayPhone(whatsapp),
          telegramChatId: typeof raw.telegramChatId === 'string' ? raw.telegramChatId.trim().slice(0, 40) : '',
          pin: pin.slice(0, 12),
          tariff: validTariffs.includes(raw.tariff) ? raw.tariff : 'Bazis 25 AZN',
          expiresAt:
            typeof raw.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.expiresAt)
              ? raw.expiresAt
              : futureYmd(30),
          status: raw.status === 'Deaktiv' ? 'Deaktiv' : 'Aktiv',
          createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
        };
        db.shops.push(restoredShop);
        existingIds.add(id);
        restoredCount++;
      }
    }

    saveDb(db);
    res.json({ ok: true, restoredCount, totalShops: db.shops.length });
  });

  const server = http.createServer(app);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server, path: '/__vite_hmr' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get(['/dev-sw.js', '/sw.js', '/workbox-*.js', '/sw-push.js'], (_req, res) => {
      res.status(404).type('application/javascript').send('// not found');
    });
    app.get('*', (req, res) => {
      if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.json')) {
        res.status(404).end();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', `http://localhost:${PORT}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', `http://localhost:${PORT}`);
    const roleParam = url.searchParams.get('role');
    const orderId = url.searchParams.get('orderId') || undefined;
    const shopToken = url.searchParams.get('token') || undefined;

    let role: 'driver' | 'shop' | 'admin' = 'driver';
    let shopId: string | undefined;

    if (roleParam === 'shop' && shopToken) {
      const claims = verifyToken(shopToken);
      if (claims && claims.role === 'shop' && typeof claims.shopId === 'string') {
        role = 'shop';
        shopId = claims.shopId;
      }
    } else if (roleParam === 'admin' && shopToken) {
      const claims = verifyToken(shopToken);
      if (claims && claims.role === 'admin') {
        role = 'admin';
      }
    }

    const meta: WsClientMeta = { ws, role, orderId, shopId };
    wsClients.add(meta);

    ws.on('close', () => {
      wsClients.delete(meta);
    });
    ws.on('error', () => {
      wsClients.delete(meta);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AvtoTap server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
