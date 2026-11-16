import React from 'react';
import { ArrowLeft, X } from 'lucide-react';

export type LegalDocType = 'terms' | 'privacy' | null;

interface LegalModalProps {
  doc: LegalDocType;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ doc, onClose }) => {
  if (!doc) return null;

  const isTerms = doc === 'terms';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 sm:p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Geri"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-bold text-slate-900">
              {isTerms ? 'İstifadəçi razılaşması' : 'Məxfilik siyasəti'}
            </h2>
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

        <div className="overflow-y-auto px-5 py-6 text-sm leading-relaxed text-slate-700 space-y-4">
          {isTerms ? (
            <>
              <p className="font-semibold text-slate-900">1. Ümumi müddəalar</p>
              <p>
                Şərur AvtoZapcast platforması sürücülər ilə rayon üzrə fəaliyyət göstərən avtomobil ehtiyat hissələri
                mağazaları və avtoölüxanalar arasında sürətli məlumat mübadiləsini təmin edən rəqəmsal vasitədir.
              </p>
              <p className="font-semibold text-slate-900">2. Xidmətin iş prinsipi</p>
              <p>
                Sürücü avtomobilin markası, buraxılış ili, lazım olan detal və əlaqə nömrəsi barədə sorğu
                göndərdikdə, sistemə qoşulmuş aktiv mağazalar həmin sorğu üzrə öz qiymət təkliflərini
                (AZN ilə), detalın vəziyyətini və mövcudluğunu təqdim edirlər.
              </p>
              <p className="font-semibold text-slate-900">3. Məsuliyyət bölgüsü</p>
              <p>
                Detalın keyfiyyəti, zəmanət şərtləri, çatdırılma və ödəniş şərtləri birbaşa sürücü ilə seçilmiş
                mağaza arasında razılaşdırılır. Platforma yalnız sorğunun mağazalara çatdırılmasına və cavabların
                real vaxtda göstərilməsinə xidmət edir.
              </p>
              <p className="font-semibold text-slate-900">4. Düzgün məlumat və spam qadağası</p>
              <p>
                İstifadəçilər yalnız real ehtiyat hissəsi sorğuları göndərməlidirlər. Saxta, təhqiramiz və ya spam
                xarakterli sorğular administrator tərəfindən xəbərdarlıqsız silinir.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-900">1. Toplanan məlumatlar</p>
              <p>
                Sorğu göndərərkən təqdim etdiyiniz avtomobil məlumatları, detalın şəkli (əgər əlavə olunubsa) və
                WhatsApp nömrəniz yalnız ehtiyat hissəsi təkliflərinin hazırlanması və sizinlə əlaqə saxlanılması
                məqsədilə emal olunur.
              </p>
              <p className="font-semibold text-slate-900">2. Məlumatların paylaşılması</p>
              <p>
                Sorğu detalları yalnız platformada aktiv abunəliyə malik tərəfdaş mağazalara və ölüxanalara
                göstərilir. Məlumatlar üçüncü tərəf reklam şəbəkələrinə satılmır və ötürülmür.
              </p>
              <p className="font-semibold text-slate-900">3. Şəkillər və saxlanma müddəti</p>
              <p>
                Yüklənən detal şəkilləri mağazaların detalı dəqiq tanıması üçün istifadə olunur. İstifadəçi
                sorğunun silinməsini istədikdə administrator vasitəsilə məlumatların ləğvini tələb edə bilər.
              </p>
              <p className="font-semibold text-slate-900">4. Brauzer yaddaşı</p>
              <p>
                Son göndərdiyiniz sifarişlərə tez qayıda bilməyiniz üçün sifariş identifikatorları cihazınızın
                yerli yaddaşında (localStorage) saxlanılır.
              </p>
            </>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Bağla
          </button>
        </div>
      </div>
    </div>
  );
};
