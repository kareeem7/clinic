'use strict';

// node --test tests/mfa-login-errors.test.cjs
// Incident 2026-11-06 (٣): بعد كتابة كود TOTP كان الدكتور يرى
// «حدث خطأ غير متوقع — حاول مرة أخرى» لأن authErrorAr()/explainError()
// لم يكونا يعرفان أكواد GoTrue الحقيقية، ولا الرسائل بلا error_code.
// هذه الاختبارات تمنع عودة ذلك التعمية بأي تغيير لاحق.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utils = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8');

function utilsContext() {
  const a = utils.indexOf('// رسالة واحدة واضحة');
  const b = utils.indexOf('// ---- الصور الرمزية', a);
  assert.ok(a > -1 && b > a);
  const src = utils.slice(a, b);
  const ctx = vm.createContext({ logError: () => 'req-test-1', __out: '' });
  vm.runInContext(src, ctx, { filename: 'utils.js' });
  return {
    run: expr => vm.runInContext(expr, ctx),
    explainError: ex => { ctx.__ex = ex; return vm.runInContext('explainError(__ex)', ctx); }
  };
}

function dbContext(mfa) {
  const ctx = vm.createContext({
    State: { settings: {}, patientIndex: {}, activeClinicId: null },
    console,
    defaultClinicData: () => ({ settings: {}, plans: [] }),
    normalizeClinicFeatures: v => v || {},
    normalizeClinicSettings: v => v || {},
    addDaysISO: () => '2026-11-20', todayISO: () => '2026-11-06',
    logError: () => 'req-test-1', newRequestId: () => 'req-test-1',
    Offline: undefined, OfflineCapture: undefined
  });
  vm.runInContext(dbSource, ctx, { filename: 'db.js' });
  const DB = vm.runInContext('DB', ctx);
  DB.uid = 'doctor-1';
  DB.sb = { auth: { mfa } };
  return DB;
}

// أكواد GoTrue الفعلية (internal/api/apierrors/errorcode.go + mfa.go)
const MFA_CODES = {
  mfa_verification_failed: 'انتظر الرمز الجديد',
  mfa_challenge_expired: 'انتهت صلاحية رمز التحقق',
  mfa_verification_rejected: 'تم رفض التحقق',
  mfa_ip_address_mismatch: 'تغيّرت شبكة الإنترنت',
  mfa_factor_not_found: 'تطبيق المصادقة',
  mfa_totp_verify_not_enabled: 'غير مفعّل',
  mfa_verified_factor_exists: 'مسجّل بالفعل',
  insufficient_aal: 'التحقق بخطوتين',
  session_not_found: 'انتهت جلسة الدخول',
  reauthentication_needed: 'سجّل الدخول من جديد',
  otp_expired: 'انتهت صلاحية الرمز',
  validation_failed: '6 أرقام'
};

test('كل أكواد MFA/الجلسة في GoTrue لها رسالة عربية قابلة للتنفيذ — لا الرسالة العامة', () => {
  const u = utilsContext();
  for (const [code, fragment] of Object.entries(MFA_CODES)) {
    const msg = u.run(`authErrorAr(${JSON.stringify(code)})`);
    assert.doesNotMatch(msg, /حدث خطأ غير متوقع/, code + ' must not fall back');
    assert.match(msg, new RegExp(fragment), code + ' must explain the action');
  }
});

test('رسائل GoTrue بلا error_code صالح تُترجم من النص نفسه', () => {
  const u = utilsContext();
  const cases = [
    ['Auth session missing!', /انتهت جلسة الدخول/],
    ['MFA challenge 6ec950e7 has expired, verify against another challenge or create a new challenge.', /انتهت صلاحية رمز التحقق/],
    ['Challenge and verify IP addresses mismatch.', /تغيّرت شبكة الإنترنت/],
    ['Invalid TOTP code entered', /كود التحقق غير صحيح/],
    ['Invalid refresh token: refresh token not found', /انتهت جلسة الدخول/],
    ['AAL2 required to enroll a new factor', /التحقق بخطوتين/]
  ];
  for (const [message, expected] of cases) {
    assert.match(u.explainError({ message }), expected, message);
  }
});

test('خطأ غير معروف يبقى آمناً لكنه يعطي رقم مرجع بدل طريق مسدود', () => {
  const u = utilsContext();
  const msg = u.explainError({ code: 'totally-unknown', message: 'opaque' });
  assert.match(msg, /حدث خطأ غير متوقع/);
  assert.match(msg, /حدّث الصفحة/);
  assert.match(msg, /رقم المرجع: req-test-1/);
  assert.doesNotMatch(msg, /opaque/, 'لا تُعرض حمولة السيرفر الخام للمستخدم');
});

test('mfaVerify يترجم data:null من challenge إلى session_not_found بدل TypeError', async () => {
  const DB = dbContext({
    challenge: async () => ({ data: null, error: null })
  });
  await assert.rejects(
    () => DB.mfaVerify('123456', 'factor-1'),
    e => e && e.code === 'session_not_found'
  );
});

test('mfaVerify يرمي mfa_no_factor عند غياب العامل بدل TypeError', async () => {
  const DB = dbContext({
    listFactors: async () => ({ data: null, error: null })
  });
  await assert.rejects(
    () => DB.mfaVerify('123456', null),
    e => e && e.code === 'mfa_no_factor'
  );
});

test('mfaVerify يمرّر خطأ verify كما هو (code يصل للترجمة الجديدة)', async () => {
  const err = { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' };
  const DB = dbContext({
    challenge: async () => ({ data: { id: 'ch-1' }, error: null }),
    verify: async () => ({ data: null, error: err })
  });
  await assert.rejects(() => DB.mfaVerify('123456', 'factor-1'), e => e === err);
  const u = utilsContext();
  assert.match(u.explainError(err), /انتظر الرمز الجديد/);
});

test('mfaVerify ينجح ويرجع ready عند توفر challenge صحيح', async () => {
  const DB = dbContext({
    challenge: async () => ({ data: { id: 'ch-1' }, error: null }),
    verify: async () => ({ data: { access_token: 'x' }, error: null })
  });
  assert.equal(await DB.mfaVerify('123456', 'factor-1'), 'ready');
});

test('واجهة MFA تقدم زر «سجّل الدخول من جديد» لأخطاء الجلسة/انتهاء الرمز', () => {
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(main, /mfaRestart/);
  assert.match(main, /session_not_found\|mfa_challenge_expired\|insufficient_aal\|reauthentication_needed/);
  assert.match(main, /سجّل الدخول من جديد/);
});

test('logError يسجّل شكلاً تقنياً محدوداً بلا نص الرسالة ولا بيانات مرضى', () => {
  const config = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
  const a = config.indexOf('/* Central error reporting.');
  const b = config.indexOf('// SQL التأسيس', a);
  assert.ok(a > -1 && b > a);
  const lines = [];
  const ctx = vm.createContext({
    Date, console: { error: (tag, obj) => lines.push(obj) }, __out: ''
  });
  vm.runInContext('let REQUEST_SEQ = 0;\n' +
    'function newRequestId() { REQUEST_SEQ += 1; return "req-" + Date.now().toString(36) + "-" + REQUEST_SEQ; }\n' +
    config.slice(a, b), ctx, { filename: 'config.js' });
  ctx.__err = { code: 'mfa_challenge_expired', name: 'AuthApiError', status: 422,
                message: 'MFA challenge for patient 01012345678 has expired' };
  const req = vm.runInContext('logError(__err, "unmapped")', ctx);
  assert.match(req, /^req-/);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].requestId, req);
  assert.equal(lines[0].shape, 'mfa-challenge-expired');
  assert.equal(lines[0].code, 'mfa_challenge_expired');
  assert.equal(lines[0].name, 'AuthApiError');
  assert.equal(lines[0].status, 422);
  assert.equal(lines[0].context, 'unmapped');
  assert.ok(!Object.prototype.hasOwnProperty.call(lines[0], 'message'));
  assert.ok(!JSON.stringify(lines[0]).includes('01012345678'), 'لا بيانات مرضى في السجل');
});

test('errorShape يصنّف أخطاء الجلسة والشبكة و TypeError دون كشف النص', () => {
  const config = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
  const a = config.indexOf('function errorShape');
  const b = config.indexOf('function logError', a);
  const ctx = vm.createContext({ __out: '' });
  vm.runInContext(config.slice(a, b), ctx, { filename: 'config.js' });
  const shape = m => { ctx.__m = { message: m }; return vm.runInContext('errorShape(__m)', ctx); };
  assert.equal(shape('Auth session missing!'), 'session');
  assert.equal(shape('Failed to fetch'), 'network');
  assert.equal(shape("Cannot read properties of null (reading 'id')"), 'client-typeerror');
  assert.equal(shape('Challenge and verify IP addresses mismatch.'), 'mfa-ip');
  assert.equal(shape('MFA challenge abc has expired'), 'mfa-challenge-expired');
  assert.equal(shape('new row violates row-level security policy'), 'rls');
});

test('عند تعطيل TOTP في Supabase، الرسالة توجه لصفحة الإعداد ولا تقول «تواصل مع الإدارة»', () => {
  const u = utilsContext();
  const msg = u.run("authErrorAr('mfa_totp_verify_not_enabled')");
  assert.match(msg, /Supabase/);
  assert.match(msg, /Authentication/);
  assert.match(msg, /TOTP/);
  assert.doesNotMatch(msg, /تواصل مع إدارة النظام/);
  assert.doesNotMatch(msg, /حدث خطأ غير متوقع/);
  const fromText = u.explainError({ code: undefined, message: 'MFA verification is disabled for TOTP' });
  assert.match(fromText, /Authentication/, 'الترجمة تعمل حتى لو الكود وصل فارغاً');
});

test('رسالة تعطيل TOTP لا تكشف أي مفتاح أو اسم مشروع', () => {
  const u = utilsContext();
  const msg = u.run("authErrorAr('mfa_totp_verify_not_enabled')");
  assert.doesNotMatch(msg, /eyJ|sb_secret|service_role|xfppempsztxidjmlwrza/);
});
