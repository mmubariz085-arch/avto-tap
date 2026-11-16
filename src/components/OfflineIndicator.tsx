import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>İnternet bağlantısı yoxdur — keş məlumatları göstərilir</span>
    </div>
  );
};
