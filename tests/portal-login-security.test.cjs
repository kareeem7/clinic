'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const codeMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261112_patient_access_codes.sql'), 'utf8');
const atomicMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261103_patient_portal_login_atomic.sql'), 'utf8');
const otpMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261105_patient_portal_phone_otp.sql'), 'utf8');
const stagingMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261109_patient_portal_phone_otp_temporary_disable.sql'), 'utf8');
const phoneNormalizationMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261110_fix_portal_phone_normalization.sql'), 'utf8');

const LOGIN_HEADER = 'create or replace function public.patient_portal_login(p_code text, p_phone text)';
const END_MARKER = 'end; $$;';

function loginFunction(source) {
  const start = source.indexOf(LOGIN_HEADER);
  assert.notEqual(start, -1, 'code-based login function exists');
  const end = source.indexOf(END_MARKER, start);
  assert.notEqual(end, -1, 'code-based login function terminates');
  return source.slice(start, end + END_MARKER.length);
}

test('SQL phone normalization strips the plus sign from E.164 numbers before matching', () => {
  const start = setup.indexOf('create or replace function public.norm_phone_eg(t text)');
  const end = setup.indexOf('$$;', start) + 3;
  const normalizer = setup.slice(start, end);
  assert.ok(start >= 0 && end > 2, 'setup SQL defines the phone normalizer');
  assert.match(normalizer, /regexp_replace\(coalesce\(t,''\), '\[\^0-9\]', '', 'g'\)/);
  assert.equal(normalizer.includes("'\\D'"), false);
  assert.match(phoneNormalizationMigration, /regexp_replace\(coalesce\(t,''\), '\[\^0-9\]', '', 'g'\)/);
});

test('the effective login rule is the permanent code, scoped by the clinic prefix', () => {
  const fn = loginFunction(codeMigration);
  assert.match(fn, /string_to_array\(v_input, '-'\)/);
  assert.match(fn, /select \* into v_clinic from public\.clinics[\s\S]*?where code = v_prefix/);
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\('patient-portal-login:' \|\| v_lock_key, 0\)\)/);
  assert.match(fn, /where clinic_id = v_clinic\.id and phone_key = v_key/);
  assert.match(fn, /tried_at > now\(\) - interval '15 minutes'\) >= 5/);
  assert.match(fn, /join public\.patients p on p\.id = c\.patient_id and p\.deleted_at is null/);
  assert.match(fn, /c\.code = v_input/);
  assert.match(fn, /c\.disabled_at is null/);
  assert.match(fn, /insert into public\.patient_sessions \(patient_id, doctor_id, clinic_id\)/);
  // المطابقة محصورة في الفرع: لا عدّ عالمي ولا رفض بسبب تكرار الرقم
  assert.doesNotMatch(fn, /duplicate-match/);
  assert.doesNotMatch(fn, /select count\(\*\) into v_n from public\.patients/);
  assert.doesNotMatch(fn, /birth_date|p_birth/);
  assert.doesNotMatch(fn, /auth\.uid\(\)|phone_confirmed_at|auth\.users/);
});

test('the old phone + birthdate RPC is dropped and only (text, text) is granted to anon', () => {
  assert.match(codeMigration, /drop function if exists public\.patient_portal_login\(text, date\)/);
  assert.match(codeMigration, /grant execute on function public\.patient_portal_login\(text, text\) to anon, authenticated/);
  assert.doesNotMatch(codeMigration, /grant execute on function public\.patient_portal_login\(text, date\)/);
  assert.doesNotMatch(setup, /create or replace function public\.patient_portal_login\(p_phone text, p_birth date\)/);
  assert.doesNotMatch(setup, /grant execute on function public\.patient_portal_login\(text, date\)/);
  assert.match(setup, /create or replace function public\.patient_portal_login\(p_code text, p_phone text\)/);
  assert.equal((setup.match(/create or replace function public\.patient_portal_login\(/g) || []).length, 1);
  assert.doesNotMatch(setup, /phone_confirmed_at/, 'no verified-phone OTP gate survives in the setup script');
});

test('historical login migrations are preserved but superseded by 20261112', () => {
  assert.match(atomicMigration, /revoke all on function public\.patient_portal_login\(text, date\) from public, anon, authenticated/);
  assert.doesNotMatch(atomicMigration, /grant execute on function public\.patient_portal_login/);
  assert.match(stagingMigration, /TEMPORARY STAGING ONLY/);
  assert.match(otpMigration, /phone_confirmed_at/);
  assert.match(otpMigration, /grant execute on function public\.patient_portal_login\(text, date\) to authenticated;/);
  assert.match(readme, /تاريخية/);
  assert.match(readme, /إعادة أساس/);
});

test('the OTP activation migration is preserved as a FUTURE layer on top of the code', () => {
  assert.match(readme, /OTP مؤجّل/);
  assert.match(readme, /أول تجربة فعلية/);
  assert.match(readme, /طبقة|فوق الكود/);
  assert.match(readme, /signInWithOtp/);
  assert.match(readme, /verifyOtp/);
  assert.doesNotMatch(readme, /بوابة المريض تتطلب الآن Supabase Auth Phone OTP/);
});

test('client sends the code (never a birth date) and displays it permanently', () => {
  assert.match(portal, /DB\.sb\.rpc\('patient_portal_login'/);
  assert.match(portal, /p_code:/);
  assert.doesNotMatch(portal, /p_birth/);
  assert.doesNotMatch(portal, /signInWithOtp|verifyOtp/);
  assert.match(portal, /patient_portal_access_code/);
  assert.match(portal, /#ptAccessCode/);
  assert.match(html, /id="ptCode"/);
  assert.match(html, /id="ptAccessCode"/);
  assert.doesNotMatch(html, /id="ptBirthDay"|id="ptBirthMonth"|id="ptBirthYear"/);
  assert.doesNotMatch(html, /ptOtpCode|ptOtpResend/);
  assert.match(main, /#ptCode/);
});

test('README records the code decision, the no-rotation consequence and the readiness warning', () => {
  assert.match(readme, /20261112_patient_access_codes\.sql/);
  assert.match(readme, /20261111_multi_clinic_branches\.sql/);
  assert.match(readme, /20261105_patient_portal_phone_otp\.sql/);
  assert.match(readme, /20261110_fix_portal_phone_normalization\.sql/);
  assert.match(readme, /anon/);
  assert.match(readme, /غير جاهز لبيانات مرضى حقيقية/);
  assert.match(readme, /ما لهوش استرجاع آمن|لا يوجد زر تغيير/);
  assert.match(readme, /يُخزَّن كما هو|تخزين الكود/);
});
