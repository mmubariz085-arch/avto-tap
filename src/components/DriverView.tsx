import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronRight, ImagePlus, QrCode, Send, Trash2 } from 'lucide-react';
import { compressImageFile } from '../utils/phone';
import {
  getSafeNotificationPermission,
  subscribePushNotifications,
  triggerAlertFeedback,
  unlockAudio,
} from '../utils/notify';
import { extractApiError } from '../utils/api';
import { saveOrderSnapshotToPhone } from '../utils/phoneStorage';
import type { LegalDocType } from './LegalModal';
import { PushNotificationsButton } from './PushNotificationsButton';
import { QrPosterModal } from './QrPosterModal';
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
  onDeleteOrder: (orderId: string) => void;
  onClearOrders: () => void;
  onOpenLegal: (doc: LegalDocType) => void;
}

export const DriverView: React.FC<DriverViewProps> = ({
  activeShopCount,
  savedOrders,
  onOrderCreated,
  onOpenOrder,
  onDeleteOrder,
  onClearOrders,
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
    try {
      const savedPhone = localStorage.getItem('avtotap_driver_phone');
      if (savedPhone) {
        setDriverWhatsapp(savedPhone);
      }
    } catch {
      // ignore storage errors
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
            setErrorMsg(extractApiError(data, 'Sorğu göndərilərkən xəta baş verdi.'));
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

          try {
            localStorage.setItem('avtotap_driver_phone', cleanPhone);
          } catch {
            // ignore storage errors
          }
          void saveOrderSnapshotToPhone(data.request);
          if (getSafeNotificationPermission() === 'granted') {
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-9">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        {/* Primary Form Column */}
        <div className="lg:col-span-7">
          <div className="mb-6">
            <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl text-balance">
              Bütün mağazalara 1 sorğu göndər
            </h1>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
              {activeShopCount > 0
                ? `${activeShopCount} aktiv mağaza və ölüxana sorğunuza real vaxtda qiymət göndərəcək.`
                : 'Yerli ehtiyat hissəsi mağazalarından və ölüxanalardan dərhal qiymət alın.'}
            </p>
            <div className="mt-3.5">
              <PushNotificationsButton role="driver" />
            </div>
          </div>

          <form
            noValidate
            onSubmit={handleSubmit}
            className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_2px_10px_rgba(11,17,32,0.03),0_18px_40px_-24px_rgba(11,17,32,0.12)] sm:p-7 space-y-5"
          >
            {/* Brand & Model */}
            <div>
              <label htmlFor="car-brand-input" className="block text-sm font-bold text-slate-900">
                Avtomobilin marka və modeli
              </label>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {POPULAR_BRANDS.map((brand) => {
                  const isSelected = carBrandModel.toLowerCase().startsWith(brand.toLowerCase());
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => handleSelectBrand(brand)}
                      className={`min-h-[40px] rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'border-[#0B1120] bg-[#0B1120] text-white shadow-sm'
                          : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
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
                className="mt-3 w-full min-h-[50px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 text-base text-slate-950 placeholder:text-slate-400 transition-colors focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
              />
            </div>

            {/* Year + Part row on wider mobile/tablet */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label htmlFor="car-year-input" className="block text-sm font-bold text-slate-900">
                  Buraxılış ili
                </label>
                <input
                  id="car-year-input"
                  type="text"
                  inputMode="numeric"
                  value={year}
                  onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                  placeholder="2014"
                  className="mt-1.5 w-full min-h-[50px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 font-mono tabular-nums text-base font-semibold text-slate-950 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 transition-colors focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="part-name-input" className="block text-sm font-bold text-slate-900">
                  Lazım olan detalın adı
                </label>
                <input
                  id="part-name-input"
                  type="text"
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  placeholder="Ön sağ fara, su radiatoru, arxa bufer"
                  className="mt-1.5 w-full min-h-[50px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 text-base text-slate-950 placeholder:text-slate-400 transition-colors focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
                />
              </div>
            </div>

            {/* Optional Photo Upload */}
            <div>
              <span className="block text-sm font-bold text-slate-900">
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
                    className="flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-semibold text-slate-800 transition-all hover:border-slate-300 hover:bg-slate-100 active:scale-[0.98]"
                  >
                    <Camera className="h-5 w-5 text-orange-600 shrink-0" />
                    <span className="truncate">Kameradan çək</span>
                  </button>
                  <button
                    type="button"
                    disabled={isCompressing}
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-semibold text-slate-800 transition-all hover:border-slate-300 hover:bg-slate-100 active:scale-[0.98]"
                  >
                    <ImagePlus className="h-5 w-5 text-slate-700 shrink-0" />
                    <span className="truncate">Qalereyadan seç</span>
                  </button>
                </div>
              ) : (
                <div className="mt-2 relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                  <img
                    src={photoDataUrl}
                    alt="Detalın yüklənmiş şəkli"
                    referrerPolicy="no-referrer"
                    className="h-48 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoDataUrl(undefined)}
                    className="absolute right-3 top-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md hover:bg-slate-950"
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
              <label htmlFor="driver-whatsapp" className="block text-sm font-bold text-slate-900">
                WhatsApp nömrəniz
              </label>
              <input
                id="driver-whatsapp"
                type="tel"
                inputMode="tel"
                value={driverWhatsapp}
                onChange={(e) => setDriverWhatsapp(e.target.value)}
                placeholder="+994 50 123 45 67"
                className="mt-1.5 w-full min-h-[50px] rounded-2xl border border-slate-200 bg-slate-50/75 px-4 font-mono tabular-nums text-base font-medium text-slate-950 placeholder:text-slate-400 transition-colors focus:border-orange-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-orange-600/10"
              />
            </div>

            {/* Terms Checkbox */}
            <div
              onClick={() => setAcceptedTerms((v) => !v)}
              className="flex cursor-pointer items-start gap-3 rounded-2xl p-2.5 -mx-2.5 transition-colors hover:bg-slate-50 select-none"
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
                  className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-colors ${
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
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isCompressing}
              className="flex w-full min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-b from-orange-600 to-orange-700 px-6 py-3.5 text-base font-bold text-white shadow-[0_10px_24px_-8px_rgba(194,65,12,0.48)] transition-all hover:from-orange-700 hover:to-orange-800 active:scale-[0.985] disabled:opacity-60"
            >
              <Send className="h-5 w-5" />
              <span>{isSubmitting ? 'Sorğu göndərilir...' : 'Sorğu göndər'}</span>
            </button>
          </form>
        </div>

        {/* Right / Secondary Column */}
        <div className="space-y-5 lg:col-span-5 lg:pt-2">
          {savedOrders.length > 0 && (
            <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-bold text-slate-950">Son sifarişləriniz</h2>
                  <span className="font-mono text-xs text-slate-500">({savedOrders.length})</span>
                </div>
                <button
                  type="button"
                  onClick={onClearOrders}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Hamısını sil</span>
                </button>
              </div>
              <div className="mt-3 divide-y divide-slate-100">
                {savedOrders.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenOrder(item.id)}
                      className="flex min-h-[52px] min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-slate-50 -ml-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-950">
                          {item.carBrandModel} · <span className="font-mono text-slate-600">{item.year}</span>
                        </p>
                        <p className="truncate text-xs font-medium text-orange-700 mt-0.5">{item.partName}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteOrder(item.id)}
                      aria-label={`${item.partName} sifarişini sil`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-sm space-y-5">
            <h2 className="font-display text-base font-bold text-slate-950">Necə işləyir?</h2>
            <ol className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <li className="flex items-start gap-3.5">
                <span className="font-mono text-xs font-bold text-orange-700 pt-0.5 shrink-0">
                  01.
                </span>
                <span>Avtomobilinizi və lazım olan detalı yazın, istəsəniz şəklini əlavə edin.</span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="font-mono text-xs font-bold text-orange-700 pt-0.5 shrink-0">
                  02.
                </span>
                <span>Sorğu bütün aktiv mağazalara və avtoölüxanalara dərhal bildirişlə çatır.</span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="font-mono text-xs font-bold text-orange-700 pt-0.5 shrink-0">
                  03.
                </span>
                <span>Qiymətlər telefonunuzda canlı görünür — bəyəndiyiniz mağazaya WhatsApp-da yazın.</span>
              </li>
            </ol>

            <div className="pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-2.5 text-xs font-bold text-slate-800 transition-colors hover:bg-slate-100"
              >
                <QrCode className="h-4 w-4 text-orange-600 shrink-0" />
                <span>QR kod kartı (Çap et və paylaş)</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      <QrPosterModal open={showQrModal} onClose={() => setShowQrModal(false)} />
    </div>
  );
};
