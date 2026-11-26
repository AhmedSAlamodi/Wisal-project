import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastState {
  message: string;
  variant: ToastVariant;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) {
    return null;
  }

  const styles = {
    success: {
      container: 'bg-[#0F2942] text-white border-[#1E3A5F]',
      icon: (
        <CheckCircle2
          className="w-4 h-4 text-emerald-300 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      ),
    },
    error: {
      container: 'bg-[#991B1B] text-white border-[#7F1D1D]',
      icon: (
        <AlertTriangle
          className="w-4 h-4 text-red-100 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      ),
    },
    info: {
      container: 'bg-[#0F2942] text-white border-[#1E3A5F]',
      icon: (
        <Info
          className="w-4 h-4 text-slate-200 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      ),
    },
  }[toast.variant];

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className="fixed bottom-20 md:bottom-6 left-4 right-4 sm:right-auto sm:left-6 z-[60] max-w-md"
    >
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg shadow-xs border ${styles.container}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {styles.icon}
          <p className="text-sm font-medium leading-snug">{toast.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق الإشعار"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 shrink-0 cursor-pointer active:scale-[0.99]"
        >
          <X className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
