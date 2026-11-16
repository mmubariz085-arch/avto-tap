import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Lock,
  LogOut,
  MessageCircle,
  Send,
  Store,
  X,
} from 'lucide-react';
import { buildWhatsAppUrl, formatTimeAgoAz } from '../utils/phone';
import { triggerAlertFeedback, unlockAudio } from '../utils/notify';
import { PushNotificationsButton } from './PushNotificationsButton';
import type {
  PartAvailability,
  PartCondition,
  PartRequest,
  PublicShopInfo,
  ShopQuote,
  WsEvent,
} from '../types';

interface ShopFeedItem extends PartRequest {
  myQuote: ShopQuote | null;
  totalQuotes: number;
}

interface ShopViewProps {
  replyRequestId?: string | null;
  onClearReplyId?: () => void;
}

const CONDITIONS: PartCondition[] = ['Orijinal', 'Dublikat', 'Üstən çıxma'];
const AVAILABILITIES: PartAvailability[] = ['Mövcuddur', 'Anbarda son ədəd', 'Sifarişlə (1-2 gün)'];

export const ShopView: React.FC<ShopViewProps> = ({ replyRequestId, onClearReplyId }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('avtotap_shop_token'));
  const [shop, setShop] = useState<PublicShopInfo | null>(null);
  const [adminWhatsapp, setAdminWhatsapp] = useState<string>('');
  const [feed, setFeed] = useState<ShopFeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(token));

  // Login state
  const [loginPhone, setLoginPhone] = useState('+994 ');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Quote modal state
  const [activeRequest, setActiveRequest] = useState<ShopFeedItem | null>(null);
  const [priceAzn, setPriceAzn] = useState('');
  const [condition, setCondition] = useState<PartCondition>('Orijinal');
  const [availability, setAvailability] = useState<PartAvailability>('Mövcuddur');
  const [comment, setComment] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isSendingQuote, setIsSendingQuote] = useState(false);

  // Media & sound
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [newAlertBanner, setNewAlertBanner] = useState<string | null>(null);

  const loadShopDashboard = useCallback(async (activeToken: string) => {
    try {
      const res = await fetch('/api/shop/me', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('avtotap_shop_token');
        setToken(null);
        setShop(null);
        setFeed([]);
        return;
      }
      const data = await res.json();
      setShop(data.shop);
      setAdminWhatsapp(data.adminWhatsapp || '');
      setFeed(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      // keep existing state if offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      void loadShopDashboard(token);
    }
  }, [token, loadShopDashboard]);

  // Open quote modal automatically if navigated via WhatsApp reply link
  useEffect(() => {
    if (!replyRequestId || feed.length === 0 || !shop?.isEffectivelyActive) return;
    const found = feed.find((item) => item.id === replyRequestId);
    if (found) {
      openQuoteModal(found);
      onClearReplyId?.();
    }
  }, [replyRequestId, feed, shop, onClearReplyId]);

  // WebSocket live feed for shop
  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUser = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws?role=shop&token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        void loadShopDashboard(token);
      };

      socket.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as WsEvent;
          if (event.type === 'request:created') {
            const incoming = event.payload;
            setFeed((prev) => {
              if (prev.some((r) => r.id === incoming.id)) return prev;
              const nextItem: ShopFeedItem = {
                ...incoming,
                myQuote: null,
                totalQuotes: incoming.quoteCount || 0,
              };
              return [nextItem, ...prev];
            });
            triggerAlertFeedback('incoming', {
              sound: soundEnabled,
              vibrate: soundEnabled,
              notification: {
                title: `Yeni sorğu: ${incoming.carBrandModel} (${incoming.year})`,
                body: incoming.partName,
                url: `/?tab=shop&reply=${encodeURIComponent(incoming.id)}`,
                tag: `req-${incoming.id}`,
              },
            });
            setNewAlertBanner(`Yeni sorğu: ${incoming.carBrandModel} (${incoming.year}) — ${incoming.partName}`);
          } else if (event.type === 'request:deleted') {
            setFeed((prev) => prev.filter((r) => r.id !== event.payload.requestId));
          } else if (event.type === 'shop:updated') {
            void loadShopDashboard(token);
          }
        } catch {
          // ignore
        }
      };

      socket.onclose = () => {
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token, soundEnabled, loadShopDashboard]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/shop/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp: loginPhone.trim(), pin: loginPin.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Giriş alınmadı.');
        return;
      }
      localStorage.setItem('avtotap_shop_token', data.token);
      setToken(data.token);
      setShop(data.shop);
      setAdminWhatsapp(data.adminWhatsapp || '');
      setLoading(true);
    } catch {
      setLoginError('Serverlə əlaqə xətası.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('avtotap_shop_token');
    setToken(null);
    setShop(null);
    setFeed([]);
    setLoginPin('');
  };

  const openQuoteModal = (item: ShopFeedItem) => {
    setActiveRequest(item);
    setPriceAzn(item.myQuote ? String(item.myQuote.priceAzn) : '');
    setCondition(item.myQuote ? item.myQuote.condition : 'Orijinal');
    setAvailability(item.myQuote ? item.myQuote.availability : 'Mövcuddur');
    setComment(item.myQuote?.comment || '');
    setQuoteError(null);
  };

  const handleSubmitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest || !token) return;
    unlockAudio();
    setQuoteError(null);

    const parsed = Number(priceAzn);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      triggerAlertFeedback('error', { sound: soundEnabled, vibrate: soundEnabled });
      setQuoteError('Düzgün qiymət (AZN) daxil edin.');
      return;
    }

    setIsSendingQuote(true);
    try {
      const res = await fetch('/api/shop/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestId: activeRequest.id,
          priceAzn: parsed,
          condition,
          availability,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        triggerAlertFeedback('error', { sound: soundEnabled, vibrate: soundEnabled });
        setQuoteError(data.error || 'Qiymət göndərilmədi.');
        return;
      }

      const savedQuote = data.quote as ShopQuote;
      setFeed((prev) =>
        prev.map((item) =>
          item.id === activeRequest.id
            ? {
                ...item,
                myQuote: savedQuote,
                totalQuotes: item.myQuote ? item.totalQuotes : item.totalQuotes + 1,
              }
            : item
        )
      );
      triggerAlertFeedback('success', { sound: soundEnabled, vibrate: soundEnabled });
      setActiveRequest(null);
    } catch {
      triggerAlertFeedback('error', { sound: soundEnabled, vibrate: soundEnabled });
      setQuoteError('Şəbəkə xətası baş verdi.');
    } finally {
      setIsSendingQuote(false);
    }
  };

  // Login Screen
  if (!token || (!shop && !loading)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Mağaza kabineti</h1>
              <p className="text-xs text-slate-600">Mağaza və ya ölüxana girişi</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="shop-phone" className="block text-sm font-semibold text-slate-900">
                Telefon nömrəsi (WhatsApp)
              </label>
              <input
                id="shop-phone"
                type="tel"
                inputMode="tel"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                placeholder="+994 50 555 10 10"
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 px-4 font-mono tabular-nums text-base text-slate-900 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
                required
              />
            </div>

            <div>
              <label htmlFor="shop-pin" className="block text-sm font-semibold text-slate-900">
                PIN kod
              </label>
              <input
                id="shop-pin"
                type="password"
                inputMode="numeric"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                placeholder="Administrator tərəfindən verilən PIN"
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 px-4 font-mono tabular-nums text-base text-slate-900 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
                required
              />
            </div>

            {loginError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-base font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              <Lock className="h-4 w-4" />
              <span>{isLoggingIn ? 'Yoxlanılır...' : 'Kabinetə daxil ol'}</span>
            </button>
          </form>

          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            Mağazanızı sistemə qoşmaq və ya PIN kod almaq üçün administrator ilə əlaqə saxlayın.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !shop) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center text-sm text-slate-600">
        Kabinet yüklənir...
      </div>
    );
  }

  // Deactivated / Expired Subscription Screen
  if (!shop.isEffectivelyActive) {
    const renewalText = `Salam! "${shop.name}" mağazasının (${shop.whatsapp}) AvtoTap abunəliyini uzatmaq istəyirəm.`;
    const adminWaUrl = buildWhatsAppUrl(adminWhatsapp || '+994507770000', renewalText);

    return (
      <div className="mx-auto w-full max-w-lg px-4 py-8 sm:py-12">
        <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold text-slate-900">
            {shop.isExpired ? 'Abunəlik müddətiniz bitib' : 'Hesabınız hazırda deaktivdir'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            <strong>{shop.name}</strong> · Bitmə tarixi:{' '}
            <span className="font-mono font-semibold text-slate-800">{shop.expiresAt}</span>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Yeni sürücü sorğularını görmək və qiymət göndərmək üçün abunəliyi aktivləşdirin.
          </p>

          <div className="mt-6 space-y-3">
            <a
              href={adminWaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-green-700 px-5 py-3 text-sm font-bold text-white hover:bg-green-800"
            >
              <MessageCircle className="h-5 w-5" />
              <span>Abunəliyi uzatmaq üçün Admin ilə əlaqə</span>
            </a>

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              <span>Çıxış et</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Shop Request Feed
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:py-8">
      {/* Shop Status Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-extrabold text-slate-900">{shop.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
            {shop.district && (
              <>
                <span>{shop.district}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="font-semibold text-slate-900">{shop.tariff}</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-700 font-semibold">Aktiv ({shop.expiresAt}-dək)</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PushNotificationsButton role="shop" authToken={token} compact />
          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            aria-label={soundEnabled ? 'Səsi söndür' : 'Səsi aç'}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            {soundEnabled ? <Bell className="h-4 w-4 text-orange-700" /> : <BellOff className="h-4 w-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Səs açıqdır' : 'Səs bağlıdır'}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            <span>Çıxış</span>
          </button>
        </div>
      </div>

      {newAlertBanner && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          <span>{newAlertBanner}</span>
          <button
            type="button"
            onClick={() => setNewAlertBanner(null)}
            aria-label="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-orange-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-extrabold text-slate-900">
          Gələn sorğular <span className="font-mono text-slate-500">({feed.length})</span>
        </h2>
        <span className="text-xs font-medium text-slate-500">Real vaxtda yenilənir</span>
      </div>

      {feed.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-base font-bold text-slate-900">Hələlik yeni sorğu yoxdur</p>
          <p className="mt-1.5 text-sm text-slate-600">
            Sürücülər yeni sorğu göndərən kimi avtomatik olaraq burada görünəcək.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {feed.map((item) => (
            <article
              key={item.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span>{formatTimeAgoAz(item.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.totalQuotes} cavab</span>
                    </div>
                    <h3 className="mt-1 text-lg font-extrabold text-slate-900">
                      {item.carBrandModel} <span className="font-mono text-slate-600">({item.year})</span>
                    </h3>
                    <p className="mt-1 text-base font-semibold text-orange-700">{item.partName}</p>
                  </div>

                  {item.photoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setZoomPhoto(item.photoDataUrl || null)}
                      className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200"
                    >
                      <img
                        src={item.photoDataUrl}
                        alt={item.partName}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  )}
                </div>

                {item.myQuote && (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-900">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                      <span>
                        Göndərilib: <strong className="font-mono">{item.myQuote.priceAzn} AZN</strong> ·{' '}
                        {item.myQuote.condition}
                      </span>
                    </span>
                    <span className="text-emerald-700">{item.myQuote.availability}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => openQuoteModal(item)}
                  className={`flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                    item.myQuote
                      ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
                      : 'bg-orange-700 text-white hover:bg-orange-800'
                  }`}
                >
                  <Send className="h-4 w-4" />
                  <span>{item.myQuote ? 'Qiyməti yenilə' : 'Qiymət göndər'}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Quote Bottom Sheet / Modal */}
      {activeRequest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">
                  {activeRequest.carBrandModel} ({activeRequest.year})
                </p>
                <h3 className="mt-0.5 truncate text-lg font-extrabold text-slate-900">
                  {activeRequest.partName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveRequest(null)}
                aria-label="Bağla"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitQuote} className="mt-5 space-y-4">
              <div>
                <label htmlFor="quote-price" className="block text-sm font-semibold text-slate-900">
                  Qiymət (AZN)
                </label>
                <input
                  id="quote-price"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  autoFocus
                  value={priceAzn}
                  onChange={(e) => setPriceAzn(e.target.value)}
                  placeholder="Məsələn: 120"
                  className="mt-1.5 w-full min-h-[52px] rounded-xl border border-slate-300 px-4 font-mono text-xl font-bold text-slate-900 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
                  required
                />
              </div>

              <div>
                <span className="block text-sm font-semibold text-slate-900">Detalın vəziyyəti</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {CONDITIONS.map((cond) => (
                    <button
                      key={cond}
                      type="button"
                      onClick={() => setCondition(cond)}
                      className={`min-h-[44px] rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
                        condition === cond
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {cond}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-semibold text-slate-900">Mövcudluq</span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {AVAILABILITIES.map((avail) => (
                    <button
                      key={avail}
                      type="button"
                      onClick={() => setAvailability(avail)}
                      className={`min-h-[42px] rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors ${
                        availability === avail
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {avail}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="quote-comment" className="block text-sm font-semibold text-slate-900">
                  Əlavə qeyd <span className="font-normal text-slate-500">(istəyə bağlı)</span>
                </label>
                <input
                  id="quote-comment"
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Məsələn: Zəmanət verilir, Babək prospektindədir"
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-orange-600 focus:outline-none"
                />
              </div>

              {quoteError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800">
                  {quoteError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSendingQuote}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-700 px-5 py-3 text-base font-bold text-white hover:bg-orange-800 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                <span>{isSendingQuote ? 'Göndərilir...' : 'Qiyməti göndər'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {zoomPhoto && (
        <div
          onClick={() => setZoomPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4"
        >
          <button
            type="button"
            onClick={() => setZoomPhoto(null)}
            aria-label="Bağla"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={zoomPhoto}
            alt="Detalın böyüdülmüş şəkli"
            referrerPolicy="no-referrer"
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
