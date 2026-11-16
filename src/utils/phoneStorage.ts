import type { AdminSettings, RequestWithQuotes, Shop } from '../types';

const DB_NAME = 'avtotap_phone_storage';
const DB_VERSION = 1;
const STORE_KV = 'kv';

export interface AdminPhoneBackup {
  shops: Shop[];
  adminWhatsapp: string;
  savedAt: string;
}

export interface ShopPhoneCache {
  shopId: string;
  shopName: string;
  requests: Array<Record<string, unknown>>;
  savedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openPhoneDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_KV)) {
            db.createObjectStore(STORE_KV);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function requestPersistentPhoneStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore unsupported browsers
  }
  return false;
}

export async function getPhoneStorageStats(): Promise<{
  persisted: boolean;
  usedKb: number;
}> {
  let persisted = false;
  let usedKb = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usedKb = Math.round((est.usage || 0) / 1024);
    }
  } catch {
    // ignore
  }
  return { persisted, usedKb };
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openPhoneDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(`avtotap_idb_${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readonly');
      const store = tx.objectStore(STORE_KV);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    localStorage.setItem(`avtotap_idb_${key}`, JSON.stringify(value));
  } catch {
    // ignore quota errors on localStorage fallback
  }
  const db = await openPhoneDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function saveOrderSnapshotToPhone(order: RequestWithQuotes): Promise<void> {
  await idbSet(`order_${order.id}`, order);
}

export async function loadOrderSnapshotFromPhone(orderId: string): Promise<RequestWithQuotes | null> {
  return idbGet<RequestWithQuotes>(`order_${orderId}`);
}

export async function saveShopFeedToPhone(cache: ShopPhoneCache): Promise<void> {
  await idbSet('shop_feed_cache', cache);
}

export async function loadShopFeedFromPhone(): Promise<ShopPhoneCache | null> {
  return idbGet<ShopPhoneCache>('shop_feed_cache');
}

export async function saveAdminBackupToPhone(
  shops: Shop[],
  settings: AdminSettings
): Promise<AdminPhoneBackup> {
  const backup: AdminPhoneBackup = {
    shops: shops.map((s) => ({
      id: s.id,
      name: s.name,
      district: s.district,
      whatsapp: s.whatsapp,
      telegramChatId: s.telegramChatId,
      pin: s.pin,
      tariff: s.tariff,
      expiresAt: s.expiresAt,
      status: s.status,
      createdAt: s.createdAt,
    })),
    adminWhatsapp: settings.adminWhatsapp,
    savedAt: new Date().toISOString(),
  };
  await idbSet('admin_backup', backup);
  return backup;
}

export async function loadAdminBackupFromPhone(): Promise<AdminPhoneBackup | null> {
  return idbGet<AdminPhoneBackup>('admin_backup');
}
