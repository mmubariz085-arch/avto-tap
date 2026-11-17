import React from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

function sanitizeCorruptedBrowserCache(): void {
  try {
    const rawOrders = localStorage.getItem('avtotap_saved_orders');
    if (rawOrders) {
      const parsed = JSON.parse(rawOrders);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem('avtotap_saved_orders');
      } else {
        const clean = parsed.filter(
          (o) =>
            Boolean(o) &&
            typeof o === 'object' &&
            typeof (o as { id?: unknown }).id === 'string' &&
            typeof (o as { carBrandModel?: unknown }).carBrandModel === 'string' &&
            typeof (o as { partName?: unknown }).partName === 'string'
        );
        localStorage.setItem('avtotap_saved_orders', JSON.stringify(clean.slice(0, 10)));
      }
    }
  } catch {
    try {
      localStorage.removeItem('avtotap_saved_orders');
    } catch {
      // ignore
    }
  }

  try {
    localStorage.removeItem('avtotap_idb_shop_profile_cache');
    localStorage.removeItem('avtotap_idb_shop_feed_cache');
    localStorage.removeItem('avtotap_idb_admin_backup');
  } catch {
    // ignore
  }
}

async function clearAllCachedAppState(): Promise<void> {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('avtotap_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }

  try {
    if ('indexedDB' in window) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 600);
        try {
          const req = window.indexedDB.deleteDatabase('avtotap_phone_storage');
          req.onsuccess = () => {
            window.clearTimeout(timer);
            resolve();
          };
          req.onerror = () => {
            window.clearTimeout(timer);
            resolve();
          };
          req.onblocked = () => {
            window.clearTimeout(timer);
            resolve();
          };
        } catch {
          window.clearTimeout(timer);
          resolve();
        }
      });
    }
  } catch {
    // ignore
  }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    // ignore
  }
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Gözlənilməz xəta baş verdi.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI ErrorBoundary caught:', error, info?.componentStack);
    sanitizeCorruptedBrowserCache();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F6F8FA] px-4 py-10">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-lg">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h1 className="mt-4 font-display text-xl font-extrabold text-slate-950">
              Ekran yüklənərkən xəta baş verdi
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Narahat olmayın, məlumatlarınız qorunub. Səhifəni yeniləyin və ya əsas ekrana qayıdın.
            </p>
            {this.state.errorMessage && (
              <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600 break-words">
                {this.state.errorMessage}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0B1120] px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Yenidən yüklə</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  sanitizeCorruptedBrowserCache();
                  try {
                    localStorage.removeItem('avtotap_preferred_section');
                  } catch {
                    // ignore
                  }
                  window.location.href = '/';
                }}
                className="flex min-h-[46px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Əsas ekrana qayıt
              </button>
              <button
                type="button"
                onClick={() => {
                  void clearAllCachedAppState().finally(() => {
                    window.location.href = '/';
                  });
                }}
                className="flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-2xl px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Keşi təmizlə və yenidən aç</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
