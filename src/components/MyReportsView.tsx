import { useEffect, useState, type FormEvent } from 'react';
import {
  Ban,
  BellRing,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Copy,
  FilePlus2,
  IdCard,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  PackageCheck,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildOfficialWhatsAppUrl,
  NOT_FOUND_NOTIFICATION_MESSAGE,
} from '../services/apiService';
import {
  LOCATION_TYPES,
  type LocationType,
  type LostReport,
  type LostReportStatus,
  type UpdateLostReportPayload,
} from '../types/report';
import { MobileNotificationPrompt } from './MobileNotificationPrompt';

interface MyReportsViewProps {
  myReports: { report: LostReport; ownedInBrowser: boolean }[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onLookupByCode: (reportCode: string) => Promise<void>;
  onUpdateReport: (
    reportId: string,
    payload: UpdateLostReportPayload
  ) => Promise<void>;
  onCancelReport: (reportId: string) => Promise<void>;
  onDeleteReport?: (reportId: string) => Promise<void>;
  onMarkNotificationRead: (reportId: string) => Promise<void>;
  onRemoveFromMyList: (reportId: string) => void;
  onGoToReportForm: () => void;
  onCopyFeedback: (message: string) => void;
}

const STATUS_BADGE: Record<
  LostReportStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'قيد المراجعة بالمكتب',
    className: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
  },
  matched: {
    label: 'موجود بالمكتب - بانتظار الاستلام',
    className: 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]',
  },
  delivered: {
    label: 'تم التسليم',
    className: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
  },
  cancelled: {
    label: 'ملغى / تم سحبه من الطالب',
    className: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
  },
};

const STEPS: { key: Exclude<LostReportStatus, 'cancelled'>; label: string }[] = [
  { key: 'pending', label: 'قيد المراجعة' },
  { key: 'matched', label: 'موجود بالمكتب' },
  { key: 'delivered', label: 'تم التسليم' },
];

const RECOVERY_GUIDE_STEPS = [
  {
    step: '01',
    title: 'إبلاغ',
    detail: 'سجّل بيانات الغرض المفقود ومواصفاته السرية ليصل فوراً لمكتب كليتك.',
  },
  {
    step: '02',
    title: 'مراجعة المكتب',
    detail: 'يتولى موظف شؤون الطلاب فحص البلاغ ومطابقته مع الأغراض المسلّمة.',
  },
  {
    step: '03',
    title: 'مطابقة وإشعار',
    detail: 'عند التطابق تتحول الحالة إلى «موجود بالمكتب» ويُرسل لك إشعار واتساب.',
  },
  {
    step: '04',
    title: 'استلام بالبطاقة الجامعية',
    detail: 'توجّه للمكتب وأبرز بطاقتك الجامعية لتأكيد هويتك واستلام الغرض.',
  },
] as const;

function getStepIndex(status: LostReportStatus): number {
  if (status === 'pending') return 0;
  if (status === 'matched') return 1;
  return 2;
}

function formatArabicDateTime(isoString?: string): string | null {
  if (!isoString) return null;
  try {
    return new Intl.DateTimeFormat('ar', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return null;
  }
}

export function MyReportsView({
  myReports,
  isLoading,
  isRefreshing = false,
  onRefresh,
  onLookupByCode,
  onUpdateReport,
  onCancelReport,
  onDeleteReport,
  onMarkNotificationRead,
  onRemoveFromMyList,
  onGoToReportForm,
  onCopyFeedback,
}: MyReportsViewProps) {
  const [codeInput, setCodeInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<LostReport | null>(null);
  const [editForm, setEditForm] = useState<UpdateLostReportPayload>({
    itemName: '',
    description: '',
    locationType: LOCATION_TYPES[0],
    roomOrLocation: '',
    timePeriod: '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<LostReport | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);

  useEffect(() => {
    if (!cancelTarget) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isCancelling) {
        setCancelTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelTarget, isCancelling]);

  useEffect(() => {
    if (!editTarget) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUpdating) {
        setEditTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editTarget, isUpdating]);

  const openEditModal = (report: LostReport) => {
    setEditTarget(report);
    setEditForm({
      itemName: report.itemName,
      description: report.description,
      locationType: report.locationType,
      roomOrLocation: report.roomOrLocation,
      timePeriod: report.timePeriod,
    });
    setEditError(null);
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget || isUpdating) return;
    setEditError(null);

    if (!editForm.itemName.trim()) {
      setEditError('يرجى كتابة اسم الغرض المفقود.');
      return;
    }
    if (!editForm.description.trim()) {
      setEditError('يرجى إدخال المواصفات الدقيقة للمطابقة.');
      return;
    }
    if (!editForm.roomOrLocation.trim()) {
      setEditError('يرجى تحديد رقم القاعة أو تفاصيل المكان.');
      return;
    }
    if (!editForm.timePeriod.trim()) {
      setEditError('يرجى تحديد الفترة الزمنية.');
      return;
    }

    setIsUpdating(true);
    try {
      await onUpdateReport(editTarget.id, {
        itemName: editForm.itemName.trim(),
        description: editForm.description.trim(),
        locationType: editForm.locationType,
        roomOrLocation: editForm.roomOrLocation.trim(),
        timePeriod: editForm.timePeriod.trim(),
      });
      setEditTarget(null);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'تعذر تعديل البلاغ حالياً.'
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSearching) return;
    setLookupError(null);

    const trimmed = codeInput.trim().toUpperCase();
    if (!trimmed) {
      setLookupError('يرجى كتابة رقم البلاغ مثل WS-101.');
      return;
    }

    try {
      setIsSearching(true);
      await onLookupByCode(trimmed);
      setCodeInput('');
    } catch (err) {
      setLookupError(
        err instanceof Error ? err.message : 'لم يتم العثور على بلاغ بهذا الرقم.'
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyDetails = async (report: LostReport) => {
    const lines = [
      'بلاغ فقد — منصة «وصال الجامعي»',
      `رقم البلاغ: ${report.reportCode}`,
      `الغرض: ${report.itemName}`,
      `الكلية: ${report.faculty}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      // المتابعة بإشعار النسخ
    }
    setCopiedId(report.id);
    onCopyFeedback(`تم نسخ رقم البلاغ (${report.reportCode}) إلى الحافظة.`);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget || isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancelReport(cancelTarget.id);
      setCancelTarget(null);
    } catch {
      // تم عرض رسالة الخطأ عبر Toast
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDeleteCancelled = async (reportId: string) => {
    if (!onDeleteReport || deletingId) return;
    setDeletingId(reportId);
    try {
      await onDeleteReport(reportId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleAcknowledgeAlert = async (reportId: string) => {
    if (markingReadId) return;
    setMarkingReadId(reportId);
    try {
      await onMarkNotificationRead(reportId);
    } finally {
      setMarkingReadId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* رأس القسم */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0F2942]">
            متابعة بلاغاتي
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            تظهر هنا البلاغات التي سجلتها من هذا المتصفح أو استعدتها برقم البلاغ
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing || isLoading}
              title="تحديث حالة البلاغات"
              aria-label="تحديث حالة البلاغات"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] disabled:opacity-60 text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap cursor-pointer"
            >
              <RefreshCw
                className={`w-4 h-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <span>تحديث</span>
            </button>
          )}

          <button
            type="button"
            onClick={onGoToReportForm}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] text-white text-sm font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FilePlus2 className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <span>إبلاغ عن فقد جديد</span>
          </button>
        </div>
      </div>

      {/* بطاقة تفعيل إشعارات الجوال وتوجيه آيفون */}
      <MobileNotificationPrompt onStatusFeedback={onCopyFeedback} />

      {/* خانة البحث برقم البلاغ WS-xxx */}
      <section
        aria-label="استعادة ومتابعة بلاغ برقم البلاغ"
        className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5 space-y-3"
      >
        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <div className="relative flex-1">
            <label htmlFor="lookup-report-code" className="sr-only">
              ابحث برقم البلاغ مثل WS-101
            </label>
            <Search
              className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <input
              id="lookup-report-code"
              type="text"
              maxLength={32}
              dir="ltr"
              disabled={isSearching}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="ابحث برقم البلاغ (مثال: WS-101)"
              className="w-full min-h-[44px] pr-10 pl-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-right font-mono tabular-nums text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 text-white text-sm font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <Search className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            )}
            <span>{isSearching ? 'جاري البحث...' : 'متابعة برقم البلاغ'}</span>
          </button>
        </form>

        {lookupError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-[#FEE2E2] border border-[#FECACA] text-[#991B1B] text-xs font-medium"
          >
            {lookupError}
          </div>
        )}

        <p className="text-xs text-slate-500">
          حفاظاً على خصوصية الطلبة، لا تُعرض بلاغات الآخرين؛ يمكنك متابعة بلاغاتك الخاصة أو استرجاع بلاغ سابق برقم التتبع.
        </p>
      </section>

      {/* حالة التحميل أو الحالة الفارغة أو البطاقات */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm font-medium text-[#0F2942]">
          <Loader2 className="w-5 h-5 animate-spin text-[#0F2942]" strokeWidth={1.6} aria-hidden="true" />
          <span>جاري تحميل بلاغاتك...</span>
        </div>
      ) : myReports.length === 0 ? (
        <section className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-[#E2E8F0]">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#0F2942]">
                لا توجد بلاغات مسجلة في قائمتك حالياً
              </h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                عند إرسال بلاغ جديد سيظهر هنا تلقائياً لمتابعة مراحله الأربع حتى الاستلام.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToReportForm}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] text-white text-sm font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FilePlus2 className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span>إبلاغ عن فقد غرض</span>
            </button>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500">
              آلية استعادة المفقودات في مكاتب شؤون الطلاب
            </h3>
            <ol className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {RECOVERY_GUIDE_STEPS.map((item) => (
                <li
                  key={item.step}
                  className="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg p-4 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-white border border-[#E2E8F0] font-mono text-[11px] font-bold text-[#0F2942] tabular-nums">
                      {item.step}
                    </span>
                    <span className="text-sm font-bold text-[#0F2942]">
                      {item.title}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {myReports.map(({ report, ownedInBrowser }) => {
            const badge = STATUS_BADGE[report.status];
            const currentStep = getStepIndex(report.status);
            const isCopied = copiedId === report.id;
            const canEditOrWithdraw = ownedInBrowser && report.status === 'pending';
            const canWithdraw = report.status === 'pending' && ownedInBrowser;
            const hasUnreadNotification = Boolean(report.notification?.unread);
            const showMatchedAlert = report.status === 'matched';
            const showNotFoundAlert =
              report.status === 'pending' &&
              (report.notification?.type === 'not_found' ||
                Boolean(report.notFoundNotified));
            const checkedTimeLabel = formatArabicDateTime(
              report.lastCheckedAt || report.notification?.createdAt
            );

            return (
              <article
                key={report.id}
                className="flex flex-col justify-between bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5"
              >
                <div>
                  {/* الزاوية العلوية: رقم البلاغ بخط أحادي المسافة + شارة التنبيه الجديد + شارة الحالة */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2.5 py-1 rounded-md bg-[#F5F7FA] border border-[#E2E8F0] text-[#0F2942] font-mono text-xs font-bold tabular-nums">
                        {report.reportCode}
                      </span>
                      {hasUnreadNotification && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-bold ${
                            showNotFoundAlert
                              ? 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'
                              : 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]'
                          }`}
                        >
                          <BellRing className="w-3 h-3 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                          <span>تحديث جديد</span>
                        </span>
                      )}
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${badge.className}`}
                    >
                      {report.status === 'matched' ? (
                        <PackageCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                      ) : report.status === 'delivered' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                      ) : report.status === 'cancelled' ? (
                        <Ban className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                      )}
                      <span>{badge.label}</span>
                    </span>
                  </div>

                  {/* العنوان */}
                  <h2 className="text-base sm:text-lg font-bold text-[#0F2942] mt-3.5 leading-snug">
                    {report.itemName}
                  </h2>

                  {/* تنويه البطاقة الجامعية */}
                  {ownedInBrowser && report.studentName ? (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] px-3 py-2 text-xs text-slate-700">
                      <IdCard className="w-4 h-4 text-[#0F2942] shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span>
                        باسم:{' '}
                        <strong className="font-semibold text-[#0F2942]">
                          {report.studentName}
                        </strong>{' '}
                        · يُشترط إبراز البطاقة الجامعية
                      </span>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] px-3 py-2 text-xs text-slate-600">
                      <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span>
                        بلاغ مستعاد برقم التتبع · يُشترط إبراز البطاقة الجامعية عند الاستلام
                      </span>
                    </div>
                  )}

                  {/* تفاصيل الكلية والمكان والفترة */}
                  <dl className="mt-3.5 pt-3 border-t border-[#E2E8F0]/70 space-y-2 text-xs sm:text-sm text-slate-700">
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">الكلية</dt>
                      <Building2 className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <dd className="font-medium text-[#0F2942]">{report.faculty}</dd>
                    </div>
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">المكان</dt>
                      <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <dd>
                        {report.locationType} — {report.roomOrLocation}
                      </dd>
                    </div>
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">الفترة الزمنية</dt>
                      <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <dd className="text-slate-600">{report.timePeriod}</dd>
                    </div>
                  </dl>

                  {/* شريط حالة بصري من 3 خطوات */}
                  {report.status !== 'cancelled' && (
                    <div className="mt-4 pt-3.5 border-t border-[#E2E8F0]">
                      <div className="grid grid-cols-3 gap-2" aria-label="مراحل البلاغ">
                        {STEPS.map((step, index) => {
                          const active = index <= currentStep;
                          const barColor = !active
                            ? 'bg-[#E2E8F0]'
                            : report.status === 'matched'
                            ? 'bg-[#166534]'
                            : report.status === 'delivered'
                            ? 'bg-[#0F2942]'
                            : 'bg-[#92400E]';

                          return (
                            <div key={step.key} className="space-y-1.5">
                              <div className={`h-1.5 rounded-full ${barColor}`} />
                              <p
                                className={`text-[11px] text-center leading-tight ${
                                  index === currentStep
                                    ? 'font-semibold text-[#0F2942]'
                                    : active
                                    ? 'font-medium text-slate-600'
                                    : 'text-slate-400'
                                }`}
                              >
                                {step.label}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* تنبيه الاستلام وتأكيد قراءة الإشعار والأزرار */}
                <div className="mt-4 space-y-2.5">
                  {showMatchedAlert && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-[#DCFCE7] border border-[#BBF7D0] px-3.5 py-3 text-xs text-[#166534] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold">
                            غرضك موجود في مكتب شؤون الطلاب
                          </span>
                          {hasUnreadNotification && (
                            <span className="px-2 py-0.5 rounded bg-white/80 text-[#166534] text-[10px] font-bold">
                              غير مقروء
                            </span>
                          )}
                        </div>
                        <p className="font-semibold leading-relaxed">
                          يتم الاستلام بالحضور الشخصي إلى مكتب شؤون الطلاب في ({report.faculty}) وإبراز البطاقة الجامعية ورقم البلاغ ({report.reportCode}).
                        </p>
                        {report.notification?.message && (
                          <p className="text-[11px] font-medium text-[#166534]/90 leading-relaxed">
                            {report.notification.message}
                          </p>
                        )}

                        {ownedInBrowser && (
                          hasUnreadNotification ? (
                            <button
                              type="button"
                              disabled={markingReadId === report.id}
                              onClick={() => void handleAcknowledgeAlert(report.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] rounded-md bg-[#166534] hover:bg-[#14532D] disabled:opacity-70 text-white text-[11px] font-semibold transition-all active:scale-[0.99] cursor-pointer"
                            >
                              <CheckCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                              <span>تأكيد قراءة التنبيه</span>
                            </button>
                          ) : report.notification?.readAt ? (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#166534]/85">
                              <CheckCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                              <span>تم تأكيد قراءة التنبيه</span>
                            </div>
                          ) : null
                        )}
                      </div>

                      {report.status === 'matched' && (
                        <a
                          href={buildOfficialWhatsAppUrl(report)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-lg bg-[#166534] hover:bg-[#14532D] text-white text-xs font-semibold transition-all active:scale-[0.99]"
                        >
                          <MessageCircle className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                          <span>مراسلة وصال الجامعي عبر واتساب</span>
                        </a>
                      )}
                    </div>
                  )}

                  {showNotFoundAlert && (
                    <div className="rounded-lg bg-[#FEF3C7] border border-[#FDE68A] px-3.5 py-3 text-xs text-[#92400E] space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/80 text-[#92400E] text-[11px] font-bold">
                          بلاغك لا يزال نشطاً وقيد المتابعة
                        </span>
                        {hasUnreadNotification && (
                          <span className="px-2 py-0.5 rounded bg-white text-[#92400E] text-[10px] font-bold">
                            غير مقروء
                          </span>
                        )}
                      </div>

                      <p className="font-medium leading-relaxed">
                        {report.notification?.message ||
                          NOT_FOUND_NOTIFICATION_MESSAGE}
                      </p>

                      {checkedTimeLabel && (
                        <p className="text-[11px] text-[#92400E]/85">
                          وقت المراجعة: {checkedTimeLabel}
                        </p>
                      )}

                      {ownedInBrowser && (
                        hasUnreadNotification ? (
                          <button
                            type="button"
                            disabled={markingReadId === report.id}
                            onClick={() => void handleAcknowledgeAlert(report.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] rounded-md bg-[#92400E] hover:bg-[#78350F] disabled:opacity-70 text-white text-[11px] font-semibold transition-all active:scale-[0.99] cursor-pointer"
                          >
                            <CheckCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                            <span>تأكيد قراءة التنبيه</span>
                          </button>
                        ) : report.notification?.readAt ? (
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#92400E]/85">
                            <CheckCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                            <span>تم تأكيد قراءة التنبيه</span>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}

                  {report.status === 'delivered' && (
                    <div className="rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] px-3.5 py-2 text-xs text-[#475569] font-medium text-center">
                      تم استلام الغرض وإغلاق البلاغ
                    </div>
                  )}

                  {report.status === 'cancelled' && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] px-3.5 py-2.5 text-xs text-[#475569] font-medium text-center leading-relaxed">
                        تم سحب البلاغ من الطالب بعد العثور على الغرض وإيقاف المراجعة بالمكتب
                      </div>
                      {ownedInBrowser && onDeleteReport && (
                        <button
                          type="button"
                          disabled={deletingId === report.id}
                          onClick={() => void handleDeleteCancelled(report.id)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg border border-[#FECACA] bg-[#FEE2E2]/45 hover:bg-[#FEE2E2] disabled:opacity-60 text-[#991B1B] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                        >
                          {deletingId === report.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                          )}
                          <span>حذف البلاغ نهائياً من السجل</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* أزرار تعديل وسحب البلاغ */}
                  {canEditOrWithdraw && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(report)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[42px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5 text-slate-500 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        <span>تعديل البلاغ</span>
                      </button>

                      {canWithdraw && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget(report)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[42px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] text-slate-700 hover:text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5 text-slate-500 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                          <span>سحب البلاغ</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => void handleCopyDetails(report)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/60 text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5 text-[#166534] shrink-0" strokeWidth={1.6} aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-500 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                      )}
                      <span>{isCopied ? 'تم النسخ' : 'نسخ رقم البلاغ'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemoveFromMyList(report.id)}
                      title="إزالة من قائمة بلاغاتي في هذا المتصفح"
                      aria-label={`إزالة البلاغ ${report.reportCode} من قائمتي`}
                      className="w-10 h-10 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#FEE2E2] hover:border-[#FECACA] hover:text-[#991B1B] text-slate-400 flex items-center justify-center transition-all active:scale-[0.99] shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* نافذة تعديل البلاغ المعلق */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2942]/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-report-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isUpdating) {
              setEditTarget(null);
            }
          }}
        >
          <div className="bg-white w-full max-w-md rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Pencil
                  className="w-5 h-5 text-[#0F2942] shrink-0"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
                <h2
                  id="edit-report-title"
                  className="text-base font-bold text-[#0F2942]"
                >
                  تعديل بيانات البلاغ ({editTarget.reportCode})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={isUpdating}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-[#F5F7FA] disabled:opacity-50 cursor-pointer active:scale-[0.99]"
              >
                <X className="w-4 h-4" strokeWidth={1.6} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              {editError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-[#FEE2E2] border border-[#FECACA] text-[#991B1B] text-xs font-medium"
                >
                  {editError}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-item-name"
                  className="block text-xs font-semibold text-[#0F2942]"
                >
                  اسم الغرض
                </label>
                <input
                  id="edit-item-name"
                  type="text"
                  maxLength={120}
                  required
                  disabled={isUpdating}
                  value={editForm.itemName}
                  onChange={(e) =>
                    setEditForm({ ...editForm, itemName: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3.5 py-2 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-description"
                  className="block text-xs font-semibold text-[#0F2942]"
                >
                  المواصفات الدقيقة للمطابقة
                </label>
                <textarea
                  id="edit-description"
                  rows={3}
                  maxLength={1000}
                  required
                  disabled={isUpdating}
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm({ ...editForm, description: e.target.value })
                  }
                  className="w-full px-3.5 py-2 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-location-type"
                    className="block text-xs font-semibold text-[#0F2942]"
                  >
                    نوع المكان
                  </label>
                  <select
                    id="edit-location-type"
                    disabled={isUpdating}
                    value={editForm.locationType}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        locationType: e.target.value as LocationType,
                      })
                    }
                    className="w-full min-h-[42px] px-3 py-2 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none"
                  >
                    {LOCATION_TYPES.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-room"
                    className="block text-xs font-semibold text-[#0F2942]"
                  >
                    رقم القاعة أو التفاصيل
                  </label>
                  <input
                    id="edit-room"
                    type="text"
                    maxLength={160}
                    required
                    disabled={isUpdating}
                    value={editForm.roomOrLocation}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        roomOrLocation: e.target.value,
                      })
                    }
                    className="w-full min-h-[42px] px-3 py-2 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-time-period"
                  className="block text-xs font-semibold text-[#0F2942]"
                >
                  الفترة الزمنية
                </label>
                <input
                  id="edit-time-period"
                  type="text"
                  maxLength={100}
                  required
                  disabled={isUpdating}
                  value={editForm.timePeriod}
                  onChange={(e) =>
                    setEditForm({ ...editForm, timePeriod: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3.5 py-2 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  disabled={isUpdating}
                  className="px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] disabled:opacity-50 text-slate-700 text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  {isUpdating ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  ) : (
                    <Check className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  )}
                  <span>{isUpdating ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* نافذة تأكيد سحب البلاغ */}
      {cancelTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2942]/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-report-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCancelling) {
              setCancelTarget(null);
            }
          }}
        >
          <div className="bg-white w-full max-w-md rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Ban
                  className="w-5 h-5 text-[#0F2942] shrink-0"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
                <h2
                  id="cancel-report-title"
                  className="text-base font-bold text-[#0F2942]"
                >
                  تأكيد سحب البلاغ
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                disabled={isCancelling}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-[#F5F7FA] disabled:opacity-50 cursor-pointer active:scale-[0.99]"
              >
                <X className="w-4 h-4" strokeWidth={1.6} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] space-y-1 text-sm">
                <span className="font-mono text-xs font-bold text-[#0F2942] tabular-nums">
                  {cancelTarget.reportCode}
                </span>
                <p className="font-semibold text-[#0F2942]">
                  {cancelTarget.itemName}
                </p>
              </div>

              <p className="text-sm text-slate-700 leading-relaxed">
                هل وجدت غرضك بالفعل؟ عند التأكيد ستتغير حالة البلاغ إلى{' '}
                <strong className="text-[#0F2942]">«ملغى / تم سحبه من الطالب»</strong>{' '}
                وسيتوقف موظف شؤون الطلاب عن البحث عنه.
              </p>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  disabled={isCancelling}
                  className="px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] disabled:opacity-50 text-slate-700 text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  تراجع
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmCancel()}
                  disabled={isCancelling}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  {isCancelling ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  ) : (
                    <Ban className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  )}
                  <span>
                    {isCancelling ? 'جاري السحب...' : 'تأكيد سحب البلاغ'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
