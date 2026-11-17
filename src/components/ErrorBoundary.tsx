import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Gözlənilməz xəta baş verdi.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('UI ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F6F8FA] px-4 py-10">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-lg">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h1 className="mt-4 font-display text-xl font-extrabold text-slate-950">
              Ekran yüklənərkən xəta baş verdi
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Narahat olmayın, məlumatlarınız qorunub. Səhifəni yeniləyin və ya əsas ekrana qayıdın.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0B1120] px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Yenidən yüklə</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/';
                }}
                className="flex min-h-[46px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Əsas ekrana qayıt
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
