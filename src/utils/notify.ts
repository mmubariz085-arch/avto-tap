let sharedAudioCtx: AudioContext | null = null;
let sharedCompressor: DynamicsCompressorNode | null = null;
let audioUnlocked = false;

function getAudioContext(): { ctx: AudioContext; out: AudioNode } | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
    sharedCompressor = sharedAudioCtx.createDynamicsCompressor();
    sharedCompressor.threshold.setValueAtTime(-10, sharedAudioCtx.currentTime);
    sharedCompressor.knee.setValueAtTime(12, sharedAudioCtx.currentTime);
    sharedCompressor.ratio.setValueAtTime(8, sharedAudioCtx.currentTime);
    sharedCompressor.attack.setValueAtTime(0.003, sharedAudioCtx.currentTime);
    sharedCompressor.release.setValueAtTime(0.15, sharedAudioCtx.currentTime);
    sharedCompressor.connect(sharedAudioCtx.destination);
  }
  return { ctx: sharedAudioCtx, out: sharedCompressor || sharedAudioCtx.destination };
}

export function unlockAudio(): void {
  try {
    const audio = getAudioContext();
    if (!audio) return;
    if (audio.ctx.state === 'suspended') {
      void audio.ctx.resume();
    }
    if (!audioUnlocked) {
      const buffer = audio.ctx.createBuffer(1, 1, 22050);
      const src = audio.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(audio.ctx.destination);
      src.start(0);
      audioUnlocked = true;
    }
  } catch {
    // ignore browser autoplay restriction
  }
}

export function installGlobalAudioUnlocker(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => unlockAudio();
  window.addEventListener('pointerdown', handler, { passive: true });
  window.addEventListener('keydown', handler, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('keydown', handler);
  };
}

export type FeedbackKind = 'incoming' | 'success' | 'error';

export function vibrateDevice(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // ignore unsupported device
  }
}

export function playFeedbackSound(kind: FeedbackKind): void {
  try {
    const audio = getAudioContext();
    if (!audio) return;
    const { ctx, out } = audio;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;

    if (kind === 'incoming') {
      // Loud, punchy 3-chime alert with harmonic octave layer
      const notes = [1046.5, 1318.51, 1567.98];
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.14;

        const oscMain = ctx.createOscillator();
        const oscHarmonic = ctx.createOscillator();
        const gain = ctx.createGain();

        oscMain.type = 'triangle';
        oscMain.frequency.setValueAtTime(freq, start);

        oscHarmonic.type = 'sine';
        oscHarmonic.frequency.setValueAtTime(freq * 2, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.95, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.34);

        oscMain.connect(gain);
        oscHarmonic.connect(gain);
        gain.connect(out);

        oscMain.start(start);
        oscHarmonic.start(start);
        oscMain.stop(start + 0.36);
        oscHarmonic.stop(start + 0.36);
      });
    } else if (kind === 'success') {
      // Loud positive 2-tone confirmation
      const notes = [659.25, 987.77];
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.1;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.8, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
        osc.connect(gain);
        gain.connect(out);
        osc.start(start);
        osc.stop(start + 0.26);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.linearRampToValueAtTime(175, now + 0.22);
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(out);
      osc.start(now);
      osc.stop(now + 0.28);
    }
  } catch {
    // ignore audio errors
  }
}

export async function showSystemNotification(
  title: string,
  body: string,
  url = '/',
  tag = 'avtotap-alert'
): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag,
          data: { url },
          ...({ vibrate: [300, 100, 300, 100, 350], renotify: true } as Record<string, unknown>),
        });
        return;
      }
    }
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag,
    });
  } catch {
    // ignore notification fallback error
  }
}

export function triggerAlertFeedback(
  kind: FeedbackKind,
  options?: {
    sound?: boolean;
    vibrate?: boolean;
    notification?: { title: string; body: string; url?: string; tag?: string };
  }
): void {
  const withSound = options?.sound !== false;
  const withVibrate = options?.vibrate !== false;

  if (withSound) {
    playFeedbackSound(kind);
  }
  if (withVibrate) {
    if (kind === 'incoming') {
      vibrateDevice([300, 100, 300, 100, 350]);
    } else if (kind === 'success') {
      vibrateDevice([120]);
    } else {
      vibrateDevice([140, 70, 140]);
    }
  }
  if (options?.notification) {
    void showSystemNotification(
      options.notification.title,
      options.notification.body,
      options.notification.url,
      options.notification.tag
    );
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribePushNotifications(params: {
  role: 'driver' | 'shop' | 'admin';
  orderId?: string;
  authToken?: string | null;
  requestPermissionIfDefault?: boolean;
}): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return 'unsupported';
  }

  let permission = Notification.permission;
  if (permission === 'default' && params.requestPermissionIfDefault) {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return permission;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const vapidRes = await fetch('/api/push/vapid-key');
    if (!vapidRes.ok) return permission;
    const { publicKey } = (await vapidRes.json()) as { publicKey?: string };
    if (!publicKey) return permission;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.authToken) {
      headers.Authorization = `Bearer ${params.authToken}`;
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subscription: sub.toJSON(),
        role: params.role,
        orderId: params.orderId,
      }),
    });
  } catch {
    // ignore push subscription failure in restricted environments
  }

  return permission;
}
