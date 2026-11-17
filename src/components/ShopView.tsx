import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Lock,
  LogOut,
  MessageCircle,
  Send,
  Smartphone,
  Store,
  Volume2,
  X,
} from 'lucide-react';
import { buildWhatsAppUrl, formatTimeAgoAz } from '../utils/phone';
import { subscribePushNotifications, triggerAlertFeedback, unlockAudio } from '../utils/notify';
import { postJsonWithRetry } from '../utils/api';
import {
  clearAuthTokenFromPhone,
  clearPreferredSection,
  clearShopProfileFromPhone,
  loadAuthTokenFromPhone,
  loadShopFeedFromPhone,
  loadShopProfileFromPhone,
  saveAuthTokenToPhone,
  savePreferredSection,
  saveShopFeedToPhone,
  saveShopProfileToPhone,
} from '../utils/phoneStorage';
import { PushNotificationsButton } from './PushNotificationsButton';
import { UnauthorizedDomainNotice } from './UnauthorizedDomainNotice';
import {
  auth,
  consumeGmailRedirectResult,
  isUnauthorizedDomainError,
  loadMyShopFromFirestore,
  mapFirebaseAuthErrorAz,
  resolveFirebaseUserEmail,
  signInWithGmail,
  signOutFirebase,
  syncShopToFirestore,
  syncUserProfileToFirestore,
} from '../firebase';
import type {
  PartAvailability,
  PartCondition,
  PartRequest,
  PublicShopInfo,
  Shop,
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

const GoogleBadgeIcon: React.FC = () => (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.4c-.2 1.2-1.5 3.6-5.4 3.6-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
    />
  </svg>
);

export const ShopView: React.FC<ShopViewProps> = ({ replyRequestId, onClearReplyId }) => {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('avtotap_shop_token');
    } catch {
      return null;
    }
  });
  const [shop, setShop] = useState<PublicShopInfo | null>(null);
  const [adminWhatsapp, setAdminWhatsapp] = useState<string>('');
  const [feed, setFeed] = useState<ShopFeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(token));

  // Login & Gmail registration state
  const [loginPhone, setLoginPhone] = useState(() => {
    try {
      return localStorage.getItem('avtotap_shop_phone') || '+994 ';
    } catch {
      return '+994 ';
    }
  });
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPinFallback, setShowPinFallback] = useState(false);
  const [pendingGoogleReg, setPendingGoogleReg] = useState<{
    uid: string;
    email: string;
    displayName: string;
  } | null>(null);
  const [regShopName, setRegShopName] = useState('');
  const [regWhatsapp, setRegWhatsapp] = useState('+994 ');
  const [regDistrict, setRegDistrict] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Quote modal state
  const [activeRequest, setActiveRequest] = useState<ShopFeedItem | null>(null);
  const [priceAzn, setPriceAzn] = useState('');
  const [condition, setCondition] = useState<PartCondition>('Orijinal');
  const [availability, setAvailability] = useState<PartAvailability>('Mövcuddur');
  const [comment, setComment] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isSendingQuote, setIsSendingQuote] = useState(false);

  // Media, sound, wake-lock & live status
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [newAlertBanner, setNewAlertBanner] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const seenRequestIdsRef = useRef<Set<string>>(new Set());
  const feedInitializedRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Hydrate token once on mount if localStorage was cleared by OS/WebView
  useEffect(() => {
    let hasLocalToken = false;
    try {
      hasLocalToken = Boolean(localStorage.getItem('avtotap_shop_token'));
    } catch {
      hasLocalToken = false;
    }
    if (!hasLocalToken) {
      void loadAuthTokenFromPhone('shop').then((savedToken) => {
        if (savedToken) {
          setToken((prev) => prev || savedToken);
          setLoading(true);
        }
      });
    }
  }, []);

  // Hydrate cached shop profile & feed from phone memory when token is active
  useEffect(() => {
    if (!token) return;
    void Promise.all([loadShopProfileFromPhone(), loadShopFeedFromPhone()]).then(
      ([profileCache, feedCache]) => {
        if (profileCache?.shop) {
          setShop((prev) => prev || (profileCache.shop as unknown as PublicShopInfo));
          if (profileCache.adminWhatsapp) {
            setAdminWhatsapp((prev) => prev || profileCache.adminWhatsapp);
          }
          setLoading(false);
        }
        if (feedCache && Array.isArray(feedCache.requests)) {
          const cachedItems = feedCache.requests as unknown as ShopFeedItem[];
          cachedItems.forEach((r) => seenRequestIdsRef.current.add(r.id));
          feedInitializedRef.current = true;
          setFeed((prev) => (prev.length > 0 ? prev : cachedItems));
        }
      }
    );
  }, [token]);

  const loadShopDashboard = useCallback(async (activeToken: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);
      const res = await fetch('/api/shop/me', {
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
        shop?: PublicShopInfo;
        adminWhatsapp?: string;
        requests?: ShopFeedItem[];
      } | null = null;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = null;
      }

      if (res.status === 401 && data && typeof data.error === 'string') {
        try {
          localStorage.removeItem('avtotap_shop_token');
        } catch {
          // ignore
        }
        void clearAuthTokenFromPhone('shop');
        void clearPreferredSection();
        void clearShopProfileFromPhone();
        setLoginError('Sessiya bitdi. Yenidən daxil olun.');
        setToken(null);
        setShop(null);
        setFeed([]);
        return;
      }
      if (!res.ok || !data || !data.shop) {
        return;
      }

      setShop(data.shop);
      setAdminWhatsapp(data.adminWhatsapp || '');
      void savePreferredSection('shop');
      void saveShopProfileToPhone(
        data.shop as unknown as Record<string, unknown>,
        data.adminWhatsapp || ''
      );

      const nextFeed: ShopFeedItem[] = Array.isArray(data.requests) ? data.requests : [];
      if (feedInitializedRef.current) {
        const newlyArrived = nextFeed.filter((r) => !seenRequestIdsRef.current.has(r.id));
        if (newlyArrived.length > 0 && data.shop.isEffectivelyActive) {
          const latest = newlyArrived[0];
          triggerAlertFeedback('incoming', {
            sound: soundEnabledRef.current,
            vibrate: soundEnabledRef.current,
            notification: {
              title: `Yeni sorğu: ${latest.carBrandModel} (${latest.year})`,
              body: latest.partName,
              url: `/?tab=shop&reply=${encodeURIComponent(latest.id)}`,
              tag: `req-${latest.id}`,
            },
          });
          setNewAlertBanner(`Yeni sorğu: ${latest.carBrandModel} (${latest.year}) — ${latest.partName}`);
        }
      }
      nextFeed.forEach((r) => seenRequestIdsRef.current.add(r.id));
      feedInitializedRef.current = true;

      setFeed(nextFeed);
      if (data.shop?.id) {
        void saveShopFeedToPhone({
          shopId: data.shop.id,
          shopName: data.shop.name,
          requests: nextFeed as unknown as Array<Record<string, unknown>>,
          savedAt: new Date().toISOString(),
        });
      }
    } catch {
      // keep cached phone storage state if offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      void loadShopDashboard(token);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        void subscribePushNotifications({
          role: 'shop',
          authToken: token,
          requestPermissionIfDefault: false,
        });
      }
    }
  }, [token, loadShopDashboard]);

  // Open quote modal automatically if navigated via notification/reply link
  useEffect(() => {
    if (!replyRequestId || feed.length === 0 || !shop?.isEffectivelyActive) return;
    const found = feed.find((item) => item.id === replyRequestId);
    if (found) {
      openQuoteModal(found);
      onClearReplyId?.();
    }
  }, [replyRequestId, feed, shop, onClearReplyId]);

  // Keep Screen Awake toggle (for shops keeping panel open on counter phone)
  useEffect(() => {
    if (!wakeLockActive || typeof navigator === 'undefined') return;
    const wakeApi = (navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    }).wakeLock;
    if (!wakeApi) return;

    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (document.visibilityState !== 'visible' || cancelled) return;
        sentinel = await wakeApi.request('screen');
      } catch {
        // ignore unsupported/battery-saver restrictions
      }
    };

    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [wakeLockActive]);

  // Dual-channel Live Sync: WebSocket + 15s Backup Poll + Foreground/SW Push Sync
  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUser = false;

    const connect = () => {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${window.location.host}/ws?role=shop&token=${encodeURIComponent(token)}`;
        socket = new WebSocket(url);

        socket.onopen = () => {
          setWsConnected(true);
          void loadShopDashboard(token);
        };

        socket.onmessage = (evt) => {
          try {
            const event = JSON.parse(evt.data) as WsEvent;
            if (event.type === 'request:created') {
              const incoming = event.payload;
              const alreadySeen = seenRequestIdsRef.current.has(incoming.id);
              seenRequestIdsRef.current.add(incoming.id);
              setFeed((prev) => {
                if (prev.some((r) => r.id === incoming.id)) return prev;
                const nextItem: ShopFeedItem = {
                  ...incoming,
                  myQuote: null,
                  totalQuotes: incoming.quoteCount || 0,
                };
                return [nextItem, ...prev];
              });
              if (!alreadySeen) {
                triggerAlertFeedback('incoming', {
                  sound: soundEnabledRef.current,
                  vibrate: soundEnabledRef.current,
                  notification: {
                    title: `Yeni sorğu: ${incoming.carBrandModel} (${incoming.year})`,
                    body: incoming.partName,
                    url: `/?tab=shop&reply=${encodeURIComponent(incoming.id)}`,
                    tag: `req-${incoming.id}`,
                  },
                });
                setNewAlertBanner(`Yeni sorğu: ${incoming.carBrandModel} (${incoming.year}) — ${incoming.partName}`);
              }
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
          setWsConnected(false);
          if (!closedByUser) {
            reconnectTimer = window.setTimeout(connect, 3000);
          }
        };
      } catch {
        setWsConnected(false);
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      }
    };

    connect();

    const syncNow = () => {
      void loadShopDashboard(token);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        void subscribePushNotifications({
          role: 'shop',
          authToken: token,
          requestPermissionIfDefault: false,
        });
      }
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        connect();
      }
    };

    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadShopDashboard(token);
      }
    }, 15_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_RECEIVED') {
        void loadShopDashboard(token);
        triggerAlertFeedback('incoming', {
          sound: soundEnabledRef.current,
          vibrate: soundEnabledRef.current,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', syncNow);
    window.addEventListener('online', syncNow);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', syncNow);
      window.removeEventListener('online', syncNow);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      socket?.close();
    };
  }, [token, loadShopDashboard]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const result = await postJsonWithRetry<{
        token?: string;
        shop?: PublicShopInfo;
        adminWhatsapp?: string;
        error?: string;
      }>(
        '/api/shop/login',
        { whatsapp: loginPhone.trim(), pin: loginPin.trim() },
        { retries: 2, timeoutMs: 15000 }
      );
      if (!result.ok || !result.data.token || !result.data.shop) {
        setLoginError(result.data.error || 'Giriş alınmadı.');
        return;
      }
      try {
        localStorage.setItem('avtotap_shop_token', result.data.token);
        localStorage.setItem('avtotap_shop_phone', loginPhone.trim());
        localStorage.setItem('avtotap_preferred_section', 'shop');
      } catch {
        // ignore
      }
      setToken(result.data.token);
      setShop(result.data.shop);
      setAdminWhatsapp(result.data.adminWhatsapp || '');
      setLoading(true);
      void saveAuthTokenToPhone('shop', result.data.token);
      void savePreferredSection('shop');
      void saveShopProfileToPhone(
        result.data.shop as unknown as Record<string, unknown>,
        result.data.adminWhatsapp || ''
      );
    } catch {
      setLoginError('Giriş zamanı gözlənilməz xəta baş verdi. Yenidən cəhd edin.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const completeShopGoogleSignIn = useCallback(
    async (user: NonNullable<Awaited<ReturnType<typeof signInWithGmail>>>) => {
      const idToken = await user.getIdToken();
      void syncUserProfileToFirestore(user, 'shop').catch(() => {});

      const result = await postJsonWithRetry<{
        registered?: boolean;
        token?: string;
        shop?: PublicShopInfo;
        adminWhatsapp?: string;
        uid?: string;
        email?: string;
        displayName?: string;
        error?: string;
      }>(
        '/api/auth/firebase-shop',
        { idToken },
        { retries: 2, timeoutMs: 15000 }
      );

      if (!result.ok) {
        setLoginError(result.data.error || 'Gmail ilə giriş alınmadı.');
        return;
      }

      if (result.data.registered && result.data.token && result.data.shop) {
        try {
          localStorage.setItem('avtotap_shop_token', result.data.token);
          localStorage.setItem('avtotap_preferred_section', 'shop');
        } catch {
          // ignore
        }
        setPendingGoogleReg(null);
        setToken(result.data.token);
        setShop(result.data.shop);
        setAdminWhatsapp(result.data.adminWhatsapp || '');
        setLoading(true);
        void saveAuthTokenToPhone('shop', result.data.token);
        void savePreferredSection('shop');
        void saveShopProfileToPhone(
          result.data.shop as unknown as Record<string, unknown>,
          result.data.adminWhatsapp || ''
        );
        return;
      }

      // Check Firestore in case container restarted and shop was saved in cloud
      try {
        const cloudShop = await loadMyShopFromFirestore(user.uid);
        if (cloudShop && cloudShop.name && cloudShop.whatsapp) {
          const restored = await postJsonWithRetry<{
            token?: string;
            shop?: PublicShopInfo;
            adminWhatsapp?: string;
          }>(
            '/api/shop/register-google',
            {
              idToken,
              name: cloudShop.name,
              whatsapp: cloudShop.whatsapp,
              district: cloudShop.district || '',
            },
            { retries: 1, timeoutMs: 15000 }
          );
          if (restored.ok && restored.data.token && restored.data.shop) {
            try {
              localStorage.setItem('avtotap_shop_token', restored.data.token);
              localStorage.setItem('avtotap_preferred_section', 'shop');
            } catch {
              // ignore
            }
            setPendingGoogleReg(null);
            setToken(restored.data.token);
            setShop(restored.data.shop);
            setAdminWhatsapp(restored.data.adminWhatsapp || '');
            setLoading(true);
            void saveAuthTokenToPhone('shop', restored.data.token);
            void savePreferredSection('shop');
            void saveShopProfileToPhone(
              restored.data.shop as unknown as Record<string, unknown>,
              restored.data.adminWhatsapp || ''
            );
            return;
          }
        }
      } catch {
        // ignore if no cloud shop yet
      }

      setPendingGoogleReg({
        uid: user.uid,
        email: resolveFirebaseUserEmail(user) || (result.data.email || '').trim().toLowerCase(),
        displayName: user.displayName || result.data.displayName || '',
      });
    },
    []
  );

  useEffect(() => {
    let active = true;
    void consumeGmailRedirectResult()
      .then((redirectUser) => {
        if (!active || !redirectUser) return;
        setIsGoogleLoading(true);
        return completeShopGoogleSignIn(redirectUser).finally(() => {
          if (active) setIsGoogleLoading(false);
        });
      })
      .catch((err) => {
        if (!active) return;
        if (isUnauthorizedDomainError(err)) {
          setUnauthorizedDomain(true);
          setShowPinFallback(true);
        }
        setLoginError(mapFirebaseAuthErrorAz(err));
      });
    return () => {
      active = false;
    };
  }, [completeShopGoogleSignIn]);

  const handleShopGoogleLogin = async () => {
    if (isGoogleLoading || isLoggingIn || isRegistering) return;
    setLoginError(null);
    setUnauthorizedDomain(false);
    setIsGoogleLoading(true);
    try {
      const user = await signInWithGmail();
      if (!user) {
        return;
      }
      await completeShopGoogleSignIn(user);
    } catch (err) {
      if (isUnauthorizedDomainError(err)) {
        setUnauthorizedDomain(true);
        setShowPinFallback(true);
      }
      setLoginError(mapFirebaseAuthErrorAz(err));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleCompleteGoogleRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingGoogleReg || isRegistering) return;
    setLoginError(null);

    if (regShopName.trim().length < 2) {
      setLoginError('Zəhmət olmasa mağazanızın adını daxil edin.');
      return;
    }

    setIsRegistering(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setLoginError('Gmail sessiyası bitdi. Yenidən Google ilə daxil olun.');
        setPendingGoogleReg(null);
        return;
      }
      const idToken = await currentUser.getIdToken();
      const result = await postJsonWithRetry<{
        token?: string;
        shop?: PublicShopInfo;
        adminWhatsapp?: string;
        error?: string;
      }>(
        '/api/shop/register-google',
        {
          idToken,
          name: regShopName.trim(),
          whatsapp: regWhatsapp.trim(),
          district: regDistrict.trim(),
        },
        { retries: 2, timeoutMs: 15000 }
      );

      if (!result.ok || !result.data.token || !result.data.shop) {
        setLoginError(result.data.error || 'Qeydiyyat tamamlanmadı.');
        return;
      }

      const fullShop: Shop = {
        ...result.data.shop,
        pin: '0000',
        createdAt: new Date().toISOString(),
      };
      void syncUserProfileToFirestore(currentUser, 'shop').catch(() => {});
      void syncShopToFirestore(fullShop).catch(() => {});

      try {
        localStorage.setItem('avtotap_shop_token', result.data.token);
        localStorage.setItem('avtotap_preferred_section', 'shop');
      } catch {
        // ignore
      }
      setPendingGoogleReg(null);
      setToken(result.data.token);
      setShop(result.data.shop);
      setAdminWhatsapp(result.data.adminWhatsapp || '');
      setLoading(true);
      void saveAuthTokenToPhone('shop', result.data.token);
      void savePreferredSection('shop');
      void saveShopProfileToPhone(
        result.data.shop as unknown as Record<string, unknown>,
        result.data.adminWhatsapp || ''
      );
    } catch (err) {
      setLoginError(mapFirebaseAuthErrorAz(err));
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('avtotap_shop_token');
      localStorage.removeItem('avtotap_preferred_section');
    } catch {
      // ignore
    }
    void clearAuthTokenFromPhone('shop');
    void clearPreferredSection();
    void clearShopProfileFromPhone();
    void signOutFirebase();
    setLoginError(null);
    setPendingGoogleReg(null);
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
      const result = await postJsonWithRetry<{ quote?: ShopQuote; error?: string }>(
        '/api/shop/quotes',
        {
          requestId: activeRequest.id,
          priceAzn: parsed,
          condition,
          availability,
          comment: comment.trim() || undefined,
        },
        { token, retries: 2, timeoutMs: 15000 }
      );
      if (!result.ok || !result.data.quote) {
        triggerAlertFeedback('error', { sound: soundEnabled, vibrate: soundEnabled });
        setQuoteError(result.data.error || 'Qiymət göndərilmədi.');
        return;
      }

      const savedQuote = result.data.quote;
      setFeed((prev) => {
        const next = prev.map((item) =>
          item.id === activeRequest.id
            ? {
                ...item,
                myQuote: savedQuote,
                totalQuotes: item.myQuote ? item.totalQuotes : item.totalQuotes + 1,
              }
            : item
        );
        if (shop?.id) {
          void saveShopFeedToPhone({
            shopId: shop.id,
            shopName: shop.name,
            requests: next as unknown as Array<Record<string, unknown>>,
            savedAt: new Date().toISOString(),
          });
        }
        return next;
      });
      triggerAlertFeedback('success', { sound: soundEnabled, vibrate: soundEnabled });
      setActiveRequest(null);
    } finally {
      setIsSendingQuote(false);
    }
  };

  // Login / Gmail Registration Screen
  if (!token || (!shop && !loading)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-14">
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-[0_2px_10px_rgba(11,17,32,0.03),0_18px_40px_-24px_rgba(11,17,32,0.12)]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0B1120] text-white">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-slate-950">Mağaza kabineti</h1>
              <p className="text-xs text-slate-500">
                {pendingGoogleReg
                  ? 'Yeni mağaza qeydiyyatını tamamlayın'
                  : 'Gmail ilə daxil olun və ya mağazanızı qeyd edin'}
              </p>
            </div>
          </div>

          {pendingGoogleReg ? (
            <form onSubmit={handleCompleteGoogleRegistration} className="mt-6 space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs">
                <div className="min-w-0">
                  <span className="block font-semibold text-emerald-800">Təsdiqlənmiş Gmail</span>
                  <span className="block truncate font-mono font-bold text-slate-950">
                    {pendingGoogleReg.email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void signOutFirebase();
                    setPendingGoogleReg(null);
                    setLoginError(null);
                  }}
                  className="shrink-0 font-bold text-slate-600 underline underline-offset-2 hover:text-slate-950"
                >
                  Dəyiş
                </button>
              </div>

              <div>
                <label htmlFor="reg-shop-name" className="block text-sm font-bold text-slate-900">
                  Mağazanın adı
                </label>
                <input
                  id="reg-shop-name"
                  type="text"
                  value={regShopName}
                  onChange={(e) => setRegShopName(e.target.value)}
                  placeholder="Məsələn: Şərur Avto Zapçast"
                  className="mt-1.5 w-full min-h-[50px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 text-base text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                  required
                />
              </div>

              <div>
                <label htmlFor="reg-shop-wa" className="block text-sm font-bold text-slate-900">
                  WhatsApp nömrəsi (müştərilər üçün)
                </label>
                <input
                  id="reg-shop-wa"
                  type="tel"
                  inputMode="tel"
                  value={regWhatsapp}
                  onChange={(e) => setRegWhatsapp(e.target.value)}
                  placeholder="+994 50 555 10 10"
                  className="mt-1.5 w-full min-h-[50px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 font-mono tabular-nums text-base text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                  required
                />
              </div>

              <div>
                <label htmlFor="reg-shop-district" className="block text-sm font-bold text-slate-900">
                  Ünvan <span className="font-normal text-slate-500">(istəyə bağlı)</span>
                </label>
                <input
                  id="reg-shop-district"
                  type="text"
                  value={regDistrict}
                  onChange={(e) => setRegDistrict(e.target.value)}
                  placeholder="Məsələn: Şərur, Mərkəzi küçə"
                  className="mt-1.5 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 text-sm text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                />
              </div>

              {loginError && (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={isRegistering}
                className="flex w-full min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-600 to-orange-700 px-5 py-3 text-base font-bold text-white shadow-sm hover:from-orange-700 hover:to-orange-800 disabled:opacity-60"
              >
                <CheckCircle2 className="h-5 w-5" />
                <span>{isRegistering ? 'Qeydiyyat aparılır...' : 'Qeydiyyatı tamamla və daxil ol'}</span>
              </button>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <button
                type="button"
                disabled={isGoogleLoading || isLoggingIn}
                onClick={() => void handleShopGoogleLogin()}
                className="flex w-full min-h-[54px] items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-bold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                <GoogleBadgeIcon />
                <span>
                  {isGoogleLoading ? 'Gmail yoxlanılır...' : 'Google (Gmail) ilə daxil ol / Qeydiyyat'}
                </span>
              </button>

              {loginError && (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {loginError}
                </div>
              )}

              {unauthorizedDomain && <UnauthorizedDomainNotice />}

              <p className="text-xs leading-relaxed text-slate-500">
                Bir toxunuşla Gmail hesabınızla mağaza qeydiyyatından keçin və müştəri sifarişlərini dərhal qəbul edin.
              </p>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setShowPinFallback((v) => !v)}
                  className="text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-900"
                >
                  {showPinFallback ? 'PIN bölməsini gizlət' : 'WhatsApp + PIN ilə köhnə giriş'}
                </button>
              </div>

              {showPinFallback && (
                <form onSubmit={handleLogin} className="space-y-3 border-t border-slate-100 pt-4">
                  <div>
                    <label htmlFor="shop-phone" className="block text-xs font-bold text-slate-800">
                      Telefon nömrəsi (WhatsApp)
                    </label>
                    <input
                      id="shop-phone"
                      type="tel"
                      inputMode="tel"
                      value={loginPhone}
                      onChange={(e) => setLoginPhone(e.target.value)}
                      placeholder="+994 50 555 10 10"
                      className="mt-1.5 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 font-mono tabular-nums text-base text-slate-950 transition-colors focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="shop-pin" className="block text-xs font-bold text-slate-800">
                      PIN kod
                    </label>
                    <input
                      id="shop-pin"
                      type="password"
                      inputMode="numeric"
                      value={loginPin}
                      onChange={(e) => setLoginPin(e.target.value)}
                      placeholder="Administrator tərəfindən verilən PIN"
                      className="mt-1.5 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 font-mono tabular-nums text-base text-slate-950 transition-colors focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoggingIn || isGoogleLoading}
                    className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#0B1120] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Lock className="h-4 w-4" />
                    <span>{isLoggingIn ? 'Yoxlanılır...' : 'PIN ilə daxil ol'}</span>
                  </button>
                </form>
              )}
            </div>
          )}
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
    const renewalText = `Salam! "${shop.name}" mağazasının (${shop.whatsapp}) Şərur AvtoZapcast abunəliyini uzatmaq istəyirəm.`;
    const adminWaUrl = buildWhatsAppUrl(adminWhatsapp || '+994507770000', renewalText);

    return (
      <div className="mx-auto w-full max-w-lg px-4 py-8 sm:py-12">
        <div className="rounded-3xl border border-red-200 bg-white p-7 shadow-sm text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-display text-xl font-extrabold text-slate-950">
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
              className="flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-2xl bg-green-700 px-5 py-3 text-sm font-bold text-white hover:bg-green-800"
            >
              <MessageCircle className="h-5 w-5" />
              <span>Abunəliyi uzatmaq üçün Admin ilə əlaqə</span>
            </a>

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
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
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-9">
      {/* Shop Status Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#0B1120] p-5 text-white shadow-[0_14px_32px_-16px_rgba(11,17,32,0.5)]">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-extrabold text-white">{shop.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-300">
            {shop.district && (
              <>
                <span>{shop.district}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="font-semibold text-white">{shop.tariff}</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400 font-semibold">Aktiv ({shop.expiresAt}-dək)</span>
            <span aria-hidden="true">·</span>
            <span className={wsConnected ? 'text-emerald-400 font-semibold' : 'text-amber-300'}>
              {wsConnected ? 'Canlı əlaqə' : 'Yenidən qoşulur...'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              triggerAlertFeedback('incoming', {
                sound: true,
                vibrate: true,
                notification: {
                  title: 'Test bildirişi — Şərur AvtoZapcast',
                  body: 'Səs, vibrasiya və müştəri sorğu bildirişləri işləyir!',
                  url: '/?tab=shop',
                  tag: 'shop-test-alert',
                },
              });
            }}
            className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <Volume2 className="h-4 w-4 text-emerald-400" />
            <span className="hidden sm:inline">Səsi yoxla</span>
          </button>

          <button
            type="button"
            onClick={() => setWakeLockActive((v) => !v)}
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              wakeLockActive
                ? 'bg-orange-600 text-white'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <Smartphone className="h-4 w-4" />
            <span className="hidden sm:inline">
              {wakeLockActive ? 'Ekran açıqdır' : 'Ekran sönməsin'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              unlockAudio();
              setSoundEnabled((v) => !v);
            }}
            aria-label={soundEnabled ? 'Səsi söndür' : 'Səsi aç'}
            className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            {soundEnabled ? <Bell className="h-4 w-4 text-orange-400" /> : <BellOff className="h-4 w-4 text-slate-300" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Səs açıqdır' : 'Səs bağlıdır'}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <LogOut className="h-4 w-4" />
            <span>Çıxış</span>
          </button>
        </div>
      </div>

      {/* Prominent Push Notification Activation Bar (only shown until enabled) */}
      {typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission !== 'granted' && (
          <div className="mb-5 rounded-3xl border border-orange-200 bg-orange-50/90 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-sm font-extrabold text-slate-950">
                  Müştəri sifarişlərini qaçırmamaq üçün puş bildirişləri açın
                </h2>
                <p className="mt-0.5 text-xs text-slate-700 leading-relaxed">
                  {Notification.permission === 'denied'
                    ? 'Bildirişlər brauzer ayarlarından bloklanıb. Telefon ayarlarından bildiriş icazəsini «İcazə ver» edin.'
                    : 'Telefon bağlı olanda belə yeni sorğular səs və vibrasiya ilə dərhal gələcək.'}
                </p>
              </div>
              {Notification.permission !== 'denied' && (
                <div className="shrink-0 sm:w-56">
                  <PushNotificationsButton role="shop" authToken={token} />
                </div>
              )}
            </div>
          </div>
        )}

      {newAlertBanner && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5 text-sm font-bold text-orange-950 shadow-sm">
          <span>{newAlertBanner}</span>
          <button
            type="button"
            onClick={() => setNewAlertBanner(null)}
            aria-label="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-orange-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold text-slate-950">
          Gələn sorğular <span className="font-mono text-slate-500">({feed.length})</span>
        </h2>
        <span className="text-xs font-medium text-slate-500">Real vaxtda yenilənir</span>
      </div>

      {feed.length === 0 ? (
        <div className="rounded-3xl border border-slate-200/90 bg-white p-10 text-center shadow-sm">
          <p className="font-display text-base font-bold text-slate-950">Hələlik yeni sorğu yoxdur</p>
          <p className="mt-1.5 text-sm text-slate-600">
            Sürücülər yeni sorğu göndərən kimi avtomatik olaraq burada görünəcək.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {feed.map((item) => (
            <article
              key={item.id}
              className="flex flex-col justify-between rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span>{formatTimeAgoAz(item.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.totalQuotes} cavab</span>
                    </div>
                    <h3 className="mt-1 font-display text-lg font-extrabold text-slate-950">
                      {item.carBrandModel} <span className="font-mono text-slate-500">({item.year})</span>
                    </h3>
                    <p className="mt-1 text-base font-bold text-orange-700">{item.partName}</p>
                  </div>

                  {item.photoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setZoomPhoto(item.photoDataUrl || null)}
                      className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-200"
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
                  <div className="mt-3.5 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-900">
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

              <div className="mt-4 pt-3.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => openQuoteModal(item)}
                  className={`flex w-full min-h-[50px] items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition-all active:scale-[0.985] ${
                    item.myQuote
                      ? 'border border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100'
                      : 'bg-gradient-to-b from-orange-600 to-orange-700 text-white shadow-sm hover:from-orange-700 hover:to-orange-800'
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
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">
                  {activeRequest.carBrandModel} ({activeRequest.year})
                </p>
                <h3 className="mt-0.5 truncate font-display text-lg font-extrabold text-slate-950">
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
                <label htmlFor="quote-price" className="block text-sm font-bold text-slate-900">
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
                  placeholder="120"
                  className="mt-1.5 w-full min-h-[54px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 font-mono text-2xl font-bold text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                  required
                />
              </div>

              <div>
                <span className="block text-sm font-bold text-slate-900">Detalın vəziyyəti</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {CONDITIONS.map((cond) => (
                    <button
                      key={cond}
                      type="button"
                      onClick={() => setCondition(cond)}
                      className={`min-h-[44px] rounded-2xl border px-2 py-2 text-xs font-bold transition-colors ${
                        condition === cond
                          ? 'border-[#0B1120] bg-[#0B1120] text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {cond}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-bold text-slate-900">Mövcudluq</span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {AVAILABILITIES.map((avail) => (
                    <button
                      key={avail}
                      type="button"
                      onClick={() => setAvailability(avail)}
                      className={`min-h-[42px] rounded-2xl border px-2.5 py-2 text-xs font-semibold transition-colors ${
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
                <label htmlFor="quote-comment" className="block text-sm font-bold text-slate-900">
                  Əlavə qeyd <span className="font-normal text-slate-500">(istəyə bağlı)</span>
                </label>
                <input
                  id="quote-comment"
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Məsələn: Zəmanət verilir"
                  className="mt-1.5 w-full min-h-[48px] rounded-2xl border border-slate-200 bg-slate-50/75 px-3.5 text-sm text-slate-950 focus:border-orange-600 focus:bg-white focus:outline-none"
                />
              </div>

              {quoteError && (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800">
                  {quoteError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSendingQuote}
                className="flex w-full min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-600 to-orange-700 px-5 py-3 text-base font-bold text-white shadow-sm hover:from-orange-700 hover:to-orange-800 disabled:opacity-60"
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
            className="max-h-[85vh] max-w-full rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
