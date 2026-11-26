import {
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
 * استخدام المسارات النسبية يضمن التوافق المباشر مع Render وVercel والخادم الموحد.
 */
export const USE_REMOTE_API = true;
export const API_BASE_URL = '/api/reports';
export const STAFF_API_BASE_URL = '/api/staff';

/** الرقم الرسمي لمنصة «وصال الجامعي» */
export const OFFICIAL_WHATSAPP_NUMBER = '967734918671';
export const OFFICIAL_WHATSAPP_DISPLAY = '734918671';

const OFFLINE_CACHE_KEY = 'wisal_student_affairs_reports_v6';
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

// توكن جلسة الموظف يُحفظ في الذاكرة فقط (لا يُخزن في localStorage أو sessionStorage)
let inMemoryStaffToken: string | null = null;

export function clearInMemoryStaffToken(): void {
  inMemoryStaffToken = null;
}

export function hasInMemoryStaffToken(): boolean {
  return Boolean(inMemoryStaffToken);
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

async function parseJsonApiResponse<T>(
  response: Response,
  fallbackError: string
): Promise<ApiResponse<T>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      success: false,
      data: null,
      error:
        response.status === 404
          ? 'خدمة الخادم الخلفي غير متوفرة على هذا النطاق.'
          : fallbackError,
      statusCode: response.status,
    };
  }

  let parsed: ApiResponse<T>;
  try {
    parsed = (await response.json()) as ApiResponse<T>;
  } catch {
    return {
      success: false,
      data: null,
      error: fallbackError,
      statusCode: response.status,
    };
  }

  if (response.status === 401) {
    inMemoryStaffToken = null;
  }

  if (!response.ok || !parsed.success) {
    return {
      success: false,
      data: null,
      error: parsed.error || fallbackError,
      statusCode: response.status,
    };
  }

  return {
    ...parsed,
    statusCode: response.status,
  };
}

/**
 * طبقة الاتصال بالخادم (REST API Service Layer)
 */
export const apiService = {
  async getStaffAuthStatus(
    faculty: UniversityFaculty
  ): Promise<ApiResponse<StaffAuthStatus>> {
    try {
      const response = await fetch(
        `${STAFF_API_BASE_URL}/status?faculty=${encodeURIComponent(faculty)}`
      );
      return await parseJsonApiResponse<StaffAuthStatus>(
        response,
        'تعذر التحقق من حالة دخول الكلية.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم للتحقق من حالة الكلية.',
      };
    }
  },

  async setupStaffPasscode(
    faculty: UniversityFaculty,
    passcode: string
  ): Promise<ApiResponse<StaffSession>> {
    try {
      const response = await fetch(`${STAFF_API_BASE_URL}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faculty, passcode }),
      });
      const result = await parseJsonApiResponse<StaffSession>(
        response,
        'تعذر إعداد رمز دخول الكلية.'
      );
      if (result.success && result.data?.token) {
        inMemoryStaffToken = result.data.token;
      }
      return result;
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء إعداد رمز الكلية.',
      };
    }
  },

  async staffLogin(
    faculty: UniversityFaculty,
    passcode: string
  ): Promise<ApiResponse<StaffSession>> {
    try {
      const response = await fetch(`${STAFF_API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faculty, passcode }),
      });
      const result = await parseJsonApiResponse<StaffSession>(
        response,
        'تعذر تسجيل الدخول لبوابة المكتب.'
      );
      if (result.success && result.data?.token) {
        inMemoryStaffToken = result.data.token;
      }
      return result;
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء تسجيل الدخول.',
      };
    }
  },

  async getStaffSession(): Promise<
    ApiResponse<{ faculty: UniversityFaculty; expiresAt: string }>
  > {
    if (!inMemoryStaffToken) {
      return {
        success: false,
        data: null,
        error: 'لا توجد جلسة نشطة.',
        statusCode: 401,
      };
    }
    try {
      const response = await fetch(`${STAFF_API_BASE_URL}/session`, {
        headers: buildAuthHeaders(),
      });
      return await parseJsonApiResponse<{
        faculty: UniversityFaculty;
        expiresAt: string;
      }>(response, 'انتهت جلسة الموظف.');
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر التحقق من الجلسة.',
      };
    }
  },

  async staffLogout(): Promise<void> {
    const token = inMemoryStaffToken;
    inMemoryStaffToken = null;
    if (!token) return;
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
    if (!USE_REMOTE_API) {
      return {
        success: true,
        data: sortReports(readOfflineCache()),
        error: null,
      };
    }

    try {
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

      const response = await fetch(API_BASE_URL, { headers });
      const result = await parseJsonApiResponse<LostReport[]>(
        response,
        'تعذر جلب البلاغات من الخادم.'
      );
      if (result.success && result.data) {
        if (!inMemoryStaffToken) {
          writeOfflineCache(result.data);
        }
        return {
          ...result,
          data: sortReports(result.data),
        };
      }
      return result;
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return {
          success: true,
          data: sortReports(readOfflineCache()),
          error: null,
        };
      }
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم، يرجى المحاولة مجدداً.',
      };
    }
  },

  async getReportByCode(rawCode: string): Promise<ApiResponse<LostReport>> {
    const normalizedCode = rawCode.trim().toUpperCase();
    try {
      const response = await fetch(
        `${API_BASE_URL}/code/${encodeURIComponent(normalizedCode)}`,
        {
          headers: buildAuthHeaders(),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'لم يتم العثور على بلاغ بهذا الرقم.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر البحث عن البلاغ من الخادم.',
      };
    }
  },

  async registerPushSubscription(
    subscription: PushSubscriptionPayload,
    reportIds: string[] = []
  ): Promise<ApiResponse<PushSubscriptionPayload>> {
    savePushSubscriptionLocally(subscription);

    try {
      const entryMap = new Map(
        readMyReportEntries().map((e) => [e.id, e.ownerToken || ''])
      );
      const reports = reportIds
        .map((id) => ({ id, ownerToken: entryMap.get(id) || '' }))
        .filter((r) => Boolean(r.ownerToken));

      const response = await fetch(`${API_BASE_URL}/push-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, reports }),
      });
      return await parseJsonApiResponse<PushSubscriptionPayload>(
        response,
        'تعذر حفظ اشتراك الإشعارات على الخادم.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم لتسجيل اشتراك الإشعارات.',
      };
    }
  },

  async createReport(
    payload: CreateLostReportPayload
  ): Promise<ApiResponse<LostReport>> {
    const cleanPhone = sanitizePhoneNumber(payload.phoneNumber);
    const pushSubscription =
      payload.pushSubscription ?? readSavedPushSubscription();

    try {
      const response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          phoneNumber: cleanPhone,
          pushSubscription,
        }),
      });
      const result = await parseJsonApiResponse<LostReport>(
        response,
        'تعذر حفظ البلاغ على الخادم.'
      );
      if (result.success && result.data) {
        saveStudentProfile({
          studentFaculty: result.data.faculty,
          studentName: result.data.studentName,
          phoneNumber: result.data.phoneNumber,
        });
      }
      return result;
    } catch {
      return {
        success: false,
        data: null,
        error: 'فشل الاتصال بالخادم أثناء إرسال البلاغ.',
      };
    }
  },

  async updateReport(
    reportId: string,
    payload: UpdateLostReportPayload
  ): Promise<ApiResponse<LostReport>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({
            'Content-Type': 'application/json',
            ...(ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : {}),
          }),
          body: JSON.stringify(payload),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر تحديث بيانات البلاغ.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء تعديل البلاغ.',
      };
    }
  },

  async markAsMatched(id: string): Promise<ApiResponse<LostReport>> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(id)}/match`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر تحديث حالة البلاغ.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء تحديث الحالة.',
      };
    }
  },

  async resendPickupReminder(
    reportId: string
  ): Promise<ApiResponse<LostReport>> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}/pickup-reminder`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر إرسال تذكير الاستلام.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء إرسال تذكير الاستلام.',
      };
    }
  },

  async notifyNotFoundYet(reportId: string): Promise<ApiResponse<LostReport>> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}/notify-not-found`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر تسجيل إشعار عدم العثور على الغرض.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء تسجيل الإشعار.',
      };
    }
  },

  async markNotificationAsRead(
    reportId: string
  ): Promise<ApiResponse<LostReport>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}/notification-read`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({
            'Content-Type': 'application/json',
            ...(ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : {}),
          }),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر تحديث حالة قراءة الإشعار.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم لتحديث الإشعار.',
      };
    }
  },

  async confirmDelivery(reportId: string): Promise<ApiResponse<LostReport>> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}/deliver`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ verifiedByUniversityId: true }),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر تأكيد التسليم النهائي.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء تأكيد التسليم.',
      };
    }
  },

  async cancelReport(reportId: string): Promise<ApiResponse<LostReport>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}/cancel`,
        {
          method: 'PATCH',
          headers: buildAuthHeaders({
            'Content-Type': 'application/json',
            ...(ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : {}),
          }),
        }
      );
      return await parseJsonApiResponse<LostReport>(
        response,
        'تعذر سحب البلاغ.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء سحب البلاغ.',
      };
    }
  },

  async deleteReport(
    reportId: string
  ): Promise<ApiResponse<{ deletedId: string }>> {
    const ownerToken = getOwnerTokenForReport(reportId);
    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(reportId)}`,
        {
          method: 'DELETE',
          headers: buildAuthHeaders(
            ownerToken ? { 'X-Wisal-Owner-Token': ownerToken } : undefined
          ),
        }
      );
      return await parseJsonApiResponse<{ deletedId: string }>(
        response,
        'تعذر حذف البلاغ.'
      );
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر الاتصال بالخادم أثناء حذف البلاغ.',
      };
    }
  },

  async clearAllReports(): Promise<ApiResponse<LostReport[]>> {
    try {
      localStorage.removeItem(OFFLINE_CACHE_KEY);
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
