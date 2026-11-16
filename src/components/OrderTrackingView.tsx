import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Crown, MessageCircle, Phone, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { buildTelUrl, buildWhatsAppUrl, formatTimeAgoAz } from '../utils/phone';
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

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(orderId)}`);
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Sifariş tapılmadı.');
        setOrder(null);
        return;
      }
      setOrder(data.request);
      if (typeof data.activeShopCount === 'number') {
        setActiveShopCount(data.activeShopCount);
      }
      setErrorMsg(null);
    } catch {
      setErrorMsg('Məlumat yüklənmədi. Yenidən cəhd edin.');
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
            setOrder((prev) => {
              if (!prev) return prev;
              const filtered = prev.quotes.filter(
                (q) => q.id !== incoming.id && q.shopId !== incoming.shopId
              );
              const merged = sortQuotes([incoming, ...filtered]);
              return {
                ...prev,
                quotes: merged,
                quoteCount: merged.length,
              };
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
      <div className="mx-auto max-w-4xl px-4 py-10 text-center">
        <p className="text-sm font-medium text-slate-600">Sifariş məlumatları yüklənir...</p>
      </div>
    );
  }

  if (errorMsg || !order) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base font-bold text-slate-900">{errorMsg || 'Sifariş tapılmadı.'}</p>
          <button
            type="button"
            onClick={onNewRequest}
            className="mt-5 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-orange-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-800"
          >
            <Plus className="h-4 w-4" />
            <span>Yeni sorğu yarat</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onNewRequest}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
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
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Yenilə</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Order Summary Card */}
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-4">
          <p className="text-xs font-semibold text-slate-500">Sifariş nömrəsi · #{order.id.slice(-6).toUpperCase()}</p>
          <h1 className="mt-1.5 text-xl font-extrabold text-slate-900">
            {order.carBrandModel} <span className="font-mono font-bold text-slate-600">({order.year})</span>
          </h1>
          <p className="mt-2 text-base font-semibold text-orange-700">{order.partName}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{order.district || 'Bakı'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{order.driverWhatsapp}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimeAgoAz(order.createdAt)}</span>
          </div>

          {order.photoDataUrl && (
            <button
              type="button"
              onClick={() => setZoomPhoto(order.photoDataUrl || null)}
              className="mt-4 block w-full overflow-hidden rounded-xl border border-slate-200"
            >
              <img
                src={order.photoDataUrl}
                alt={order.partName}
                referrerPolicy="no-referrer"
                className="h-44 w-full object-cover"
              />
            </button>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-600">
            Sorğunuz {activeShopCount > 0 ? `${activeShopCount} aktiv mağazaya` : 'mağazalara'} göndərilib.
            Mağaza qiymət göndərdikcə təkliflər burada dərhal görünəcək.
          </div>
        </aside>

        {/* Live Shop Quotes Column */}
        <section className="space-y-4 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-slate-900">
              Mağaza cavabları{' '}
              <span className="font-mono tabular-nums text-slate-500">({order.quotes.length})</span>
            </h2>
          </div>

          {order.quotes.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-900">Mağazalardan cavab gözlənilir</h3>
              <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
                Səhifəni bağlamayın — satıcılar qiymət göndərən kimi təkliflər burada avtomatik görünəcək.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {order.quotes.map((quote) => {
                const waText = [
                  `Salam, ${quote.shopName}! AvtoTap üzərindən cavabınızı gördüm.`,
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
                    className={`overflow-hidden rounded-2xl border shadow-sm transition-colors ${
                      quote.isVip
                        ? 'border-amber-400 bg-amber-50/30'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    {quote.isVip && (
                      <div className="flex items-center justify-between bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300">
                        <span className="inline-flex items-center gap-1.5">
                          <Crown className="h-3.5 w-3.5 text-amber-400" />
                          <span>VIP Tərəfdaş</span>
                        </span>
                        <span className="text-slate-300 font-normal">Ön sırada sabitlənib</span>
                      </div>
                    )}

                    <div className="p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="text-base font-extrabold text-slate-900 truncate">
                            {quote.shopName}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-600">
                            <span>{quote.shopDistrict}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-900 font-semibold">{quote.condition}</span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{quote.availability}</span>
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-mono tabular-nums text-2xl font-extrabold text-slate-900">
                            {quote.priceAzn} <span className="text-sm font-bold text-slate-600">AZN</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {formatTimeAgoAz(quote.createdAt)}
                          </div>
                        </div>
                      </div>

                      {quote.comment && (
                        <p className="mt-3 rounded-xl bg-slate-100/80 px-3.5 py-2.5 text-xs text-slate-700">
                          {quote.comment}
                        </p>
                      )}

                      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full min-h-[50px] items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-800 active:scale-[0.99]"
                        >
                          <MessageCircle className="h-5 w-5 shrink-0" />
                          <span>WhatsApp-da yaz</span>
                        </a>

                        <a
                          href={telUrl}
                          className="flex w-full min-h-[50px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 active:scale-[0.99]"
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
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
