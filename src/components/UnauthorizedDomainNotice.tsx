import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { getUnauthorizedDomainSetupInfo } from '../firebase';

export const UnauthorizedDomainNotice: React.FC = () => {
  const { hostname, consoleUrl } = getUnauthorizedDomainSetupInfo();
  const [copied, setCopied] = useState(false);

  if (!hostname) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hostname);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard restriction
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-slate-800 space-y-2.5">
      <p className="leading-relaxed">
        Gmail girişinin bu linkdə işləməsi üçün Firebase Console-da{' '}
        <strong>Authentication → Settings → Authorized domains</strong> bölməsinə bu domeni əlavə edin:
      </p>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2">
        <code className="truncate font-mono text-xs font-bold text-slate-950">{hostname}</code>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-800"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
        </button>
      </div>
      <a
        href={consoleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Firebase Authorized domains aç</span>
      </a>
    </div>
  );
};
