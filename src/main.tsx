import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

declare global {
  interface Window {
    __avtotapDeferredPrompt?: Event | null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__avtotapDeferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    window.__avtotapDeferredPrompt = null;
  });
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;

    const safeCheckForUpdate = async (registration: ServiceWorkerRegistration) => {
      if (!navigator.onLine) return;
      try {
        const health = await fetch('/api/health', { cache: 'no-store' });
        const contentType = health.headers.get('content-type') || '';
        if (!health.ok || !contentType.includes('application/json')) return;
        await registration.update();
      } catch {
        // Ignore transient network/server-restart errors during background polling
      }
    };

    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        window.setInterval(() => {
          void safeCheckForUpdate(registration);
        }, 60_000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void safeCheckForUpdate(registration);
          }
        });
      },
      onNeedRefresh() {
        void updateSW(true);
      },
      onRegisterError() {
        // Prevent unhandled registration rejections
      },
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  } else {
    void navigator.serviceWorker
      .getRegistrations()
      .then(async (regs) => {
        for (const reg of regs) {
          const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
          if (scriptUrl.includes('dev-sw.js')) {
            await reg.unregister();
          }
        }
        await navigator.serviceWorker.register('/sw-push.js', { scope: '/' });
      })
      .catch(() => {
        // ignore dev SW cleanup errors
      });
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
