export type ShopTariff = 'Test' | 'Bazis 25 AZN' | 'VIP 40 AZN';

export type ShopStatus = 'Aktiv' | 'Deaktiv';

export type PartCondition = 'Orijinal' | 'Dublikat' | 'Üstən çıxma';

export type PartAvailability = 'Mövcuddur' | 'Sifarişlə (1-2 gün)' | 'Anbarda son ədəd';

export interface Shop {
  id: string;
  name: string;
  district: string;
  whatsapp: string;
  telegramChatId?: string;
  pin: string;
  tariff: ShopTariff;
  expiresAt: string; // YYYY-MM-DD
  status: ShopStatus;
  createdAt: string;
}

export interface PublicShopInfo {
  id: string;
  name: string;
  district: string;
  whatsapp: string;
  telegramChatId?: string;
  tariff: ShopTariff;
  expiresAt: string;
  status: ShopStatus;
  isExpired: boolean;
  isEffectivelyActive: boolean;
}

export interface PartRequest {
  id: string;
  carBrandModel: string;
  year: string;
  partName: string;
  photoDataUrl?: string;
  driverWhatsapp: string;
  district?: string;
  note?: string;
  createdAt: string;
}

export interface ShopQuote {
  id: string;
  requestId: string;
  shopId: string;
  shopName: string;
  shopDistrict: string;
  shopWhatsapp: string;
  shopTariff: ShopTariff;
  isVip: boolean;
  priceAzn: number;
  condition: PartCondition;
  availability: PartAvailability;
  comment?: string;
  createdAt: string;
}

export interface RequestWithQuotes extends PartRequest {
  quotes: ShopQuote[];
  quoteCount: number;
}

export interface AdminSettings {
  adminWhatsapp: string;
  telegramBotConfigured: boolean;
}

export interface TelegramSubscriber {
  chatId: string;
  displayName: string;
  username?: string;
  lastText?: string;
  date: number;
}

export type WsEvent =
  | { type: 'request:created'; payload: RequestWithQuotes }
  | { type: 'request:deleted'; payload: { requestId: string } }
  | { type: 'quote:created'; payload: { requestId: string; quote: ShopQuote } }
  | { type: 'shop:updated'; payload: { shopId: string } }
  | { type: 'ping' };
