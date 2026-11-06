'use strict';

// node --test tests/profile-self-heal.test.cjs
// 2026-11-06: with "Confirm email" enabled, auth.signUp() returns no session,
// so register() cannot create the doctors/clinics rows under RLS. The doctor
// confirms the email, signs in, and loadSettingsRow() used to fail with
// clinic_profile_missing. These tests lock in the idempotent self-heal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(root, 'js/utils.js'), 'utf8');

function harness({ user, rows = null, branchRows = [], readError = null, writeError = null } = {}) {
  const calls = { upsert: [], doctorInsert: [], clinicInsert: [], clinicSelect: 0, reads: 0, getUser: 0 };
  const context = vm.createContext({
    console,
    State: { settings: {} },
    TRIAL_DAYS: 14,
    todayISO: () => '2026-11-06',
    addDaysISO: (iso, n) => '2026-11-' + String(6 + n),
    defaultClinicData: () => ({ settings: {
      clinicName: '', doctorName: '', specialty: '', phone: '', price: 0, address: '',
      clinicalFeatures: { measurements: false, inbody: false, labs: false,
        glucoseTracking: false, bloodPressureTracking: false }
    } }),
    normalizeClinicSettings: value => ({ ...(value || {}), clinicalFeatures: { measurements: false } })
  });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.uid = 'doctor-1';

  const doctorRead = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => {
      calls.reads++;
      if (readError) return { data: null, error: readError };
      // after the self-heal upsert the profile exists
      const healed = calls.upsert.length ? { settings: { clinicName: 'عيادة admin' } } : null;
      return { data: rows || healed, error: null };
    } }) })
  });
  const clinicQuery = () => {
    const b = {
      eq() { return b; }, is() { return b; },
      limit() { return Promise.resolve({ data: branchRows, error: null }); },
      then(res, rej) { return Promise.resolve({ data: branchRows, error: null }).then(res, rej); }
    };
    return b;
  };
  DB.sb = {
    auth: { getUser: async () => { calls.getUser++; return { data: { user }, error: null }; } },
    from(table) {
      if (table === 'doctors') {
        return {
          ...doctorRead(),
          upsert(row, opts) {
            calls.upsert.push({ row, opts });
            return Promise.resolve({ data: null, error: writeError });
          },
          insert(row) { calls.doctorInsert.push(row); return Promise.resolve({ error: null }); }
        };
      }
      if (table === 'clinics') {
        return {
          select() { calls.clinicSelect++; return clinicQuery(); },
          insert(row) { calls.clinicInsert.push(row); return Promise.resolve({ error: writeError }); }
        };
      }
      throw new Error('unexpected table ' + table);
    }
  };
  return { DB, State: context.State, calls };
}

const confirmedUser = {
  id: 'doctor-1',
  user_metadata: { doctor_name: 'admin', specialty: 'علاج طبيعي', clinic_name: 'عيادة النور' }
};

test('صف الدكتور الناقص يُعاد إنشاؤه تلقائياً عند أول دخول بعد تأكيد البريد', async () => {
  const { DB, State, calls } = harness({ user: confirmedUser });
  await DB.loadSettingsRow();
  assert.equal(calls.reads, 2, 'يُقرأ الصف ثم يُعاد قراءته بعد الإصلاح');
  assert.equal(calls.getUser, 1);
  assert.equal(calls.upsert.length, 1);
  const { row, opts } = calls.upsert[0];
  assert.equal(row.id, 'doctor-1');
  assert.equal(row.settings.doctorName, 'admin');
  assert.equal(row.settings.specialty, 'علاج طبيعي');
  assert.equal(row.settings.clinicName, 'عيادة النور');
  assert.equal(row.settings.account.status, 'trial');
  assert.equal(row.settings.account.endsAt, '2026-11-20');
  assert.equal(row.settings.clinicalFeatures.measurements, false);
  assert.equal(opts.onConflict, 'id');
  assert.equal(opts.ignoreDuplicates, true, 'never overwrite an existing profile');
  assert.equal(State.settings.clinicName, 'عيادة admin');
});

test('الإصلاح التلقائي ينشئ فرعاً افتراضياً واحداً فقط لو مفيش فروع', async () => {
  const { DB, calls } = harness({ user: confirmedUser });
  await DB.loadSettingsRow();
  assert.equal(calls.clinicSelect, 1);
  assert.equal(calls.clinicInsert.length, 1);
  assert.equal(calls.clinicInsert[0].doctor_id, 'doctor-1');
  assert.equal(calls.clinicInsert[0].is_default, true);
  assert.equal(calls.clinicInsert[0].name, 'عيادة النور');
});

test('صف موجود ⇒ صفر كتابات (لا إعادة ضبط للاشتراك ولا تكرار فرع)', async () => {
  const { DB, calls } = harness({
    user: confirmedUser,
    rows: { settings: { clinicName: 'عيادتي', account: { status: 'suspended' } } },
    branchRows: [{ id: 'clinic-1' }]
  });
  await DB.loadSettingsRow();
  assert.equal(calls.reads, 1);
  assert.equal(calls.upsert.length, 0);
  assert.equal(calls.clinicInsert.length, 0);
  assert.equal(calls.clinicSelect, 0);
  assert.equal(calls.getUser, 0);
});

test('عدم تطابق هوية المستخدم ⇒ يفشل بأمان بدون أي كتابة', async () => {
  const { DB, calls } = harness({ user: { id: 'someone-else', user_metadata: {} } });
  await assert.rejects(DB.loadSettingsRow(), e => e.code === 'clinic_profile_missing');
  assert.equal(calls.upsert.length, 0);
  assert.equal(calls.clinicInsert.length, 0);
});

test('خطأ قاعدة البيانات أو الكتابة لا يُبتلع', async () => {
  const readError = { code: '42501' };
  const a = harness({ user: confirmedUser, readError });
  await assert.rejects(a.DB.loadSettingsRow(), e => e === readError);
  assert.equal(a.calls.upsert.length, 0);

  const writeError = { code: '23505' };
  const b = harness({ user: confirmedUser, writeError });
  await assert.rejects(b.DB.loadSettingsRow(), e => e === writeError);
  assert.equal(b.calls.clinicInsert.length, 0);
});

test('اسم العيادة الافتراضي من اسم الدكتور لو بيانات التسجيل ناقصة', async () => {
  const { DB, calls } = harness({ user: { id: 'doctor-1', user_metadata: { doctor_name: 'أحمد' } } });
  await DB.loadSettingsRow();
  assert.equal(calls.upsert[0].row.settings.clinicName, 'عيادة أحمد');
  assert.equal(calls.clinicInsert[0].name, 'عيادة أحمد');
});

test('register() يحفظ اسم العيادة في بيانات المستخدم لاسترجاعه بعد التأكيد', () => {
  const src = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
  assert.match(src, /clinic_name:\s*clinic/);
  assert.match(src, /if \(!data\.session\) throw \{ code: 'confirm-email' \}/);
});

test('رسالة تأكيد البريد تشرح أن ملف العيادة يُجهَّز تلقائياً', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(utilsSource.replace(/^'use strict';/, ''), ctx, { filename: 'utils.js' });
  const msg = vm.runInContext("authErrorAr('confirm-email')", ctx);
  assert.match(msg, /تلقائياً/);
  assert.match(msg, /سجّل الدخول/);
});

test('رسالة clinic_profile_missing لسه معروفة كخطة بديلة آمنة', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(utilsSource.replace(/^'use strict';/, ''), ctx, { filename: 'utils.js' });
  assert.match(vm.runInContext("authErrorAr('clinic_profile_missing')", ctx), /ملف العيادة/);
});
