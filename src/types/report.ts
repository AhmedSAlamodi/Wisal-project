export type LostReportStatus = 'pending' | 'matched' | 'delivered' | 'cancelled';

export type AppMode = 'student' | 'staff';

export type StudentTab = 'report' | 'my-reports';

export const LOCATION_TYPES = [
  'قاعة / مدرج دراسي',
  'معمل / مختبر',
  'مكتبة',
  'ساحة / مصلى',
  'كافتيريا / استراحة',
  'أخرى',
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

export const TIME_PERIOD_PRESETS = [
  'اليوم صباحاً',
  'اليوم ظهراً/عصراً',
  'أمس',
  'خلال آخر 3 أيام',
] as const;

export const UNIVERSITY_FACULTIES = [
  'كلية الطب والعلوم الصحية',
  'كلية الهندسة والبترول',
  'كلية الحاسبات وتقنية المعلومات',
  'كلية العلوم',
  'كلية العلوم الإدارية',
  'كلية العلوم البيئية والأحياء البحرية',
  'كلية التمريض',
  'كلية الآداب',
  'كلية القانون',
  'كلية البنات',
  'كلية التربية – المكلا',
] as const;

export type UniversityFaculty = (typeof UNIVERSITY_FACULTIES)[number];

export type ReportNotificationType = 'matched' | 'not_found';

export interface ReportNotification {
  type?: ReportNotificationType;
  message: string;
  createdAt: string;
  unread: boolean;
  readAt?: string;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export interface LostReport {
  id: string;
  reportCode: string; // مثال: WS-101
  studentName: string; // سري: اسم الطالب الثلاثي (كما في البطاقة الجامعية) يظهر للموظف فقط
  itemName: string;
  description: string; // سري: يظهر لموظف شؤون الطلاب فقط
  faculty: UniversityFaculty;
  locationType: LocationType;
  roomOrLocation: string;
  timePeriod: string;
  phoneNumber: string; // سري: يظهر لموظف شؤون الطلاب فقط
  isUrgent?: boolean; // تصنيف تلقائي للأغراض الهامة (وثائق، أجهزة، أموال...)
  status: LostReportStatus;
  createdAt: string;
  matchedAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  notFoundNotified?: boolean;
  lastCheckedAt?: string;
  notification?: ReportNotification;
  pushSubscription?: PushSubscriptionPayload | null;
}

export interface CreateLostReportPayload {
  faculty: UniversityFaculty;
  studentName: string;
  itemName: string;
  description: string;
  locationType: LocationType;
  roomOrLocation: string;
  timePeriod: string;
  phoneNumber: string;
  pushSubscription?: PushSubscriptionPayload | null;
}

export interface MyReportEntry {
  id: string;
  ownedInBrowser: boolean; // true إذا أُنشئ من هذا المتصفح، false إذا استُعيد برقم البلاغ فقط
}

export interface StudentProfile {
  studentFaculty: UniversityFaculty;
  studentName: string;
  phoneNumber: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}
