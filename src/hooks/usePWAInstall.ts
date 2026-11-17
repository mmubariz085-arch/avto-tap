import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== 'undefined' && window.__avtotapDeferredPrompt) {
      return window.__avtotapDeferredPrompt as BeforeInstallPromptEvent;
    }
    return null;
  });
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    try {
      const isStandalone =
        (typeof window.matchMedia === 'function' &&
          Boolean(window.matchMedia('(display-mode: standalone)')?.matches)) ||
        (window.navigator as unknown as { standalone?: boolean })?.standalone === true;
      setIsInstalled(isStandalone);

      const ua = (window.navigator?.userAgent || '').toLowerCase();
      setIsIOS(/iphone|ipad|ipod/.test(ua));
      setIsInAppBrowser(
        /;\s*wv\)|fbav|fban|instagram|whatsapp|telegram|gsa\/|micromessenger|line\//.test(ua)
      );

      if (window.__avtotapDeferredPrompt) {
        setDeferredPrompt(window.__avtotapDeferredPrompt as BeforeInstallPromptEvent);
      }
    } catch {
      // ignore restricted WebView environment
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__avtotapDeferredPrompt = e;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      window.__avtotapDeferredPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<InstallOutcome> => {
    const promptEvent =
      deferredPrompt ||
      (typeof window !== 'undefined'
        ? (window.__avtotapDeferredPrompt as BeforeInstallPromptEvent | null)
        : null);
    if (!promptEvent) return 'unavailable';
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      window.__avtotapDeferredPrompt = null;
      setDeferredPrompt(null);
      if (outcome === 'accepted') {
        setIsInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isInAppBrowser,
    install,
  };
}
