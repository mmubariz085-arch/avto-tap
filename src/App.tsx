import { useEffect, useState } from 'react';
import { Car, Store } from 'lucide-react';
import { AdminView } from './components/AdminView';
import { DriverView, type SavedOrderSummary } from './components/DriverView';
import { LegalModal, type LegalDocType } from './components/LegalModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OrderTrackingView } from './components/OrderTrackingView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QuickReplyView } from './components/QuickReplyView';
import { ShopView } from './components/ShopView';
import { installGlobalAudioUnlocker } from './utils/notify';
import { requestPersistentPhoneStorage } from './utils/phoneStorage';
import type { RequestWithQuotes } from './types';

type ActiveSection = 'driver' | 'shop' | 'admin';

const SAVED_ORDERS_KEY = 'avtotap_saved_orders';

function readSavedOrders(): SavedOrderSummary[] {
  try {
    const raw = localStorage.getItem(SAVED_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [section, setSection] = useState<ActiveSection>(() => {
    if (typeof window === 'undefined') return 'driver';
    const params = new URLSearchParams(window.location.search);
    if (window.location.hash === '#admin' || params.get('panel') === 'admin') {
      return 'admin';
    }
    if (params.get('tab') === 'shop') {
      return 'shop';
    }
    return 'driver';
  });

  const [activeOrderId, setActiveOrderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('order');
  });

  const [initialOrderData, setInitialOrderData] = useState<RequestWithQuotes | null>(null);
  const [replyRequestId, setReplyRequestId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('reply');
  });

  const [quickReplyParams, setQuickReplyParams] = useState<{ requestId: string; shopToken: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const qr = params.get('quickReply');
    const st = params.get('st');
    return qr && st ? { requestId: qr, shopToken: st } : null;
  });

  const [activeShopCount, setActiveShopCount] = useState<number>(0);
  const [savedOrders, setSavedOrders] = useState<SavedOrderSummary[]>(readSavedOrders);
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);

  useEffect(() => {
    void requestPersistentPhoneStorage();

    fetch('/api/public/config')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.activeShopCount === 'number') {
          setActiveShopCount(data.activeShopCount);
        }
      })
      .catch(() => {
        // ignore offline
      });

    const handleHashChange = () => {
      if (window.location.hash === '#admin') {
        setSection('admin');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    const uninstallAudio = installGlobalAudioUnlocker();
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      uninstallAudio();
    };
  }, []);

  const updateUrlOrder = (orderId: string | null) => {
    const url = new URL(window.location.href);
    if (orderId) {
      url.searchParams.set('order', orderId);
      url.searchParams.delete('tab');
      url.searchParams.delete('reply');
    } else {
      url.searchParams.delete('order');
    }
    window.history.replaceState({}, '', url.toString());
  };

  const navigateSection = (target: ActiveSection) => {
    setQuickReplyParams(null);
    setSection(target);
    const url = new URL(window.location.href);
    url.searchParams.delete('quickReply');
    url.searchParams.delete('st');
    if (target === 'admin') {
      url.hash = 'admin';
    } else {
      url.hash = '';
      if (target === 'shop') {
        url.searchParams.set('tab', 'shop');
      } else {
        url.searchParams.delete('tab');
      }
    }
    window.history.replaceState({}, '', url.toString());
  };

  const handleOpenFullShopCabinetFromQuickReply = (shopToken: string) => {
    localStorage.setItem('avtotap_shop_token', shopToken);
    setQuickReplyParams(null);
    navigateSection('shop');
  };

  const handleOrderCreated = (req: RequestWithQuotes) => {
    const summary: SavedOrderSummary = {
      id: req.id,
      carBrandModel: req.carBrandModel,
      year: req.year,
      partName: req.partName,
      createdAt: req.createdAt,
    };
    setSavedOrders((prev) => {
      const next = [summary, ...prev.filter((o) => o.id !== req.id)].slice(0, 10);
      localStorage.setItem(SAVED_ORDERS_KEY, JSON.stringify(next));
      return next;
    });
    setInitialOrderData(req);
    setActiveOrderId(req.id);
    setSection('driver');
    updateUrlOrder(req.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenOrder = (orderId: string) => {
    setInitialOrderData(null);
    setActiveOrderId(orderId);
    setSection('driver');
    updateUrlOrder(orderId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNewRequest = () => {
    setInitialOrderData(null);
    setActiveOrderId(null);
    setSection('driver');
    updateUrlOrder(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex min-h-screen flex-col text-slate-900">
      {/* Compact Frosted Sticky Top Bar (3-Zone Contract) */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => {
              if (section === 'admin') {
                navigateSection('driver');
              } else {
                handleNewRequest();
              }
            }}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0"
          >
            <img
              src="/icon.svg"
              alt="AvtoTap loqosu"
              className="h-8 w-8 rounded-xl shadow-sm shrink-0"
            />
            <span className="font-display text-lg font-extrabold tracking-tight text-slate-950">
              AvtoTap
            </span>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-semibold">
            <button
              type="button"
              onClick={() => navigateSection('driver')}
              className={`min-h-[40px] px-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                section === 'driver'
                  ? 'border-orange-600 text-slate-950'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Sürücü
            </button>
            <button
              type="button"
              onClick={() => navigateSection('shop')}
              className={`min-h-[40px] px-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                section === 'shop'
                  ? 'border-orange-600 text-slate-950'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Mağaza kabineti
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {quickReplyParams ? (
          <QuickReplyView
            requestId={quickReplyParams.requestId}
            shopToken={quickReplyParams.shopToken}
            onOpenFullShopCabinet={handleOpenFullShopCabinetFromQuickReply}
          />
        ) : section === 'admin' ? (
          <AdminView onExitAdmin={() => navigateSection('driver')} />
        ) : section === 'shop' ? (
          <ShopView
            replyRequestId={replyRequestId}
            onClearReplyId={() => setReplyRequestId(null)}
          />
        ) : activeOrderId ? (
          <OrderTrackingView
            orderId={activeOrderId}
            initialOrder={initialOrderData}
            onNewRequest={handleNewRequest}
          />
        ) : (
          <DriverView
            activeShopCount={activeShopCount}
            savedOrders={savedOrders}
            onOrderCreated={handleOrderCreated}
            onOpenOrder={handleOpenOrder}
            onOpenLegal={(doc) => setLegalDoc(doc)}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer
        className={`border-t border-slate-200/80 bg-white/80 px-4 py-5 text-xs text-slate-500 ${
          section !== 'admin' ? 'pb-24 md:pb-6' : 'pb-6'
        }`}
      >
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row sm:px-2">
          <p className="text-center sm:text-left">
            © {new Date().getFullYear()} AvtoTap · Yerli avtomobil ehtiyat hissələri axtarışı
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setLegalDoc('terms')}
              className="min-h-[36px] font-medium text-slate-700 underline underline-offset-2 hover:text-slate-950"
            >
              İstifadəçi razılaşması
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('privacy')}
              className="min-h-[36px] font-medium text-slate-700 underline underline-offset-2 hover:text-slate-950"
            >
              Məxfilik siyasəti
            </button>
            <button
              type="button"
              onClick={() => navigateSection('admin')}
              className="min-h-[36px] font-medium text-slate-400 hover:text-slate-700"
            >
              Admin
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Thumb Navigation (<= 15% total sticky height combined with header) */}
      {section !== 'admin' && (
        <nav
          aria-label="Əsas naviqasiya"
          className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-2 border-t border-slate-200/80 bg-white/95 backdrop-blur-xl shadow-[0_-8px_28px_-14px_rgba(11,17,32,0.12)] pb-safe md:hidden"
        >
          <button
            type="button"
            onClick={() => navigateSection('driver')}
            className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${
              section === 'driver' ? 'text-orange-700' : 'text-slate-500'
            }`}
          >
            {section === 'driver' && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-600" />
            )}
            <Car className="h-5 w-5" />
            <span>Sürücü</span>
          </button>

          <button
            type="button"
            onClick={() => navigateSection('shop')}
            className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${
              section === 'shop' ? 'text-orange-700' : 'text-slate-500'
            }`}
          >
            {section === 'shop' && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-600" />
            )}
            <Store className="h-5 w-5" />
            <span>Mağaza kabineti</span>
          </button>
        </nav>
      )}

      <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
      <OfflineIndicator />
    </div>
  );
}
