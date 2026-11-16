import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
  Send,
  Store,
  X,
} from 'lucide-react';
import { buildWhatsAppUrl, formatTimeAgoAz } from '../utils/phone';
import { triggerAlertFeedback, unlockAudio } from '../utils/notify';
import type {
  PartAvailability,
  PartCondition,
  PartRequest,
  PublicShopInfo,
  ShopQuote,
} from '../types';

interface QuickReplyViewProps {
  requestId: string;
  shopToken: string;
  onOpenFullShopCabinet: (token: string) => void;
}

const CONDITIONS: PartCondition[] = ['Orijinal', 'Dublikat', 'Üstən çıxma'];
const AVAILABILITIES: PartAvailability[] = ['Mövcuddur', 'Anbarda son ədəd', 'Sifarişlə (1-2 gün)'];

export const QuickReplyView: React.FC<QuickReplyViewProps> = ({
  requestId,
  shopToken,
  onOpenFullShopCabinet,
}) => {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shop, setShop] = useState<PublicShopInfo | null>(null);
  const [adminWhatsapp, setAdminWhatsapp] = useState('');
  const [request, setRequest] = useState<PartRequest | null>(null);
  const [sentQuote, setSentQuote] = useState<ShopQuote | null>(null);

  const [priceAzn, setPriceAzn] = useState('');
  const [condition, setCondition] = useState<PartCondition>('Orijinal');
  const [availability, setAvailability] = useState<PartAvailability>('Mövcuddur');
  const [comment, setComment] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/shop/quick-reply/${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${shopToken}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setErrorMsg(data.error || 'Sorğu yüklənmədi.');
          return;
        }
        setShop(data.shop);
        setAdminWhatsapp(data.adminWhatsapp || '');
        setRequest(data.request);
        if (data.myQuote) {
          const q = data.myQuote as ShopQuote;
          setSentQuote(q);
          setPriceAzn(String(q.priceAzn));
          setCondition(q.condition);
          setAvailability(q.availability);
          setComment(q.comment || '');
        }
      })
      .catch(() => {
        if (active) setErrorMsg('Şəbəkə xətası baş verdi.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestId, shopToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    setSubmitError(null);
    const parsed = Number(priceAzn);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      triggerAlertFeedback('error');
      setSubmitError('Düzgün qiymət (AZN) daxil edin.');
      return;
    }

    setIsSending(true);
    try {
      const res = await fetch('/api/shop/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${shopToken}`,
        },
        body: JSON.stringify({
          requestId,
          priceAzn: parsed,
          condition,
          availability,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        triggerAlertFeedback('error');
        setSubmitError(data.error || 'Cavab göndərilmədi.');
        return;
      }
      triggerAlertFeedback('success');
      setSentQuote(data.quote);
      setJustSubmitted(true);
    } catch {
      triggerAlertFeedback('error');
      setSubmitError('Serverlə əlaqə xətası.');
    } finally {
      setIsSending(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center text-sm font-medium text-slate-600">
        Sorğu məlumatları açılır...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base font-bold text-slate-900">{errorMsg}</p>
          <button
            type="button"
            onClick={() => onOpenFullShopCabinet(shopToken)}
            className="mt-5 w-full min-h-[48px] rounded-xl bg-slate-900 text-sm font-bold text-white hover:bg-slate-800"
          >
            Mağaza kabinetinə keç
          </button>
        </div>
      </div>
    );
  }

  if (shop && !shop.isEffectivelyActive) {
    const renewalText = `Salam! "${shop.name}" mağazasının (${shop.whatsapp}) AvtoTap abunəliyini uzatmaq istəyirəm.`;
    const adminWaUrl = buildWhatsAppUrl(adminWhatsapp || '+994507770000', renewalText);

    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-extrabold text-slate-900">
            {shop.isExpired ? 'Abunəlik müddətiniz bitib' : 'Mağaza hesabı deaktivdir'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Cavab göndərmək üçün administrator ilə əlaqə saxlayıb abunəliyi aktivləşdirin.
          </p>
          <a
            href={adminWaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex w-full min-h-[50px] items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white hover:bg-green-800"
          >
            <MessageCircle className="h-5 w-5" />
            <span>Admin ilə əlaqə</span>
          </a>
        </div>
      </div>
    );
  }

  if (!request || !shop) return null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-5 sm:py-8 space-y-4">
      {/* Shop identity bar */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-900">{shop.name}</p>
          <p className="text-xs text-slate-500">Telegram sürətli cavab səhifəsi</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenFullShopCabinet(shopToken)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 shrink-0"
        >
          <Store className="h-4 w-4" />
          <span>Bütün sorğular</span>
        </button>
      </div>

      {/* Driver Request Card */}
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span>{formatTimeAgoAz(request.createdAt)}</span>
            </div>
            <h1 className="mt-1 text-xl font-extrabold text-slate-900">
              {request.carBrandModel} <span className="font-mono text-slate-600">({request.year})</span>
            </h1>
            <p className="mt-1 text-base font-bold text-orange-700">{request.partName}</p>
          </div>

          {request.photoDataUrl && (
            <button
              type="button"
              onClick={() => setZoomPhoto(request.photoDataUrl || null)}
              className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200"
            >
              <img
                src={request.photoDataUrl}
                alt={request.partName}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </button>
          )}
        </div>
      </article>

      {/* Success Banner or Form */}
      {justSubmitted && sentQuote ? (
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-3 text-lg font-extrabold text-slate-900">Cavabınız sürücüyə göndərildi!</h2>
          <p className="mt-1 text-sm text-slate-600">
            <strong className="font-mono text-slate-900">{sentQuote.priceAzn} AZN</strong> · {sentQuote.condition} ·{' '}
            {sentQuote.availability}
          </p>
          <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setJustSubmitted(false)}
              className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              Qiyməti dəyiş
            </button>
            <button
              type="button"
              onClick={() => onOpenFullShopCabinet(shopToken)}
              className="min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800"
            >
              Mağaza kabineti
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <div>
            <label htmlFor="quick-price" className="block text-sm font-bold text-slate-900">
              Qiymət (AZN)
            </label>
            <input
              id="quick-price"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="1"
              value={priceAzn}
              onChange={(e) => setPriceAzn(e.target.value)}
              placeholder="Məsələn: 120"
              className="mt-1.5 w-full min-h-[52px] rounded-xl border border-slate-300 px-4 font-mono text-xl font-bold text-slate-900 focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
              required
            />
          </div>

          <div>
            <span className="block text-sm font-bold text-slate-900">Detalın vəziyyəti</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CONDITIONS.map((cond) => (
                <button
                  key={cond}
                  type="button"
                  onClick={() => setCondition(cond)}
                  className={`min-h-[46px] rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
                    condition === cond
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {cond}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-sm font-bold text-slate-900">Mövcudluq</span>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {AVAILABILITIES.map((avail) => (
                <button
                  key={avail}
                  type="button"
                  onClick={() => setAvailability(avail)}
                  className={`min-h-[44px] rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors ${
                    availability === avail
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {avail}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="quick-comment" className="block text-sm font-bold text-slate-900">
              Əlavə qeyd <span className="font-normal text-slate-500">(istəyə bağlı)</span>
            </label>
            <input
              id="quick-comment"
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Məsələn: Zəmanət verilir"
              className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-orange-600 focus:outline-none"
            />
          </div>

          {submitError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSending}
            className="flex w-full min-h-[54px] items-center justify-center gap-2 rounded-xl bg-orange-700 px-5 py-3 text-base font-bold text-white hover:bg-orange-800 disabled:opacity-60"
          >
            <Send className="h-5 w-5" />
            <span>{isSending ? 'Göndərilir...' : sentQuote ? 'Qiyməti yenilə' : 'Qiyməti göndər'}</span>
          </button>
        </form>
      )}

      {zoomPhoto && (
        <div
          onClick={() => setZoomPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4"
        >
          <button
            type="button"
            onClick={() => setZoomPhoto(null)}
            aria-label="Bağla"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={zoomPhoto}
            alt="Detalın böyüdülmüş şəkli"
            referrerPolicy="no-referrer"
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
