import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { Shop } from './types';

export const ADMIN_EMAIL = 'mmubariz085@gmail.com';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export async function signInWithGmail(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore signOut errors
  }
}

export function mapFirebaseAuthErrorAz(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  if (code === 'auth/popup-closed-by-user') {
    return 'Google giriş pəncərəsi bağlandı. Yenidən cəhd edin.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Brauzer pəncərəni blokladı. Açılan pəncərələrə (Popup) icazə verin.';
  }
  if (code === 'auth/cancelled-popup-request') {
    return 'Giriş sorğusu ləğv edildi.';
  }
  if (code === 'auth/network-request-failed') {
    return 'İnternet bağlantısı yoxdur və ya zəifdir.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Bu domen Firebase Auth siyahısında icazəli deyil.';
  }
  return 'Gmail ilə giriş zamanı xəta baş verdi. Yenidən cəhd edin.';
}

export async function syncUserProfileToFirestore(
  user: User,
  role: 'admin' | 'shop'
): Promise<void> {
  const email = (user.email || '').trim().toLowerCase();
  if (!email || !user.emailVerified) return;

  const userPath = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const safeDisplayName = (user.displayName || '').trim().slice(0, 120);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email,
        displayName: safeDisplayName,
        role: email === ADMIN_EMAIL ? role : 'shop',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName: safeDisplayName,
        email,
        updatedAt: serverTimestamp(),
      });
    }

    if (role === 'admin' && email === ADMIN_EMAIL) {
      const adminRef = doc(db, 'admins', user.uid);
      const adminSnap = await getDoc(adminRef);
      if (!adminSnap.exists()) {
        await setDoc(adminRef, {
          uid: user.uid,
          email,
          createdAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncShopToFirestore(
  shop: Shop,
  options: { asAdmin?: boolean } = {}
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const path = `shops/${shop.id}`;
  try {
    const shopRef = doc(db, 'shops', shop.id);
    const snap = await getDoc(shopRef);

    const safeDistrict = (shop.district || '').trim().slice(0, 80);
    const safeTelegram = (shop.telegramChatId || '').trim().slice(0, 40);
    const safeOwnerUid = (shop.ownerUid || currentUser.uid).slice(0, 128);
    const safeOwnerEmail = (shop.ownerEmail || currentUser.email || '').trim().slice(0, 200);

    if (!snap.exists()) {
      await setDoc(shopRef, {
        id: shop.id,
        ownerUid: safeOwnerUid,
        ownerEmail: safeOwnerEmail,
        name: shop.name.trim().slice(0, 100),
        district: safeDistrict,
        whatsapp: shop.whatsapp.trim().slice(0, 32),
        telegramChatId: safeTelegram,
        pin: shop.pin.trim().slice(0, 12),
        tariff: shop.tariff,
        expiresAt: shop.expiresAt,
        status: shop.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (options.asAdmin) {
      await updateDoc(shopRef, {
        ownerUid: safeOwnerUid,
        ownerEmail: safeOwnerEmail,
        name: shop.name.trim().slice(0, 100),
        district: safeDistrict,
        whatsapp: shop.whatsapp.trim().slice(0, 32),
        telegramChatId: safeTelegram,
        pin: shop.pin.trim().slice(0, 12),
        tariff: shop.tariff,
        expiresAt: shop.expiresAt,
        status: shop.status,
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.ownerUid === currentUser.uid) {
      await updateDoc(shopRef, {
        name: shop.name.trim().slice(0, 100),
        district: safeDistrict,
        whatsapp: shop.whatsapp.trim().slice(0, 32),
        telegramChatId: safeTelegram,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadAllShopsFromFirestoreForAdmin(): Promise<Shop[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || (currentUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return [];
  }
  const path = 'shops';
  try {
    const snap = await getDocs(collection(db, 'shops'));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id || d.id),
        ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : undefined,
        ownerEmail: typeof data.ownerEmail === 'string' ? data.ownerEmail : undefined,
        name: String(data.name || ''),
        district: typeof data.district === 'string' && data.district ? data.district : undefined,
        whatsapp: String(data.whatsapp || ''),
        telegramChatId: typeof data.telegramChatId === 'string' ? data.telegramChatId : '',
        pin: String(data.pin || '0000'),
        tariff:
          data.tariff === 'Test' || data.tariff === 'Bazis 25 AZN' || data.tariff === 'VIP 40 AZN'
            ? data.tariff
            : 'Test',
        expiresAt: String(data.expiresAt || ''),
        status: data.status === 'Deaktiv' ? 'Deaktiv' : 'Aktiv',
        createdAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function loadMyShopFromFirestore(uid: string): Promise<Shop | null> {
  const path = 'shops';
  try {
    const q = query(collection(db, 'shops'), where('ownerUid', '==', uid));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return {
      id: String(data.id || snap.docs[0].id),
      ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : undefined,
      ownerEmail: typeof data.ownerEmail === 'string' ? data.ownerEmail : undefined,
      name: String(data.name || ''),
      district: typeof data.district === 'string' && data.district ? data.district : undefined,
      whatsapp: String(data.whatsapp || ''),
      telegramChatId: typeof data.telegramChatId === 'string' ? data.telegramChatId : '',
      pin: String(data.pin || '0000'),
      tariff:
        data.tariff === 'Test' || data.tariff === 'Bazis 25 AZN' || data.tariff === 'VIP 40 AZN'
          ? data.tariff
          : 'Test',
      expiresAt: String(data.expiresAt || ''),
      status: data.status === 'Deaktiv' ? 'Deaktiv' : 'Aktiv',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function deleteShopFromFirestore(shopId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || (currentUser.email || '').toLowerCase() !== ADMIN_EMAIL) return;
  const path = `shops/${shopId}`;
  try {
    await deleteDoc(doc(db, 'shops', shopId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
