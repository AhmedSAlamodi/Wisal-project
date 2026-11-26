import {
  LOCATION_TYPES,
  UNIVERSITY_FACULTIES,
  type ApiResponse,
  type CreateLostReportPayload,
  type LostReport,
  type LostReportStatus,
  type MyReportEntry,
  type PushSubscriptionPayload,
  type StaffAuthStatus,
  type StaffSession,
  type StudentProfile,
  type UniversityFaculty,
  type UpdateLostReportPayload,
} from '../types/report';
import {
  readSavedPushSubscription,
  savePushSubscriptionLocally,
  showServiceWorkerNotification,
} from './pwaService';

/**
 * إعدادات الاتصال بالخادم (API Configuration)
 * استخدام المسارات النسبية يضمن التوافق المباشر مع Render وVercel والخادم الموحد،
 * مع تفعيل الوضع الاحتياطي المحلي تلقائياً عند غياب الخادم الخلفي (/api).
 */
export const USE_REMOTE_API = true;
export const API_BASE_URL = '/api/reports';
export const STAFF_API_BASE_URL = '/api/staff';
export const LOCAL_FALLBACK_DEMO_PASSCODE = '1234';

/** الرقم الرسمي لمنصة «وصال الجامعي» */
export const OFFICIAL_WHATSAPP_NUMBER = '967734918671';
export const OFFICIAL_WHATSAPP_DISPLAY = '734918671';

const OFFLINE_CACHE_KEY = 'wisal_student_affairs_reports_v6';
const LOCAL_SEQUENCE_KEY = 'wisal_local_sequence_v1';
const LEGACY_STORAGE_KEYS = [
  'wisal_student_affairs_reports_v1',
  'wisal_student_affairs_reports_v2',
  'wisal_student_affairs_reports_v3',
  'wisal_student_affairs_reports_v4',
  'wisal_student_affairs_reports_v5',
];
const MY_REPORTS_STORAGE_KEY = 'myReportIds';
const STUDENT_FACULTY_STORAGE_KEY = 'studentFaculty';
const STUDENT_PROFILE_STORAGE_KEY = 'wisal_student_profile_v1';
const LEGACY_STAFF_FACULTY_KEY = 'wisal_staff_faculty_v1';

// توكن جلسة الموظف وحالة الوضع الاحتياطي يُحفظان في الذاكرة فقط
let inMemoryStaffToken: string | null = null;
let inMemoryLocalStaffFaculty: UniversityFaculty | null = null;
let localFallbackActive = false;

export function clearInMemoryStaffToken(): void {
  inMemoryStaffToken = null;
  inMemoryLocalStaffFaculty = null;
}

export function hasInMemoryStaffToken(): boolean {
  return Boolean(inMemoryStaffToken || inMemoryLocalStaffFaculty);
}

export function isUsingLocalFallback(): boolean {
  return localFallbackActive;
}

const STATUS_PRIORITY: Record<LostReportStatus, number> = {
  matched: 0,
  pending: 1,
  delivered: 2,
  cancelled: 3,
};

export function normalizeArabicText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

const URGENT_KEYWORDS = [
  'بطاقة',
  'بطاقه',
  'هوية',
  'هويه',
  'جواز',
  'جوال',
  'هاتف',
  'ايفون',
  'iphone',
  'سامسونج',
  'samsung',
  'لابتوب',
  'laptop',
  'جهاز',
  'ايباد',
  'ipad',
  'محفظة',
  'محفظه',
  'فلوس',
  'نقود',
  'مفتاح سيارة',
  'مفتاح سياره',
  'مفاتيح سيارة',
  'مفاتيح سياره',
].map(normalizeArabicText);

export function detectUrgentItem(itemTitle: string): boolean {
  const normalized = normalizeArabicText(itemTitle);
  if (!normalized) return false;
  return URGENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function sortReports(reports: LostReport[]): LostReport[] {
  return [...reports].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    const urgentA = a.isUrgent || detectUrgentItem(a.itemName) ? 1 : 0;
    const urgentB = b.isUrgent || detectUrgentItem(b.itemName) ? 1 : 0;
    if (urgentB !== urgentA) {
      return urgentB - urgentA;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function migrateLegacyStorage(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.removeItem(LEGACY_STAFF_FACULTY_KEY);
  } catch {
    // تجاهل
  }
}

function readOfflineCache(): LostReport[] {
  migrateLegacyStorage();
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const validFaculties = new Set<string>(UNIVERSITY_FACULTIES);
    return (parsed as LostReport[])
      .filter(
        (r) =>
          r &&
          typeof r.id === 'string' &&
          typeof r.reportCode === 'string' &&
          typeof r.itemName === 'string' &&
          validFaculties.has(r.faculty)
      )
      .map((r) => ({
        ...r,
        isUrgent: Boolean(r.isUrgent) || detectUrgentItem(r.itemName),
      }));
  } catch {
    return [];
  }
}

function writeOfflineCache(reports: LostReport[]): void {
  try {
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(reports));
  } catch {
    // تجاهل في حال تعذر التخزين
  }
}

/**
 * إدارة سجل بلاغات الطالب الخاصة في localStorage تحت المفتاح myReportIds
 */
export function readMyReportEntries(): MyReportEntry[] {
  try {
    const raw = localStorage.getItem(MY_REPORTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): MyReportEntry | null => {
        if (typeof item === 'string') {
          return { id: item, ownedInBrowser: true };
        }
        if (item && typeof item.id === 'string') {
          return {
            id: item.id,
            ownedInBrowser: Boolean(item.ownedInBrowser),
            ...(typeof item.ownerToken === 'string' && item.ownerToken
              ? { ownerToken: item.ownerToken }
              : {}),
          };
        }
        return null;
      })
      .filter((x): x is MyReportEntry => x !== null);
  } catch {
    return [];
  }
}

export function saveMyReportEntry(entry: MyReportEntry): MyReportEntry[] {
  const existing = readMyReportEntries();
  const idx = existing.findIndex((item) => item.id === entry.id);
  let next: MyReportEntry[];
  if (idx >= 0) {
    next = existing.map((item, i) =>
      i === idx
        ? {
            id: item.id,
            ownedInBrowser: item.ownedInBrowser || entry.ownedInBrowser,
            ...(entry.ownerToken || item.ownerToken
              ? { ownerToken: entry.ownerToken ?? item.ownerToken }
              : {}),
          }
        : item
    );
  } else {
    next = [entry, ...existing];
  }
  try {
    localStorage.setItem(MY_REPORTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // تجاهل
  }
  return next;
}

export function removeMyReportEntry(reportId: string): MyReportEntry[] {
  const next = readMyReportEntries().filter((item) => item.id !== reportId);
  try {
    localStorage.setItem(MY_REPORTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // تجاهل
  }
  return next;
}

export function clearMyReportEntries(): void {
  try {
    localStorage.removeItem(MY_REPORTS_STORAGE_KEY);
  } catch {
    // تجاهل
  }
}

function toAsciiHeaderValue(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || !/^[\x20-\x7E]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function getOwnerTokenForReport(reportId: string): string | undefined {
  return toAsciiHeaderValue(
    readMyReportEntries().find((e) => e.id === reportId)?.ownerToken
  );
}

/**
 * حفظ وقراءة الكلية الأساسية للطالب وبياناته في localStorage (studentFaculty)
 */
export function readStudentProfile(): StudentProfile | null {
  try {
    const validFaculties = new Set<string>(UNIVERSITY_FACULTIES);
    const rawProfile = localStorage.getItem(STUDENT_PROFILE_STORAGE_KEY);
    if (rawProfile) {
      const parsed = JSON.parse(rawProfile) as Partial<StudentProfile>;
      if (
        parsed &&
        typeof parsed.studentFaculty === 'string' &&
        validFaculties.has(parsed.studentFaculty)
      ) {
        return {
          studentFaculty: parsed.studentFaculty as UniversityFaculty,
          studentName:
            typeof parsed.studentName === 'string' ? parsed.studentName : '',
          phoneNumber:
            typeof parsed.phoneNumber === 'string' ? parsed.phoneNumber : '',
        };
      }
    }

    const rawFaculty = localStorage.getItem(STUDENT_FACULTY_STORAGE_KEY);
    if (!rawFaculty) return null;
    if (validFaculties.has(rawFaculty)) {
      return {
        studentFaculty: rawFaculty as UniversityFaculty,
        studentName: '',
        phoneNumber: '',
      };
    }
    const parsedLegacy = JSON.parse(rawFaculty) as Partial<StudentProfile>;
    if (
      parsedLegacy &&
      typeof parsedLegacy.studentFaculty === 'string' &&
      validFaculties.has(parsedLegacy.studentFaculty)
    ) {
      return {
        studentFaculty: parsedLegacy.studentFaculty as UniversityFaculty,
        studentName:
          typeof parsedLegacy.studentName === 'string'
            ? parsedLegacy.studentName
            : '',
        phoneNumber:
          typeof parsedLegacy.phoneNumber === 'string'
            ? parsedLegacy.phoneNumber
            : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStudentProfile(profile: StudentProfile): StudentProfile {
  const existing = readStudentProfile();
  const normalizedProfile: StudentProfile = {
    // تثبيت الكلية الأساسية عند أول بلاغ وعدم تغييرها لاحقاً
    studentFaculty: existing?.studentFaculty ?? profile.studentFaculty,
    studentName: profile.studentName.trim() || existing?.studentName || '',
    phoneNumber:
      sanitizePhoneNumber(profile.phoneNumber) || existing?.phoneNumber || '',
  };

  try {
    localStorage.setItem(
      STUDENT_FACULTY_STORAGE_KEY,
      normalizedProfile.studentFaculty
    );
    localStorage.setItem(
      STUDENT_PROFILE_STORAGE_KEY,
      JSON.stringify(normalizedProfile)
    );
  } catch {
    // تجاهل
  }
  return normalizedProfile;
}

export function clearStudentProfile(): void {
  try {
    localStorage.removeItem(STUDENT_FACULTY_STORAGE_KEY);
    localStorage.removeItem(STUDENT_PROFILE_STORAGE_KEY);
  } catch {
    // تجاهل
  }
}

/**
 * تنظيف رقم الجوال/واتساب تلقائياً ودعم الأرقام اليمنية (9 أرقام تبدأ بـ 7 -> 9677xxxxxxx)
 */
export function sanitizePhoneNumber(rawPhone: string): string {
  const normalizedDigits = rawPhone
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\d]/g, '');

  const digits = normalizedDigits.startsWith('00')
    ? normalizedDigits.slice(2)
    : normalizedDigits;

  // الرقم اليمني المحلي: 9 أرقام تبدأ بـ 7 (مثل 77، 73، 71، 70)
  if (/^7\d{8}$/.test(digits)) {
    return `967${digits}`;
  }
  // في حال كُتب مع صفر بادئ (07xxxxxxxx)
  if (/^07\d{8}$/.test(digits)) {
    return `967${digits.slice(1)}`;
  }
  // الرقم اليمني مع المفتاح الدولي مسبقاً
  if (/^9677\d{8}$/.test(digits)) {
    return digits;
  }
  return digits;
}

export function isValidYemeniPhone(rawPhone: string): boolean {
  const clean = sanitizePhoneNumber(rawPhone);
  return /^9677\d{8}$/.test(clean);
}

export function formatPhoneForDisplay(phone: string): string {
  const clean = sanitizePhoneNumber(phone);
  if (clean.startsWith('967') && clean.length === 12) {
    return clean.slice(3);
  }
  return clean;
}

/**
 * رابط مراسلة الرقم الرسمي لمنصة «وصال الجامعي» (967734918671)
 */
export function buildOfficialWhatsAppUrl(report?: LostReport): string {
  const message = report
    ? `السلام عليكم فريق منصة «وصال الجامعي»، أستفسر بخصوص بلاغي رقم ${report.reportCode} (${report.itemName}) الموجود في مكتب شؤون الطلاب بـ (${report.faculty}).`
    : 'السلام عليكم فريق منصة «وصال الجامعي»، أحتاج إلى مساعدة بخصوص بلاغ مفقودات جامعي.';
  return `https://wa.me/${OFFICIAL_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/**
 * النص الداخلي لإشعار الطالب بعدم العثور على الغرض لحد الآن مع إبقاء البلاغ نشطاً
 */
export const NOT_FOUND_NOTIFICATION_MESSAGE =
  'تحديث من مكتب شؤون الطلاب: لم يتم العثور على غرضك لحد الآن، وسيتم إبقاء البلاغ نشطاً ومتاحاً، وفي حال العثور عليه سيتم التواصل معك عبر رقم الواتساب الذي أرفقته.';

/**
 * نص رسالة واتساب الجاهزة لإشعار الطالب بوجود غرضه بالمكتب
 */
export function buildStaffWhatsAppMessage(report: LostReport): string {
  return `السلام عليكم ${report.studentName}، معك فريق «وصال الجامعي - مكتب شؤون الطلاب» (${report.faculty}). نُبشّرك بأنه تم العثور على غرضك (${report.itemName}) المطابق للبلاغ رقم ${report.reportCode} وهو موجود حالياً بالمكتب. يرجى التوجه لمكتب شؤون الطلاب بالكلية لاستلامه مع إحضار البطاقة الجامعية ورقم البلاغ (${report.reportCode}) للتحقق من الهوية.`;
}

/**
 * رابط إشعار الطالب من قِبل موظف شؤون الطلاب عبر واتساب
 */
export function buildStaffWhatsAppNotifyUrl(report: LostReport): string {
  const cleanPhone = sanitizePhoneNumber(report.phoneNumber);
  const message = buildStaffWhatsAppMessage(report);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * نص رسالة واتساب لتذكير الطالب بالحضور واستلام غرضه من المكتب
 */
export function buildStaffPickupReminderWhatsAppMessage(
  report: LostReport
): string {
  return `السلام عليكم ${report.studentName}، تذكير من مكتب شؤون الطلاب في (${report.faculty}) عبر منصة «وصال الجامعي»: غرضك (${report.itemName}) المطابق للبلاغ رقم ${report.reportCode} لا يزال محفوظاً لدينا بالمكتب وبانتظار استلامك. يرجى الحضور شخصياً لمكتب شؤون الطلاب وإبراز البطاقة الجامعية ورقم البلاغ (${report.reportCode}).`;
}

/**
 * رابط واتساب لإعادة إرسال تذكير الاستلام للطالب
 */
export function buildStaffPickupReminderWhatsAppUrl(
  report: LostReport
): string {
  const cleanPhone = sanitizePhoneNumber(report.phoneNumber);
  const message = buildStaffPickupReminderWhatsAppMessage(report);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * نص رسالة واتساب الجاهزة لإشعار الطالب بأن الغرض لم يُعثر عليه لحد الآن
 */
export function buildStaffNotFoundWhatsAppMessage(report: LostReport): string {
  return `السلام عليكم ${report.studentName}، معك مكتب شؤون الطلاب في (${report.faculty}) عبر منصة «وصال الجامعي». نفيدك بخصوص بلاغك رقم ${report.reportCode} (${report.itemName}) أنه لم يتم العثور على الغرض لحد الآن بعد المراجعة الأولية، وسيبقى بلاغك نشطاً ومتاحاً بالمكتب، وفي حال العثور عليه سيتم التواصل معك فوراً عبر هذا الرقم.`;
}

/**
 * رابط واتساب لإشعار الطالب بأن الغرض لم يُعثر عليه لحد الآن
 */
export function buildStaffNotFoundWhatsAppUrl(report: LostReport): string {
  const cleanPhone = sanitizePhoneNumber(report.phoneNumber);
  const message = buildStaffNotFoundWhatsAppMessage(report);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * إطلاق إشعار الجوال الرسمي عبر Service Worker عند مطابقة الغرض بالمكتب
 */
export function triggerMatchedBrowserNotification(report: LostReport): void {
  void showServiceWorkerNotification({
    title: 'وصال الجامعي',
    body: `تم العثور على غرضك بالمكتب (${report.reportCode} - ${report.itemName}) في ${report.faculty}. يرجى إحضار البطاقة الجامعية ورقم البلاغ عند الاستلام.`,
    tag: `wisal-matched-${report.id}`,
    reportId: report.id,
    reportCode: report.reportCode,
  });
}

/**
 * إطلاق إشعار تذكير الاستلام عبر Service Worker عند تأخر الطالب
 */
export function triggerPickupReminderBrowserNotification(
  report: LostReport
): void {
  void showServiceWorkerNotification({
    title: 'وصال الجامعي',
    body: `تذكير بالاستلام: غرضك (${report.reportCode} - ${report.itemName}) لا يزال بانتظارك في مكتب شؤون الطلاب بـ ${report.faculty}. يرجى الحضور وإبراز البطاقة الجامعية.`,
    tag: `wisal-reminder-${report.id}-${Date.now()}`,
    reportId: report.id,
    reportCode: report.reportCode,
  });
}

/**
 * إطلاق إشعار الجوال الرسمي عبر Service Worker عند إشعار الطالب بعدم العثور على الغرض لحد الآن
 */
export function triggerNotFoundBrowserNotification(report: LostReport): void {
  void showServiceWorkerNotification({
    title: 'وصال الجامعي',
    body: `لم يتم العثور على غرضك لحد الآن (${report.reportCode} - ${report.itemName})، وسيبقى البلاغ نشطاً ومتاحاً بالمكتب.`,
    tag: `wisal-not-found-${report.id}`,
    reportId: report.id,
    reportCode: report.reportCode,
  });
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (inMemoryStaffToken) {
    headers.Authorization = `Bearer ${inMemoryStaffToken}`;
  }
  return headers;
}

type RemoteResult<T> =
  | { kind: 'ok'; result: ApiResponse<T> }
  | { kind: 'unavailable'; sticky: boolean };

async function inspectRemoteResponse<T>(
  response: Response,
  fallbackError: string
): Promise<RemoteResult<T>> {
  if (response.status === 503) {
    return { kind: 'unavailable', sticky: false };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { kind: 'unavailable', sticky: true };
  }

  let parsed: ApiResponse<T>;
  try {
    parsed = (await response.json()) as ApiResponse<T>;
  } catch {
    return {
      kind: 'unavailable',
      sticky: response.status === 404 || response.status === 405,
    };
  }

  if (
    (response.status === 404 || response.status === 405) &&
    typeof parsed?.success !== 'boolean'
  ) {
    return { kind: 'unavailable', sticky: true };
  }

  if (response.status === 401) {
    inMemoryStaffToken = null;
  }

  if (!response.ok || !parsed.success) {
    return {
      kind: 'ok',
      result: {
        success: false,
        data: null,
        error: parsed.error || fallbackError,
        statusCode: response.status,
      },
    };
  }

  return {
    kind: 'ok',
    result: {
      ...parsed,
      statusCode: response.status,
    },
  };
}

async function executeWithFallback<T>(
  remoteCall: () => Promise<Response>,
  fallbackError: string,
  localHandler: () => ApiResponse<T>
): Promise<ApiResponse<T>> {
  if (!USE_REMOTE_API || localFallbackActive || Boolean(inMemoryLocalStaffFaculty)) {
    return localHandler();
  }

  try {
    const response = await remoteCall();
    const inspected = await inspectRemoteResponse<T>(response, fallbackError);
    if (inspected.kind === 'unavailable') {
      if (inspected.sticky) {
        localFallbackActive = true;
      }
      return localHandler();
    }
    return inspected.result;
  } catch {
    return localHandler();
  }
}

function extractLocalSequence(reportCode: string): number {
  const match = String(reportCode || '').match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 100;
}

function allocateNextLocalSequence(existingReports: LostReport[]): number {
  const maxReportSeq = existingReports.reduce((max, r) => {
    const seq = extractLocalSequence(r.reportCode);
    return seq > max ? seq : max;
  }, 100);

  let storedSeq = 100;
  try {
    const raw = localStorage.getItem(LOCAL_SEQUENCE_KEY);
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        storedSeq = parsed;
      }
    }
  } catch {
    // تجاهل
  }

  const nextSeq = Math.max(100, storedSeq, maxReportSeq) + 1;
  try {
    localStorage.setItem(LOCAL_SEQUENCE_KEY, String(nextSeq));
  } catch {
    // تجاهل
  }
  return nextSeq;
}

function createLocalToken(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${prefix}-${hex}`;
    }
  } catch {
    // متابعة بالبديل
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ==========================================
// طبقة التشغيل الاحتياطي المحلي (localStorage)
// ==========================================

function localGetStaffAuthStatus(
  faculty: UniversityFaculty
): ApiResponse<StaffAuthStatus> {
  if (!UNIVERSITY_FACULTIES.includes(faculty)) {
    return {
      success: false,
      data: null,
      error: 'يرجى اختيار كلية جامعية صالحة.',
      statusCode: 400,
    };
  }
  return {
    success: true,
    data: {
      faculty,
      needsSetup: false,
      localFallback: true,
    },
    error: null,
    statusCode: 200,
  };
}

function localStaffLogin(
  faculty: UniversityFaculty,
  passcode: string
): ApiResponse<StaffSession> {
  if (!UNIVERSITY_FACULTIES.includes(faculty)) {
    return {
      success: false,
      data: null,
      error: 'الكلية المحددة غير صالحة.',
      statusCode: 400,
    };
  }
  const trimmed = passcode.trim();
  if (!trimmed) {
    return {
      success: false,
      data: null,
      error: 'يرجى إدخال رمز الدخول الأمني المخصص للكلية المختارة.',
      statusCode: 400,
    };
  }
  if (trimmed !== LOCAL_FALLBACK_DEMO_PASSCODE) {
    return {
      success: false,
      data: null,
      error: `رمز الدخول غير صحيح في الوضع المحلي. الرمز الافتراضي للتجربة هو (${LOCAL_FALLBACK_DEMO_PASSCODE}).`,
      statusCode: 401,
    };
  }

  inMemoryStaffToken = null;
  inMemoryLocalStaffFaculty = faculty;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  return {
    success: true,
    data: {
      token: '',
      faculty,
      expiresAt,
      localFallback: true,
    },
    error: null,
    statusCode: 200,
  };
}

function localGetReports(): ApiResponse<LostReport[]> {
  const all = readOfflineCache();
  if (inMemoryLocalStaffFaculty) {
    return {
      success: true,
      data: sortReports(all.filter((r) => r.faculty === inMemoryLocalStaffFaculty)),
      error: null,
      statusCode: 200,
    };
  }

  const myIds = new Set(readMyReportEntries().map((e) => e.id));
  if (myIds.size === 0) {
    return {
      success: true,
      data: [],
      error: null,
      statusCode: 200,
    };
  }

  return {
    success: true,
    data: sortReports(all.filter((r) => myIds.has(r.id))),
    error: null,
    statusCode: 200,
  };
}

function localGetReportByCode(rawCode: string): ApiResponse<LostReport> {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length > 32) {
    return {
      success: false,
      data: null,
      error: 'يرجى كتابة رقم بلاغ صالح مثل WS-101.',
      statusCode: 400,
    };
  }
  const found = readOfflineCache().find(
    (r) => r.reportCode.toUpperCase() === normalizedCode
  );
  if (!found) {
    return {
      success: false,
      data: null,
      error: `لا يوجد بلاغ مسجل برقم (${normalizedCode}) في التخزين المحلي.`,
      statusCode: 404,
    };
  }
  return {
    success: true,
    data: found,
    error: null,
    statusCode: 200,
  };
}

function localRegisterPushSubscription(
  subscription: PushSubscriptionPayload,
  reportIds: string[]
): ApiResponse<PushSubscriptionPayload> {
  if (reportIds.length > 0) {
    const idSet = new Set(reportIds);
    const reports = readOfflineCache();
    let changed = false;
    const next = reports.map((report) => {
      if (idSet.has(report.id)) {
        changed = true;
        return { ...report, pushSubscription: subscription };
      }
      return report;
    });
    if (changed) writeOfflineCache(next);
  }
  return {
    success: true,
    data: subscription,
    error: null,
    statusCode: 200,
  };
}

function localCreateReport(
  payload: CreateLostReportPayload,
  cleanPhone: string,
  pushSubscription: PushSubscriptionPayload | null
): ApiResponse<LostReport> {
  const faculty = String(payload.faculty || '').trim() as UniversityFaculty;
  const studentName = String(payload.studentName || '').trim();
  const itemName = String(payload.itemName || '').trim();
  const description = String(payload.description || '').trim();
  const locationType = payload.locationType;
  const roomOrLocation = String(payload.roomOrLocation || '').trim();
  const timePeriod = String(payload.timePeriod || '').trim();

  if (!UNIVERSITY_FACULTIES.includes(faculty)) {
    return {
      success: false,
      data: null,
      error: 'يرجى اختيار كلية صالحة من القائمة.',
      statusCode: 400,
    };
  }
  if (studentName.split(/\s+/).filter(Boolean).length < 3 || studentName.length > 120) {
    return {
      success: false,
      data: null,
      error: 'يرجى إدخال اسم الطالب الثلاثي (بحد أقصى 120 حرفاً) كما في البطاقة الجامعية.',
      statusCode: 400,
    };
  }
  if (!itemName || itemName.length > 120) {
    return {
      success: false,
      data: null,
      error: 'يرجى كتابة اسم الغرض المفقود (بحد أقصى 120 حرفاً).',
      statusCode: 400,
    };
  }
  if (!description || description.length > 1000) {
    return {
      success: false,
      data: null,
      error: 'يرجى إدخال المواصفات الدقيقة للمطابقة (بحد أقصى 1000 حرف).',
      statusCode: 400,
    };
  }
  if (!LOCATION_TYPES.includes(locationType)) {
    return {
      success: false,
      data: null,
      error: 'يرجى اختيار نوع مكان صالح.',
      statusCode: 400,
    };
  }
  if (!roomOrLocation || roomOrLocation.length > 160) {
    return {
      success: false,
      data: null,
      error: 'يرجى تحديد رقم القاعة أو تفاصيل المكان (بحد أقصى 160 حرفاً).',
      statusCode: 400,
    };
  }
  if (!timePeriod || timePeriod.length > 100) {
    return {
      success: false,
      data: null,
      error: 'يرجى تحديد الفترة الزمنية (بحد أقصى 100 حرف).',
      statusCode: 400,
    };
  }
  if (!isValidYemeniPhone(cleanPhone)) {
    return {
      success: false,
      data: null,
      error: 'يرجى إدخال رقم جوال يمني صحيح مكون من 9 أرقام يبدأ بـ 7 (مثل 77xxxxxxx).',
      statusCode: 400,
    };
  }

  const existing = readOfflineCache();
  const conflictReport = existing.find(
    (item) =>
      sanitizePhoneNumber(item.phoneNumber) === cleanPhone &&
      item.faculty !== faculty
  );
  if (conflictReport) {
    return {
      success: false,
      data: null,
      error: `عذراً، هذا الرقم مسجل مسبقاً في ${conflictReport.faculty} ولا يمكن رفع بلاغات في أكثر من كلية`,
      statusCode: 409,
    };
  }

  const nextSeq = allocateNextLocalSequence(existing);
  const newReport: LostReport = {
    id: `ws-${nextSeq}-${Date.now()}`,
    reportCode: `WS-${nextSeq}`,
    studentName,
    itemName,
    description,
    faculty,
    locationType,
    roomOrLocation,
    timePeriod,
    phoneNumber: cleanPhone,
    isUrgent: detectUrgentItem(itemName),
    status: 'pending',
    createdAt: new Date().toISOString(),
    pushSubscription,
    ownerToken: createLocalToken('local'),
  };

  writeOfflineCache([newReport, ...existing]);
  saveStudentProfile({
    studentFaculty: newReport.faculty,
    studentName: newReport.studentName,
    phoneNumber: newReport.phoneNumber,
  });

  return {
    success: true,
    data: newReport,
    error: null,
    statusCode: 201,
  };
}

function localUpdateReport(
  reportId: string,
  payload: UpdateLostReportPayload
): ApiResponse<LostReport> {
  const itemName = String(payload.itemName || '').trim();
  const description = String(payload.description || '').trim();
  const locationType = payload.locationType;
  const roomOrLocation = String(payload.roomOrLocation || '').trim();
  const timePeriod = String(payload.timePeriod || '').trim();

  if (!itemName || !description || !roomOrLocation || !timePeriod || !LOCATION_TYPES.includes(locationType)) {
    return {
      success: false,
      data: null,
      error: 'يرجى استكمال جميع بيانات البلاغ المطلوبة.',
      statusCode: 400,
    };
  }

  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }

  const target = reports[idx];
  if (target.status !== 'pending') {
    return {
      success: false,
      data: null,
      error: 'يمكن تعديل بيانات البلاغ فقط أثناء بقائه قيد المراجعة.',
      statusCode: 409,
    };
  }

  const updated: LostReport = {
    ...target,
    itemName,
    description,
    locationType,
    roomOrLocation,
    timePeriod,
    isUrgent: detectUrgentItem(itemName),
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localMarkAsMatched(reportId: string): ApiResponse<LostReport> {
  if (!inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'يرجى تسجيل الدخول لبوابة المكتب أولاً.',
      statusCode: 401,
    };
  }
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  if (target.faculty !== inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'لا يمكن تعديل بلاغ تابع لكلية أخرى.',
      statusCode: 403,
    };
  }
  if (target.status !== 'pending') {
    return {
      success: false,
      data: null,
      error: 'يمكن تأكيد العثور على الغرض للبلاغات التي لا تزال قيد المراجعة فقط.',
      statusCode: 409,
    };
  }

  const nowIso = new Date().toISOString();
  const updated: LostReport = {
    ...target,
    status: 'matched',
    matchedAt: nowIso,
    notification: {
      type: 'matched',
      message: `غرضك «${target.itemName}» (بلاغ ${target.reportCode}) موجود الآن في مكتب شؤون الطلاب بـ (${target.faculty}). يرجى إحضار البطاقة الجامعية ورقم البلاغ عند الاستلام.`,
      createdAt: nowIso,
      unread: true,
    },
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localResendPickupReminder(reportId: string): ApiResponse<LostReport> {
  if (!inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'يرجى تسجيل الدخول لبوابة المكتب أولاً.',
      statusCode: 401,
    };
  }
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  if (target.faculty !== inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'لا يمكن إرسال تذكير لبلاغ تابع لكلية أخرى.',
      statusCode: 403,
    };
  }
  if (target.status !== 'matched') {
    return {
      success: false,
      data: null,
      error: 'يُتاح إرسال تذكير الاستلام للبلاغات الموجودة بالمكتب فقط.',
      statusCode: 409,
    };
  }

  const nowIso = new Date().toISOString();
  const updated: LostReport = {
    ...target,
    notification: {
      type: 'matched',
      message: `تذكير بالاستلام: غرضك «${target.itemName}» (بلاغ ${target.reportCode}) لا يزال بانتظارك في مكتب شؤون الطلاب بـ (${target.faculty}). يرجى الحضور شخصياً وإبراز البطاقة الجامعية للاستلام.`,
      createdAt: nowIso,
      unread: true,
    },
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localNotifyNotFoundYet(reportId: string): ApiResponse<LostReport> {
  if (!inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'يرجى تسجيل الدخول لبوابة المكتب أولاً.',
      statusCode: 401,
    };
  }
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  if (target.faculty !== inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'لا يمكن تحديث بلاغ تابع لكلية أخرى.',
      statusCode: 403,
    };
  }
  if (target.status !== 'pending') {
    return {
      success: false,
      data: null,
      error: 'لا يمكن إرسال إشعار عدم العثور على الغرض بعد تأكيد وجوده أو إغلاقه.',
      statusCode: 409,
    };
  }

  const nowIso = new Date().toISOString();
  const updated: LostReport = {
    ...target,
    status: 'pending',
    notFoundNotified: true,
    lastCheckedAt: nowIso,
    notification: {
      type: 'not_found',
      message: NOT_FOUND_NOTIFICATION_MESSAGE,
      createdAt: nowIso,
      unread: true,
    },
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localMarkNotificationAsRead(reportId: string): ApiResponse<LostReport> {
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  const nowIso = new Date().toISOString();
  const updated: LostReport = {
    ...target,
    notification: target.notification
      ? {
          ...target.notification,
          unread: false,
          readAt: nowIso,
        }
      : {
          type: target.status === 'matched' ? 'matched' : 'not_found',
          message:
            target.status === 'matched'
              ? `غرضك «${target.itemName}» موجود بالمكتب. يرجى إحضار البطاقة الجامعية ورقم البلاغ عند الاستلام.`
              : NOT_FOUND_NOTIFICATION_MESSAGE,
          createdAt: target.matchedAt || target.lastCheckedAt || nowIso,
          unread: false,
          readAt: nowIso,
        },
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localConfirmDelivery(reportId: string): ApiResponse<LostReport> {
  if (!inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'يرجى تسجيل الدخول لبوابة المكتب أولاً.',
      statusCode: 401,
    };
  }
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  if (target.faculty !== inMemoryLocalStaffFaculty) {
    return {
      success: false,
      data: null,
      error: 'لا يمكن تسليم بلاغ تابع لكلية أخرى.',
      statusCode: 403,
    };
  }
  if (target.status !== 'matched') {
    return {
      success: false,
      data: null,
      error: 'يجب أولاً تأكيد العثور على الغرض بالمكتب قبل تسجيل التسليم النهائي.',
      statusCode: 409,
    };
  }

  const nowIso = new Date().toISOString();
  const updated: LostReport = {
    ...target,
    status: 'delivered',
    deliveredAt: nowIso,
    notification: target.notification
      ? {
          ...target.notification,
          unread: false,
          readAt: target.notification.readAt ?? nowIso,
        }
      : undefined,
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localCancelReport(reportId: string): ApiResponse<LostReport> {
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  if (target.status !== 'pending') {
    return {
      success: false,
      data: null,
      error:
        target.status === 'matched'
          ? 'لا يمكن سحب البلاغ بعد العثور على الغرض؛ يرجى الحضور شخصياً لمكتب شؤون الطلاب مع البطاقة الجامعية للاستلام.'
          : 'لا يمكن سحب هذا البلاغ في حالته الحالية.',
      statusCode: 409,
    };
  }

  const updated: LostReport = {
    ...target,
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  };
  reports[idx] = updated;
  writeOfflineCache(reports);
  return { success: true, data: updated, error: null, statusCode: 200 };
}

function localDeleteReport(
  reportId: string
): ApiResponse<{ deletedId: string }> {
  const reports = readOfflineCache();
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) {
    return {
      success: false,
      data: null,
      error: 'لم يتم العثور على البلاغ المطلوب.',
      statusCode: 404,
    };
  }
  const target = reports[idx];
  if (target.status !== 'cancelled' && target.status !== 'delivered') {
    return {
      success: false,
      data: null,
      error: 'لا يمكن حذف بلاغ نشط؛ يمكن حذف البلاغات المسحوبة أو المسلّمة فقط.',
      statusCode: 409,
    };
  }
  reports.splice(idx, 1);
  writeOfflineCache(reports);
  return {
    success: true,
    data: { deletedId: reportId },
    error: null,
    statusCode: 200,
  };
}

/**
 * طبقة الاتصال بالخادم مع الوضع الاحتياطي المحلي التلقائي (REST API + localStorage Fallback)
 */
export const apiService = {
  async getStaffAuthStatus(
    faculty: UniversityFaculty
  ): Promise<ApiResponse<StaffAuthStatus>> {
    return executeWithFallback<StaffAuthStatus>(
      () =>
        fetch(
          `${STAFF_API_BASE_URL}/status?faculty=${encodeURIComponent(faculty)}`
        ),
      'تعذر التحقق من حالة دخول الكلية.',
      () => localGetStaffAuthStatus(faculty)
    );
  },

  async setupStaffPasscode(
    faculty: UniversityFaculty,
    passcode: string
  ): Promise<ApiResponse<StaffSession>> {
    const result = await executeWithFallback<StaffSession>(
      () =>
        fetch(`${STAFF_API_BASE_URL}/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faculty, passcode }),
        }),
      'تعذر إعداد رمز دخول الكلية.',
      () => localStaffLogin(faculty, passcode)
    );
    if (result.success && result.data?.token) {
      inMemoryStaffToken = result.data.token;
      inMemoryLocalStaffFaculty = null;
    }
    return result;
  },

  async staffLogin(
    faculty: UniversityFaculty,
    passcode: string
  ): Promise<ApiResponse<StaffSession>> {
    const result = await executeWithFallback<StaffSession>(
      () =>
        fetch(`${STAFF_API_BASE_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faculty, passcode }),
        }),
      'تعذر تسجيل الدخول لبوابة المكتب.',
      () => localStaffLogin(faculty, passcode)
    );
    if (result.success && result.data?.token) {
      inMemoryStaffToken = result.data.token;
      inMemoryLocalStaffFaculty = null;
    }
    return result;
  },

  async getStaffSession(): Promise<
    ApiResponse<{ faculty: UniversityFaculty; expiresAt: string }>
  > {
    if (inMemoryLocalStaffFaculty) {
      return {
        success: true,
        data: {
          faculty: inMemoryLocalStaffFaculty,
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        },
        error: null,
        statusCode: 200,
      };
    }
    if (!inMemoryStaffToken) {
      return {
        success: false,
        data: null,
        error: 'لا توجد جلسة نشطة.',
        statusCode: 401,
      };
    }
    return executeWithFallback<{ faculty: UniversityFaculty; expiresAt: string }>(
      () =>
        fetch(`${STAFF_API_BASE_URL}/session`, {
          headers: buildAuthHeaders(),
        }),
      'انتهت جلسة الموظف.',
      () => ({
        success: false,
        data: null,
        error: 'لا توجد جلسة محلية نشطة.',
        statusCode: 401,
      })
    );
  },

  async staffLogout(): Promise<void> {
    const token = inMemoryStaffToken;
    inMemoryStaffToken = null;
    inMemoryLocalStaffFaculty = null;
    if (!token || localFallbackActive) return;
    try {
      await fetch(`${STAFF_API_BASE_URL}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // تجاهل
    }
  },

  async getReports(): Promise<ApiResponse<LostReport[]>> {
    const result = await executeWithFallback<LostReport[]>(
      () => {
        const myEntries = readMyReportEntries()
          .map((e) => ({
            id: toAsciiHeaderValue(e.id) || '',
            ownerToken: toAsciiHeaderValue(e.ownerToken) || '',
          }))
          .filter((e) => Boolean(e.id))
          .slice(0, 100);
        const headers = buildAuthHeaders(
          !inMemoryStaffToken && myEntries.length > 0
            ? { 'X-Wisal-My-Reports': JSON.stringify(myEntries) }
            : undefined
        );
        return fetch(API_BASE_URL, { headers });
      },
      'تعذر جلب البلاغات من الخادم.',
      () => localGetReports()
    );

    if (result.success && result.data) {
      if (!inMemoryStaffToken && !inMemoryLocalStaffFaculty && !localFallbackActive) {
        // الحفاظ على البلاغات المحلية الإضافية عند الاتصال بالخادم
        const existingLocal = readOfflineCache();
        const remoteById = new Map(result.data.map((r) => [r.id, r]));
        const merged = [
          ...result.data,
          ...existingLocal.filter((r) => !remoteById.has(r.id)),
        ];
        writeOfflineCache(merged);
      }
      return {
        ...result,
        data: sortReports(result.data),
      };
    }
    return result;
  },

  async getReportByCode(rawCode: string): Promise<ApiResponse<LostReport>> {
    const normalizedCode = rawCode.trim().toUpperCase();
    return executeWithFallback<LostReport>(
      () =>
        fetch(`${API_BASE_URL}/code/${encodeURIComponent(normalizedCode)}`, {
          headers: buildAuthHeaders(),
        }),
      'لم يتم العثور على بلاغ بهذا الرقم.',
      () => localGetReportByCode(normalizedCode)
    );
  },

  async registerPushSubscription(
    subscription: PushSubscriptionPayload,
    reportIds: string[] = []
  ): Promise<ApiResponse<PushSubscriptionPayload>> {
    savePushSubscriptionLocally(subscription);

    return executeWithFallback<PushSubscriptionPayload>(
      () => {
        const entryMap = new Map(
          readMyReportEntries().map((e) => [e.id, e.ownerToken || ''])
        );
        const reports = reportIds
          .map((id) => ({ id, ownerToken: entryMap.get(id) || '' }))
          .filter((r) => Boolean(r.ownerToken));

        return fetch(`${API_BASE_URL}/push-subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription, reports }),
        });
      },
      'تعذر حفظ اشتراك الإشعارات على الخادم.',
      () => localRegisterPushSubscription(subscription, reportIds)
    );
  },

  async createReport(
    payload: CreateLostReportPayload
  ): Promise<ApiResponse<LostReport>> {
    const cleanPhone = sanitizePhoneNumber(payload.phoneNumber);
    const pushSubscription =
      payload.pushSubscription ?? readSavedPushSubscription();

    const result = await executeWithFallback<LostReport>(
      () =>
        fetch(API_BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            phoneNumber: cleanPhone,
            pushSubscription,
          }),
        }),
      'تعذر حفظ البلاغ على الخادم.',
      () => localCreateReport(payload, cleanPhone, pushSubscription)
    );

    if (result.success && result.data) {
      saveStudentProfile({
        studentFaculty: result.data.faculty,
        studentName: result.data.studentName,
        phoneNumber: result.data.phoneNumber,
      });
      if (!localFallbackActive) {
        const existing = readOfflineCache();
        if (!existing.some((r) => r.id === result.data!.id)) {
          writeOfflineCache([result.data, ...existing]);
        }
      }
    }
    return result;
  },

  async updateReport(
    reportId: string,
    payload: UpdateLostReportPayload
  ): Promise<ApiResponse<LostReport>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    return executeWithFallback<LostReport>(
      () =>
        fetch(`${API_BASE_URL}/${encodeURIComponent(reportId)}`, {
          method: 'PATCH',
          headers: buildAuthHeaders({
            'Content-Type': 'application/json',
            ...(ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : {}),
          }),
          body: JSON.stringify(payload),
        }),
      'تعذر تحديث بيانات البلاغ.',
      () => localUpdateReport(reportId, payload)
    );
  },

  async markAsMatched(id: string): Promise<ApiResponse<LostReport>> {
    return executeWithFallback<LostReport>(
      () =>
        fetch(`${API_BASE_URL}/${encodeURIComponent(id)}/match`, {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        }),
      'تعذر تحديث حالة البلاغ.',
      () => localMarkAsMatched(id)
    );
  },

  async resendPickupReminder(
    reportId: string
  ): Promise<ApiResponse<LostReport>> {
    return executeWithFallback<LostReport>(
      () =>
        fetch(
          `${API_BASE_URL}/${encodeURIComponent(reportId)}/pickup-reminder`,
          {
            method: 'PATCH',
            headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          }
        ),
      'تعذر إرسال تذكير الاستلام.',
      () => localResendPickupReminder(reportId)
    );
  },

  async notifyNotFoundYet(reportId: string): Promise<ApiResponse<LostReport>> {
    return executeWithFallback<LostReport>(
      () =>
        fetch(
          `${API_BASE_URL}/${encodeURIComponent(reportId)}/notify-not-found`,
          {
            method: 'PATCH',
            headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          }
        ),
      'تعذر تسجيل إشعار عدم العثور على الغرض.',
      () => localNotifyNotFoundYet(reportId)
    );
  },

  async markNotificationAsRead(
    reportId: string
  ): Promise<ApiResponse<LostReport>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    return executeWithFallback<LostReport>(
      () =>
        fetch(
          `${API_BASE_URL}/${encodeURIComponent(reportId)}/notification-read`,
          {
            method: 'PATCH',
            headers: buildAuthHeaders({
              'Content-Type': 'application/json',
              ...(ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : {}),
            }),
          }
        ),
      'تعذر تحديث حالة قراءة الإشعار.',
      () => localMarkNotificationAsRead(reportId)
    );
  },

  async confirmDelivery(reportId: string): Promise<ApiResponse<LostReport>> {
    return executeWithFallback<LostReport>(
      () =>
        fetch(`${API_BASE_URL}/${encodeURIComponent(reportId)}/deliver`, {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ verifiedByUniversityId: true }),
        }),
      'تعذر تأكيد التسليم النهائي.',
      () => localConfirmDelivery(reportId)
    );
  },

  async cancelReport(reportId: string): Promise<ApiResponse<LostReport>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    return executeWithFallback<LostReport>(
      () =>
        fetch(`${API_BASE_URL}/${encodeURIComponent(reportId)}/cancel`, {
          method: 'PATCH',
          headers: buildAuthHeaders({
            'Content-Type': 'application/json',
            ...(ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : {}),
          }),
        }),
      'تعذر سحب البلاغ.',
      () => localCancelReport(reportId)
    );
  },

  async deleteReport(
    reportId: string
  ): Promise<ApiResponse<{ deletedId: string }>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    return executeWithFallback<{ deletedId: string }>(
      () =>
        fetch(`${API_BASE_URL}/${encodeURIComponent(reportId)}`, {
          method: 'DELETE',
          headers: buildAuthHeaders(
            ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : undefined
          ),
        }),
      'تعذر حذف البلاغ.',
      () => localDeleteReport(reportId)
    );
  },

  async clearAllReports(): Promise<ApiResponse<LostReport[]>> {
    try {
      localStorage.removeItem(OFFLINE_CACHE_KEY);
      localStorage.removeItem(LOCAL_SEQUENCE_KEY);
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
      }
      clearMyReportEntries();
      clearStudentProfile();
      return {
        success: true,
        data: [],
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر مسح البيانات المحفوظة محلياً.',
      };
    }
  },
};
