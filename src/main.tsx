import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
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
      // Poll for new versions online every 60s and whenever app returns to foreground
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
      // Prevent unhandled registration rejections if server is temporarily unavailable
    },
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
