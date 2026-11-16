import React, { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { subscribePushNotifications, triggerAlertFeedback, unlockAudio } from '../utils/notify';

interface PushNotificationsButtonProps {
  role: 'driver' | 'shop' | 'admin';
  orderId?: string;
  authToken?: string | null;
  compact?: boolean;
}

export const PushNotificationsButton: React.FC<PushNotificationsButtonProps> = ({
  role,
  orderId,
  authToken,
  compact = false,
}) => {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    const isSupported =
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator;
    setSupported(isSupported);
    if (isSupported) {
      setPermission(Notification.permission);
      if (Notification.permission === 'granted') {
        void subscribePushNotifications({
          role,
          orderId,
          authToken,
          requestPermissionIfDefault: false,
        });
      }
    }
  }, [role, orderId, authToken]);

  if (!supported || permission === 'denied') {
    return null;
  }

  const handleEnable = async () => {
    unlockAudio();
    setSubscribing(true);
    try {
      const result = await subscribePushNotifications({
        role,
        orderId,
        authToken,
        requestPermissionIfDefault: true,
      });
      if (result !== 'unsupported') {
        setPermission(result);
      }
      if (result === 'granted') {
        triggerAlertFeedback('success', {
          notification: {
            title: 'Şərur AvtoZapcast bildirişləri aktivdir',
            body: 'Yeni sorğular və qiymət təklifləri səs və vibrasiya ilə dərhal gələcək.',
            url: window.location.href,
            tag: 'avtotap-enabled',
          },
        });
      }
    } finally {
      setSubscribing(false);
    }
  };

  if (permission === 'granted') {
    if (compact) return null;
    return (
      <div className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
        <BellRing className="h-4 w-4 text-emerald-700 shrink-0" />
        <span>Puş bildirişlər aktivdir</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={subscribing}
      onClick={() => void handleEnable()}
      className={
        compact
          ? 'inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-900 hover:bg-orange-100 whitespace-nowrap shrink-0'
          : 'flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-900 hover:bg-orange-100'
      }
    >
      <Bell className="h-4 w-4 text-orange-700 shrink-0" />
      <span>{subscribing ? 'Aktivləşdirilir...' : 'Puş bildirişləri aç'}</span>
    </button>
  );
};
