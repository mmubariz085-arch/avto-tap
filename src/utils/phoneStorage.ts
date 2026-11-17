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

async function idbDelete(key: string): Promise<void> {
  try {
    localStorage.removeItem(`avtotap_idb_${key}`);
  } catch {
    // ignore
  }
  const db = await openPhoneDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      store.delete(key);
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

export async function deleteOrderSnapshotFromPhone(orderId: string): Promise<void> {
  await idbDelete(`order_${orderId}`);
}

export async function clearAllOrderSnapshotsFromPhone(orderIds: string[]): Promise<void> {
  await Promise.all(orderIds.map((id) => idbDelete(`order_${id}`)));
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
      ownerUid: s.ownerUid,
      ownerEmail: s.ownerEmail,
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

export async function saveAuthTokenToPhone(role: 'admin' | 'shop', token: string): Promise<void> {
  const lsKey = role === 'admin' ? 'avtotap_admin_token' : 'avtotap_shop_token';
  try {
    localStorage.setItem(lsKey, token);
  } catch {
    // ignore
  }
  await idbSet(`auth_token_${role}`, token);
}

export async function loadAuthTokenFromPhone(role: 'admin' | 'shop'): Promise<string | null> {
  const lsKey = role === 'admin' ? 'avtotap_admin_token' : 'avtotap_shop_token';
  try {
    const lsToken = localStorage.getItem(lsKey);
    if (lsToken) return lsToken;
  } catch {
    // ignore
  }
  const idbToken = await idbGet<string>(`auth_token_${role}`);
  if (idbToken) {
    try {
      localStorage.setItem(lsKey, idbToken);
    } catch {
      // ignore
    }
  }
  return idbToken || null;
}

export async function clearAuthTokenFromPhone(role: 'admin' | 'shop'): Promise<void> {
  const lsKey = role === 'admin' ? 'avtotap_admin_token' : 'avtotap_shop_token';
  try {
    localStorage.removeItem(lsKey);
  } catch {
    // ignore
  }
  await idbDelete(`auth_token_${role}`);
}

export interface ShopProfilePhoneCache {
  shop: Record<string, unknown>;
  adminWhatsapp: string;
  savedAt: string;
}

export async function saveShopProfileToPhone(
  shop: Record<string, unknown>,
  adminWhatsapp: string
): Promise<void> {
  await idbSet('shop_profile_cache', {
    shop,
    adminWhatsapp,
    savedAt: new Date().toISOString(),
  });
}

export async function loadShopProfileFromPhone(): Promise<ShopProfilePhoneCache | null> {
  return idbGet<ShopProfilePhoneCache>('shop_profile_cache');
}

export async function clearShopProfileFromPhone(): Promise<void> {
  await idbDelete('shop_profile_cache');
  await idbDelete('shop_feed_cache');
}

export async function savePreferredSection(section: 'shop'): Promise<void> {
  try {
    localStorage.setItem('avtotap_preferred_section', section);
  } catch {
    // ignore
  }
  await idbSet('preferred_section', section);
}

export async function loadPreferredSection(): Promise<'shop' | null> {
  try {
    const ls = localStorage.getItem('avtotap_preferred_section');
    if (ls === 'shop') return 'shop';
  } catch {
    // ignore
  }
  const idbVal = await idbGet<string>('preferred_section');
  if (idbVal === 'shop') {
    try {
      localStorage.setItem('avtotap_preferred_section', 'shop');
    } catch {
      // ignore
    }
    return 'shop';
  }
  return null;
}

export async function clearPreferredSection(): Promise<void> {
  try {
    localStorage.removeItem('avtotap_preferred_section');
  } catch {
    // ignore
  }
  await idbDelete('preferred_section');
}


