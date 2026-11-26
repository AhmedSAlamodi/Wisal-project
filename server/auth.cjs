const crypto = require('crypto');
const {
  UNIVERSITY_FACULTIES,
  loadStoreFromDisk,
  withStoreLock,
} = require('./storage.cjs');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret() {
  const envSecret = process.env.STAFF_SESSION_SECRET;
  if (typeof envSecret === 'string' && envSecret.trim().length >= 16) {
    return envSecret.trim();
  }
  return EPHEMERAL_SESSION_SECRET;
}

function parseEnvPasscodesMap() {
  const raw = process.env.STAFF_PASSCODES_JSON;
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getEnvPasscodeForFaculty(faculty) {
  const map = parseEnvPasscodesMap();
  if (map && typeof map[faculty] === 'string' && map[faculty].trim()) {
    return map[faculty].trim();
  }
  const shared = process.env.STAFF_PASSCODE;
  if (typeof shared === 'string' && shared.trim()) {
    return shared.trim();
  }
  return null;
}

function safeCompareText(expected, candidate) {
  const expectedDigest = crypto
    .createHash('sha256')
    .update(String(expected))
    .digest();
  const candidateDigest = crypto
    .createHash('sha256')
    .update(String(candidate))
    .digest();
  return crypto.timingSafeEqual(expectedDigest, candidateDigest);
}

function hashPasscode(passcode, saltHex) {
  return crypto.scryptSync(passcode, saltHex, 64).toString('hex');
}

function verifyStoredHash(passcode, credential) {
  if (!credential || !credential.salt || !credential.hash) return false;
  const computedHex = hashPasscode(passcode, credential.salt);
  const expectedBuf = Buffer.from(credential.hash, 'hex');
  const computedBuf = Buffer.from(computedHex, 'hex');
  if (expectedBuf.length !== computedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, computedBuf);
}

function getFacultyAuthStatus(faculty) {
  if (!UNIVERSITY_FACULTIES.includes(faculty)) {
    return { validFaculty: false, configured: false, needsSetup: false };
  }
  if (getEnvPasscodeForFaculty(faculty)) {
    return { validFaculty: true, configured: true, needsSetup: false };
  }
  const store = loadStoreFromDisk();
  const hasStored = Boolean(store.staffCredentials[faculty]);
  return {
    validFaculty: true,
    configured: hasStored,
    needsSetup: !hasStored,
  };
}

async function setupFacultyPasscode(faculty, passcode) {
  if (!UNIVERSITY_FACULTIES.includes(faculty)) {
    return { ok: false, status: 400, error: 'الكلية المحددة غير صالحة.' };
  }
  if (typeof passcode !== 'string') {
    return { ok: false, status: 400, error: 'يرجى إدخال رمز دخول صالح.' };
  }
  const trimmed = passcode.trim();
  if (trimmed.length < 6 || trimmed.length > 128) {
    return {
      ok: false,
      status: 400,
      error: 'يجب أن يتكون رمز الكلية من 6 إلى 128 حرفاً.',
    };
  }

  return withStoreLock((store, persist) => {
    if (getEnvPasscodeForFaculty(faculty) || store.staffCredentials[faculty]) {
      return {
        ok: false,
        status: 409,
        error: 'تم إعداد رمز الدخول لهذه الكلية مسبقاً. يرجى تسجيل الدخول به.',
      };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPasscode(trimmed, salt);
    store.staffCredentials[faculty] = {
      salt,
      hash,
      updatedAt: new Date().toISOString(),
    };
    persist(store);

    const session = createSessionToken(faculty);
    return {
      ok: true,
      status: 201,
      data: session,
    };
  });
}

function verifyFacultyPasscode(faculty, passcode) {
  if (!UNIVERSITY_FACULTIES.includes(faculty)) {
    return { ok: false, status: 400, error: 'الكلية المحددة غير صالحة.' };
  }
  if (typeof passcode !== 'string' || !passcode.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'يرجى إدخال رمز الدخول الأمني المخصص للكلية المختارة.',
    };
  }

  const trimmed = passcode.trim();
  const envPasscode = getEnvPasscodeForFaculty(faculty);
  if (envPasscode) {
    if (!safeCompareText(envPasscode, trimmed)) {
      return {
        ok: false,
        status: 401,
        error: `رمز الدخول الأمني غير صحيح لـ (${faculty}).`,
      };
    }
    return { ok: true, data: createSessionToken(faculty) };
  }

  const store = loadStoreFromDisk();
  const stored = store.staffCredentials[faculty];
  if (!stored) {
    return {
      ok: false,
      status: 409,
      error: 'لم يتم إعداد رمز دخول لهذه الكلية بعد. يرجى تعيين الرمز أولاً.',
    };
  }

  if (!verifyStoredHash(trimmed, stored)) {
    return {
      ok: false,
      status: 401,
      error: `رمز الدخول الأمني غير صحيح لـ (${faculty}).`,
    };
  }

  return { ok: true, data: createSessionToken(faculty) };
}

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payloadB64) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
}

function createSessionToken(faculty) {
  const now = Date.now();
  const exp = now + SESSION_TTL_MS;
  const payload = {
    faculty,
    iat: now,
    exp,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadB64);
  return {
    token: `${payloadB64}.${signature}`,
    faculty,
    expiresAt: new Date(exp).toISOString(),
  };
}

function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expectedSig = signPayload(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    );
    if (
      !parsed ||
      !UNIVERSITY_FACULTIES.includes(parsed.faculty) ||
      typeof parsed.exp !== 'number' ||
      Date.now() > parsed.exp
    ) {
      return null;
    }
    return {
      faculty: parsed.faculty,
      expiresAt: new Date(parsed.exp).toISOString(),
    };
  } catch {
    return null;
  }
}

function extractBearerSession(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return verifySessionToken(token);
}

function requireStaffAuth(req, res, next) {
  const session = extractBearerSession(req);
  if (!session) {
    return res.status(401).json({
      success: false,
      data: null,
      error: 'انتهت جلسة الموظف أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول مجدداً.',
    });
  }
  req.staffFaculty = session.faculty;
  req.staffSessionExpiresAt = session.expiresAt;
  return next();
}

module.exports = {
  getFacultyAuthStatus,
  setupFacultyPasscode,
  verifyFacultyPasscode,
  extractBearerSession,
  requireStaffAuth,
};
