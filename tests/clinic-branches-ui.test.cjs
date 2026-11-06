'use strict';

// الدفعة ٣: واجهة الدكتور للفروع + كود المريض في الملف + وسم الصفوف الجديدة.
// اختبارات ثابتة/محاكاة DOM فقط — لا PostgreSQL ولا Supabase حقيقي ولا بيانات مرضى.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const migration = read('sql/migrations/20261113_active_clinic.sql');
const setup = read('sql/baseline.sql');
const db = read('js/db.js');
const state = read('js/state.js');
const app = read('js/app.js');
const main = read('js/main.js');
const settings = read('js/settings.js');
const patient = read('js/patient.js');
const portal = read('js/patient-portal.js');
const html = read('index.html');
const readme = read('README.md');
const block = migration.slice(migration.indexOf('begin;') + 6, migration.lastIndexOf('commit;')).trim();

test('20261113 is transactional, additive, and embedded verbatim in the fresh-install SQL', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.ok(block.length > 1000);
  assert.ok(setup.includes(block), 'baseline.sql embeds the 20261113 body byte-for-byte');
  assert.match(setup.trim(), /commit;$/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from|alter table[\s\S]*?drop column/i);
});

test('the insert trigger stamps new rows with the active clinic without failing on odd settings', () => {
  assert.match(migration, /create or replace function public\.set_row_clinic_id\(\)/);
  assert.match(migration, /returns trigger language plpgsql security definer set search_path = public/);
  assert.match(migration, /if new\.clinic_id is not null then return new; end if;/);
  // مقارنة نصية: قيمة قديمة/غير UUID في settings ما توقّعش INSERT
  assert.match(migration, /d\.settings->>'activeClinicId' = c\.id::text/);
  assert.doesNotMatch(migration, /::uuid\)/);
  assert.match(migration, /and c\.deleted_at is null/);
  assert.match(migration, /where d\.id = new\.doctor_id/);
  const loop = migration.match(/foreach t in array array\[([\s\S]*?)\] loop/);
  assert.ok(loop);
  for (const t of ['plans', 'patients', 'appointments', 'patient_records', 'patient_notes', 'patient_labs', 'patient_health_readings']) {
    assert.ok(loop[1].includes("'" + t + "'"), t);
  }
  assert.match(migration, /drop trigger if exists %I on public\.%I/);
  assert.match(migration, /before insert on public\.%I for each row/);
  assert.match(migration, /jsonb_build_object\('activeClinicId', c\.id::text\)/);
  assert.match(migration, /coalesce\(d\.settings->>'activeClinicId', ''\) = ''/);
});

test('fresh registration creates one default branch with no prefix', () => {
  const reg = db.slice(db.indexOf('async register('), db.indexOf('async signOut('));
  assert.match(reg, /this\.sb\.from\('clinics'\)\.insert\(/);
  assert.match(reg, /is_default: true/);
  const branchInsert = reg.slice(reg.indexOf("from('clinics')"));
  assert.doesNotMatch(branchInsert, /code:/); // البادئة من اختيار الدكتور لاحقاً
});

test('branch lists are filtered by clinic_id on the server and in memory', () => {
  assert.match(db, /const clinicRows = rows =>/);
  assert.match(db, /r\.clinic_id === State\.activeClinicId/);
  assert.match(db, /if \(State\.activeClinicId\) b = b\.eq\('clinic_id', State\.activeClinicId\)/);
  assert.match(db, /select\('id,name,phone,type,status,created_at,plan_id,diagnosis,clinic_id'\)/);
  assert.match(db, /State\.appointments = clinicRows\(appointments\)/);
  assert.match(db, /State\.pTotal = clinicRows\(roster\)/);
  assert.match(state, /State\.clinics = \[\]/);
  assert.match(state, /State\.activeClinicId = null/);
  assert.match(state, /all\.filter\(p => !p\.clinic_id \|\| p\.clinic_id === State\.activeClinicId\)/);
});

test('rosterArr() really hides other branches and keeps legacy un-stamped rows', () => {
  const ctx = vm.createContext({ console, todayISO: () => '2026-11-04' });
  vm.runInContext(state, ctx, { filename: 'state.js' });
  vm.runInContext(`State.patientIndex = {
    a: { id: 'a', clinic_id: 'c1' }, b: { id: 'b', clinic_id: 'c2' }, c: { id: 'c' }
  }; State.activeClinicId = 'c1';`, ctx);
  assert.equal(vm.runInContext('rosterArr().map(p => p.id).join(",")', ctx), 'a,c');
  vm.runInContext('State.activeClinicId = null;', ctx);
  assert.equal(vm.runInContext('rosterArr().map(p => p.id).join(",")', ctx), 'a,b,c');
  assert.equal(vm.runInContext("activePatients().length", ctx), 0); // status مفقود في المحاكاة
});

test('clinics are exported but access codes never are', () => {
  const dump = db.slice(db.indexOf('async dumpAll()'));
  assert.match(dump, /g\('clinics'\)/);
  assert.match(dump, /clinics: clinics\.map/);
  assert.doesNotMatch(dump, /patient_portal_credentials/);
  assert.doesNotMatch(db, /g\('patient_portal_credentials'\)/);
});

test('DB.loadClinics() hydrates the branch list and resolves the active branch', () => {
  const fn = db.slice(db.indexOf('async loadClinics()'), db.indexOf('// Keep unacknowledged'));
  assert.match(fn, /this\.sb\.from\('clinics'\)/);
  assert.match(fn, /select\('id,name,code,phone,is_default,active'\)/);
  assert.match(fn, /\.eq\('doctor_id', this\.uid\)\.is\('deleted_at', null\)/);
  assert.match(fn, /State\.clinics = rows/);
  assert.match(fn, /State\.settings && State\.settings\.activeClinicId/);
  assert.match(fn, /rows\.find\(c => c\.is_default\) \|\| rows\[0\]/);
});

test('sidebar switcher shows the active branch and stays hidden with a single branch', () => {
  const fn = app.slice(app.indexOf('function syncShellIdentity()'));
  assert.match(fn, /\$\('#activeClinic'\)/);
  assert.match(fn, /clinics\.map\(c =>/);
  assert.match(fn, /sel\.classList\.toggle\('hide', clinics\.length < 2\)/);
  assert.match(fn, /active\.name \|\| s\.clinicName/);
  assert.match(html, /<select id="activeClinic"/);
});

test('switching branches reuses the existing settings RPC, not a new privileged endpoint', () => {
  const fn = main.slice(main.indexOf('const activeClinicSel'), main.indexOf('// 15)'));
  assert.match(fn, /rpc\('save_clinic_settings', \{ patch: \{ activeClinicId: id \} \}\)/);
  assert.match(fn, /State\.pPage = 1/);
  assert.match(fn, /await DB\.loadAll\(\)/);
  assert.match(fn, /refreshCurrent\(\)/);
  const boot = main.slice(main.indexOf('async function routeAfterAuth'), main.indexOf('function boot('));
  assert.ok(boot.indexOf('await DB.loadClinics()') < boot.indexOf('await DB.loadAll()'),
    'loadClinics must run before the first INSERT path in loadAll');
});

test('settings screen lists branches and lets the doctor choose the prefix', () => {
  assert.match(settings, /function renderClinicBranches\(\)/);
  assert.match(settings, /renderClinicBranches\(\); \/\/ الدفعة ٣/);
  assert.match(settings, /\$\('#clinicBranchesList'\)/);
  assert.match(settings, /\$\('#clinicPrefixFor'\)/);
  for (const id of ['clinicBranchesList', 'clinicPrefixFor', 'clinicPrefixValue', 'clinicPrefixSave', 'newClinicName', 'clinicAddSave']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  const save = main.slice(main.indexOf('const prefixSave'), main.indexOf('// 16)'));
  assert.match(save, /rpc\('set_clinic_prefix', \{ p_clinic_id: cid, p_code: code \}\)/);
  assert.match(save, /\^\[A-Z0-9\]\{2,12\}\$/);
  assert.match(main, /this\.sb\.from\('clinics'\)\.insert|\.from\('clinics'\)\.insert/);
});

test('the patient file shows the permanent code and only an emergency on/off switch', () => {
  assert.match(html, /id="patAccessCard"/);
  assert.match(html, /id="patAccessBody"/);
  assert.match(patient, /async function renderPatientAccess\(p\)/);
  assert.match(patient, /rpc\('issue_patient_code', \{ p_patient_id: p\.id \}\)/);
  assert.match(patient, /renderPatientAccess\(p\);/);
  assert.match(patient, /data-action="pt-access-off"/);
  assert.match(patient, /data-action="pt-access-on"/);
  assert.match(main, /rpc\('set_patient_portal_access', \{ p_patient_id: ds\.id, p_enabled: (?:false|true) \}\)/);
  // لا تدوير ولا تغيير للكود في أي مكان
  for (const src of [patient, main, html, portal, setup]) {
    assert.doesNotMatch(src, /rotate_patient_code|change_patient_code|update_patient_code|data-action="pt-code-(?:rotate|change)"/);
  }
});

test('the dead birthdate helper is gone and no birth-date fields remain in the UI', () => {
  assert.doesNotMatch(portal, /function portalBirthDate\(/);
  assert.doesNotMatch(portal, /p_birth/);
  assert.doesNotMatch(html, /ptBirth|ptBirthDay|ptBirthMonth|ptBirthYear/);
  assert.doesNotMatch(main, /portalBirthDate/);
  assert.match(readme, /اتشالت نهائياً/);
});

test('README documents the delivered batch 3 and keeps the plaintext caveat', () => {
  assert.match(readme, /فروع العيادة \(الدفعات ١–٣\)/);
  assert.match(readme, /20261113_active_clinic\.sql/);
  assert.match(readme, /save_clinic_settings/);
  assert.match(readme, /set_row_clinic_id\(\)/);
  assert.match(readme, /clinics`/);
  assert.match(readme, /تخزين الكود/);
  assert.match(readme, /أي جهة تقرأ الداتابيز/);
  assert.match(readme, /ما لهوش استرجاع آمن/);
  assert.doesNotMatch(readme, /غير مفعّل بعد \(الدفعة ٣\)/);
});

test('OTP is still deferred: no SMS/Auth client was introduced by batch 3', () => {
  assert.doesNotMatch(main, /signInWithOtp|verifyOtp|patientAuth/);
  assert.doesNotMatch(portal, /signInWithOtp|verifyOtp|service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(migration, /otp|sms|auth\.signIn/i);
  assert.match(readme, /OTP\/SMS مؤجّل/);
});
