import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, CheckCircle2, Crown, MessageCircle, Phone, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { buildTelUrl, buildWhatsAppUrl, formatTimeAgoAz } from '../utils/phone';
import { triggerAlertFeedback } from '../utils/notify';
import { extractApiError } from '../utils/api';
import { loadOrderSnapshotFromPhone, saveOrderSnapshotToPhone } from '../utils/phoneStorage';
import { PushNotificationsButton } from './PushNotificationsButton';
import type { RequestWithQuotes, ShopQuote, WsEvent } from '../types';

interface OrderTrackingViewProps {
  orderId: string;
  initialOrder?: RequestWithQuotes | null;
  onNewRequest: () => void;
}

function sortQuotes(quotes: ShopQuote[]): ShopQuote[] {
  return [...quotes].sort((a, b) => {
    if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
    if (a.priceAzn !== b.priceAzn) return a.priceAzn - b.priceAzn;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  orderId,
  initialOrder,
  onNewRequest,
}) => {
  const [order, setOrder] = useState<RequestWithQuotes | null>(initialOrder ?? null);
  const [activeShopCount, setActiveShopCount] = useState<number>(0);
  const [loading, setLoading] = useState(!initialOrder);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
  const [newQuoteBanner, setNewQuoteBanner] = useState<string | null>(null);
  const seenQuoteIdsRef = useRef<Set<string>>(
    new Set((initialOrder?.quotes || []).map((q) => q.id))
  );
  const initializedRef = useRef<boolean>(Boolean(initialOrder));

  // Hydrate immediately from phone memory if available while network loads
  useEffect(() => {
    let active = true;
    void loadOrderSnapshotFromPhone(orderId).then((cached) => {
      if (
        !active ||
        !cached ||
        typeof cached !== 'object' ||
        typeof cached.id !== 'string' ||
        typeof cached.carBrandModel !== 'string'
      ) {
        return;
      }
      const normalized: RequestWithQuotes = {
        ...cached,
        quotes: Array.isArray(cached.quotes) ? cached.quotes : [],
        quoteCount: Array.isArray(cached.quotes) ? cached.quotes.length : 0,
      };
      setOrder((prev) => prev || normalized);
      normalized.quotes.forEach((q) => {
        if (q && typeof q.id === 'string') seenQuoteIdsRef.current.add(q.id);
      });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orderId]);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(orderId)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        const cached = await loadOrderSnapshotFromPhone(orderId);
        if (cached && typeof cached === 'object' && typeof cached.id === 'string') {
          setOrder({
            ...cached,
            quotes: Array.isArray(cached.quotes) ? cached.quotes : [],
            quoteCount: Array.isArray(cached.quotes) ? cached.quotes.length : 0,
          });
          setErrorMsg(null);
          return;
        }
        setErrorMsg(extractApiError(data, 'Sifariş tapılmadı.'));
        setOrder(null);
        return;
      }
      const rawReq = data.request as RequestWithQuotes;
      const incomingOrder: RequestWithQuotes = {
        ...rawReq,
        quotes: Array.isArray(rawReq?.quotes) ? rawReq.quotes : [],
        quoteCount: Array.isArray(rawReq?.quotes) ? rawReq.quotes.length : 0,
      };
      if (initializedRef.current) {
        const newlyAdded = incomingOrder.quotes.filter((q) => !seenQuoteIdsRef.current.has(q.id));
        if (newlyAdded.length > 0) {
          const latest = newlyAdded[0];
          triggerAlertFeedback('incoming', {
            notification: {
              title: `Yeni qiymət: ${latest.priceAzn} AZN (${latest.shopName})`,
              body: `${incomingOrder.partName} · ${latest.condition}`,
              url: `/?order=${encodeURIComponent(orderId)}`,
              tag: `quote-${latest.id}`,
            },
          });
          setNewQuoteBanner(`Yeni təklif gəldi: ${latest.shopName} — ${latest.priceAzn} AZN`);
        }
      }
      incomingOrder.quotes.forEach((q) => seenQuoteIdsRef.current.add(q.id));
      initializedRef.current = true;
      setOrder(incomingOrder);
      void saveOrderSnapshotToPhone(incomingOrder);
      if (typeof data.activeShopCount === 'number') {
        setActiveShopCount(data.activeShopCount);
      }
      setErrorMsg(null);
    } catch {
      const cached = await loadOrderSnapshotFromPhone(orderId);
      if (cached && typeof cached === 'object' && typeof cached.id === 'string') {
        setOrder({
          ...cached,
          quotes: Array.isArray(cached.quotes) ? cached.quotes : [],
          quoteCount: Array.isArray(cached.quotes) ? cached.quotes.length : 0,
        });
        setErrorMsg(null);
      } else {
        setErrorMsg('Məlumat yüklənmədi. Yenidən cəhd edin.');
      }
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUser = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws?role=driver&orderId=${encodeURIComponent(orderId)}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        setWsConnected(true);
        void fetchOrder();
      };

      socket.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as WsEvent;
          if (event.type === 'quote:created' && event.payload.requestId === orderId) {
            const incoming = event.payload.quote;
            if (!seenQuoteIdsRef.current.has(incoming.id)) {
              seenQuoteIdsRef.current.add(incoming.id);
              triggerAlertFeedback('incoming', {
                notification: {
                  title: `Yeni qiymət: ${incoming.priceAzn} AZN (${incoming.shopName})`,
                  body: `${incoming.condition} · ${incoming.availability}`,
                  url: `/?order=${encodeURIComponent(orderId)}`,
                  tag: `quote-${incoming.id}`,
                },
              });
              setNewQuoteBanner(`Yeni təklif gəldi: ${incoming.shopName} — ${incoming.priceAzn} AZN`);
            }
            setOrder((prev) => {
              if (!prev) return prev;
              const filtered = prev.quotes.filter(
                (q) => q.id !== incoming.id && q.shopId !== incoming.shopId
              );
              const merged = sortQuotes([incoming, ...filtered]);
              const nextOrder: RequestWithQuotes = {
                ...prev,
                quotes: merged,
                quoteCount: merged.length,
              };
              void saveOrderSnapshotToPhone(nextOrder);
              return nextOrder;
            });
          } else if (event.type === 'request:deleted' && event.payload.requestId === orderId) {
            setErrorMsg('Bu sorğu administrator tərəfindən silinib.');
            setOrder(null);
          }
        } catch {
          // ignore malformed event
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [orderId, fetchOrder]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-sm font-medium text-slate-600">Sifariş məlumatları yüklənir...</p>
      </div>
    );
  }

  if (errorMsg || !order) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <p className="font-display text-lg font-bold text-slate-950">{errorMsg || 'Sifariş tapılmadı.'}</p>
          <button
            type="button"
            onClick={onNewRequest}
            className="mt-5 inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-orange-700 px-6 py-3 text-sm font-bold text-white hover:bg-orange-800"
          >
            <Plus className="h-4 w-4" />
            <span>Yeni sorğu yarat</span>
          </button>
        </div>
      </div>
    );
  }

  const safeQuotes = Array.isArray(order.quotes) ? order.quotes : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-9">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onNewRequest}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Yeni sorğu göndər</span>
        </button>

        <div className="flex items-center gap-3">
          {wsConnected && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
              <span>Canlı yenilənir</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchOrder()}
            aria-label="Yenilə"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Yenilə</span>
          </button>
        </div>
      </div>

      {newQuoteBanner && (
        <div
          role="status"
          className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-bold text-emerald-950 shadow-sm"
        >
          <span className="inline-flex items-center gap-2">
            <Bell className="h-4 w-4 text-emerald-700 shrink-0" />
            <span>{newQuoteBanner}</span>
          </span>
          <button
            type="button"
            onClick={() => setNewQuoteBanner(null)}
            aria-label="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-emerald-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Order Summary Card (Obsidian High-Contrast Surface) */}
        <aside className="rounded-3xl bg-[#0B1120] p-6 text-white shadow-[0_14px_32px_-16px_rgba(11,17,32,0.5)] lg:col-span-4">
          <p className="font-mono text-xs font-semibold text-slate-400">
            Sifariş · #{String(order.id || '').slice(-6).toUpperCase()}
          </p>
          <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-white">
            {order.carBrandModel} <span className="font-mono font-bold text-slate-400">({order.year})</span>
          </h1>
          <p className="mt-2 text-base font-bold text-orange-400">{order.partName}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <span className="font-mono tabular-nums text-slate-300">{order.driverWhatsapp}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimeAgoAz(order.createdAt)}</span>
          </div>

          {order.photoDataUrl && (
            <button
              type="button"
              onClick={() => setZoomPhoto(order.photoDataUrl || null)}
              className="mt-4 block w-full overflow-hidden rounded-2xl border border-white/10"
            >
              <img
                src={order.photoDataUrl}
                alt={order.partName}
                referrerPolicy="no-referrer"
                className="h-44 w-full object-cover"
              />
            </button>
          )}

          <div className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-300">
            Sorğunuz {activeShopCount > 0 ? `${activeShopCount} aktiv mağazaya` : 'mağazalara'} göndərilib və telefon yaddaşında saxlanılır.
          </div>

          <div className="mt-4">
            <PushNotificationsButton role="driver" orderId={orderId} />
          </div>
        </aside>

        {/* Live Shop Quotes Column */}
        <section className="space-y-4 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-extrabold text-slate-950">
              Mağaza cavabları{' '}
              <span className="font-mono tabular-nums text-slate-500">({safeQuotes.length})</span>
            </h2>
          </div>

          {safeQuotes.length === 0 ? (
            <div className="rounded-3xl border border-slate-200/90 bg-white p-9 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
              <h3 className="mt-4 font-display text-base font-bold text-slate-950">Mağazalardan cavab gözlənilir</h3>
              <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
                Səhifəni bağlamayın və ya puş bildirişləri aktiv saxlayın — satıcılar qiymət göndərən kimi təkliflər burada dərhal görünəcək.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {safeQuotes.map((quote) => {
                const waText = [
                  `Salam, ${quote.shopName}! Şərur AvtoZapcast üzərindən cavabınızı gördüm.`,
                  `Avtomobil: ${order.carBrandModel} (${order.year})`,
                  `Detal: ${order.partName}`,
                  `Təklif olunan qiymət: ${quote.priceAzn} AZN (${quote.condition}, ${quote.availability})`,
                  `Əlaqə nömrəm: ${order.driverWhatsapp}`,
                ].join('\n');

                const waUrl = buildWhatsAppUrl(quote.shopWhatsapp, waText);
                const telUrl = buildTelUrl(quote.shopWhatsapp);

                return (
                  <article
                    key={quote.id}
                    className={`overflow-hidden rounded-3xl border shadow-sm transition-shadow hover:shadow-md ${
                      quote.isVip
                        ? 'border-amber-400/80 bg-white ring-1 ring-amber-300/60'
                        : 'border-slate-200/90 bg-white'
                    }`}
                  >
                    {quote.isVip && (
                      <div className="flex items-center justify-between bg-[#0B1120] px-5 py-2.5 text-xs font-bold text-amber-300">
                        <span className="inline-flex items-center gap-1.5">
                          <Crown className="h-3.5 w-3.5 text-amber-400" />
                          <span>VIP Tərəfdaş</span>
                        </span>
                        <span className="text-slate-300 font-normal">Ön sırada sabitlənib</span>
                      </div>
                    )}

                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-display text-lg font-extrabold text-slate-950 truncate">
                            {quote.shopName}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-600">
                            {quote.shopDistrict && (
                              <>
                                <span>{quote.shopDistrict}</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span className="text-slate-950 font-semibold">{quote.condition}</span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{quote.availability}</span>
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-display font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-slate-950">
                            {quote.priceAzn} <span className="text-sm font-bold text-slate-500">AZN</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {formatTimeAgoAz(quote.createdAt)}
                          </div>
                        </div>
                      </div>

                      {quote.comment && (
                        <p className="mt-3.5 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs leading-relaxed text-slate-700">
                          {quote.comment}
                        </p>
                      )}

                      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-green-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-800 active:scale-[0.985]"
                        >
                          <MessageCircle className="h-5 w-5 shrink-0" />
                          <span>WhatsApp-da yaz</span>
                        </a>

                        <a
                          href={telUrl}
                          className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100 active:scale-[0.985]"
                        >
                          <Phone className="h-5 w-5 shrink-0 text-slate-700" />
                          <span>Zəng et</span>
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" />
            <span>Ödəniş və detalın yoxlanılması birbaşa mağaza ilə həyata keçirilir.</span>
          </div>
        </section>
      </div>

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
            className="max-h-[85vh] max-w-full rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
