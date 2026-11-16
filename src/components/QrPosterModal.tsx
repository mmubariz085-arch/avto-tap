import React, { useRef, useState } from 'react';
import { Download, Printer, RotateCcw, X } from 'lucide-react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';

interface QrPosterModalProps {
  open: boolean;
  onClose: () => void;
}

const POSTER_BG_URL = '/src/assets/images/qr_poster_bg_1794862231610.jpg';

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export const QrPosterModal: React.FC<QrPosterModalProps> = ({ open, onClose }) => {
  const defaultUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://serur-avtozapcast.az';
  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [bgFailed, setBgFailed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const qrCanvasWrapperRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const cleanUrl = targetUrl.trim() || defaultUrl;
  const displayHost = cleanUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '');

  const handleDownloadPoster = async () => {
    setIsDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1600;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Base dark obsidian fill
      const fallbackGrad = ctx.createLinearGradient(0, 0, 1200, 1600);
      fallbackGrad.addColorStop(0, '#141E36');
      fallbackGrad.addColorStop(0.55, '#0B1120');
      fallbackGrad.addColorStop(1, '#070B14');
      ctx.fillStyle = fallbackGrad;
      ctx.fillRect(0, 0, 1200, 1600);

      // Draw generated studio automotive background image (cover fit)
      const bgImg = await loadImg(POSTER_BG_URL);
      if (bgImg) {
        const imgRatio = bgImg.width / bgImg.height;
        const canvasRatio = 1200 / 1600;
        let drawW = 1200;
        let drawH = 1600;
        let drawX = 0;
        let drawY = 0;
        if (imgRatio > canvasRatio) {
          drawW = 1600 * imgRatio;
          drawX = (1200 - drawW) / 2;
        } else {
          drawH = 1200 / imgRatio;
          drawY = (1600 - drawH) / 2;
        }
        ctx.drawImage(bgImg, drawX, drawY, drawW, drawH);
      }

      // Contrast scrim overlay so text + QR remain 100% crisp in print
      const scrim = ctx.createLinearGradient(0, 0, 0, 1600);
      scrim.addColorStop(0, 'rgba(7, 11, 20, 0.58)');
      scrim.addColorStop(0.45, 'rgba(11, 17, 32, 0.62)');
      scrim.addColorStop(1, 'rgba(7, 11, 20, 0.88)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, 1200, 1600);

      // Top burnt-orange accent bar
      ctx.fillStyle = '#EA580C';
      ctx.fillRect(0, 0, 1200, 18);

      // Outer subtle frame border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 4;
      roundRectPath(ctx, 42, 48, 1116, 1504, 44);
      ctx.stroke();

      // App Icon & Brand Row
      const iconImg = await loadImg('/pwa-192x192.png');
      if (iconImg) {
        ctx.save();
        roundRectPath(ctx, 100, 108, 124, 124, 28);
        ctx.clip();
        ctx.drawImage(iconImg, 100, 108, 124, 124);
        ctx.restore();
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = '#FB923C';
      ctx.font = '700 28px "Plus Jakarta Sans", "Noto Sans", sans-serif';
      ctx.fillText('ŞƏRUR RAYONU · ONLAYN EHTİYAT HİSSƏLƏRİ', 252, 152);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 58px "Outfit", "Noto Sans", sans-serif';
      ctx.fillText('Şərur AvtoZapcast', 252, 218);

      // Main Headline
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 66px "Outfit", "Noto Sans", sans-serif';
      ctx.fillText('Bütün mağazalara', 600, 345);
      ctx.fillStyle = '#FB923C';
      ctx.fillText('1 sorğu göndər!', 600, 424);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '500 30px "Plus Jakarta Sans", "Noto Sans", sans-serif';
      ctx.fillText('Mağaza-mağaza gəzməyə ehtiyac yoxdur —', 600, 492);
      ctx.fillText('bütün dükanlardan və ölüxanalardan dərhal qiymət al.', 600, 534);

      // White High-Contrast QR Card
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 46;
      ctx.shadowOffsetY = 18;
      ctx.fillStyle = '#FFFFFF';
      roundRectPath(ctx, 240, 595, 720, 680, 44);
      ctx.fill();
      ctx.restore();

      // Orange corner accent brackets inside QR card
      ctx.fillStyle = '#EA580C';
      roundRectPath(ctx, 490, 622, 220, 10, 5);
      ctx.fill();

      // Copy crisp QR from hidden high-res QRCodeCanvas
      const srcQrCanvas = qrCanvasWrapperRef.current?.querySelector('canvas');
      if (srcQrCanvas) {
        ctx.drawImage(srcQrCanvas, 340, 660, 520, 520);
      }

      // Scan Caption inside white card
      ctx.fillStyle = '#0B1120';
      ctx.font = '800 32px "Outfit", "Noto Sans", sans-serif';
      ctx.fillText('KAMERANI QR KODA TUTUN', 600, 1236);

      // Clean URL bar below QR card
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      roundRectPath(ctx, 180, 1310, 840, 66, 20);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '600 28px "JetBrains Mono", monospace';
      const urlText = displayHost.length > 42 ? `${displayHost.slice(0, 41)}…` : displayHost;
      ctx.fillText(urlText, 600, 1353);

      // Bottom 3 editorial steps
      const steps = [
        { num: '01.', text: 'QR-i skan et' },
        { num: '02.', text: 'Detalı yaz' },
        { num: '03.', text: 'Qiyməti seç' },
      ];
      steps.forEach((step, idx) => {
        const cx = 240 + idx * 360;
        ctx.fillStyle = '#FB923C';
        ctx.font = '700 30px "JetBrains Mono", monospace';
        ctx.fillText(step.num, cx, 1445);
        ctx.fillStyle = '#F1F5F9';
        ctx.font = '700 30px "Plus Jakarta Sans", "Noto Sans", sans-serif';
        ctx.fillText(step.text, cx, 1492);
      });

      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'serur-avtozapcast-qr-kart.png';
      a.click();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/75 sm:p-4 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-md flex-col rounded-t-3xl sm:rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />

        {/* Modal Top Toolbar */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h3 className="font-display text-base font-extrabold text-slate-950">
              Çap üçün QR kod kartı
            </h3>
            <p className="text-xs text-slate-500">Şəkil kimi yükləyin və ya çap edib asın</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Bağla"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Poster Preview + Controls */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Hidden High-Res QR Canvas used strictly for PNG Poster Export */}
          <div ref={qrCanvasWrapperRef} className="hidden" aria-hidden="true">
            <QRCodeCanvas value={cleanUrl} size={560} level="H" bgColor="#FFFFFF" fgColor="#0B1120" />
          </div>

          {/* Printable Poster Card Preview */}
          <div
            id="qr-printable-poster"
            className="relative overflow-hidden rounded-3xl bg-[#0B1120] text-white shadow-[0_22px_44px_-16px_rgba(11,17,32,0.55)] border border-slate-800"
          >
            {/* Background Studio Image + Scrim */}
            {!bgFailed && (
              <img
                src={POSTER_BG_URL}
                alt="Avto servis fonu"
                referrerPolicy="no-referrer"
                onError={() => setBgFailed(true)}
                className="absolute inset-0 h-full w-full object-cover opacity-80"
              />
            )}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(7,11,20,0.62) 0%, rgba(11,17,32,0.65) 48%, rgba(7,11,20,0.92) 100%)',
              }}
            />

            {/* Top Burnt-Orange Strip */}
            <div className="relative h-2 w-full bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600" />

            <div className="relative p-5 sm:p-6 text-center">
              {/* Brand Lockup */}
              <div className="flex items-center justify-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="Şərur AvtoZapcast loqosu"
                  className="h-12 w-12 rounded-2xl border border-white/15 shadow-md shrink-0"
                />
                <div className="text-left">
                  <p className="text-[10px] font-bold tracking-wider text-orange-400">
                    ŞƏRUR · EHTİYAT HİSSƏLƏRİ
                  </p>
                  <p className="font-display text-lg font-extrabold tracking-tight text-white">
                    Şərur AvtoZapcast
                  </p>
                </div>
              </div>

              {/* Poster Callout */}
              <h4 className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-tight text-white text-balance">
                Bütün mağazalara{' '}
                <span className="text-orange-400">1 sorğu göndər!</span>
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                Mağaza-mağaza gəzməyə ehtiyac yoxdur — skan et, bütün dükan və ölüxanalardan dərhal qiymət al.
              </p>

              {/* High-Contrast White QR Container */}
              <div className="mx-auto mt-4 w-fit rounded-3xl bg-white p-4 shadow-[0_14px_30px_rgba(0,0,0,0.45)]">
                <div className="mx-auto mb-2.5 h-1 w-14 rounded-full bg-orange-600" />
                <QRCodeSVG
                  value={cleanUrl}
                  size={196}
                  level="H"
                  bgColor="#FFFFFF"
                  fgColor="#0B1120"
                />
                <p className="mt-2.5 font-display text-xs font-extrabold tracking-wide text-slate-950">
                  KAMERANI QR KODA TUTUN
                </p>
              </div>

              {/* Clean URL Strip */}
              <div className="mt-3.5 rounded-xl bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <p className="truncate font-mono text-[11px] font-semibold text-slate-100">
                  {displayHost}
                </p>
              </div>

              {/* Bottom 3 Steps */}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-3.5 text-center">
                <div>
                  <span className="block font-mono text-[11px] font-bold text-orange-400">01.</span>
                  <span className="text-[11px] font-semibold text-slate-100">QR-i skan et</span>
                </div>
                <div>
                  <span className="block font-mono text-[11px] font-bold text-orange-400">02.</span>
                  <span className="text-[11px] font-semibold text-slate-100">Detalı yaz</span>
                </div>
                <div>
                  <span className="block font-mono text-[11px] font-bold text-orange-400">03.</span>
                  <span className="text-[11px] font-semibold text-slate-100">Qiyməti seç</span>
                </div>
              </div>
            </div>
          </div>

          {/* Editable QR Target Link */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="qr-target-url" className="text-xs font-bold text-slate-700">
                QR kodun açacağı sayt linki
              </label>
              {targetUrl !== defaultUrl && (
                <button
                  type="button"
                  onClick={() => setTargetUrl(defaultUrl)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-orange-700 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Cari link</span>
                </button>
              )}
            </div>
            <input
              id="qr-target-url"
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1.5 w-full min-h-[44px] rounded-2xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-xs text-slate-900 focus:border-orange-600 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Sticky Bottom Print & Download Actions */}
        <div className="grid grid-cols-2 gap-2.5 border-t border-slate-100 bg-white px-5 py-4">
          <button
            type="button"
            disabled={isDownloading}
            onClick={() => void handleDownloadPoster()}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-600 to-orange-700 px-3 text-xs font-bold text-white shadow-sm hover:from-orange-700 hover:to-orange-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4 shrink-0" />
            <span>{isDownloading ? 'Hazırlanır...' : 'Şəkil kimi yüklə'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#0B1120] px-3 text-xs font-bold text-white hover:bg-slate-800"
          >
            <Printer className="h-4 w-4 shrink-0" />
            <span>Çap et</span>
          </button>
        </div>
      </div>
    </div>
  );
};
