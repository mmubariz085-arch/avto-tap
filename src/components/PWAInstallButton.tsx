import React, { useState } from 'react';
import { Check, Copy, Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isInAppBrowser, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const outcome = await install();
      if (outcome === 'unavailable') {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  const handleCopyLink = async () => {
    const appUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://avtotap.az';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(appUrl);
      } else {
        const input = document.createElement('input');
        input.value = appUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 shadow-sm"
      >
        {isIOS ? <Share className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        <span>Ekrana yüklə</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 shrink-0">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="pwa-guide-title" className="text-base font-bold text-slate-900">
                    Ana ekrana əlavə et
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tətbiq kimi bir toxunuşla açın
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Bağla"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isInAppBrowser && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                Hazırda tətbiq daxili brauzer (WhatsApp, Telegram və ya Google) ilə açılıb. Quraşdırmaq üçün aşağıdakı linki kopyalayıb{' '}
                <strong>{isIOS ? 'Safari' : 'Google Chrome'}</strong> brauzerində açın.
              </div>
            )}

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-700">
                <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    1
                  </span>
                  <span>
                    Safari brauzerinin aşağı panelindəki{' '}
                    <strong className="inline-flex items-center gap-1 text-slate-900">
                      Paylaş <Share className="inline h-3.5 w-3.5" />
                    </strong>{' '}
                    düyməsinə toxunun.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    2
                  </span>
                  <span>
                    Aşağı sürüşdürüb <strong>«Ana ekrana əlavə et» (Add to Home Screen)</strong> seçin.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-700">
                <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    1
                  </span>
                  <span>
                    Chrome brauzerinin sağ yuxarı küncündəki{' '}
                    <strong className="inline-flex items-center gap-0.5 text-slate-900">
                      menyu <MoreVertical className="inline h-3.5 w-3.5" />
                    </strong>{' '}
                    düyməsinə toxunun.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    2
                  </span>
                  <span>
                    <strong>«Əsas ekrana əlavə et»</strong> və ya <strong>«Tətbiqi quraşdır»</strong> seçimini seçin.
                  </span>
                </li>
              </ol>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span className="text-emerald-700">Link kopyalandı</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Linki kopyala</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[44px] w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Başa düşdüm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
