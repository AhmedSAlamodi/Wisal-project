import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  IdCard,
  KeyRound,
  Landmark,
  Loader2,
  LogOut,
  MapPin,
  PackageCheck,
  Phone,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  COLLEGE_ACCESS_CODES,
  detectUrgentItem,
  formatPhoneForDisplay,
  normalizeArabicText,
  verifyStaffAccess,
} from '../services/apiService';
import {
  UNIVERSITY_FACULTIES,
  type LostReport,
  type LostReportStatus,
  type UniversityFaculty,
} from '../types/report';

interface StaffPortalViewProps {
  reports: LostReport[];
  staffFaculty: UniversityFaculty | null;
  onLogin: (faculty: UniversityFaculty) => void;
  onLogout: () => void;
  onMarkAsMatched: (report: LostReport) => Promise<void>;
  onNotifyNotFound: (report: LostReport) => Promise<void>;
  onResendPickupReminder: (report: LostReport) => Promise<void>;
  onOpenDeliveryModal: (report: LostReport) => void;
  onLoginError: (message: string) => void;
  onCopyFeedback: (message: string) => void;
}

const STATUS_LABELS: Record<
  LostReportStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'قيد المراجعة',
    className: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
  },
  matched: {
    label: 'موجود بالمكتب',
    className: 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]',
  },
  delivered: {
    label: 'تم التسليم',
    className: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
  },
  cancelled: {
    label: 'سحبه الطالب',
    className: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
  },
};

export function StaffPortalView({
  reports,
  staffFaculty,
  onLogin,
  onLogout,
  onMarkAsMatched,
  onNotifyNotFound,
  onResendPickupReminder,
  onOpenDeliveryModal,
  onLoginError,
  onCopyFeedback,
}: StaffPortalViewProps) {
  const [selectedFaculty, setSelectedFaculty] = useState<UniversityFaculty>(
    UNIVERSITY_FACULTIES[0]
  );
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [copiedFacultyCode, setCopiedFacultyCode] = useState<string | null>(
    null
  );
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<LostReportStatus>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingAction, setProcessingAction] = useState<{
    id: string;
    type: 'match' | 'not_found' | 'reminder';
  } | null>(null);

  // إجمالي سجل بلاغات الكلية التراكمي الكامل (لا يتأثر أبداً بالتبويب أو البحث)
  const collegeReports = useMemo(() => {
    if (!staffFaculty) return [];
    return reports.filter((r) => r.faculty === staffFaculty);
  }, [reports, staffFaculty]);

  // إحصائيات الكلية الثابتة التراكمية في أعلى اللوحة
  const statusCounts = useMemo(() => {
    let pending = 0;
    let matched = 0;
    let delivered = 0;
    for (const r of collegeReports) {
      if (r.status === 'pending') pending += 1;
      else if (r.status === 'matched') matched += 1;
      else if (r.status === 'delivered') delivered += 1;
    }
    return { pending, matched, delivered };
  }, [collegeReports]);

  const searchFilteredReports = useMemo(() => {
    const normalizedQuery = normalizeArabicText(searchQuery);
    const matches = collegeReports.filter((r) => {
      if (!normalizedQuery) return true;
      const matchCode = normalizeArabicText(r.reportCode).includes(
        normalizedQuery
      );
      const matchStudent = normalizeArabicText(r.studentName).includes(
        normalizedQuery
      );
      return matchCode || matchStudent;
    });

    // ترتيب البلاغات الهامة (isUrgent) في أعلى القائمة دائماً ثم الأحدث
    return [...matches].sort((a, b) => {
      const urgentA = a.isUrgent || detectUrgentItem(a.itemName) ? 1 : 0;
      const urgentB = b.isUrgent || detectUrgentItem(b.itemName) ? 1 : 0;
      if (urgentB !== urgentA) return urgentB - urgentA;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [collegeReports, searchQuery]);

  const tabCounts = useMemo(() => {
    let pending = 0;
    let matched = 0;
    let delivered = 0;
    let cancelled = 0;
    for (const r of searchFilteredReports) {
      if (r.status === 'pending') pending += 1;
      else if (r.status === 'matched') matched += 1;
      else if (r.status === 'delivered') delivered += 1;
      else if (r.status === 'cancelled') cancelled += 1;
    }
    return { pending, matched, delivered, cancelled };
  }, [searchFilteredReports]);

  // البلاغات المعروضة في التبويب النشط (البلاغات المسحوبة cancelled مستبعدة تماماً من قيد المراجعة وموجود بالمكتب)
  const filteredCollegeReports = useMemo(() => {
    return searchFilteredReports.filter((r) => r.status === activeTab);
  }, [searchFilteredReports, activeTab]);

  const handleLoginSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!passcode.trim()) {
      const msg = 'يرجى إدخال رمز الدخول الأمني المخصص للكلية المختارة.';
      setLoginError(msg);
      onLoginError(msg);
      return;
    }

    if (!verifyStaffAccess(selectedFaculty, passcode)) {
      const msg = `رمز الدخول الأمني غير صحيح لـ (${selectedFaculty}). تأكد من إدخال الرمز المخصص لهذه الكلية.`;
      setLoginError(msg);
      onLoginError(msg);
      return;
    }

    setPasscode('');
    setShowPasscode(false);
    onLogin(selectedFaculty);
  };

  const handleCopyCollegeCode = async (faculty: UniversityFaculty) => {
    const code = COLLEGE_ACCESS_CODES[faculty];
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // المتابعة بالتغذية الراجعة
    }
    setCopiedFacultyCode(faculty);
    onCopyFeedback(`تم نسخ رمز الدخول الخاص بـ (${faculty}) إلى الحافظة.`);
    window.setTimeout(() => setCopiedFacultyCode(null), 1800);
  };

  if (!staffFaculty) {
    const selectedCode = COLLEGE_ACCESS_CODES[selectedFaculty];
    const isSelectedCopied = copiedFacultyCode === selectedFaculty;

    return (
      <div className="max-w-md mx-auto">
        <section className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-6 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="w-6 h-6 text-[#0F2942] mt-0.5 shrink-0"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[#0F2942]">
                بوابة موظف شؤون الطلاب
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                الدخول المخصص لمكاتب الكليات لإدارة البلاغات والمطابقة والتسليم
              </p>
            </div>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {loginError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-[#FEE2E2] border border-[#FECACA] text-[#991B1B] text-xs font-medium leading-relaxed"
              >
                {loginError}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="staff-faculty-select"
                className="block text-sm font-semibold text-[#0F2942]"
              >
                الكلية
              </label>
              <select
                id="staff-faculty-select"
                value={selectedFaculty}
                onChange={(e) => {
                  setSelectedFaculty(e.target.value as UniversityFaculty);
                  setLoginError(null);
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none cursor-pointer"
              >
                {UNIVERSITY_FACULTIES.map((faculty) => (
                  <option key={faculty} value={faculty}>
                    {faculty}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="staff-passcode"
                className="block text-sm font-semibold text-[#0F2942]"
              >
                رمز الدخول الأمني للكلية
              </label>
              <div className="relative">
                <input
                  id="staff-passcode"
                  type={showPasscode ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    if (loginError) setLoginError(null);
                  }}
                  placeholder="أدخل الرمز الأمني للكلية"
                  className="w-full min-h-[44px] pr-3.5 pl-11 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm font-mono font-semibold tracking-wider tabular-nums text-left text-slate-900 placeholder:font-sans placeholder:text-right placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode((prev) => !prev)}
                  aria-label={showPasscode ? 'إخفاء رمز الدخول' : 'إظهار رمز الدخول'}
                  title={showPasscode ? 'إخفاء الرمز' : 'إظهار الرمز'}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-200/70 hover:text-[#0F2942] transition-colors cursor-pointer"
                >
                  {showPasscode ? (
                    <EyeOff className="w-4 h-4" strokeWidth={1.6} aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={1.6} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] rounded-lg bg-[#0F2942] hover:bg-[#163859] text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
            >
              <KeyRound className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span>دخول إلى لوحة المكتب</span>
            </button>
          </form>

          {/* رابط قابل للطي في الأسفل لنسخ رمز التجربة */}
          <details className="pt-3 border-t border-[#E2E8F0] text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-500 hover:text-[#0F2942] select-none py-1">
              رموز التجربة (للمعاينة والاختبار)
            </summary>

            <div className="mt-2.5 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2 bg-white border border-[#E2E8F0] rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="block text-[11px] text-slate-500 truncate">
                    {selectedFaculty}
                  </span>
                  <code
                    dir="ltr"
                    className="block text-xs font-bold font-mono text-[#0F2942] tabular-nums mt-0.5"
                  >
                    {selectedCode}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyCollegeCode(selectedFaculty)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#0F2942] hover:bg-[#163859] text-white text-[11px] font-semibold shrink-0 transition-all active:scale-[0.99] cursor-pointer"
                >
                  {isSelectedCopied ? (
                    <Check className="w-3 h-3 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  ) : (
                    <Copy className="w-3 h-3 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  )}
                  <span>{isSelectedCopied ? 'تم النسخ' : 'نسخ الرمز'}</span>
                </button>
              </div>

              <ul className="space-y-1.5 max-h-44 overflow-y-auto pl-1">
                {UNIVERSITY_FACULTIES.map((faculty) => {
                  const code = COLLEGE_ACCESS_CODES[faculty];
                  const isCopied = copiedFacultyCode === faculty;
                  return (
                    <li
                      key={faculty}
                      className="flex items-center justify-between gap-2 bg-white border border-[#E2E8F0] rounded-md px-2.5 py-1.5"
                    >
                      <span className="truncate font-medium text-slate-700">
                        {faculty}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyCollegeCode(faculty)}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#F5F7FA] hover:bg-slate-200/70 text-[#0F2942] font-mono text-[10px] font-bold shrink-0 cursor-pointer"
                        title="نسخ الرمز"
                      >
                        <span dir="ltr">{code}</span>
                        {isCopied ? (
                          <Check className="w-3 h-3 text-[#166534]" strokeWidth={1.6} aria-hidden="true" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400" strokeWidth={1.6} aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        </section>
      </div>
    );
  }

  const handleActionMatchAndNotify = async (report: LostReport) => {
    if (report.status !== 'pending' || processingAction) return;
    setProcessingAction({ id: report.id, type: 'match' });
    try {
      await onMarkAsMatched(report);
    } finally {
      setProcessingAction(null);
    }
  };

  const handleActionNotFound = async (report: LostReport) => {
    if (report.status !== 'pending' || processingAction) return;
    setProcessingAction({ id: report.id, type: 'not_found' });
    try {
      await onNotifyNotFound(report);
    } finally {
      setProcessingAction(null);
    }
  };

  const handleActionPickupReminder = async (report: LostReport) => {
    if (report.status !== 'matched' || processingAction) return;
    setProcessingAction({ id: report.id, type: 'reminder' });
    try {
      await onResendPickupReminder(report);
    } finally {
      setProcessingAction(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* شريط المكتب النشط وزر تسجيل الخروج */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs text-slate-500 font-medium">
            مكتب شؤون الطلاب النشط
          </span>
          <h1 className="text-lg sm:text-xl font-bold text-[#0F2942] mt-0.5">
            {staffFaculty}
          </h1>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-lg bg-[#F5F7FA] hover:bg-slate-200/70 border border-[#E2E8F0] text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap shrink-0"
        >
          <LogOut className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>تسجيل خروج</span>
        </button>
      </div>

      {/* 3 بطاقات إحصائيات تراكمية ثابتة للكلية */}
      <section
        aria-label="ملخص إحصائيات الكلية التراكمية"
        className="grid grid-cols-3 gap-3"
      >
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-4 flex items-center justify-between gap-2">
          <div>
            <span className="block text-[11px] sm:text-xs font-medium text-slate-500">
              قيد المراجعة
            </span>
            <strong className="block text-xl sm:text-2xl font-bold text-[#92400E] tabular-nums mt-0.5">
              {statusCounts.pending}
            </strong>
          </div>
          <Clock className="w-5 h-5 text-[#92400E]/75 hidden sm:block shrink-0" strokeWidth={1.5} aria-hidden="true" />
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-4 flex items-center justify-between gap-2">
          <div>
            <span className="block text-[11px] sm:text-xs font-medium text-slate-500">
              موجود بالمكتب
            </span>
            <strong className="block text-xl sm:text-2xl font-bold text-[#166534] tabular-nums mt-0.5">
              {statusCounts.matched}
            </strong>
          </div>
          <PackageCheck className="w-5 h-5 text-[#166534]/75 hidden sm:block shrink-0" strokeWidth={1.5} aria-hidden="true" />
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-4 flex items-center justify-between gap-2">
          <div>
            <span className="block text-[11px] sm:text-xs font-medium text-slate-500">
              تم التسليم
            </span>
            <strong className="block text-xl sm:text-2xl font-bold text-[#475569] tabular-nums mt-0.5">
              {statusCounts.delivered}
            </strong>
          </div>
          <CheckCircle2 className="w-5 h-5 text-slate-400 hidden sm:block shrink-0" strokeWidth={1.5} aria-hidden="true" />
        </div>
      </section>

      {/* شريط البحث السريع وتبويبات الفلترة */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-4 sm:p-5 space-y-3.5">
        <div className="relative">
          <label htmlFor="staff-quick-search" className="sr-only">
            ابحث بالاسم الثلاثي للطالب أو رقم البلاغ
          </label>
          <Search
            className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <input
            id="staff-quick-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم الثلاثي للطالب أو رقم البلاغ (WS-xxx)..."
            className="w-full min-h-[44px] pr-10 pl-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
          />
        </div>

        <div
          role="tablist"
          aria-label="تصنيف بلاغات الكلية"
          className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-[#F5F7FA] border border-[#E2E8F0] p-1 rounded-lg"
        >
          {(
            [
              {
                key: 'pending',
                label: 'قيد المراجعة',
                count: tabCounts.pending,
              },
              {
                key: 'matched',
                label: 'موجود بالمكتب',
                count: tabCounts.matched,
              },
              {
                key: 'delivered',
                label: 'تم التسليم',
                count: tabCounts.delivered,
              },
              {
                key: 'cancelled',
                label: 'الأرشيف',
                count: tabCounts.cancelled,
              },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 min-h-[40px] rounded-md text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-white text-[#0F2942] shadow-xs border border-[#E2E8F0]'
                    : 'text-slate-600 hover:text-[#0F2942]'
                }`}
              >
                {tab.key === 'cancelled' && (
                  <Archive className="w-3.5 h-3.5 text-slate-400 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                )}
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                    active
                      ? 'bg-[#0F2942] text-white'
                      : 'bg-slate-200/80 text-slate-700'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* قائمة البلاغات */}
      {filteredCollegeReports.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            {searchQuery.trim()
              ? `لا توجد نتائج مطابقة لـ «${searchQuery.trim()}» في تبويب «${
                  activeTab === 'pending'
                    ? 'قيد المراجعة'
                    : activeTab === 'matched'
                    ? 'موجود بالمكتب'
                    : activeTab === 'delivered'
                    ? 'تم التسليم'
                    : 'الأرشيف'
                }».`
              : `لا توجد بلاغات في تبويب «${
                  activeTab === 'pending'
                    ? 'قيد المراجعة'
                    : activeTab === 'matched'
                    ? 'موجود بالمكتب'
                    : activeTab === 'delivered'
                    ? 'تم التسليم'
                    : 'الأرشيف'
                }» لـ ${staffFaculty} حالياً.`}
          </p>
          {searchQuery.trim() && searchFilteredReports.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {tabCounts.pending > 0 && activeTab !== 'pending' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('pending')}
                  className="px-3.5 py-2 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  عرض النتائج في قيد المراجعة ({tabCounts.pending})
                </button>
              )}
              {tabCounts.matched > 0 && activeTab !== 'matched' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('matched')}
                  className="px-3.5 py-2 rounded-lg bg-[#DCFCE7] border border-[#BBF7D0] text-[#166534] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  عرض النتائج في موجود بالمكتب ({tabCounts.matched})
                </button>
              )}
              {tabCounts.delivered > 0 && activeTab !== 'delivered' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('delivered')}
                  className="px-3.5 py-2 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  عرض النتائج في تم التسليم ({tabCounts.delivered})
                </button>
              )}
              {tabCounts.cancelled > 0 && activeTab !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('cancelled')}
                  className="px-3.5 py-2 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569] text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer"
                >
                  عرض النتائج في الأرشيف ({tabCounts.cancelled})
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCollegeReports.map((report) => {
            const statusMeta = STATUS_LABELS[report.status];
            const isBusyThis = processingAction?.id === report.id;
            const isMatchingThis =
              isBusyThis && processingAction?.type === 'match';
            const isNotFoundThis =
              isBusyThis && processingAction?.type === 'not_found';
            const isReminderThis =
              isBusyThis && processingAction?.type === 'reminder';
            const isUrgent =
              report.status !== 'cancelled' &&
              (Boolean(report.isUrgent) || detectUrgentItem(report.itemName));

            return (
              <article
                key={report.id}
                className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5 space-y-4"
              >
                {/* الأعلى: الاسم الثلاثي للطالب + رقم البلاغ + شارة هام والحالة */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCheck className="w-4 h-4 text-[#0F2942] shrink-0" strokeWidth={1.6} aria-hidden="true" />
                    <span className="text-sm sm:text-base font-bold text-[#0F2942] truncate">
                      {report.studentName}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2.5 py-1 rounded-md bg-[#F5F7FA] border border-[#E2E8F0] text-[#0F2942] font-mono text-xs font-bold tabular-nums">
                      {report.reportCode}
                    </span>
                    {isUrgent && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] text-xs font-bold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        <span>هام</span>
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${statusMeta.className}`}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                </div>

                {/* الوسط: اسم الغرض + مربع المواصفات السرية + صف البيانات */}
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-[#0F2942] leading-snug">
                    {report.itemName}
                  </h2>

                  <div className="rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] p-3.5 space-y-1">
                    <span className="block text-[11px] font-semibold text-slate-500">
                      المواصفات السرية للمطابقة:
                    </span>
                    <p className="text-sm text-slate-800 leading-relaxed">
                      {report.description}
                    </p>
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                    <div className="flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span>{report.locationType}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span>{report.roomOrLocation}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span>{report.timePeriod}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span dir="ltr" className="font-semibold font-mono tabular-nums text-[#0F2942]">
                        {formatPhoneForDisplay(report.phoneNumber)}
                      </span>
                    </div>
                  </dl>
                  {report.status === 'pending' && report.notFoundNotified && (
                    <div className="rounded-lg bg-[#FEF3C7]/60 border border-[#FDE68A] px-3 py-2 text-[11px] font-semibold text-[#92400E] flex items-center justify-between gap-2">
                      <span>تم إشعار الطالب: لم يُعثر عليه حالياً (البلاغ لا يزال نشطاً)</span>
                      {report.lastCheckedAt && (
                        <span className="font-normal text-[#92400E]/80 whitespace-nowrap">
                          {new Intl.DateTimeFormat('ar', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }).format(new Date(report.lastCheckedAt))}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* الأسفل: أزرار الإجراءات المتسلسلة حسب الحالة فقط */}
                <div className="pt-3 border-t border-[#E2E8F0]">
                  {report.status === 'pending' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={isBusyThis}
                        onClick={() => void handleActionMatchAndNotify(report)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#166534] hover:bg-[#14532D] disabled:opacity-70 text-white text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                      >
                        {isMatchingThis ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        ) : (
                          <PackageCheck className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        )}
                        <span>
                          {isMatchingThis
                            ? 'جاري تأكيد العثور...'
                            : 'تم العثور على الغرض'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusyThis}
                        onClick={() => void handleActionNotFound(report)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-[#FDE68A] bg-[#FEF3C7]/45 hover:bg-[#FEF3C7] disabled:opacity-70 text-[#92400E] text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                      >
                        {isNotFoundThis ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        ) : (
                          <Clock className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        )}
                        <span>
                          {isNotFoundThis
                            ? 'جاري إرسال الإشعار...'
                            : 'لم يتم العثور على الغرض'}
                        </span>
                      </button>
                    </div>
                  ) : report.status === 'matched' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={isBusyThis}
                        onClick={() => onOpenDeliveryModal(report)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 text-white text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                      >
                        <IdCard className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        <span>تم التسليم بنجاح</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusyThis}
                        onClick={() => void handleActionPickupReminder(report)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/70 disabled:opacity-70 text-[#0F2942] text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
                      >
                        {isReminderThis ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        ) : (
                          <BellRing className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                        )}
                        <span>
                          {isReminderThis
                            ? 'جاري إرسال التذكير...'
                            : 'إعادة إرسال تذكير الاستلام'}
                        </span>
                      </button>
                    </div>
                  ) : report.status === 'delivered' ? (
                    <div className="py-2.5 px-3 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569] text-xs font-semibold text-center space-y-0.5">
                      <p>تم التسليم بنجاح بالبطاقة الجامعية وإغلاق البلاغ</p>
                      {report.deliveredAt && (
                        <p className="font-normal text-slate-500">
                          وقت التسليم:{' '}
                          {new Intl.DateTimeFormat('ar', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(report.deliveredAt))}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="py-2.5 px-3 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569] text-xs font-semibold text-center">
                      سحبه الطالب بعد العثور على غرضه — أُغلق البلاغ تلقائياً
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
