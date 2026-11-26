const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UNIVERSITY_FACULTIES = [
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
];

const LOCATION_TYPES = [
  'قاعة / مدرج دراسي',
  'معمل / مختبر',
  'مكتبة',
  'ساحة / مصلى',
  'كافتيريا / استراحة',
  'أخرى',
];

const VALID_STATUSES = ['pending', 'matched', 'delivered', 'cancelled'];

const STATUS_PRIORITY = {
  matched: 0,
  pending: 1,
  delivered: 2,
  cancelled: 3,
};

const NOT_FOUND_NOTIFICATION_MESSAGE =
  'تحديث من مكتب شؤون الطلاب: لم يتم العثور على غرضك لحد الآن، وسيتم إبقاء البلاغ نشطاً ومتاحاً، وفي حال العثور عليه سيتم التواصل معك عبر رقم الواتساب الذي أرفقته.';

function normalizeArabicText(text) {
  return String(text || '')
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

function detectUrgentItem(itemTitle) {
  const normalized = normalizeArabicText(itemTitle);
  if (!normalized) return false;
  return URGENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function sanitizePhoneNumber(rawPhone) {
  const normalizedDigits = String(rawPhone || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\d]/g, '');

  const digits = normalizedDigits.startsWith('00')
    ? normalizedDigits.slice(2)
    : normalizedDigits;

  if (/^7\d{8}$/.test(digits)) {
    return `967${digits}`;
  }
  if (/^07\d{8}$/.test(digits)) {
    return `967${digits.slice(1)}`;
  }
  if (/^9677\d{8}$/.test(digits)) {
    return digits;
  }
  return digits;
}

function isValidYemeniPhone(rawPhone) {
  return /^9677\d{8}$/.test(sanitizePhoneNumber(rawPhone));
}

function hashOwnerToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function verifyOwnerToken(report, providedToken) {
  if (!report || !report.ownerTokenHash || typeof providedToken !== 'string') {
    return false;
  }
  const trimmed = providedToken.trim();
  if (!trimmed) return false;
  const candidateHash = hashOwnerToken(trimmed);
  const expectedBuf = Buffer.from(report.ownerTokenHash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  if (expectedBuf.length !== candidateBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, candidateBuf);
}

function sortReports(reports) {
  return [...reports].sort((a, b) => {
    const priorityDiff =
      (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    const urgentA = a.isUrgent || detectUrgentItem(a.itemName) ? 1 : 0;
    const urgentB = b.isUrgent || detectUrgentItem(b.itemName) ? 1 : 0;
    if (urgentB !== urgentA) return urgentB - urgentA;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function resolveDataFilePath() {
  const custom = process.env.DATA_FILE_PATH;
  if (typeof custom === 'string' && custom.trim()) {
    return path.resolve(custom.trim());
  }
  return path.resolve(__dirname, '..', 'data', 'wisal-data.json');
}

function extractReportSequence(reportCode) {
  const match = String(reportCode || '').match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 100;
}

function isValidStoredReport(r) {
  return (
    r &&
    typeof r === 'object' &&
    typeof r.id === 'string' &&
    r.id.trim() !== '' &&
    typeof r.reportCode === 'string' &&
    r.reportCode.trim() !== '' &&
    typeof r.studentName === 'string' &&
    typeof r.itemName === 'string' &&
    typeof r.description === 'string' &&
    UNIVERSITY_FACULTIES.includes(r.faculty) &&
    LOCATION_TYPES.includes(r.locationType) &&
    typeof r.roomOrLocation === 'string' &&
    typeof r.timePeriod === 'string' &&
    typeof r.phoneNumber === 'string' &&
    VALID_STATUSES.includes(r.status) &&
    typeof r.createdAt === 'string'
  );
}

function normalizeStoreShape(parsed) {
  const rawReports = Array.isArray(parsed?.reports) ? parsed.reports : [];
  const reports = rawReports.filter(isValidStoredReport).map((r) => ({
    ...r,
    isUrgent: Boolean(r.isUrgent) || detectUrgentItem(r.itemName),
  }));

  const maxExistingSeq = reports.reduce((max, r) => {
    const seq = extractReportSequence(r.reportCode);
    return seq > max ? seq : max;
  }, 100);

  const storedNextSeq =
    typeof parsed?.nextSequence === 'number' && Number.isFinite(parsed.nextSequence)
      ? parsed.nextSequence
      : 100;

  const staffCredentials = {};
  if (parsed?.staffCredentials && typeof parsed.staffCredentials === 'object') {
    for (const faculty of UNIVERSITY_FACULTIES) {
      const cred = parsed.staffCredentials[faculty];
      if (
        cred &&
        typeof cred.salt === 'string' &&
        typeof cred.hash === 'string'
      ) {
        staffCredentials[faculty] = {
          salt: cred.salt,
          hash: cred.hash,
          updatedAt:
            typeof cred.updatedAt === 'string'
              ? cred.updatedAt
              : new Date().toISOString(),
        };
      }
    }
  }

  return {
    nextSequence: Math.max(100, storedNextSeq, maxExistingSeq),
    reports,
    staffCredentials,
  };
}

let writeQueue = Promise.resolve();

function loadStoreFromDisk() {
  const filePath = resolveDataFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return {
        nextSequence: 100,
        reports: [],
        staffCredentials: {},
      };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return {
        nextSequence: 100,
        reports: [],
        staffCredentials: {},
      };
    }
    return normalizeStoreShape(JSON.parse(raw));
  } catch {
    return {
      nextSequence: 100,
      reports: [],
      staffCredentials: {},
    };
  }
}

function persistStoreToDisk(store) {
  const filePath = resolveDataFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const suffix = crypto.randomBytes(4).toString('hex');
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${suffix}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function withStoreLock(mutator) {
  const next = writeQueue.then(async () => {
    const store = loadStoreFromDisk();
    const result = await mutator(store, persistStoreToDisk);
    return result;
  });
  writeQueue = next.catch(() => {});
  return next;
}

function toPublicReport(report) {
  return {
    id: report.id,
    reportCode: report.reportCode,
    studentName: '',
    itemName: report.itemName,
    description: '',
    faculty: report.faculty,
    locationType: report.locationType,
    roomOrLocation: report.roomOrLocation,
    timePeriod: report.timePeriod,
    phoneNumber: '',
    isUrgent: Boolean(report.isUrgent) || detectUrgentItem(report.itemName),
    status: report.status,
    createdAt: report.createdAt,
    matchedAt: report.matchedAt,
    deliveredAt: report.deliveredAt,
    cancelledAt: report.cancelledAt,
    notFoundNotified: report.notFoundNotified,
    lastCheckedAt: report.lastCheckedAt,
    notification: report.notification,
  };
}

function toStudentOwnedReport(report) {
  const { ownerTokenHash: _omitHash, pushSubscription: _omitSub, ...rest } =
    report;
  return rest;
}

function toStaffReport(report) {
  const { ownerTokenHash: _omitHash, ...rest } = report;
  return rest;
}

module.exports = {
  UNIVERSITY_FACULTIES,
  LOCATION_TYPES,
  NOT_FOUND_NOTIFICATION_MESSAGE,
  normalizeArabicText,
  detectUrgentItem,
  sanitizePhoneNumber,
  isValidYemeniPhone,
  hashOwnerToken,
  verifyOwnerToken,
  sortReports,
  loadStoreFromDisk,
  withStoreLock,
  toPublicReport,
  toStudentOwnedReport,
  toStaffReport,
};
