import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  FilePlus2,
  IdCard,
  Loader2,
  Lock,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  formatPhoneForDisplay,
  isValidYemeniPhone,
  sanitizePhoneNumber,
} from '../services/apiService';
import { MobileNotificationPrompt } from './MobileNotificationPrompt';
import {
  LOCATION_TYPES,
  TIME_PERIOD_PRESETS,
  UNIVERSITY_FACULTIES,
  type CreateLostReportPayload,
  type LocationType,
  type LostReport,
  type StudentProfile,
  type UniversityFaculty,
} from '../types/report';

const LOST_DRAFT_KEY = 'wisal_lost_report_draft_v2';

interface DraftState {
  faculty: UniversityFaculty;
  studentName: string;
  itemName: string;
  description: string;
  locationType: LocationType;
  roomOrLocation: string;
  timePeriod: string;
  isCustomTime: boolean;
  customTimePeriod: string;
  phoneNumber: string;
}

const INITIAL_DRAFT: DraftState = {
  faculty: UNIVERSITY_FACULTIES[0],
  studentName: '',
  itemName: '',
  description: '',
  locationType: LOCATION_TYPES[0],
  roomOrLocation: '',
  timePeriod: TIME_PERIOD_PRESETS[0],
  isCustomTime: false,
  customTimePeriod: '',
  phoneNumber: '',
};

function loadDraft(studentProfile: StudentProfile | null): DraftState {
  const base: DraftState = {
    ...INITIAL_DRAFT,
    faculty: studentProfile?.studentFaculty ?? UNIVERSITY_FACULTIES[0],
    studentName: studentProfile?.studentName ?? '',
    phoneNumber: studentProfile?.phoneNumber
      ? formatPhoneForDisplay(studentProfile.phoneNumber)
      : '',
  };

  try {
    const raw = localStorage.getItem(LOST_DRAFT_KEY);
    if (!raw) return base;
    const merged = {
      ...base,
      ...(JSON.parse(raw) as Partial<DraftState>),
    };
    if (!UNIVERSITY_FACULTIES.includes(merged.faculty)) {
      merged.faculty = base.faculty;
    }
    if (studentProfile?.studentFaculty) {
      merged.faculty = studentProfile.studentFaculty;
    }
    if (!merged.studentName && base.studentName) {
      merged.studentName = base.studentName;
    }
    if (!merged.phoneNumber && base.phoneNumber) {
      merged.phoneNumber = base.phoneNumber;
    }
    return merged;
  } catch {
    return base;
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(LOST_DRAFT_KEY);
  } catch {
    // تجاهل
  }
}

interface ReportLostViewProps {
  studentProfile: StudentProfile | null;
  onCreateReport: (payload: CreateLostReportPayload) => Promise<LostReport>;
  onCopyReceipt: (message: string) => void;
  onGoToTracking: () => void;
}

export function ReportLostView({
  studentProfile,
  onCreateReport,
  onCopyReceipt,
  onGoToTracking,
}: ReportLostViewProps) {
  const lockedFaculty = studentProfile?.studentFaculty ?? null;
  const isFacultyLocked = Boolean(lockedFaculty);

  const [form, setForm] = useState<DraftState>(() => loadDraft(studentProfile));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedReport, setSubmittedReport] = useState<LostReport | null>(
    null
  );
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  // حارس متزامن إضافي لمنع الإرسال المكرر عند النقر السريع على الجوال
  const submittingRef = useRef(false);

  // مراجع الحقول للتنقل المتسلسل بالضغط على Enter والتمرير السلس
  // (1. الاسم الثلاثي <- 2. الكلية <- 3. اسم الغرض <- 4. المواصفات الدقيقة <- 5. المكان أو القاعة <- 6. رقم الجوال)
  const studentNameRef = useRef<HTMLInputElement>(null);
  const facultyRef = useRef<HTMLSelectElement>(null);
  const itemNameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const roomRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!lockedFaculty) return;
    setForm((prev) =>
      prev.faculty === lockedFaculty
        ? prev
        : { ...prev, faculty: lockedFaculty }
    );
  }, [lockedFaculty]);

  useEffect(() => {
    try {
      localStorage.setItem(LOST_DRAFT_KEY, JSON.stringify(form));
    } catch {
      // تجاهل
    }
  }, [form]);

  const focusAndScroll = (
    target:
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | HTMLButtonElement
      | null
  ) => {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleAdvanceOnEnter = (
    e: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    nextTarget:
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | HTMLButtonElement
      | null
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusAndScroll(nextTarget);
    }
  };

  const resolvedTimePeriod = form.isCustomTime
    ? form.customTimePeriod.trim()
    : form.timePeriod;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || isSubmitting) return;
    setError(null);

    const nameWords = form.studentName.trim().split(/\s+/).filter(Boolean);
    if (nameWords.length < 3) {
      setError(
        'يرجى إدخال اسم الطالب الثلاثي (مثال: احمد صلاح العمودي) كما في البطاقة الجامعية.'
      );
      focusAndScroll(studentNameRef.current);
      return;
    }
    if (!form.itemName.trim()) {
      setError('يرجى كتابة اسم الغرض المفقود.');
      focusAndScroll(itemNameRef.current);
      return;
    }
    if (!form.description.trim()) {
      setError(
        'يرجى إدخال المواصفات الدقيقة للمطابقة (اللون، الماركة، أو أي علامة مميزة).'
      );
      focusAndScroll(descriptionRef.current);
      return;
    }
    if (!form.roomOrLocation.trim()) {
      setError('يرجى تحديد رقم القاعة أو تفاصيل المكان.');
      focusAndScroll(roomRef.current);
      return;
    }
    if (!resolvedTimePeriod) {
      setError('يرجى اختيار الفترة الزمنية أو كتابة وقت مخصص.');
      return;
    }

    if (!isValidYemeniPhone(form.phoneNumber)) {
      setError(
        'يرجى إدخال رقم جوال يمني صحيح مكون من 9 أرقام يبدأ بـ 7 (مثل 77xxxxxxx أو 73xxxxxxx).'
      );
      focusAndScroll(phoneRef.current);
      return;
    }
    const cleanPhone = sanitizePhoneNumber(form.phoneNumber);

    const effectiveFaculty = lockedFaculty ?? form.faculty;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const created = await onCreateReport({
        faculty: effectiveFaculty,
        studentName: form.studentName,
        itemName: form.itemName,
        description: form.description,
        locationType: form.locationType,
        roomOrLocation: form.roomOrLocation,
        timePeriod: resolvedTimePeriod,
        phoneNumber: cleanPhone,
      });
      clearDraft();
      setForm({
        ...INITIAL_DRAFT,
        faculty: created.faculty,
        studentName: created.studentName,
        phoneNumber: formatPhoneForDisplay(created.phoneNumber),
      });
      setSubmittedReport(created);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر إرسال البلاغ، يرجى المحاولة مجدداً.'
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCopyReportCode = async () => {
    if (!submittedReport) return;
    const text = [
      'إيصال بلاغ فقد — منصة «وصال الجامعي»',
      `رقم البلاغ: ${submittedReport.reportCode}`,
      `اسم الطالب: ${submittedReport.studentName}`,
      `الغرض: ${submittedReport.itemName}`,
      `مكتب شؤون الطلاب: ${submittedReport.faculty}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // المتابعة بإشعار النسخ
    }
    setCopiedReceipt(true);
    onCopyReceipt(`تم نسخ رقم البلاغ (${submittedReport.reportCode}) إلى الحافظة.`);
    window.setTimeout(() => setCopiedReceipt(false), 2000);
  };

  if (submittedReport) {
    return (
      <section className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5 sm:p-6 text-center space-y-5">
        <div className="mx-auto w-fit text-[#166534]">
          <CheckCircle2 className="w-10 h-10" strokeWidth={1.5} aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-bold text-[#0F2942]">
            تم إرسال البلاغ لمكتب شؤون الطلاب
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            توجّه البلاغ مباشرة إلى مكتب شؤون الطلاب في{' '}
            <strong className="text-[#0F2942]">{submittedReport.faculty}</strong>{' '}
            باسم الطالب{' '}
            <strong className="text-[#0F2942]">{submittedReport.studentName}</strong>.
          </p>
        </div>

        <div className="bg-[#F5F7FA] border border-[#E2E8F0] rounded-xl p-4 space-y-3">
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
            <span className="block text-xs font-medium text-slate-500">
              رقم البلاغ المرجعي
            </span>
            <span className="block text-3xl font-bold font-mono text-[#0F2942] tabular-nums mt-1">
              {submittedReport.reportCode}
            </span>
          </div>

          <div className="flex items-start gap-2.5 text-right rounded-lg bg-[#DCFCE7] border border-[#BBF7D0] px-3.5 py-3 text-xs sm:text-sm text-[#166534] font-medium leading-relaxed">
            <IdCard className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
            <p>
              سيتم إشعارك فور تطابق غرضك، ويُشترط إبراز البطاقة الجامعية عند الاستلام من مكتب شؤون الطلاب.
            </p>
          </div>
        </div>

        <MobileNotificationPrompt
          compact
          onStatusFeedback={onCopyReceipt}
        />

        <button
          type="button"
          onClick={() => void handleCopyReportCode()}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] rounded-lg bg-[#0F2942] hover:bg-[#163859] text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
        >
          {copiedReceipt ? (
            <Check className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <Copy className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          )}
          <span>{copiedReceipt ? 'تم نسخ رقم البلاغ' : 'نسخ رقم البلاغ'}</span>
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onGoToTracking}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F5F7FA] text-[#0F2942] text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
          >
            <Search className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span>متابعة البلاغات</span>
          </button>
          <button
            type="button"
            onClick={() => setSubmittedReport(null)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/60 text-[#0F2942] text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
          >
            <FilePlus2 className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span>تسجيل بلاغ آخر</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0F2942]">
            إبلاغ عن فقد غرض
          </h1>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            يُحال البلاغ مباشرة إلى مكتب شؤون الطلاب بالكلية المختارة لمطابقته مع الأغراض المسلمة للمكتب
          </p>
        </div>

        {(form.studentName ||
          form.itemName ||
          form.description ||
          form.roomOrLocation ||
          form.phoneNumber) && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              clearDraft();
              setForm({
                ...INITIAL_DRAFT,
                faculty: lockedFaculty ?? UNIVERSITY_FACULTIES[0],
              });
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg border border-[#E2E8F0] bg-white text-xs font-semibold text-slate-600 hover:bg-[#F5F7FA] disabled:opacity-50 shrink-0 transition-all active:scale-[0.99] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
            <span>مسح</span>
          </button>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-5 sm:p-6 space-y-5"
      >
        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-[#FEE2E2] border border-[#FECACA] text-[#991B1B] text-sm font-medium"
          >
            {error}
          </div>
        )}

        {/* 1. اسم الطالب الثلاثي */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="lost-student-name"
              className="block text-sm font-semibold text-[#0F2942]"
            >
              اسم الطالب الثلاثي (كما في البطاقة الجامعية){' '}
              <span className="text-[#991B1B]">*</span>
            </label>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium whitespace-nowrap shrink-0">
              <Lock className="w-3 h-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>محجوب عن العامة</span>
            </span>
          </div>
          <input
            ref={studentNameRef}
            id="lost-student-name"
            type="text"
            enterKeyHint="next"
            required
            disabled={isSubmitting}
            value={form.studentName}
            onKeyDown={(e) =>
              handleAdvanceOnEnter(
                e,
                isFacultyLocked ? itemNameRef.current : facultyRef.current
              )
            }
            onChange={(e) => setForm({ ...form, studentName: e.target.value })}
            placeholder="مثال: احمد صلاح العمودي"
            className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
          />
          <p className="text-xs text-slate-500">
            يُستخدم للتحقق من الهوية ومطابقة البطاقة الجامعية عند الاستلام من مكتب شؤون الطلاب.
          </p>
        </div>

        {/* 2. الكلية */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="lost-faculty"
              className="block text-sm font-semibold text-[#0F2942]"
            >
              الكلية (مكتب شؤون الطلاب المختص){' '}
              <span className="text-[#991B1B]">*</span>
            </label>
            {isFacultyLocked && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium whitespace-nowrap shrink-0">
                <Lock className="w-3 h-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <span>مقفلة على كليتك الأساسية</span>
              </span>
            )}
          </div>
          <select
            ref={facultyRef}
            id="lost-faculty"
            disabled={isSubmitting || isFacultyLocked}
            aria-disabled={isFacultyLocked}
            value={lockedFaculty ?? form.faculty}
            onKeyDown={(e) => handleAdvanceOnEnter(e, itemNameRef.current)}
            onChange={(e) => {
              if (isFacultyLocked) return;
              setForm({ ...form, faculty: e.target.value as UniversityFaculty });
            }}
            className={`w-full min-h-[44px] px-3.5 py-2.5 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none ${
              isFacultyLocked
                ? 'bg-slate-100 text-slate-700 cursor-not-allowed'
                : 'bg-[#F5F7FA] text-slate-900 focus:bg-white focus:border-[#0F2942] cursor-pointer'
            }`}
          >
            {UNIVERSITY_FACULTIES.map((faculty) => (
              <option key={faculty} value={faculty}>
                {faculty}
              </option>
            ))}
          </select>
          {isFacultyLocked && (
            <p className="text-xs text-slate-500 leading-relaxed">
              محددة تلقائياً حسب كليتك المسجلة (تُرفع جميع بلاغاتك لمكتب شؤون طلاب كليتك)
            </p>
          )}
        </div>

        {/* 3. اسم الغرض */}
        <div className="space-y-1.5">
          <label
            htmlFor="lost-item-name"
            className="block text-sm font-semibold text-[#0F2942]"
          >
            اسم الغرض <span className="text-[#991B1B]">*</span>
          </label>
          <input
            ref={itemNameRef}
            id="lost-item-name"
            type="text"
            enterKeyHint="next"
            required
            disabled={isSubmitting}
            value={form.itemName}
            onKeyDown={(e) => handleAdvanceOnEnter(e, descriptionRef.current)}
            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
            placeholder="مثال: سماعة AirPods Pro أو حافظة بطاقات"
            className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
          />
        </div>

        {/* 4. الوصف والمواصفات الدقيقة (Enter يضيف سطراً جديداً بشكل طبيعي) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="lost-description"
              className="block text-sm font-semibold text-[#0F2942]"
            >
              الوصف والمواصفات الدقيقة للمطابقة{' '}
              <span className="text-[#991B1B]">*</span>
            </label>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium whitespace-nowrap shrink-0">
              <Lock className="w-3 h-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>سري للمكتب فقط</span>
            </span>
          </div>
          <textarea
            ref={descriptionRef}
            id="lost-description"
            rows={3}
            required
            disabled={isSubmitting}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="اذكر اللون، الماركة، أي ملصق أو خدش أو علامة مميزة ليتمكن موظف الكلية من مطابقتها بدقة..."
            className="w-full px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none resize-none"
          />
        </div>

        {/* 5. نوع المكان ورقم القاعة */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="lost-location-type"
              className="block text-sm font-semibold text-[#0F2942]"
            >
              نوع المكان <span className="text-[#991B1B]">*</span>
            </label>
            <select
              id="lost-location-type"
              disabled={isSubmitting}
              value={form.locationType}
              onKeyDown={(e) => handleAdvanceOnEnter(e, roomRef.current)}
              onChange={(e) =>
                setForm({
                  ...form,
                  locationType: e.target.value as LocationType,
                })
              }
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 focus:bg-white focus:border-[#0F2942] focus:outline-none cursor-pointer"
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
              htmlFor="lost-room"
              className="block text-sm font-semibold text-[#0F2942]"
            >
              رقم القاعة أو التفاصيل <span className="text-[#991B1B]">*</span>
            </label>
            <input
              ref={roomRef}
              id="lost-room"
              type="text"
              enterKeyHint="next"
              required
              disabled={isSubmitting}
              value={form.roomOrLocation}
              onKeyDown={(e) => handleAdvanceOnEnter(e, phoneRef.current)}
              onChange={(e) =>
                setForm({ ...form, roomOrLocation: e.target.value })
              }
              placeholder="مثال: مبنى 14 - قاعة 204"
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
            />
          </div>
        </div>

        {/* الفترة الزمنية (Chips) */}
        <fieldset className="space-y-2.5" disabled={isSubmitting}>
          <legend className="text-sm font-semibold text-[#0F2942]">
            الفترة الزمنية <span className="text-[#991B1B]">*</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {TIME_PERIOD_PRESETS.map((preset) => {
              const selected = !form.isCustomTime && form.timePeriod === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, isCustomTime: false, timePeriod: preset })
                  }
                  className={`px-3.5 py-2 min-h-[40px] rounded-lg border text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                    selected
                      ? 'bg-[#0F2942] text-white border-[#0F2942]'
                      : 'bg-[#F5F7FA] text-slate-700 border-[#E2E8F0] hover:bg-slate-200/60'
                  }`}
                >
                  {preset}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setForm({ ...form, isCustomTime: true })}
              className={`px-3.5 py-2 min-h-[40px] rounded-lg border text-xs font-semibold transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                form.isCustomTime
                  ? 'bg-[#0F2942] text-white border-[#0F2942]'
                  : 'bg-[#F5F7FA] text-slate-700 border-[#E2E8F0] hover:bg-slate-200/60'
              }`}
            >
              وقت مخصص
            </button>
          </div>

          {form.isCustomTime && (
            <input
              type="text"
              enterKeyHint="next"
              value={form.customTimePeriod}
              onKeyDown={(e) => handleAdvanceOnEnter(e, phoneRef.current)}
              onChange={(e) =>
                setForm({ ...form, customTimePeriod: e.target.value })
              }
              placeholder="مثال: يوم الثلاثاء الساعة 11:00 صباحاً"
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#0F2942] focus:outline-none"
            />
          )}
        </fieldset>

        {/* 6. رقم الجوال / واتساب بمقدمة +967 منظمة */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="lost-phone"
              className="block text-sm font-semibold text-[#0F2942]"
            >
              رقم الجوال / واتساب <span className="text-[#991B1B]">*</span>
            </label>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium whitespace-nowrap shrink-0">
              <Lock className="w-3 h-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>محجوب عن العامة</span>
            </span>
          </div>

          <div
            dir="ltr"
            className="flex items-stretch rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] overflow-hidden focus-within:bg-white focus-within:border-[#0F2942] transition-colors"
          >
            <span className="inline-flex items-center px-3.5 bg-slate-100 border-r border-[#E2E8F0] text-xs font-mono font-bold text-[#0F2942] tabular-nums select-none shrink-0">
              +967
            </span>
            <input
              ref={phoneRef}
              id="lost-phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              enterKeyHint="done"
              disabled={isSubmitting}
              value={form.phoneNumber}
              onKeyDown={(e) => handleAdvanceOnEnter(e, submitButtonRef.current)}
              onChange={(e) =>
                setForm({
                  ...form,
                  phoneNumber: e.target.value.replace(/[^\d+\s-]/g, ''),
                })
              }
              placeholder="7XXXXXXXX"
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-transparent text-sm font-mono tabular-nums text-left text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          <p className="text-xs text-slate-500">
            أدخل 9 أرقام تبدأ بـ 7 (مثل 77 أو 73 أو 71 أو 70) لإشعارك عبر واتساب فور مطابقة الغرض.
          </p>
        </div>

        <button
          ref={submitButtonRef}
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
        >
          {isSubmitting && (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
          )}
          <span>{isSubmitting ? 'جاري إرسال البلاغ...' : 'إرسال البلاغ لمكتب الكلية'}</span>
        </button>
      </form>
    </div>
  );
}
