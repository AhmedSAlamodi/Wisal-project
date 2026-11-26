import { useEffect, useState, type FormEvent } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  IdCard,
  Loader2,
  MessageCircle,
  PackageCheck,
  X,
} from 'lucide-react';
import {
  buildStaffNotFoundWhatsAppMessage,
  buildStaffNotFoundWhatsAppUrl,
  buildStaffPickupReminderWhatsAppMessage,
  buildStaffPickupReminderWhatsAppUrl,
  buildStaffWhatsAppMessage,
  buildStaffWhatsAppNotifyUrl,
  formatPhoneForDisplay,
  NOT_FOUND_NOTIFICATION_MESSAGE,
} from '../services/apiService';
import type { LostReport } from '../types/report';

interface NotifyStudentModalProps {
  report: LostReport | null;
  mode?: 'matched' | 'reminder';
  onClose: () => void;
  onCopyMessage?: (message: string) => void;
}

export function NotifyStudentModal({
  report,
  mode = 'matched',
  onClose,
  onCopyMessage,
}: NotifyStudentModalProps) {
  const [copiedMessage, setCopiedMessage] = useState(false);

  useEffect(() => {
    setCopiedMessage(false);
  }, [report, mode]);

  useEffect(() => {
    if (!report) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report, onClose]);

  if (!report) return null;

  const isReminder = mode === 'reminder';
  const whatsappMessage = isReminder
    ? buildStaffPickupReminderWhatsAppMessage(report)
    : buildStaffWhatsAppMessage(report);
  const whatsappUrl = isReminder
    ? buildStaffPickupReminderWhatsAppUrl(report)
    : buildStaffWhatsAppNotifyUrl(report);

  const handleCopyWhatsAppMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappMessage);
    } catch {
      // المتابعة بالتغذية الراجعة
    }
    setCopiedMessage(true);
    onCopyMessage?.(
      isReminder
        ? `تم نسخ رسالة تذكير الاستلام الخاصة بالبلاغ (${report.reportCode}).`
        : `تم نسخ رسالة إشعار الواتساب الخاصة بالبلاغ (${report.reportCode}).`
    );
    window.setTimeout(() => setCopiedMessage(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2942]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notify-student-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-lg rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2">
            {isReminder ? (
              <BellRing
                className="w-5 h-5 text-[#0F2942] shrink-0"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            ) : (
              <PackageCheck
                className="w-5 h-5 text-[#166534] shrink-0"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            )}
            <h2
              id="notify-student-title"
              className="text-base font-bold text-[#0F2942]"
            >
              {isReminder
                ? 'إعادة إرسال تذكير الاستلام'
                : 'تم العثور على الغرض وإشعار الطالب'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-[#F5F7FA] cursor-pointer active:scale-[0.99]"
          >
            <X className="w-4 h-4" strokeWidth={1.6} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-lg bg-[#DCFCE7] border border-[#BBF7D0] text-[#166534] text-xs sm:text-sm leading-relaxed">
            {isReminder ? (
              <>
                تم إرسال إشعار الموقع والجوال لتذكير الطالب بوجود غرض البلاغ{' '}
                <strong className="font-mono tabular-nums">{report.reportCode}</strong>{' '}
                في مكتب شؤون الطلاب وجاهزيته للاستلام بالبطاقة الجامعية. يمكنك الآن إرسال التذكير عبر واتساب أو نسخه.
              </>
            ) : (
              <>
                تم تحديث حالة البلاغ{' '}
                <strong className="font-mono tabular-nums">{report.reportCode}</strong>{' '}
                إلى <strong>«موجود بالمكتب»</strong> وإرسال إشعار الموقع والجوال للطالب. يمكنك الآن فتح واتساب لإرسال الرسالة الجاهزة أو نسخها.
              </>
            )}
          </div>

          <div className="p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] space-y-1.5 text-xs text-slate-700">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-[#0F2942] text-sm">{report.itemName}</p>
              <span className="font-mono text-xs font-bold text-[#0F2942] tabular-nums">
                {report.reportCode}
              </span>
            </div>
            <p>
              اسم الطالب:{' '}
              <strong className="text-[#0F2942]">{report.studentName}</strong>
            </p>
            <p>
              رقم الطالب:{' '}
              <span dir="ltr" className="font-semibold font-mono tabular-nums">
                {formatPhoneForDisplay(report.phoneNumber)}
              </span>
            </p>
            <p>المكتب المختص: {report.faculty}</p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] space-y-2">
            <span className="block text-[11px] font-semibold text-slate-500">
              {isReminder
                ? 'نص رسالة تذكير الاستلام عبر واتساب:'
                : 'نص رسالة الواتساب الجاهزة:'}
            </span>
            <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
              {whatsappMessage}
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] text-slate-700 text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
            >
              إغلاق
            </button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyWhatsAppMessage()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/60 text-[#0F2942] text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
              >
                {copiedMessage ? (
                  <Check className="w-4 h-4 text-[#166534] shrink-0" strokeWidth={1.6} aria-hidden="true" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                )}
                <span>{copiedMessage ? 'تم نسخ الرسالة' : 'نسخ الرسالة'}</span>
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#166534] hover:bg-[#14532D] text-white text-sm font-semibold transition-all active:scale-[0.99]"
              >
                <MessageCircle className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                <span>فتح وإرسال عبر واتساب</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface NotifyNotFoundModalProps {
  report: LostReport | null;
  onClose: () => void;
  onCopyMessage?: (message: string) => void;
}

export function NotifyNotFoundModal({
  report,
  onClose,
  onCopyMessage,
}: NotifyNotFoundModalProps) {
  const [copiedMessage, setCopiedMessage] = useState(false);

  useEffect(() => {
    setCopiedMessage(false);
  }, [report]);

  useEffect(() => {
    if (!report) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report, onClose]);

  if (!report) return null;

  const whatsappMessage = buildStaffNotFoundWhatsAppMessage(report);

  const handleCopyWhatsAppMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappMessage);
    } catch {
      // المتابعة بالتغذية الراجعة
    }
    setCopiedMessage(true);
    onCopyMessage?.(
      `تم نسخ رسالة الإفادة الخاصة بالبلاغ (${report.reportCode}).`
    );
    window.setTimeout(() => setCopiedMessage(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2942]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notify-not-found-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-lg rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2">
            <Clock
              className="w-5 h-5 text-[#92400E] shrink-0"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <h2
              id="notify-not-found-title"
              className="text-base font-bold text-[#0F2942]"
            >
              إشعار الطالب: لم يتم العثور على الغرض
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-[#F5F7FA] cursor-pointer active:scale-[0.99]"
          >
            <X className="w-4 h-4" strokeWidth={1.6} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-xs leading-relaxed space-y-1.5">
            <p className="font-bold">
              تم إرسال إشعار الموقع والجوال للطالب، وسيبقى البلاغ نشطاً (قيد المراجعة) لتتمكن من الضغط على «تم العثور على الغرض» لاحقاً إذا وُجد.
            </p>
            <p>{NOT_FOUND_NOTIFICATION_MESSAGE}</p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] space-y-1.5 text-xs text-slate-700">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-[#0F2942] text-sm">{report.itemName}</p>
              <span className="font-mono text-xs font-bold text-[#0F2942] tabular-nums">
                {report.reportCode}
              </span>
            </div>
            <p>
              اسم الطالب:{' '}
              <strong className="text-[#0F2942]">{report.studentName}</strong>
            </p>
            <p>
              رقم الطالب:{' '}
              <span dir="ltr" className="font-semibold font-mono tabular-nums">
                {formatPhoneForDisplay(report.phoneNumber)}
              </span>
            </p>
            <p>المكتب المختص: {report.faculty}</p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] space-y-2">
            <span className="block text-[11px] font-semibold text-slate-500">
              نص رسالة الواتساب الجاهزة للطالب:
            </span>
            <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
              {whatsappMessage}
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] text-slate-700 text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
            >
              إغلاق
            </button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyWhatsAppMessage()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/60 text-[#0F2942] text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
              >
                {copiedMessage ? (
                  <Check className="w-4 h-4 text-[#166534] shrink-0" strokeWidth={1.6} aria-hidden="true" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                )}
                <span>{copiedMessage ? 'تم نسخ الرسالة' : 'نسخ الرسالة'}</span>
              </button>

              <a
                href={buildStaffNotFoundWhatsAppUrl(report)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg border border-[#FDE68A] bg-[#FEF3C7] hover:bg-[#FDE68A]/60 text-[#92400E] text-sm font-semibold transition-all active:scale-[0.99]"
              >
                <MessageCircle className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                <span>فتح وإرسال عبر واتساب</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDeliveryModalProps {
  report: LostReport | null;
  onClose: () => void;
  onConfirm: (reportId: string) => Promise<void>;
}

export function ConfirmDeliveryModal({
  report,
  onClose,
  onConfirm,
}: ConfirmDeliveryModalProps) {
  const [isIdVerified, setIsIdVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsIdVerified(false);
    setError(null);
  }, [report]);

  useEffect(() => {
    if (!report) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report, isSubmitting, onClose]);

  if (!report) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    if (!isIdVerified) {
      setError('يرجى تأكيد التحقق من البطاقة الجامعية للطالب ومطابقة الاسم أولاً.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onConfirm(report.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر تأكيد التسليم النهائي، يرجى المحاولة مجدداً.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2942]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delivery-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="bg-white w-full max-w-md rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2">
            <IdCard
              className="w-5 h-5 text-[#0F2942] shrink-0"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <h2
              id="confirm-delivery-title"
              className="text-base font-bold text-[#0F2942]"
            >
              تأكيد التسليم بالبطاقة الجامعية
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-[#F5F7FA] disabled:opacity-50 cursor-pointer active:scale-[0.99]"
          >
            <X className="w-4 h-4" strokeWidth={1.6} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#0F2942] tabular-nums">
                {report.reportCode}
              </span>
              <span className="text-[11px] text-slate-500">{report.faculty}</span>
            </div>
            <p className="font-semibold text-[#0F2942]">{report.itemName}</p>
            <div className="pt-2 border-t border-[#E2E8F0] text-xs text-slate-700">
              <span>الاسم المسجل بالبلاغ: </span>
              <strong className="text-[#0F2942] text-sm">
                {report.studentName}
              </strong>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-[#FEE2E2] border border-[#FECACA] text-[#991B1B] text-xs font-medium"
            >
              {error}
            </div>
          )}

          <label className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] cursor-pointer text-xs sm:text-sm font-semibold text-[#0F2942] leading-relaxed">
            <input
              type="checkbox"
              checked={isIdVerified}
              disabled={isSubmitting}
              onChange={(e) => {
                setIsIdVerified(e.target.checked);
                if (e.target.checked) setError(null);
              }}
              className="w-4 h-4 mt-1 accent-[#0F2942] rounded shrink-0 cursor-pointer"
            />
            <span>أُقرّ بأنه تم التحقق من البطاقة الجامعية للطالب ومطابقة الاسم</span>
          </label>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] disabled:opacity-50 text-slate-700 text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              )}
              <span>{isSubmitting ? 'جاري التأكيد...' : 'تم التسليم بنجاح'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
