try {
  require('dotenv').config();
} catch {
  // تجاهل في حال عدم وجود .env
}

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  UNIVERSITY_FACULTIES,
  LOCATION_TYPES,
  NOT_FOUND_NOTIFICATION_MESSAGE,
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
} = require('./server/storage.cjs');
const {
  getFacultyAuthStatus,
  setupFacultyPasscode,
  verifyFacultyPasscode,
  extractBearerSession,
  requireStaffAuth,
} = require('./server/auth.cjs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// عناوين الإشعارات المسموحة للـ Push (HTTPS فقط)
function sanitizePushSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.endpoint !== 'string' || !raw.endpoint.trim()) return null;
  try {
    const parsedUrl = new URL(raw.endpoint.trim());
    if (parsedUrl.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  const keys =
    raw.keys && typeof raw.keys === 'object'
      ? {
          p256dh:
            typeof raw.keys.p256dh === 'string'
              ? raw.keys.p256dh.slice(0, 512)
              : undefined,
          auth:
            typeof raw.keys.auth === 'string'
              ? raw.keys.auth.slice(0, 256)
              : undefined,
        }
      : undefined;

  return {
    endpoint: raw.endpoint.trim().slice(0, 2048),
    expirationTime:
      typeof raw.expirationTime === 'number' || raw.expirationTime === null
        ? raw.expirationTime
        : null,
    ...(keys ? { keys } : {}),
  };
}

// محدد بسيط لمحاولات تسجيل الدخول لحماية بوابة الموظفين
const authRateMap = new Map();
function checkAuthRateLimit(req, res, next) {
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : '') ||
    req.socket.remoteAddress ||
    'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 25;

  const entry = authRateMap.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    authRateMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }
  if (entry.count >= maxAttempts) {
    return res.status(429).json({
      success: false,
      data: null,
      error: 'تم تجاوز عدد محاولات الدخول المسموح بها مؤقتاً. يرجى المحاولة بعد دقائق.',
    });
  }
  entry.count += 1;
  return next();
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '100kb' }));

// معالجة أخطاء صيغة JSON في الطلبات بصيغة موحدة
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      data: null,
      error: 'تنسيق البيانات المرسلة (JSON) غير صالح.',
    });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      data: null,
      error: 'حجم البيانات المرسلة يتجاوز الحد المسموح به.',
    });
  }
  return next(err);
});

// ==========================================
// مسارات الصحة والاختبار الأساسية
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'الخادم يعمل',
  });
});

app.post('/api/requests', (req, res) => {
  const description = req.body?.description;
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({
      error: 'يرجى إدخال وصف الطلب',
    });
  }
  return res.status(200).json({
    success: true,
    message: 'تم استقبال الطلب بنجاح',
    receivedText: description.trim().slice(0, 1000),
  });
});

// ==========================================
// مسارات مصادقة موظفي شؤون الطلاب
// ==========================================
app.get('/api/staff/status', (req, res) => {
  const faculty = String(req.query.faculty || '').trim();
  const status = getFacultyAuthStatus(faculty);
  if (!status.validFaculty) {
    return res.status(400).json({
      success: false,
      data: null,
      error: 'يرجى اختيار كلية جامعية صالحة.',
    });
  }
  return res.json({
    success: true,
    data: {
      faculty,
      needsSetup: status.needsSetup,
    },
    error: null,
  });
});

app.post('/api/staff/setup', checkAuthRateLimit, async (req, res, next) => {
  try {
    const faculty = typeof req.body?.faculty === 'string' ? req.body.faculty.trim() : '';
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const result = await setupFacultyPasscode(faculty, passcode);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        data: null,
        error: result.error,
      });
    }
    return res.status(201).json({
      success: true,
      data: result.data,
      error: null,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/staff/login', checkAuthRateLimit, (req, res) => {
  const faculty = typeof req.body?.faculty === 'string' ? req.body.faculty.trim() : '';
  const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
  const result = verifyFacultyPasscode(faculty, passcode);
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      data: null,
      error: result.error,
    });
  }
  return res.json({
    success: true,
    data: result.data,
    error: null,
  });
});

app.get('/api/staff/session', requireStaffAuth, (req, res) => {
  return res.json({
    success: true,
    data: {
      faculty: req.staffFaculty,
      expiresAt: req.staffSessionExpiresAt,
    },
    error: null,
  });
});

app.post('/api/staff/logout', (req, res) => {
  return res.json({
    success: true,
    data: { loggedOut: true },
    error: null,
  });
});

// ==========================================
// مسارات إدارة البلاغات (CRUD + دورة الحياة)
// ==========================================
function parseMyReportsHeader(req) {
  const raw = req.headers['x-wisal-my-reports'];
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string' && entry.id.trim())
      .slice(0, 100)
      .map((entry) => ({
        id: entry.id.trim(),
        ownerToken:
          typeof entry.ownerToken === 'string' ? entry.ownerToken.trim() : '',
      }));
  } catch {
    return [];
  }
}

function getHeaderOwnerToken(req) {
  const raw = req.headers['x-wisal-owner-token'];
  return typeof raw === 'string' ? raw.trim() : '';
}

app.get('/api/reports', (req, res) => {
  const store = loadStoreFromDisk();
  const staffSession = extractBearerSession(req);

  if (staffSession) {
    const facultyReports = sortReports(
      store.reports.filter((r) => r.faculty === staffSession.faculty)
    ).map(toStaffReport);
    return res.json({
      success: true,
      data: facultyReports,
      error: null,
    });
  }

  const myEntries = parseMyReportsHeader(req);
  if (myEntries.length === 0) {
    return res.json({
      success: true,
      data: [],
      error: null,
    });
  }

  const tokenById = new Map(myEntries.map((e) => [e.id, e.ownerToken]));
  const matching = sortReports(
    store.reports.filter((r) => tokenById.has(r.id))
  ).map((report) => {
    const token = tokenById.get(report.id);
    return verifyOwnerToken(report, token)
      ? toStudentOwnedReport(report)
      : toPublicReport(report);
  });

  return res.json({
    success: true,
    data: matching,
    error: null,
  });
});

app.get('/api/reports/code/:code', (req, res) => {
  const rawCode = String(req.params.code || '').trim().toUpperCase();
  if (!rawCode || rawCode.length > 32) {
    return res.status(400).json({
      success: false,
      data: null,
      error: 'يرجى كتابة رقم بلاغ صالح مثل WS-101.',
    });
  }

  const store = loadStoreFromDisk();
  const found = store.reports.find(
    (r) => r.reportCode.toUpperCase() === rawCode
  );
  if (!found) {
    return res.status(404).json({
      success: false,
      data: null,
      error: `لا يوجد بلاغ مسجل برقم (${rawCode}). تأكد من كتابة الرقم مثل WS-101.`,
    });
  }

  const staffSession = extractBearerSession(req);
  const ownerToken = getHeaderOwnerToken(req);

  if (staffSession && staffSession.faculty === found.faculty) {
    return res.json({
      success: true,
      data: toStaffReport(found),
      error: null,
    });
  }
  if (verifyOwnerToken(found, ownerToken)) {
    return res.json({
      success: true,
      data: toStudentOwnedReport(found),
      error: null,
    });
  }

  return res.json({
    success: true,
    data: toPublicReport(found),
    error: null,
  });
});

app.post('/api/reports', async (req, res, next) => {
  try {
    const body = req.body || {};
    const faculty = typeof body.faculty === 'string' ? body.faculty.trim() : '';
    const studentName =
      typeof body.studentName === 'string' ? body.studentName.trim() : '';
    const itemName =
      typeof body.itemName === 'string' ? body.itemName.trim() : '';
    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    const locationType =
      typeof body.locationType === 'string' ? body.locationType.trim() : '';
    const roomOrLocation =
      typeof body.roomOrLocation === 'string'
        ? body.roomOrLocation.trim()
        : '';
    const timePeriod =
      typeof body.timePeriod === 'string' ? body.timePeriod.trim() : '';
    const rawPhone =
      typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';

    if (!UNIVERSITY_FACULTIES.includes(faculty)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى اختيار كلية صالحة من القائمة.',
      });
    }

    const nameWords = studentName.split(/\s+/).filter(Boolean);
    if (nameWords.length < 3 || studentName.length > 120) {
      return res.status(400).json({
        success: false,
        data: null,
        error:
          'يرجى إدخال اسم الطالب الثلاثي (بحد أقصى 120 حرفاً) كما في البطاقة الجامعية.',
      });
    }

    if (!itemName || itemName.length > 120) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى كتابة اسم الغرض المفقود (بحد أقصى 120 حرفاً).',
      });
    }

    if (!description || description.length > 1000) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى إدخال المواصفات الدقيقة للمطابقة (بحد أقصى 1000 حرف).',
      });
    }

    if (!LOCATION_TYPES.includes(locationType)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى اختيار نوع مكان صالح.',
      });
    }

    if (!roomOrLocation || roomOrLocation.length > 160) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى تحديد رقم القاعة أو تفاصيل المكان (بحد أقصى 160 حرفاً).',
      });
    }

    if (!timePeriod || timePeriod.length > 100) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى تحديد الفترة الزمنية (بحد أقصى 100 حرف).',
      });
    }

    if (!isValidYemeniPhone(rawPhone)) {
      return res.status(400).json({
        success: false,
        data: null,
        error:
          'يرجى إدخال رقم جوال يمني صحيح مكون من 9 أرقام يبدأ بـ 7 (مثل 77xxxxxxx).',
      });
    }

    const cleanPhone = sanitizePhoneNumber(rawPhone);
    const pushSubscription = sanitizePushSubscription(body.pushSubscription);

    const outcome = await withStoreLock((store, persist) => {
      const conflictReport = store.reports.find(
        (item) =>
          sanitizePhoneNumber(item.phoneNumber) === cleanPhone &&
          item.faculty !== faculty
      );
      if (conflictReport) {
        return {
          ok: false,
          status: 409,
          error: `عذراً، هذا الرقم مسجل مسبقاً في ${conflictReport.faculty} ولا يمكن رفع بلاغات في أكثر من كلية`,
        };
      }

      const nextSeq = store.nextSequence + 1;
      store.nextSequence = nextSeq;
      const reportCode = `WS-${nextSeq}`;
      const ownerToken = crypto.randomBytes(24).toString('hex');

      const newReport = {
        id: `ws-${nextSeq}-${Date.now()}`,
        reportCode,
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
        ownerTokenHash: hashOwnerToken(ownerToken),
      };

      store.reports.unshift(newReport);
      persist(store);

      return {
        ok: true,
        status: 201,
        data: {
          ...toStudentOwnedReport(newReport),
          ownerToken,
        },
      };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        data: null,
        error: outcome.error,
      });
    }

    return res.status(201).json({
      success: true,
      data: outcome.data,
      error: null,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/reports/push-subscribe', async (req, res, next) => {
  try {
    const subscription = sanitizePushSubscription(req.body?.subscription);
    if (!subscription) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'بيانات اشتراك الإشعارات غير صالحة.',
      });
    }

    const reportTokens = Array.isArray(req.body?.reports)
      ? req.body.reports
          .filter(
            (r) =>
              r &&
              typeof r.id === 'string' &&
              typeof r.ownerToken === 'string'
          )
          .slice(0, 100)
      : [];

    if (reportTokens.length > 0) {
      const tokenMap = new Map(
        reportTokens.map((r) => [r.id.trim(), r.ownerToken.trim()])
      );
      await withStoreLock((store, persist) => {
        let changed = false;
        store.reports = store.reports.map((report) => {
          const token = tokenMap.get(report.id);
          if (token && verifyOwnerToken(report, token)) {
            changed = true;
            return { ...report, pushSubscription: subscription };
          }
          return report;
        });
        if (changed) persist(store);
      });
    }

    return res.json({
      success: true,
      data: subscription,
      error: null,
    });
  } catch (err) {
    return next(err);
  }
});

app.patch('/api/reports/:id', async (req, res, next) => {
  try {
    const reportId = String(req.params.id || '').trim();
    const ownerToken = getHeaderOwnerToken(req);
    const body = req.body || {};

    const itemName =
      typeof body.itemName === 'string' ? body.itemName.trim() : '';
    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    const locationType =
      typeof body.locationType === 'string' ? body.locationType.trim() : '';
    const roomOrLocation =
      typeof body.roomOrLocation === 'string'
        ? body.roomOrLocation.trim()
        : '';
    const timePeriod =
      typeof body.timePeriod === 'string' ? body.timePeriod.trim() : '';

    if (!itemName || itemName.length > 120) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى كتابة اسم الغرض المفقود (بحد أقصى 120 حرفاً).',
      });
    }
    if (!description || description.length > 1000) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى إدخال المواصفات الدقيقة للمطابقة (بحد أقصى 1000 حرف).',
      });
    }
    if (!LOCATION_TYPES.includes(locationType)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى اختيار نوع مكان صالح.',
      });
    }
    if (!roomOrLocation || roomOrLocation.length > 160) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى تحديد رقم القاعة أو تفاصيل المكان (بحد أقصى 160 حرفاً).',
      });
    }
    if (!timePeriod || timePeriod.length > 100) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يرجى تحديد الفترة الزمنية (بحد أقصى 100 حرف).',
      });
    }

    const outcome = await withStoreLock((store, persist) => {
      const idx = store.reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        return {
          ok: false,
          status: 404,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }
      const target = store.reports[idx];
      if (!verifyOwnerToken(target, ownerToken)) {
        return {
          ok: false,
          status: 403,
          error: 'غير مصرح بتعديل هذا البلاغ إلا من المتصفح الذي أنشأه.',
        };
      }
      if (target.status !== 'pending') {
        return {
          ok: false,
          status: 409,
          error: 'يمكن تعديل بيانات البلاغ فقط أثناء بقائه قيد المراجعة.',
        };
      }

      const updated = {
        ...target,
        itemName,
        description,
        locationType,
        roomOrLocation,
        timePeriod,
        isUrgent: detectUrgentItem(itemName),
      };
      store.reports[idx] = updated;
      persist(store);

      return {
        ok: true,
        status: 200,
        data: toStudentOwnedReport(updated),
      };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        data: null,
        error: outcome.error,
      });
    }
    return res.json({
      success: true,
      data: outcome.data,
      error: null,
    });
  } catch (err) {
    return next(err);
  }
});

app.patch('/api/reports/:id/match', requireStaffAuth, async (req, res, next) => {
  try {
    const reportId = String(req.params.id || '').trim();
    const outcome = await withStoreLock((store, persist) => {
      const idx = store.reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        return {
          ok: false,
          status: 404,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }
      const target = store.reports[idx];
      if (target.faculty !== req.staffFaculty) {
        return {
          ok: false,
          status: 403,
          error: 'لا يمكن تعديل بلاغ تابع لكلية أخرى.',
        };
      }
      if (target.status !== 'pending') {
        return {
          ok: false,
          status: 409,
          error:
            'يمكن تأكيد العثور على الغرض للبلاغات التي لا تزال قيد المراجعة فقط.',
        };
      }

      const nowIso = new Date().toISOString();
      const updated = {
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
      store.reports[idx] = updated;
      persist(store);

      return { ok: true, status: 200, data: toStaffReport(updated) };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        data: null,
        error: outcome.error,
      });
    }
    return res.json({ success: true, data: outcome.data, error: null });
  } catch (err) {
    return next(err);
  }
});

app.patch(
  '/api/reports/:id/pickup-reminder',
  requireStaffAuth,
  async (req, res, next) => {
    try {
      const reportId = String(req.params.id || '').trim();
      const outcome = await withStoreLock((store, persist) => {
        const idx = store.reports.findIndex((r) => r.id === reportId);
        if (idx === -1) {
          return {
            ok: false,
            status: 404,
            error: 'لم يتم العثور على البلاغ المطلوب.',
          };
        }
        const target = store.reports[idx];
        if (target.faculty !== req.staffFaculty) {
          return {
            ok: false,
            status: 403,
            error: 'لا يمكن إرسال تذكير لبلاغ تابع لكلية أخرى.',
          };
        }
        if (target.status !== 'matched') {
          return {
            ok: false,
            status: 409,
            error:
              'يُتاح إرسال تذكير الاستلام للبلاغات الموجودة بالمكتب فقط.',
          };
        }

        const nowIso = new Date().toISOString();
        const updated = {
          ...target,
          notification: {
            type: 'matched',
            message: `تذكير بالاستلام: غرضك «${target.itemName}» (بلاغ ${target.reportCode}) لا يزال بانتظارك في مكتب شؤون الطلاب بـ (${target.faculty}). يرجى الحضور شخصياً وإبراز البطاقة الجامعية للاستلام.`,
            createdAt: nowIso,
            unread: true,
          },
        };
        store.reports[idx] = updated;
        persist(store);

        return { ok: true, status: 200, data: toStaffReport(updated) };
      });

      if (!outcome.ok) {
        return res.status(outcome.status).json({
          success: false,
          data: null,
          error: outcome.error,
        });
      }
      return res.json({ success: true, data: outcome.data, error: null });
    } catch (err) {
      return next(err);
    }
  }
);

app.patch(
  '/api/reports/:id/notify-not-found',
  requireStaffAuth,
  async (req, res, next) => {
    try {
      const reportId = String(req.params.id || '').trim();
      const outcome = await withStoreLock((store, persist) => {
        const idx = store.reports.findIndex((r) => r.id === reportId);
        if (idx === -1) {
          return {
            ok: false,
            status: 404,
            error: 'لم يتم العثور على البلاغ المطلوب.',
          };
        }
        const target = store.reports[idx];
        if (target.faculty !== req.staffFaculty) {
          return {
            ok: false,
            status: 403,
            error: 'لا يمكن تحديث بلاغ تابع لكلية أخرى.',
          };
        }
        if (target.status !== 'pending') {
          return {
            ok: false,
            status: 409,
            error:
              'لا يمكن إرسال إشعار عدم العثور على الغرض بعد تأكيد وجوده أو إغلاقه.',
          };
        }

        const nowIso = new Date().toISOString();
        const updated = {
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
        store.reports[idx] = updated;
        persist(store);

        return { ok: true, status: 200, data: toStaffReport(updated) };
      });

      if (!outcome.ok) {
        return res.status(outcome.status).json({
          success: false,
          data: null,
          error: outcome.error,
        });
      }
      return res.json({ success: true, data: outcome.data, error: null });
    } catch (err) {
      return next(err);
    }
  }
);

app.patch(
  '/api/reports/:id/notification-read',
  async (req, res, next) => {
    try {
      const reportId = String(req.params.id || '').trim();
      const ownerToken = getHeaderOwnerToken(req);
      const staffSession = extractBearerSession(req);

      const outcome = await withStoreLock((store, persist) => {
        const idx = store.reports.findIndex((r) => r.id === reportId);
        if (idx === -1) {
          return {
            ok: false,
            status: 404,
            error: 'لم يتم العثور على البلاغ المطلوب.',
          };
        }
        const target = store.reports[idx];
        const isOwner = verifyOwnerToken(target, ownerToken);
        const isFacultyStaff =
          Boolean(staffSession) && staffSession.faculty === target.faculty;

        if (!isOwner && !isFacultyStaff) {
          return {
            ok: false,
            status: 403,
            error: 'غير مصرح بتأكيد قراءة هذا التنبيه.',
          };
        }

        const nowIso = new Date().toISOString();
        const updated = {
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
                createdAt:
                  target.matchedAt || target.lastCheckedAt || nowIso,
                unread: false,
                readAt: nowIso,
              },
        };
        store.reports[idx] = updated;
        persist(store);

        return {
          ok: true,
          status: 200,
          data: isFacultyStaff
            ? toStaffReport(updated)
            : toStudentOwnedReport(updated),
        };
      });

      if (!outcome.ok) {
        return res.status(outcome.status).json({
          success: false,
          data: null,
          error: outcome.error,
        });
      }
      return res.json({ success: true, data: outcome.data, error: null });
    } catch (err) {
      return next(err);
    }
  }
);

app.patch('/api/reports/:id/deliver', requireStaffAuth, async (req, res, next) => {
  try {
    if (req.body?.verifiedByUniversityId !== true) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'يجب تأكيد التحقق من البطاقة الجامعية للطالب أولاً.',
      });
    }

    const reportId = String(req.params.id || '').trim();
    const outcome = await withStoreLock((store, persist) => {
      const idx = store.reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        return {
          ok: false,
          status: 404,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }
      const target = store.reports[idx];
      if (target.faculty !== req.staffFaculty) {
        return {
          ok: false,
          status: 403,
          error: 'لا يمكن تسليم بلاغ تابع لكلية أخرى.',
        };
      }
      if (target.status !== 'matched') {
        return {
          ok: false,
          status: 409,
          error:
            'يجب أولاً تأكيد العثور على الغرض بالمكتب قبل تسجيل التسليم النهائي.',
        };
      }

      const nowIso = new Date().toISOString();
      const updated = {
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
      store.reports[idx] = updated;
      persist(store);

      return { ok: true, status: 200, data: toStaffReport(updated) };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        data: null,
        error: outcome.error,
      });
    }
    return res.json({ success: true, data: outcome.data, error: null });
  } catch (err) {
    return next(err);
  }
});

app.patch('/api/reports/:id/cancel', async (req, res, next) => {
  try {
    const reportId = String(req.params.id || '').trim();
    const ownerToken = getHeaderOwnerToken(req);

    const outcome = await withStoreLock((store, persist) => {
      const idx = store.reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        return {
          ok: false,
          status: 404,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }
      const target = store.reports[idx];
      if (!verifyOwnerToken(target, ownerToken)) {
        return {
          ok: false,
          status: 403,
          error: 'غير مصرح بسحب هذا البلاغ إلا من المتصفح الذي أنشأه.',
        };
      }
      if (target.status !== 'pending') {
        return {
          ok: false,
          status: 409,
          error:
            target.status === 'matched'
              ? 'لا يمكن سحب البلاغ بعد العثور على الغرض؛ يرجى الحضور شخصياً لمكتب شؤون الطلاب مع البطاقة الجامعية للاستلام.'
              : 'لا يمكن سحب هذا البلاغ في حالته الحالية.',
        };
      }

      const updated = {
        ...target,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      };
      store.reports[idx] = updated;
      persist(store);

      return { ok: true, status: 200, data: toStudentOwnedReport(updated) };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        data: null,
        error: outcome.error,
      });
    }
    return res.json({ success: true, data: outcome.data, error: null });
  } catch (err) {
    return next(err);
  }
});

app.delete('/api/reports/:id', async (req, res, next) => {
  try {
    const reportId = String(req.params.id || '').trim();
    const ownerToken = getHeaderOwnerToken(req);
    const staffSession = extractBearerSession(req);

    const outcome = await withStoreLock((store, persist) => {
      const idx = store.reports.findIndex((r) => r.id === reportId);
      if (idx === -1) {
        return {
          ok: false,
          status: 404,
          error: 'لم يتم العثور على البلاغ المطلوب.',
        };
      }
      const target = store.reports[idx];
      const isOwner = verifyOwnerToken(target, ownerToken);
      const isFacultyStaff =
        Boolean(staffSession) && staffSession.faculty === target.faculty;

      if (!isOwner && !isFacultyStaff) {
        return {
          ok: false,
          status: 403,
          error: 'غير مصرح بحذف هذا البلاغ.',
        };
      }

      if (target.status !== 'cancelled' && target.status !== 'delivered') {
        return {
          ok: false,
          status: 409,
          error: 'لا يمكن حذف بلاغ نشط؛ يمكن حذف البلاغات المسحوبة أو المسلّمة فقط.',
        };
      }

      store.reports.splice(idx, 1);
      persist(store);

      return { ok: true, status: 200, data: { deletedId: reportId } };
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        data: null,
        error: outcome.error,
      });
    }
    return res.json({ success: true, data: outcome.data, error: null });
  } catch (err) {
    return next(err);
  }
});

// أي مسار غير معروف تحت /api يُرجع JSON موحداً
app.use('/api', (req, res) => {
  return res.status(404).json({
    success: false,
    data: null,
    error: 'نقطة الاتصال المطلوبة غير موجودة.',
  });
});

// معالج الأخطاء العام لمسارات API
app.use('/api', (err, req, res, _next) => {
  console.error('[API Error]', err?.message || err);
  return res.status(500).json({
    success: false,
    data: null,
    error: 'حدث خطأ داخلي في الخادم، يرجى المحاولة لاحقاً.',
  });
});

async function startServer() {
  if (IS_PRODUCTION) {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
        return res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } else {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(disableHmr ? { hmr: false, ws: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Wisal server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});