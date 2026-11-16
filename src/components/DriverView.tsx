import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronRight, ImagePlus, QrCode, Send, Trash2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { compressImageFile } from '../utils/phone';
import { subscribePushNotifications, triggerAlertFeedback, unlockAudio } from '../utils/notify';
import type { LegalDocType } from './LegalModal';
import { PushNotificationsButton } from './PushNotificationsButton';
import type { RequestWithQuotes } from '../types';

const POPULAR_BRANDS = [
  'Mercedes',
  'BMW',
  'Hyundai',
  'Kia',
  'Toyota',
  'Lada / VAZ',
  'Chevrolet',
  'Nissan',
  'Opel',
  'Volkswagen',
];

export interface SavedOrderSummary {
  id: string;
  carBrandModel: string;
  year: string;
  partName: string;
  createdAt: string;
}

interface DriverViewProps {
  activeShopCount: number;
  savedOrders: SavedOrderSummary[];
  onOrderCreated: (req: RequestWithQuotes) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenLegal: (doc: LegalDocType) => void;
}

export const DriverView: React.FC<DriverViewProps> = ({
  activeShopCount,
  savedOrders,
  onOrderCreated,
  onOpenOrder,
  onOpenLegal,
}) => {
  const [carBrandModel, setCarBrandModel] = useState('');
  const [year, setYear] = useState('');
  const [partName, setPartName] = useState('');
  const [driverWhatsapp, setDriverWhatsapp] = useState('+994 ');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [isCompressing, setIsCompressing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  const brandInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedPhone = localStorage.getItem('avtotap_driver_phone');
    if (savedPhone) {
      setDriverWhatsapp(savedPhone);
    }
  }, []);

  const handleSelectBrand = (brand: string) => {
    const current = carBrandModel.trim();
    if (!current || POPULAR_BRANDS.some((b) => current.toLowerCase().startsWith(b.toLowerCase()))) {
      setCarBrandModel(`${brand} `);
    } else {
      setCarBrandModel(`${brand} ${current}`);
    }
    brandInputRef.current?.focus();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setIsCompressing(true);
    try {
      const compressed = await compressImageFile(file);
      setPhotoDataUrl(compressed);
    } catch {
      setErrorMsg('Şəkli yükləmək mümkün olmadı. Başqa şəkil seçin.');
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    unlockAudio();
    setErrorMsg(null);

    const cleanBrand = carBrandModel.trim();
    const cleanYear = year.trim();
    const cleanPart = partName.trim();
    const cleanPhone = driverWhatsapp.trim();

    if (!cleanBrand) {
      triggerAlertFeedback('error');
      setErrorMsg('Avtomobilin marka və modelini yazın.');
      return;
    }
    if (!cleanYear) {
      triggerAlertFeedback('error');
      setErrorMsg('Buraxılış ilini qeyd edin.');
      return;
    }
    if (!cleanPart) {
      triggerAlertFeedback('error');
      setErrorMsg('Lazım olan detalın adını yazın.');
      return;
    }
    if (cleanPhone.replace(/\D/g, '').length < 9) {
      triggerAlertFeedback('error');
      setErrorMsg('Düzgün WhatsApp nömrəsi daxil edin.');
      return;
    }
    if (!acceptedTerms) {
      triggerAlertFeedback('error');
      setErrorMsg('Davam etmək üçün razılaşma və məxfilik şərtlərini təsdiq edin.');
      return;
    }

    setIsSubmitting(true);
    const payload = JSON.stringify({
      carBrandModel: cleanBrand,
      year: cleanYear,
      partName: cleanPart,
      photoDataUrl,
      driverWhatsapp: cleanPhone,
      acceptedTerms: true,
    });

    try {
      let lastError = 'Serverlə əlaqə yaradılmadı. İnterneti yoxlayın.';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 15000);
          const res = await fetch('/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            body: payload,
            signal: controller.signal,
          });
          window.clearTimeout(timeoutId);

          const rawText = await res.text();
          let data: { error?: string; request?: RequestWithQuotes } = {};
          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch {
            data = {};
          }

          if (!res.ok) {
            if (res.status >= 500 && attempt === 0) {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            triggerAlertFeedback('error');
            setErrorMsg(data.error || 'Sorğu göndərilərkən xəta baş verdi.');
            return;
          }

          if (!data.request) {
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            triggerAlertFeedback('error');
            setErrorMsg('Server cavabı natamam oldu. Yenidən cəhd edin.');
            return;
          }

          localStorage.setItem('avtotap_driver_phone', cleanPhone);
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            void subscribePushNotifications({
              role: 'driver',
              orderId: data.request.id,
              requestPermissionIfDefault: false,
            });
          }
          triggerAlertFeedback('success');
          onOrderCreated(data.request);
          return;
        } catch {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          lastError = 'Serverlə əlaqə yaradılmadı. İnterneti yoxlayın.';
        }
      }
      triggerAlertFeedback('error');
      setErrorMsg(lastError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        {/* Primary Form Column */}
        <div className="lg:col-span-7">
          <div className="mb-5">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
              Bütün mağazalara 1 sorğu göndər
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              {activeShopCount > 0
                ? `${activeShopCount} aktiv mağaza və ölüxana sorğunuza real vaxtda qiymət göndərəcək.`
                : 'Yerli ehtiyat hissəsi mağazalarından və ölüxanalardan dərhal qiymət alın.'}
            </p>
            <div className="mt-3">
              <PushNotificationsButton role="driver" />
            </div>
          </div>

          <form
            noValidate
            onSubmit={handleSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 space-y-5"
          >
            {/* Brand & Model */}
            <div>
              <label htmlFor="car-brand-input" className="block text-sm font-semibold text-slate-900">
                Avtomobilin marka və modeli
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {POPULAR_BRANDS.map((brand) => {
                  const isSelected = carBrandModel.toLowerCase().startsWith(brand.toLowerCase());
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => handleSelectBrand(brand)}
                      className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {brand}
                    </button>
                  );
                })}
              </div>
              <input
                ref={brandInputRef}
                id="car-brand-input"
                type="text"
                value={carBrandModel}
                onChange={(e) => setCarBrandModel(e.target.value)}
                placeholder="Məsələn: Mercedes E-Class W211"
                className="mt-2.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
              />
            </div>

            {/* Year */}
            <div>
              <label htmlFor="car-year-input" className="block text-sm font-semibold text-slate-900">
                Buraxılış ili
              </label>
              <input
                id="car-year-input"
                type="text"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="Məsələn: 2014"
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 font-mono tabular-nums text-base text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
              />
            </div>

            {/* Part Name */}
            <div>
              <label htmlFor="part-name-input" className="block text-sm font-semibold text-slate-900">
                Lazım olan detalın adı
              </label>
              <input
                id="part-name-input"
                type="text"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder="Məsələn: Ön sağ fara, su radiatoru, arxa bufer"
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
              />
            </div>

            {/* Optional Photo Upload */}
            <div>
              <span className="block text-sm font-semibold text-slate-900">
                Detalın şəkli <span className="font-normal text-slate-500">(istəyə bağlı)</span>
              </span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {!photoDataUrl ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isCompressing}
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 active:scale-[0.99]"
                  >
                    <Camera className="h-5 w-5 text-orange-700 shrink-0" />
                    <span className="truncate">Kameradan çək</span>
                  </button>
                  <button
                    type="button"
                    disabled={isCompressing}
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 active:scale-[0.99]"
                  >
                    <ImagePlus className="h-5 w-5 text-slate-700 shrink-0" />
                    <span className="truncate">Qalereyadan seç</span>
                  </button>
                </div>
              ) : (
                <div className="mt-2 relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <img
                    src={photoDataUrl}
                    alt="Detalın yüklənmiş şəkli"
                    referrerPolicy="no-referrer"
                    className="h-44 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoDataUrl(undefined)}
                    className="absolute right-2.5 top-2.5 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm hover:bg-slate-950"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Şəkli sil</span>
                  </button>
                </div>
              )}
              {isCompressing && (
                <p className="mt-1.5 text-xs text-slate-500">Şəkil hazırlanır...</p>
              )}
            </div>

            {/* Driver WhatsApp */}
            <div>
              <label htmlFor="driver-whatsapp" className="block text-sm font-semibold text-slate-900">
                WhatsApp nömrəniz
              </label>
              <input
                id="driver-whatsapp"
                type="tel"
                inputMode="tel"
                value={driverWhatsapp}
                onChange={(e) => setDriverWhatsapp(e.target.value)}
                placeholder="+994 50 123 45 67"
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 font-mono tabular-nums text-base text-slate-900 placeholder:text-slate-400 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
              />
            </div>

            {/* Terms Checkbox (full row clickable) */}
            <div
              onClick={() => setAcceptedTerms((v) => !v)}
              className="flex cursor-pointer items-start gap-3 rounded-xl p-2 -mx-2 hover:bg-slate-50 select-none"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={acceptedTerms}
                onClick={(e) => {
                  e.stopPropagation();
                  setAcceptedTerms((v) => !v);
                }}
                className="flex h-7 w-7 min-h-[44px] min-w-[44px] -ml-1 -my-1.5 items-center justify-center rounded-xl transition-colors shrink-0"
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                    acceptedTerms
                      ? 'border-orange-700 bg-orange-700 text-white'
                      : 'border-slate-400 bg-white text-transparent'
                  }`}
                >
                  <Check className="h-4 w-4 stroke-[3]" />
                </span>
              </button>
              <p className="text-xs leading-relaxed text-slate-600 pt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenLegal('terms');
                  }}
                  className="font-semibold text-slate-900 underline underline-offset-2 hover:text-orange-700"
                >
                  İstifadəçi razılaşması
                </button>{' '}
                və{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenLegal('privacy');
                  }}
                  className="font-semibold text-slate-900 underline underline-offset-2 hover:text-orange-700"
                >
                  Məxfilik siyasəti
                </button>{' '}
                şərtləri ilə tanış oldum və razıyam.
              </p>
            </div>

            {errorMsg && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isCompressing}
              className="flex w-full min-h-[54px] items-center justify-center gap-2.5 rounded-xl bg-orange-700 px-6 py-3.5 text-base font-bold text-white shadow-sm transition-all hover:bg-orange-800 active:scale-[0.99] disabled:opacity-60"
            >
              <Send className="h-5 w-5" />
              <span>{isSubmitting ? 'Sorğu göndərilir...' : 'Sorğu göndər'}</span>
            </button>
          </form>
        </div>

        {/* Right / Secondary Column: Saved Orders + How it Works + QR Share */}
        <div className="space-y-5 lg:col-span-5">
          {savedOrders.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-sm font-bold text-slate-900">Son sifarişləriniz</h2>
              <div className="mt-3 divide-y divide-slate-100">
                {savedOrders.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenOrder(item.id)}
                    className="flex w-full min-h-[56px] items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-slate-50 rounded-lg px-2 -mx-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.carBrandModel} · <span className="font-mono">{item.year}</span>
                      </p>
                      <p className="truncate text-xs text-slate-600">{item.partName}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900">Necə işləyir?</h2>
            <ol className="space-y-3 text-sm text-slate-600">
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-900 font-mono text-xs font-bold text-white">
                  1
                </span>
                <span>Avtomobilinizi və lazım olan detalı yazın, istəsəniz şəklini çəkin.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-900 font-mono text-xs font-bold text-white">
                  2
                </span>
                <span>Sorğu bütün aktiv mağazalara və avtoölüxanalara dərhal çatır.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-900 font-mono text-xs font-bold text-white">
                  3
                </span>
                <span>Qiymətlər ekranda canlı görünür — bəyəndiyiniz mağazaya bir toxunuşla WhatsApp-da yazın.</span>
              </li>
            </ol>

            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
              >
                <QrCode className="h-4 w-4 text-slate-700" />
                <span>Tətbiqi QR kod ilə paylaş</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">QR kod ilə aç</h3>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                aria-label="Bağla"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex justify-center rounded-xl border border-slate-200 bg-white p-5">
              <QRCodeSVG value={currentUrl || 'https://avtotap.az'} size={180} />
            </div>
            <p className="mt-3 text-xs text-slate-600 break-all">{currentUrl}</p>
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="mt-5 w-full min-h-[46px] rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Bağla
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
