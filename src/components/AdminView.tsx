import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  Crown,
  Download,
  Edit3,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  LogOut,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Store,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { buildWhatsAppUrl, formatTimeAgoAz } from '../utils/phone';
import { triggerAlertFeedback } from '../utils/notify';
import { postJsonWithRetry } from '../utils/api';
import {
  type AdminPhoneBackup,
  clearAuthTokenFromPhone,
  getPhoneStorageStats,
  loadAdminBackupFromPhone,
  loadAuthTokenFromPhone,
  requestPersistentPhoneStorage,
  saveAdminBackupToPhone,
  saveAuthTokenToPhone,
} from '../utils/phoneStorage';
import { PushNotificationsButton } from './PushNotificationsButton';
import { QrPosterModal } from './QrPosterModal';
import { UnauthorizedDomainNotice } from './UnauthorizedDomainNotice';
import {
  ADMIN_EMAIL,
  consumeGmailRedirectResult,
  deleteShopFromFirestore,
  isFirebaseUserVerified,
  isUnauthorizedDomainError,
  loadAllShopsFromFirestoreForAdmin,
  mapFirebaseAuthErrorAz,
  resolveFirebaseUserEmail,
  signInWithGmail,
  signOutFirebase,
  syncShopToFirestore,
  syncUserProfileToFirestore,
} from '../firebase';
import type {
  AdminSettings,
  RequestWithQuotes,
  Shop,
  ShopStatus,
  ShopTariff,
  TelegramSubscriber,
  WsEvent,
} from '../types';

interface AdminShopRow extends Shop {
  isExpired: boolean;
  isEffectivelyActive: boolean;
  quoteCount: number;
}

interface AdminViewProps {
  onExitAdmin: () => void;
}

const TARIFFS: ShopTariff[] = ['Test', 'Bazis 25 AZN', 'VIP 40 AZN'];

function defaultExpiryDate(): string {
  const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function formatSafeDateTimeAz(iso?: string): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  try {
    return new Date(ts).toLocaleString('az-AZ');
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}

const GoogleBadgeIcon: React.FC = () => (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.4c-.2 1.2-1.5 3.6-5.4 3.6-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
    />
  </svg>
);

export const AdminView: React.FC<AdminViewProps> = ({ onExitAdmin }) => {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('avtotap_admin_token');
    } catch {
      return null;
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordFallback, setShowPasswordFallback] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleLoggingIn, setIsGoogleLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<'shops' | 'requests'>('shops');
  const [shops, setShops] = useState<AdminShopRow[]>([]);
  const [requests, setRequests] = useState<RequestWithQuotes[]>([]);
  const [settings, setSettings] = useState<AdminSettings>({
    adminWhatsapp: '+994 50 777 00 00',
    telegramBotConfigured: false,
  });
  const [loading, setLoading] = useState<boolean>(Boolean(token));

  // Phone storage backup state
  const [phoneBackup, setPhoneBackup] = useState<AdminPhoneBackup | null>(null);
  const [storageStats, setStorageStats] = useState<{ persisted: boolean; usedKb: number }>({
    persisted: false,
    usedKb: 0,
  });
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Add/Edit Shop Modal
  const [showShopModal, setShowShopModal] = useState(false);
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [shopDistrict, setShopDistrict] = useState('');
  const [shopWhatsapp, setShopWhatsapp] = useState('+994 ');
  const [shopOwnerEmail, setShopOwnerEmail] = useState('');
  const [shopTelegramChatId, setShopTelegramChatId] = useState('');
  const [shopPin, setShopPin] = useState('');
  const [shopTariff, setShopTariff] = useState<ShopTariff>('Bazis 25 AZN');
  const [shopExpiresAt, setShopExpiresAt] = useState(defaultExpiryDate());
  const [shopStatus, setShopStatus] = useState<ShopStatus>('Aktiv');
  const [shopFormError, setShopFormError] = useState<string | null>(null);
  const [isSavingShop, setIsSavingShop] = useState(false);

  // Telegram updates picker state
  const [tgSubscribers, setTgSubscribers] = useState<TelegramSubscriber[]>([]);
  const [tgLoading, setTgLoading] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);
  const [tgPanelOpen, setTgPanelOpen] = useState(false);
  const [selectedShopByChat, setSelectedShopByChat] = useState<Record<string, string>>({});
  const [bindingChatId, setBindingChatId] = useState<string | null>(null);

  // Settings edit
  const [adminWaInput, setAdminWaInput] = useState('');
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [passwordChangeMsg, setPasswordChangeMsg] = useState<string | null>(null);

  // Expanded request quotes
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);
  const [adminAlertBanner, setAdminAlertBanner] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  const settingsRef = useRef<AdminSettings>(settings);
  settingsRef.current = settings;

  const refreshPhoneStorageInfo = useCallback(async () => {
    const [backup, stats] = await Promise.all([
      loadAdminBackupFromPhone(),
      getPhoneStorageStats(),
    ]);
    const validBackup =
      backup && typeof backup === 'object' && Array.isArray(backup.shops)
        ? {
            ...backup,
            shops: backup.shops.filter(
              (s) => Boolean(s) && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string'
            ),
          }
        : null;
    setPhoneBackup(validBackup);
    setStorageStats(stats);
  }, []);

  useEffect(() => {
    void requestPersistentPhoneStorage().then(() => refreshPhoneStorageInfo());
    let hasLocalToken = false;
    try {
      hasLocalToken = Boolean(localStorage.getItem('avtotap_admin_token'));
    } catch {
      hasLocalToken = false;
    }
    if (!hasLocalToken) {
      void loadAuthTokenFromPhone('admin').then((savedToken) => {
        if (savedToken) {
          setToken((prev) => prev || savedToken);
          setLoading(true);
        }
      });
    }
  }, [refreshPhoneStorageInfo]);

  const fetchDashboard = useCallback(async (activeToken: string, forceSaveEmpty = false) => {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);
      const res = await fetch('/api/admin/dashboard', {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      const rawText = await res.text();
      let data: {
        error?: string;
        shops?: AdminShopRow[];
        requests?: RequestWithQuotes[];
        settings?: AdminSettings;
      } | null = null;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = null;
      }

      if (res.status === 401 && data && typeof data.error === 'string') {
        try {
          localStorage.removeItem('avtotap_admin_token');
        } catch {
          // ignore
        }
        void clearAuthTokenFromPhone('admin');
        setLoginError('Admin sessiyası bitdi və ya etibarsızdır. Yenidən daxil olun.');
        setToken(null);
        return;
      }
      if (!res.ok || !data) {
        return;
      }

      const nextShops: AdminShopRow[] = Array.isArray(data.shops)
        ? data.shops.filter((s): s is AdminShopRow => Boolean(s) && typeof s === 'object' && typeof s.id === 'string')
        : [];
      const nextRequests: RequestWithQuotes[] = Array.isArray(data.requests)
        ? data.requests
            .filter((r): r is RequestWithQuotes => Boolean(r) && typeof r === 'object' && typeof r.id === 'string')
            .map((r) => ({
              ...r,
              quotes: Array.isArray(r.quotes) ? r.quotes : [],
              quoteCount: typeof r.quoteCount === 'number' ? r.quoteCount : Array.isArray(r.quotes) ? r.quotes.length : 0,
            }))
        : [];
      const nextSettings: AdminSettings = data.settings || settingsRef.current;

      setShops(nextShops);
      setRequests(nextRequests);
      if (data.settings) {
        setSettings(nextSettings);
        setAdminWaInput(nextSettings.adminWhatsapp || '');
      }

      // Preserve existing phone backup if server booted empty unless explicit edit occurred
      const existingPhoneBackup = await loadAdminBackupFromPhone();
      const backupShopsCount = Array.isArray(existingPhoneBackup?.shops)
        ? existingPhoneBackup.shops.length
        : 0;

      // If server booted empty, attempt silent restore from Firestore cloud
      if (nextShops.length === 0 && !forceSaveEmpty) {
        try {
          const cloudShops = await loadAllShopsFromFirestoreForAdmin();
          if (cloudShops.length > 0) {
            const restoreRes = await postJsonWithRetry<{ restoredCount?: number }>(
              '/api/admin/restore-snapshot',
              { shops: cloudShops, adminWhatsapp: nextSettings.adminWhatsapp },
              { token: activeToken, retries: 1, timeoutMs: 12000 }
            );
            if (restoreRes.ok && (restoreRes.data.restoredCount || 0) > 0) {
              void fetchDashboard(activeToken, true);
              return;
            }
          }
        } catch {
          // ignore if admin isn't signed in to Firebase yet
        }
      }

      if (nextShops.length > 0 || forceSaveEmpty || backupShopsCount === 0) {
        const saved = await saveAdminBackupToPhone(nextShops, nextSettings);
        setPhoneBackup(saved);
      } else {
        setPhoneBackup(existingPhoneBackup);
      }
      setStorageStats(await getPhoneStorageStats());
    } catch {
      // ignore transient network issue; keep session and cached phone data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      void fetchDashboard(token);
    }
  }, [token, fetchDashboard]);

  // Real-time WebSocket sync for Admin
  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUser = false;

    const connect = () => {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${window.location.host}/ws?role=admin&token=${encodeURIComponent(token)}`;
        socket = new WebSocket(url);

        socket.onopen = () => {
          void fetchDashboard(token);
        };

      socket.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as WsEvent;
          if (event.type === 'request:created') {
            triggerAlertFeedback('incoming', {
              notification: {
                title: `Yeni sürücü sorğusu: ${event.payload.carBrandModel}`,
                body: `${event.payload.partName} (${event.payload.year})`,
                url: '/#admin',
                tag: `admin-req-${event.payload.id}`,
              },
            });
            setAdminAlertBanner(
              `Yeni sorğu: ${event.payload.carBrandModel} (${event.payload.year}) — ${event.payload.partName}`
            );
            setRequests((prev) => {
              if (prev.some((r) => r.id === event.payload.id)) return prev;
              return [event.payload, ...prev];
            });
          } else if (event.type === 'quote:created') {
            triggerAlertFeedback('incoming', {
              notification: {
                title: `Yeni cavab: ${event.payload.quote.shopName} — ${event.payload.quote.priceAzn} AZN`,
                body: `${event.payload.quote.condition} · ${event.payload.quote.availability}`,
                url: '/#admin',
                tag: `admin-quote-${event.payload.quote.id}`,
              },
            });
            setAdminAlertBanner(
              `Yeni cavab: ${event.payload.quote.shopName} — ${event.payload.quote.priceAzn} AZN`
            );
            setRequests((prev) =>
              prev.map((r) => {
                if (r.id !== event.payload.requestId) return r;
                const filtered = r.quotes.filter(
                  (q) => q.id !== event.payload.quote.id && q.shopId !== event.payload.quote.shopId
                );
                const nextQuotes = [event.payload.quote, ...filtered];
                return { ...r, quotes: nextQuotes, quoteCount: nextQuotes.length };
              })
            );
          } else if (event.type === 'request:deleted') {
            setRequests((prev) => prev.filter((r) => r.id !== event.payload.requestId));
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
      } catch {
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      }
    };

    connect();
    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token, fetchDashboard]);

  const completeGoogleAdminSignIn = useCallback(
    async (user: NonNullable<Awaited<ReturnType<typeof signInWithGmail>>>) => {
      const email = resolveFirebaseUserEmail(user);
      if (!isFirebaseUserVerified(user) || email !== ADMIN_EMAIL) {
        await signOutFirebase();
        setLoginError(
          `Bu Gmail (${email || 'naməlum'}) admin deyil. Zəhmət olmasa ${ADMIN_EMAIL} hesabı ilə daxil olun.`
        );
        return;
      }

      const idToken = await user.getIdToken();
      const result = await postJsonWithRetry<{ token?: string; error?: string }>(
        '/api/auth/firebase-admin',
        { idToken },
        { retries: 2, timeoutMs: 15000 }
      );
      if (!result.ok || !result.data.token) {
        setLoginError(result.data.error || 'Admin girişi təsdiqlənmədi.');
        return;
      }

      try {
        localStorage.setItem('avtotap_admin_token', result.data.token);
      } catch {
        // ignore
      }
      setToken(result.data.token);
      setPassword('');
      setLoading(true);
      void saveAuthTokenToPhone('admin', result.data.token);
      void syncUserProfileToFirestore(user, 'admin').catch(() => {});
    },
    []
  );

  useEffect(() => {
    let active = true;
    void consumeGmailRedirectResult()
      .then((redirectUser) => {
        if (!active || !redirectUser) return;
        setIsGoogleLoggingIn(true);
        return completeGoogleAdminSignIn(redirectUser).finally(() => {
          if (active) setIsGoogleLoggingIn(false);
        });
      })
      .catch((err) => {
        if (!active) return;
        if (isUnauthorizedDomainError(err)) {
          setUnauthorizedDomain(true);
          setShowPasswordFallback(true);
        }
        setLoginError(mapFirebaseAuthErrorAz(err));
      });
    return () => {
      active = false;
    };
  }, [completeGoogleAdminSignIn]);

  const handleGoogleLogin = async () => {
    if (isGoogleLoggingIn || isLoggingIn) return;
    setLoginError(null);
    setUnauthorizedDomain(false);
    setIsGoogleLoggingIn(true);
    try {
      const user = await signInWithGmail();
      if (!user) {
        return;
      }
      await completeGoogleAdminSignIn(user);
    } catch (err) {
      if (isUnauthorizedDomainError(err)) {
        setUnauthorizedDomain(true);
      }
      setShowPasswordFallback(true);
      setLoginError(mapFirebaseAuthErrorAz(err));
    } finally {
      setIsGoogleLoggingIn(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn || isGoogleLoggingIn) return;
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const result = await postJsonWithRetry<{ token?: string; error?: string }>(
        '/api/admin/login',
        { password },
        { retries: 2, timeoutMs: 15000 }
      );
      if (!result.ok || !result.data.token) {
        setLoginError(result.data.error || 'Şifrə yanlışdır.');
        return;
      }
      try {
        localStorage.setItem('avtotap_admin_token', result.data.token);
      } catch {
        // ignore
      }
      setToken(result.data.token);
      setPassword('');
      setLoading(true);
      void saveAuthTokenToPhone('admin', result.data.token);
    } catch {
      setLoginError('Giriş zamanı gözlənilməz xəta baş verdi. Yenidən cəhd edin.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('avtotap_admin_token');
    } catch {
      // ignore
    }
    void clearAuthTokenFromPhone('admin');
    void signOutFirebase();
    setLoginError(null);
    setToken(null);
    setShops([]);
    setRequests([]);
  };

  const handleManualSaveToPhone = async () => {
    const saved = await saveAdminBackupToPhone(shops, settings);
    setPhoneBackup(saved);
    setStorageStats(await getPhoneStorageStats());
    setStorageFeedback('Məlumatlar telefon yaddaşına yazıldı');
    setTimeout(() => setStorageFeedback(null), 2500);
  };

  const handleRestoreFromBackupData = async (backup: AdminPhoneBackup) => {
    if (!token) return;
    setIsRestoringBackup(true);
    setStorageFeedback(null);
    try {
      const res = await fetch('/api/admin/restore-snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shops: backup.shops,
          adminWhatsapp: backup.adminWhatsapp,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStorageFeedback(data.error || 'Bərpa alınmadı.');
        return;
      }
      setStorageFeedback(`Telefon yaddaşından ${data.restoredCount} mağaza bərpa edildi`);
      setTimeout(() => setStorageFeedback(null), 3500);
      await fetchDashboard(token, true);
    } catch {
      setStorageFeedback('Bərpa zamanı şəbəkə xətası.');
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleExportJson = () => {
    const backup = {
      shops: shops.map((s) => ({
        id: s.id,
        name: s.name,
        district: s.district,
        whatsapp: s.whatsapp,
        telegramChatId: s.telegramChatId,
        pin: s.pin,
        tariff: s.tariff,
        expiresAt: s.expiresAt,
        status: s.status,
        createdAt: s.createdAt,
      })),
      adminWhatsapp: settings.adminWhatsapp,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `serur-avtozapcast-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AdminPhoneBackup;
      if (!parsed || !Array.isArray(parsed.shops)) {
        setStorageFeedback('Yedək faylı düzgün formatda deyil.');
        return;
      }
      await handleRestoreFromBackupData(parsed);
    } catch {
      setStorageFeedback('Faylı oxumaq mümkün olmadı.');
    }
  };

  const handleFetchTelegramUpdates = async (openPanel = true) => {
    if (!token) return;
    if (openPanel) setTgPanelOpen(true);
    setTgLoading(true);
    setTgError(null);
    try {
      const res = await fetch('/api/admin/telegram/updates', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setTgError(data.error || 'Telegram yeniləmələri alınmadı.');
        return;
      }
      const list = Array.isArray(data.subscribers) ? (data.subscribers as TelegramSubscriber[]) : [];
      setTgSubscribers(list);
      if (shops.length > 0) {
        setSelectedShopByChat((prev) => {
          const next = { ...prev };
          for (const sub of list) {
            if (!next[sub.chatId]) {
              next[sub.chatId] = shops[0].id;
            }
          }
          return next;
        });
      }
    } catch {
      setTgError('Serverlə əlaqə xətası.');
    } finally {
      setTgLoading(false);
    }
  };

  const handleBindTelegramToShop = async (chatId: string) => {
    if (!token) return;
    const targetShopId = selectedShopByChat[chatId] || shops[0]?.id;
    if (!targetShopId) return;
    setBindingChatId(chatId);
    try {
      const res = await fetch(`/api/admin/shops/${targetShopId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ telegramChatId: chatId }),
      });
      if (res.ok) {
        await fetchDashboard(token, true);
      }
    } finally {
      setBindingChatId(null);
    }
  };

  const openCreateShop = (prefillChatId = '') => {
    setEditingShopId(null);
    setShopName('');
    setShopDistrict('');
    setShopWhatsapp('+994 ');
    setShopOwnerEmail('');
    setShopTelegramChatId(prefillChatId);
    setShopPin(String(Math.floor(1000 + Math.random() * 9000)));
    setShopTariff('Bazis 25 AZN');
    setShopExpiresAt(defaultExpiryDate());
    setShopStatus('Aktiv');
    setShopFormError(null);
    setShowShopModal(true);
  };

  const openEditShop = (shop: AdminShopRow) => {
    setEditingShopId(shop.id);
    setShopName(shop.name);
    setShopDistrict(shop.district || '');
    setShopWhatsapp(shop.whatsapp);
    setShopOwnerEmail(shop.ownerEmail || '');
    setShopTelegramChatId(shop.telegramChatId || '');
    setShopPin(shop.pin);
    setShopTariff(shop.tariff);
    setShopExpiresAt(shop.expiresAt);
    setShopStatus(shop.status);
    setShopFormError(null);
    setShowShopModal(true);
  };

  const handleSaveShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setShopFormError(null);
    setIsSavingShop(true);
    try {
      const url = editingShopId ? `/api/admin/shops/${editingShopId}` : '/api/admin/shops';
      const method = editingShopId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: shopName.trim(),
          district: shopDistrict.trim(),
          whatsapp: shopWhatsapp.trim(),
          ownerEmail: shopOwnerEmail.trim().toLowerCase(),
          telegramChatId: shopTelegramChatId.trim(),
          pin: shopPin.trim(),
          tariff: shopTariff,
          expiresAt: shopExpiresAt,
          status: shopStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShopFormError(data.error || 'Yadda saxlanmadı.');
        return;
      }
      if (data.shop) {
        void syncShopToFirestore(data.shop as Shop, { asAdmin: true }).catch(() => {});
      }
      setShowShopModal(false);
      await fetchDashboard(token, true);
    } catch {
      setShopFormError('Şəbəkə xətası.');
    } finally {
      setIsSavingShop(false);
    }
  };

  const handleToggleShopStatus = async (shop: AdminShopRow) => {
    if (!token) return;
    const nextStatus: ShopStatus = shop.status === 'Aktiv' ? 'Deaktiv' : 'Aktiv';
    try {
      const res = await fetch(`/api/admin/shops/${shop.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.shop) {
        void syncShopToFirestore(data.shop as Shop, { asAdmin: true }).catch(() => {});
      }
      await fetchDashboard(token, true);
    } catch {
      // ignore
    }
  };

  const handleDeleteShop = async (shopId: string) => {
    if (!token) return;
    try {
      await fetch(`/api/admin/shops/${shopId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      void deleteShopFromFirestore(shopId).catch(() => {});
      await fetchDashboard(token, true);
    } catch {
      // ignore
    }
  };

  const handleDeleteSpamRequest = async (reqId: string) => {
    if (!token) return;
    try {
      await fetch(`/api/admin/requests/${reqId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
    } catch {
      // ignore
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ adminWhatsapp: adminWaInput.trim() }),
      });
      if (res.ok) {
        setSettingsSavedMsg('Yadda saxlandı');
        setTimeout(() => setSettingsSavedMsg(null), 2500);
        await fetchDashboard(token, true);
      }
    } catch {
      // ignore
    }
  };

  const handleChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newAdminPassword.trim()) return;
    setPasswordChangeMsg(null);
    try {
      const res = await fetch('/api/admin/password', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: newAdminPassword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordChangeMsg(data.error || 'Şifrə dəyişdirilmədi.');
        return;
      }
      setNewAdminPassword('');
      setPasswordChangeMsg('Yeni şifrə yadda saxlandı');
      setTimeout(() => setPasswordChangeMsg(null), 3000);
    } catch {
      setPasswordChangeMsg('Şəbəkə xətası.');
    }
  };

  if (!token) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-14">
        <button
          type="button"
          onClick={onExitAdmin}
          className="mb-4 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Sürücü ekranına qayıt</span>
        </button>

        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-[0_2px_10px_rgba(11,17,32,0.03),0_18px_40px_-24px_rgba(11,17,32,0.12)]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0B1120] text-amber-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-slate-950">Admin panel</h1>
              <p className="text-xs text-slate-500">Yalnız sistem sahibi ({ADMIN_EMAIL}) üçün giriş</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <button
              type="button"
              disabled={isGoogleLoggingIn || isLoggingIn}
              onClick={() => void handleGoogleLogin()}
              className="flex w-full min-h-[54px] items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-bold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <GoogleBadgeIcon />
              <span>{isGoogleLoggingIn ? 'Gmail yoxlanılır...' : 'Google (Gmail) ilə daxil ol'}</span>
            </button>

            {loginError && (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {loginError}
              </div>
            )}

            {unauthorizedDomain && <UnauthorizedDomainNotice />}

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setShowPasswordFallback((v) => !v)}
                className="text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-900"
              >
                {showPasswordFallback ? 'Şifrə bölməsini gizlət' : 'Şifrə ilə ehtiyat giriş'}
              </button>
            </div>

            {showPasswordFallback && (
              <form onSubmit={handleLogin} className="space-y-3 border-t border-slate-100 pt-4">
                <div>
                  <label htmlFor="admin-password" className="block text-xs font-bold text-slate-800">
                    Admin şifrəsi
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="admin-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Şifrəni daxil edin"
                      className="w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 pl-4 pr-12 text-base text-slate-950 transition-colors focus:border-slate-950 focus:bg-white focus:outline-none focus:ring-4 focus:ring-slate-900/10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Şifrəni gizlət' : 'Şifrəni göstər'}
                      className="absolute right-1 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn || isGoogleLoggingIn}
                  className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#0B1120] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>{isLoggingIn ? 'Yoxlanılır...' : 'Şifrə ilə daxil ol'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  const backupShopsList = Array.isArray(phoneBackup?.shops) ? phoneBackup.shops : [];
  const canOfferOneTapRestore = shops.length === 0 && backupShopsList.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-9">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#0B1120] p-5 text-white shadow-[0_14px_32px_-16px_rgba(11,17,32,0.5)]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExitAdmin}
            aria-label="Geri"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-display text-lg font-extrabold">Admin İdarəetmə Paneli</h1>
            <p className="text-xs text-slate-300">
              {shops.length} mağaza · {requests.length} sorğu
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PushNotificationsButton role="admin" authToken={token} compact />
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20"
          >
            <LogOut className="h-4 w-4" />
            <span>Çıxış</span>
          </button>
        </div>
      </div>

      {adminAlertBanner && (
        <div
          role="status"
          className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5 text-sm font-bold text-orange-950 shadow-sm"
        >
          <span>{adminAlertBanner}</span>
          <button
            type="button"
            onClick={() => setAdminAlertBanner(null)}
            aria-label="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-orange-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-2xl bg-slate-200/80 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('shops')}
            className={`min-h-[42px] rounded-xl px-5 py-2 text-sm font-bold transition-colors whitespace-nowrap ${
              activeTab === 'shops'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Mağazalar ({shops.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`min-h-[42px] rounded-xl px-5 py-2 text-sm font-bold transition-colors whitespace-nowrap ${
              activeTab === 'requests'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Sorğular ({requests.length})
          </button>
        </div>

        {activeTab === 'shops' && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 whitespace-nowrap"
            >
              <QrCode className="h-4 w-4 text-orange-600" />
              <span>QR kart (Çap et)</span>
            </button>

            <button
              type="button"
              onClick={() => void handleFetchTelegramUpdates(true)}
              disabled={tgLoading}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 text-sky-700 ${tgLoading ? 'animate-spin' : ''}`} />
              <span>Telegram-dan yenilə</span>
            </button>

            <button
              type="button"
              onClick={() => openCreateShop('')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-gradient-to-b from-orange-600 to-orange-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:from-orange-700 hover:to-orange-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Yeni mağaza əlavə et</span>
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-600">Yüklənir...</p>
      ) : activeTab === 'shops' ? (
        <div className="space-y-6">
          {/* Prompt to restore from phone storage if server is empty and phone has backup */}
          {canOfferOneTapRestore && phoneBackup && (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
              <div>
                <h2 className="font-display text-base font-extrabold text-slate-950">
                  Telefon yaddaşında {backupShopsList.length} mağaza tapıldı
                </h2>
                <p className="mt-0.5 text-xs text-slate-700">
                  Son saxlanma: {formatSafeDateTimeAz(phoneBackup.savedAt)}. Bir toxunuşla bərpa edə bilərsiniz.
                </p>
              </div>
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={() => void handleRestoreFromBackupData(phoneBackup)}
                className="inline-flex min-h-[46px] items-center gap-2 rounded-2xl bg-[#0B1120] px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />
                <span>{isRestoringBackup ? 'Bərpa edilir...' : 'Telefon yaddaşından bərpa et'}</span>
              </button>
            </section>
          )}

          {/* Telegram Subscribers Picker Panel */}
          {tgPanelOpen && (
            <section className="rounded-3xl border border-sky-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Bot className="h-5 w-5 text-sky-700" />
                  <div>
                    <h2 className="font-display text-sm font-extrabold text-slate-950">
                      Botda Start basanlar (Telegram Chat ID)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Bir toxunuşla istənilən mağazaya Chat ID təyin edin
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTgPanelOpen(false)}
                  aria-label="Bağla"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {tgLoading ? (
                <p className="mt-4 text-xs text-slate-600">Telegram-dan siyahı yüklənir...</p>
              ) : tgError ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800">
                  {tgError}
                </div>
              ) : tgSubscribers.length === 0 ? (
                <p className="mt-4 text-xs text-slate-600">
                  Hələ heç kim botda Start düyməsinə basmayıb. Mağaza sahibi bota <strong>/start</strong> yazdıqdan sonra «Telegram-dan yenilə» düyməsini sıxın.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-slate-100">
                  {tgSubscribers.map((sub) => {
                    const alreadyLinkedShop = shops.find((s) => s.telegramChatId === sub.chatId);
                    return (
                      <div
                        key={sub.chatId}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-950">
                            {sub.displayName}{' '}
                            {sub.username && (
                              <span className="font-normal text-sky-700">@{sub.username}</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 font-mono">
                            Chat ID: {sub.chatId}
                            {alreadyLinkedShop ? ` · Bağlıdır: ${alreadyLinkedShop.name}` : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {shops.length > 0 && (
                            <>
                              <select
                                value={selectedShopByChat[sub.chatId] || shops[0].id}
                                onChange={(e) =>
                                  setSelectedShopByChat((prev) => ({
                                    ...prev,
                                    [sub.chatId]: e.target.value,
                                  }))
                                }
                                className="min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-800"
                              >
                                {shops.map((sh) => (
                                  <option key={sh.id} value={sh.id}>
                                    {sh.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={bindingChatId === sub.chatId}
                                onClick={() => void handleBindTelegramToShop(sub.chatId)}
                                className="min-h-[40px] rounded-xl bg-[#0B1120] px-3.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                              >
                                {bindingChatId === sub.chatId ? 'Bağlanır...' : 'Mağazaya bağla'}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => openCreateShop(sub.chatId)}
                            className="min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 hover:bg-slate-100"
                          >
                            + Yeni mağaza
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Shops Grid */}
          {shops.length === 0 ? (
            <div className="rounded-3xl border border-slate-200/90 bg-white p-9 text-center shadow-sm">
              <Store className="mx-auto h-9 w-9 text-slate-400" />
              <p className="mt-3 font-display text-base font-bold text-slate-950">Hələlik mağaza əlavə olunmayıb</p>
              <p className="mt-1 text-xs text-slate-500">
                «Yeni mağaza əlavə et» düyməsi ilə ilk mağazanızı əlavə edin.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {shops.map((shop) => {
                const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
                const inviteText = `Salam! "${shop.name}" mağazası Şərur AvtoZapcast sisteminə qoşuldu.\nKabinet linki: ${appOrigin}/?tab=shop\nTelefon: ${shop.whatsapp}\nPIN kod: ${shop.pin}\nTarif: ${shop.tariff} (${shop.expiresAt}-dək)`;
                const inviteWaUrl = buildWhatsAppUrl(shop.whatsapp, inviteText);

                return (
                  <article
                    key={shop.id}
                    className={`rounded-3xl border p-5 shadow-sm transition-shadow hover:shadow-md ${
                      shop.status === 'Aktiv'
                        ? 'border-slate-200/90 bg-white'
                        : 'border-slate-200 bg-slate-100/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {shop.tariff === 'VIP 40 AZN' && (
                            <Crown className="h-4 w-4 shrink-0 text-amber-600" />
                          )}
                          <h3 className="truncate font-display text-base font-extrabold text-slate-950">
                            {shop.name}
                          </h3>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                          {shop.district && (
                            <>
                              <span>{shop.district}</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span className="font-semibold text-slate-900">{shop.tariff}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{shop.quoteCount} cavab</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleToggleShopStatus(shop)}
                        className={`min-h-[38px] rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                          shop.status === 'Aktiv'
                            ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                            : 'bg-slate-700 text-white hover:bg-slate-800'
                        }`}
                      >
                        {shop.status === 'Aktiv' ? 'Aktiv' : 'Deaktiv'}
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2.5 rounded-2xl bg-slate-50 p-3.5 text-xs border border-slate-100 sm:grid-cols-4">
                      <div>
                        <span className="block text-slate-500">WhatsApp</span>
                        <span className="font-mono font-semibold text-slate-900 break-all">
                          {shop.whatsapp}
                        </span>
                      </div>
                      <div>
                        <span className="block text-slate-500">Gmail hesabı</span>
                        <span
                          className={`font-mono font-semibold break-all ${
                            shop.ownerEmail ? 'text-sky-700' : 'text-slate-400'
                          }`}
                        >
                          {shop.ownerEmail || 'Bağlanmayıb'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-slate-500">PIN kod</span>
                        <span className="font-mono font-bold text-slate-900">{shop.pin}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">Bitmə tarixi</span>
                        <span
                          className={`font-mono font-semibold ${
                            shop.isExpired ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {shop.expiresAt}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <a
                        href={inviteWaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex flex-1 min-h-[44px] items-center justify-center gap-1.5 rounded-2xl bg-green-700 px-3 py-2 text-xs font-bold text-white hover:bg-green-800"
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span>PIN-i WhatsApp-a at</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => openEditShop(shop)}
                        aria-label="Redaktə et"
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Edit3 className="h-4 w-4" />
                        <span>Düzəliş</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDeleteShop(shop.id)}
                        aria-label="Sil"
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Phone Storage & Backup Control Panel */}
          <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-800">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-extrabold text-slate-950">
                    Telefon yaddaşı (IndexedDB)
                  </h2>
                  <p className="text-xs text-slate-500">
                    {storageStats.persisted ? 'Qorunan daimi yaddaş' : 'Yerli brauzer yaddaşı'} ·{' '}
                    <span className="font-mono tabular-nums">
                      {backupShopsList.length} mağaza · {storageStats.usedKb} KB
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleManualSaveToPhone()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0B1120] px-3.5 text-xs font-bold text-white hover:bg-slate-800"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Telefona yaz</span>
                </button>

                {phoneBackup && backupShopsList.length > 0 && (
                  <button
                    type="button"
                    disabled={isRestoringBackup}
                    onClick={() => void handleRestoreFromBackupData(phoneBackup)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-60"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Bərpa et</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleExportJson}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Yedəyi yüklə</span>
                </button>

                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportJson}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Fayldan bərpa</span>
                </button>
              </div>
            </div>

            {storageFeedback && (
              <p className="text-xs font-semibold text-emerald-700">{storageFeedback}</p>
            )}
          </section>

          {/* Admin Contact & Telegram Status Settings */}
          <form
            onSubmit={handleSaveSettings}
            className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm"
          >
            <div className="flex-1 min-w-[220px]">
              <label htmlFor="admin-wa-setting" className="block text-xs font-bold text-slate-700">
                Admin WhatsApp nömrəsi (abunəliyi bitən mağazalar üçün)
              </label>
              <input
                id="admin-wa-setting"
                type="tel"
                value={adminWaInput}
                onChange={(e) => setAdminWaInput(e.target.value)}
                className="mt-1.5 w-full min-h-[46px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-[46px] items-center gap-1.5 rounded-2xl bg-[#0B1120] px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              <Save className="h-4 w-4" />
              <span>{settingsSavedMsg || 'Yadda saxla'}</span>
            </button>
            <div className="w-full text-xs text-slate-500">
              Telegram Bot statusu:{' '}
              <strong className={settings.telegramBotConfigured ? 'text-emerald-700' : 'text-amber-700'}>
                {settings.telegramBotConfigured
                  ? 'Aktivdir (TELEGRAM_BOT_TOKEN qoşulub — yeni sorğular mağazaların Telegram-ına göndərilir)'
                  : 'TELEGRAM_BOT_TOKEN təyin edilməyib (Secrets bölməsində əlavə edin)'}
              </strong>
            </div>
          </form>

          <form
            onSubmit={handleChangeAdminPassword}
            className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm"
          >
            <div className="flex-1 min-w-[220px]">
              <label htmlFor="new-admin-pw" className="block text-xs font-bold text-slate-700">
                Admin şifrəsini dəyiş (minimum 6 simvol)
              </label>
              <input
                id="new-admin-pw"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                placeholder="Yeni şifrəni daxil edin"
                className="mt-1.5 w-full min-h-[46px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-[46px] items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100"
            >
              <KeyRound className="h-4 w-4" />
              <span>Şifrəni yenilə</span>
            </button>
            {passwordChangeMsg && (
              <p className="w-full text-xs font-semibold text-emerald-700">{passwordChangeMsg}</p>
            )}
          </form>
        </div>
      ) : (
        /* Requests Tab */
        <div className="space-y-4">
          {requests.length === 0 ? (
            <div className="rounded-3xl border border-slate-200/90 bg-white p-10 text-center shadow-sm">
              <p className="font-display text-base font-bold text-slate-950">Hələlik sürücü sorğusu yoxdur</p>
            </div>
          ) : (
            requests.map((reqItem) => {
              const isExpanded = expandedReqId === reqItem.id;
              const reqQuotes = Array.isArray(reqItem.quotes) ? reqItem.quotes : [];
              return (
                <article
                  key={reqItem.id}
                  className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      {reqItem.photoDataUrl && (
                        <img
                          src={reqItem.photoDataUrl}
                          alt={reqItem.partName}
                          referrerPolicy="no-referrer"
                          className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200 object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span className="font-mono">#{String(reqItem.id || '').slice(-6).toUpperCase()}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatTimeAgoAz(reqItem.createdAt)}</span>
                        </div>
                        <h3 className="mt-1 font-display text-base font-extrabold text-slate-950">
                          {reqItem.carBrandModel} <span className="font-mono text-slate-500">({reqItem.year})</span>
                        </h3>
                        <p className="text-sm font-bold text-orange-700">{reqItem.partName}</p>
                        <p className="mt-1 font-mono text-xs text-slate-600">
                          Sürücü: {reqItem.driverWhatsapp}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedReqId(isExpanded ? null : reqItem.id)}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
                      >
                        <span>Cavablar ({reqItem.quoteCount ?? reqQuotes.length})</span>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDeleteSpamRequest(reqItem.id)}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Spamı sil</span>
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                      {reqQuotes.length === 0 ? (
                        <p className="text-xs text-slate-500">Hələlik bu sorğuya cavab göndərilməyib.</p>
                      ) : (
                        reqQuotes.map((q) => (
                          <div
                            key={q.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs"
                          >
                            <div>
                              <span className="font-bold text-slate-950">{q.shopName}</span>
                              {q.isVip && <span className="ml-2 font-bold text-amber-700">VIP</span>}
                              <span className="mx-2 text-slate-400">·</span>
                              <span className="text-slate-600">
                                {q.condition} · {q.availability}
                              </span>
                            </div>
                            <span className="font-mono font-extrabold text-slate-950">
                              {q.priceAzn} AZN
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {/* Add / Edit Shop Modal */}
      {showShopModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 sm:p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-extrabold text-slate-950">
                {editingShopId ? 'Mağazanı redaktə et' : 'Yeni mağaza əlavə et'}
              </h2>
              <button
                type="button"
                onClick={() => setShowShopModal(false)}
                aria-label="Bağla"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveShop} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">Mağaza adı</label>
                <input
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="Məsələn: Avto Zapçast"
                  className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Ünvan (istəyə bağlı)</label>
                  <input
                    type="text"
                    value={shopDistrict}
                    onChange={(e) => setShopDistrict(e.target.value)}
                    placeholder="Məsələn: Mərkəzi küçə 15"
                    className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">WhatsApp nömrəsi</label>
                  <input
                    type="tel"
                    value={shopWhatsapp}
                    onChange={(e) => setShopWhatsapp(e.target.value)}
                    placeholder="+994 50 123 45 67"
                    className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Mağaza Gmail ünvanı <span className="font-normal text-slate-500">(Google girişi üçün)</span>
                </label>
                <input
                  type="email"
                  value={shopOwnerEmail}
                  onChange={(e) => setShopOwnerEmail(e.target.value)}
                  placeholder="magaza@gmail.com"
                  className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              {/* Telegram Chat ID with inline picker */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-bold text-slate-700">
                    Telegram Chat ID <span className="font-normal text-slate-500">(bildirişlər üçün)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleFetchTelegramUpdates(false)}
                    disabled={tgLoading}
                    className="text-xs font-bold text-sky-700 hover:underline"
                  >
                    {tgLoading ? 'Yüklənir...' : 'Telegram-dan yenilə'}
                  </button>
                </div>
                <input
                  type="text"
                  value={shopTelegramChatId}
                  onChange={(e) => setShopTelegramChatId(e.target.value)}
                  placeholder="Məsələn: 123456789"
                  className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                />

                {tgSubscribers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tgSubscribers.slice(0, 6).map((sub) => (
                      <button
                        key={sub.chatId}
                        type="button"
                        onClick={() => setShopTelegramChatId(sub.chatId)}
                        className={`rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          shopTelegramChatId === sub.chatId
                            ? 'border-sky-700 bg-sky-700 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {sub.displayName} ({sub.chatId})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Giriş PIN kodu</label>
                  <input
                    type="text"
                    value={shopPin}
                    onChange={(e) => setShopPin(e.target.value)}
                    placeholder="4 rəqəmli kod"
                    className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Abunəlik bitmə tarixi</label>
                  <input
                    type="date"
                    value={shopExpiresAt}
                    onChange={(e) => setShopExpiresAt(e.target.value)}
                    className="mt-1 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 font-mono text-sm text-slate-950 focus:border-slate-900 focus:bg-white focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs font-bold text-slate-700">Tarif</span>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {TARIFFS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setShopTariff(t)}
                      className={`min-h-[44px] rounded-2xl border px-2 py-2 text-xs font-bold transition-colors ${
                        shopTariff === t
                          ? 'border-[#0B1120] bg-[#0B1120] text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-bold text-slate-700">Status</span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(['Aktiv', 'Deaktiv'] as ShopStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setShopStatus(st)}
                      className={`min-h-[44px] rounded-2xl border px-3 py-2 text-xs font-bold transition-colors ${
                        shopStatus === st
                          ? st === 'Aktiv'
                            ? 'border-emerald-700 bg-emerald-700 text-white'
                            : 'border-slate-800 bg-slate-800 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {shopFormError && (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800">
                  {shopFormError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingShop}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-600 to-orange-700 px-5 py-3 text-sm font-bold text-white shadow-sm hover:from-orange-700 hover:to-orange-800 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                <span>{isSavingShop ? 'Saxlanılır...' : 'Yadda saxla'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      <QrPosterModal open={showQrModal} onClose={() => setShowQrModal(false)} />
    </div>
  );
};
