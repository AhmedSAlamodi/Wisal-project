import {
  UNIVERSITY_FACULTIES,
  type ApiResponse,
  type CreateLostReportPayload,
  type LostReport,
  type LostReportStatus,
  type MyReportEntry,
  type PushSubscriptionPayload,
  type StudentProfile,
  type UniversityFaculty,
} from '../types/report';
import {
  readSavedPushSubscription,
  savePushSubscriptionLocally,
  showServiceWorkerNotification,
} from './pwaService';

/**
 * إعدادات الاتصال بالخادم (API Configuration)
 * عند تجهيز خادم Node.js / Express، غيّر القيمة إلى true للتبديل التلقائي إلى طلبات fetch.
 */
export const USE_REMOTE_API = false;
export const API_BASE_URL = 'http://localhost:5000/api/reports';

/** الرقم الرسمي لمنصة «وصال الجامعي» */
export const OFFICIAL_WHATSAPP_NUMBER = '967734918671';
export const OFFICIAL_WHATSAPP_DISPLAY = '734918671';

/**
 * رموز الدخول الأمنية المخصصة لمكاتب شؤون الطلاب في الكليات الـ 11
 */
export const COLLEGE_ACCESS_CODES: Record<UniversityFaculty, string> = {
  'كلية الطب والعلوم الصحية': 'MED@HU#2026!91',
  'كلية الهندسة والبترول': 'ENG@PET#26!84',
  'كلية الحاسبات وتقنية المعلومات': 'CIT@HU#2026!77',
  'كلية العلوم': 'SCI@HU#2026!63',
  'كلية العلوم الإدارية': 'ADM@HU#2026!58',
  'كلية العلوم البيئية والأحياء البحرية': 'ENV@MAR#26!49',
  'كلية التمريض': 'NUR@HU#2026!35',
  'كلية الآداب': 'ART@HU#2026!29',
  'كلية القانون': 'LAW@HU#2026!16',
  'كلية البنات': 'GIR@HU#2026!94',
  'كلية التربية – المكلا': 'EDU@MKL#26!82',
};

export function verifyStaffAccess(
  college: UniversityFaculty,
  accessCode: string
): boolean {
  const expected = COLLEGE_ACCESS_CODES[college];
  if (!expected) return false;
  return accessCode.trim() === expected;
}

const STORAGE_KEY = 'wisal_student_affairs_reports_v6';
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
const SIMULATED_NETWORK_DELAY_MS = 300;

function simulateNetworkDelay(ms = SIMULATED_NETWORK_DELAY_MS): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
    const hasLegacy = LEGACY_STORAGE_KEYS.some(
      (key) => localStorage.getItem(key) !== null
    );
    if (hasLegacy) {
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
      }
      localStorage.removeItem(MY_REPORTS_STORAGE_KEY);
    }
  } catch {
    // تجاهل
  }
}

function readStorage(): LostReport[] {
  migrateLegacyStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const validFaculties = new Set<string>(UNIVERSITY_FACULTIES);
    return (parsed as LostReport[])
      .filter((r) => validFaculties.has(r.faculty))
      .map((r) => ({
        ...r,
        isUrgent: Boolean(r.isUrgent) || detectUrgentItem(r.itemName),
      }));
  } catch {
    return [];
  }
}

function writeStorage(reports: LostReport[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
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

function extractReportSequence(reportCode: string): number {
  const match = reportCode.match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 100;
}

/**
 * طبقة إدارة البيانات غير المتزامنة (Async Service Layer)
 * جاهزة للاستبدال المباشر باستدعاءات fetch لـ Node.js/Express REST API.
 */
export const apiService = {
  async getReports(): Promise<ApiResponse<LostReport[]>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(API_BASE_URL);
        if (!response.ok) {
          return {
            success: false,
            data: null,
            error: 'تعذر جلب البلاغات من الخادم.',
          };
        }
        return (await response.json()) as ApiResponse<LostReport[]>;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم، يرجى التحقق من تشغيل خادم API.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const reports = sortReports(readStorage());
      return {
        success: true,
        data: reports,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'حدث خطأ أثناء تحميل البلاغات.',
      };
    }
  },

  async getReportByCode(
    rawCode: string
  ): Promise<ApiResponse<LostReport>> {
    const normalizedCode = rawCode.trim().toUpperCase();

    if (USE_REMOTE_API) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/code/${encodeURIComponent(normalizedCode)}`
        );
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'لم يتم العثور على بلاغ بهذا الرقم.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر البحث عن البلاغ من الخادم.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const reports = readStorage();
      const found = reports.find(
        (r) => r.reportCode.toUpperCase() === normalizedCode
      );
      if (!found) {
        return {
          success: false,
          data: null,
          error: `لا يوجد بلاغ مسجل برقم (${normalizedCode}). تأكد من كتابة الرقم مثل WS-101.`,
        };
      }
      return {
        success: true,
        data: found,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'حدث خطأ أثناء البحث عن رقم البلاغ.',
      };
    }
  },

  async registerPushSubscription(
    subscription: PushSubscriptionPayload,
    reportIds: string[] = []
  ): Promise<ApiResponse<PushSubscriptionPayload>> {
    savePushSubscriptionLocally(subscription);

    if (USE_REMOTE_API) {
      try {
        const response = await fetch(`${API_BASE_URL}/push-subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription, reportIds }),
        });
        const result =
          (await response.json()) as ApiResponse<PushSubscriptionPayload>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر حفظ اشتراك الإشعارات على الخادم.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم لتسجيل اشتراك الإشعارات.',
        };
      }
    }

    // ربط الاشتراك بالبلاغات المحلية النشطة للطالب لتكون جاهزة للمزامنة مع الخادم
    if (reportIds.length > 0) {
      try {
        const existing = readStorage();
        const idSet = new Set(reportIds);
        const updated = existing.map((report) =>
          idSet.has(report.id)
            ? { ...report, pushSubscription: subscription }
            : report
        );
        writeStorage(updated);
      } catch {
        // تجاهل
      }
    }

    return {
      success: true,
      data: subscription,
      error: null,
    };
  },

  async createReport(
    payload: CreateLostReportPayload
  ): Promise<ApiResponse<LostReport>> {
    const cleanPhone = sanitizePhoneNumber(payload.phoneNumber);
    const isUrgent = detectUrgentItem(payload.itemName);
    const pushSubscription =
      payload.pushSubscription ?? readSavedPushSubscription();

    if (USE_REMOTE_API) {
      try {
        const response = await fetch(API_BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            phoneNumber: cleanPhone,
            isUrgent,
            pushSubscription,
          }),
        });
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر حفظ البلاغ على الخادم.',
          };
        }
        if (result.data) {
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
    }

    await simulateNetworkDelay();
    try {
      const existing = readStorage();
      const conflictReport = existing.find(
        (item) =>
          sanitizePhoneNumber(item.phoneNumber) === cleanPhone &&
          item.faculty !== payload.faculty
      );
      if (conflictReport) {
        return {
          success: false,
          data: null,
          error: `عذراً، هذا الرقم مسجل مسبقاً في ${conflictReport.faculty} ولا يمكن رفع بلاغات في أكثر من كلية`,
        };
      }

      const maxSeq = existing.reduce((max, item) => {
        const seq = extractReportSequence(item.reportCode);
        return seq > max ? seq : max;
      }, 100);

      const nextSeq = maxSeq + 1;
      const reportCode = `WS-${nextSeq}`;
      const newReport: LostReport = {
        id: `ws-${nextSeq}-${Date.now()}`,
        reportCode,
        studentName: payload.studentName.trim(),
        itemName: payload.itemName.trim(),
        description: payload.description.trim(),
        faculty: payload.faculty,
        locationType: payload.locationType,
        roomOrLocation: payload.roomOrLocation.trim(),
        timePeriod: payload.timePeriod.trim(),
        phoneNumber: cleanPhone,
        isUrgent,
        status: 'pending',
        createdAt: new Date().toISOString(),
        pushSubscription,
      };

      const updated = [newReport, ...existing];
      writeStorage(updated);
      saveStudentProfile({
        studentFaculty: newReport.faculty,
        studentName: newReport.studentName,
        phoneNumber: newReport.phoneNumber,
      });

      return {
        success: true,
        data: newReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر حفظ البلاغ في التخزين المحلي.',
      };
    }
  },

  async markAsMatched(id: string): Promise<ApiResponse<LostReport>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(`${API_BASE_URL}/${id}/match`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        });
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر تحديث حالة البلاغ.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم أثناء تحديث الحالة.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const existing = readStorage();
      const index = existing.findIndex((r) => r.id === id);

      if (index === -1) {
        return {
          success: false,
          data: null,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }

      const target = existing[index];
      if (target.status !== 'pending') {
        return {
          success: false,
          data: null,
          error: 'يمكن تأكيد العثور على الغرض للبلاغات التي لا تزال قيد المراجعة فقط.',
        };
      }

      const nowIso = new Date().toISOString();
      const updatedReport: LostReport = {
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

      const updated = [...existing];
      updated[index] = updatedReport;
      writeStorage(updated);

      return {
        success: true,
        data: updatedReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر تحديث حالة البلاغ إلى موجود بالمكتب.',
      };
    }
  },

  async resendPickupReminder(
    reportId: string
  ): Promise<ApiResponse<LostReport>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/${reportId}/pickup-reminder`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر إرسال تذكير الاستلام.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم أثناء إرسال تذكير الاستلام.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const existing = readStorage();
      const index = existing.findIndex((r) => r.id === reportId);
      if (index === -1) {
        return {
          success: false,
          data: null,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }

      const target = existing[index];
      if (target.status !== 'matched') {
        return {
          success: false,
          data: null,
          error: 'يُتاح إرسال تذكير الاستلام للبلاغات الموجودة بالمكتب فقط.',
        };
      }

      const nowIso = new Date().toISOString();
      const updatedReport: LostReport = {
        ...target,
        notification: {
          type: 'matched',
          message: `تذكير بالاستلام: غرضك «${target.itemName}» (بلاغ ${target.reportCode}) لا يزال بانتظارك في مكتب شؤون الطلاب بـ (${target.faculty}). يرجى الحضور شخصياً وإبراز البطاقة الجامعية للاستلام.`,
          createdAt: nowIso,
          unread: true,
        },
      };

      const updated = [...existing];
      updated[index] = updatedReport;
      writeStorage(updated);

      return {
        success: true,
        data: updatedReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر حفظ تذكير الاستلام.',
      };
    }
  },

  async notifyNotFoundYet(reportId: string): Promise<ApiResponse<LostReport>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/${reportId}/notify-not-found`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر تسجيل إشعار عدم العثور على الغرض.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم أثناء تسجيل الإشعار.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const existing = readStorage();
      const index = existing.findIndex((r) => r.id === reportId);
      if (index === -1) {
        return {
          success: false,
          data: null,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }

      const target = existing[index];
      if (target.status !== 'pending') {
        return {
          success: false,
          data: null,
          error: 'لا يمكن إرسال إشعار عدم العثور على الغرض بعد تأكيد وجوده أو إغلاقه.',
        };
      }

      const nowIso = new Date().toISOString();
      const updatedReport: LostReport = {
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

      const updated = [...existing];
      updated[index] = updatedReport;
      writeStorage(updated);

      return {
        success: true,
        data: updatedReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر حفظ إشعار مراجعة البلاغ.',
      };
    }
  },

  async markNotificationAsRead(
    reportId: string
  ): Promise<ApiResponse<LostReport>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/${reportId}/notification-read`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر تحديث حالة قراءة الإشعار.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم لتحديث الإشعار.',
        };
      }
    }

    try {
      const existing = readStorage();
      const index = existing.findIndex((r) => r.id === reportId);
      if (index === -1) {
        return {
          success: false,
          data: null,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }

      const target = existing[index];
      const nowIso = new Date().toISOString();
      const updatedReport: LostReport = {
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

      const updated = [...existing];
      updated[index] = updatedReport;
      writeStorage(updated);

      return {
        success: true,
        data: updatedReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'تعذر حفظ حالة قراءة التنبيه.',
      };
    }
  },

  async confirmDelivery(reportId: string): Promise<ApiResponse<LostReport>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(`${API_BASE_URL}/${reportId}/deliver`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verifiedByUniversityId: true }),
        });
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر تأكيد التسليم النهائي.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم أثناء تأكيد التسليم.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const existing = readStorage();
      const index = existing.findIndex((r) => r.id === reportId);

      if (index === -1) {
        return {
          success: false,
          data: null,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }

      const target = existing[index];
      if (target.status !== 'matched') {
        return {
          success: false,
          data: null,
          error: 'يجب أولاً تأكيد العثور على الغرض بالمكتب قبل تسجيل التسليم النهائي.',
        };
      }

      const nowIso = new Date().toISOString();
      const updatedReport: LostReport = {
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

      const updated = [...existing];
      updated[index] = updatedReport;
      writeStorage(updated);

      return {
        success: true,
        data: updatedReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'حدث خطأ أثناء تأكيد تسليم الغرض.',
      };
    }
  },

  async cancelReport(reportId: string): Promise<ApiResponse<LostReport>> {
    if (USE_REMOTE_API) {
      try {
        const response = await fetch(`${API_BASE_URL}/${reportId}/cancel`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        });
        const result = (await response.json()) as ApiResponse<LostReport>;
        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null,
            error: result.error || 'تعذر سحب البلاغ.',
          };
        }
        return result;
      } catch {
        return {
          success: false,
          data: null,
          error: 'تعذر الاتصال بالخادم أثناء سحب البلاغ.',
        };
      }
    }

    await simulateNetworkDelay();
    try {
      const existing = readStorage();
      const index = existing.findIndex((r) => r.id === reportId);

      if (index === -1) {
        return {
          success: false,
          data: null,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }

      const target = existing[index];
      if (target.status !== 'pending') {
        return {
          success: false,
          data: null,
          error:
            target.status === 'matched'
              ? 'لا يمكن سحب البلاغ بعد العثور على الغرض؛ يرجى الحضور شخصياً لمكتب شؤون الطلاب مع البطاقة الجامعية للاستلام.'
              : 'لا يمكن سحب هذا البلاغ في حالته الحالية.',
        };
      }

      const updatedReport: LostReport = {
        ...target,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      };

      const updated = [...existing];
      updated[index] = updatedReport;
      writeStorage(updated);

      return {
        success: true,
        data: updatedReport,
        error: null,
      };
    } catch {
      return {
        success: false,
        data: null,
        error: 'حدث خطأ أثناء سحب البلاغ.',
      };
    }
  },

  async clearAllReports(): Promise<ApiResponse<LostReport[]>> {
    if (USE_REMOTE_API) {
      return this.getReports();
    }

    await simulateNetworkDelay();
    try {
      localStorage.removeItem(STORAGE_KEY);
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
