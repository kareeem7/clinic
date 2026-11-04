'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261109_patient_portal_phone_otp_temporary_disable.sql'), 'utf8');
const atomicMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261103_patient_portal_login_atomic.sql'), 'utf8');
const otpMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261105_patient_portal_phone_otp.sql'), 'utf8');
const phoneNormalizationMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261110_fix_portal_phone_normalization.sql'), 'utf8');

const LOGIN_HEADER = 'create or replace function public.patient_portal_login(p_phone text, p_birth date)';
const END_MARKER = 'end; $$;';

// Collect EVERY definition, not just the first one. In a SQL script the last
// CREATE OR REPLACE is the effective rule, so a later OTP version would
// silently override the staging rule even if the first one looks correct.
function loginFunctions(source) {
  const found = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(LOGIN_HEADER, from);
    if (start === -1) return found;
    const end = source.indexOf(END_MARKER, start);
    assert.notEqual(end, -1, 'patient portal login function terminates');
    found.push(source.slice(start, end + END_MARKER.length));
    from = end + END_MARKER.length;
  }
}

function loginFunction(source) {
  const all = loginFunctions(source);
  assert.ok(all.length > 0, 'patient portal login function exists');
  return all[0];
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

test('portal login serializes per-phone attempts before counting or recording failures', () => {
  const fn = loginFunction(migration);
  const keyGuard = fn.indexOf("if v_key is null or btrim(v_key) = '' then");
  const lock = fn.indexOf("pg_advisory_xact_lock(hashtextextended('patient-portal-login:' || v_key, 0))");
  const count = fn.indexOf('select count(*) from public.portal_login_attempts');
  const failedInsert = fn.indexOf('insert into public.portal_login_attempts (phone_key) values (v_key)');
  assert.ok(keyGuard >= 0 && keyGuard < lock);
  assert.ok(lock < count, 'lock must be acquired before checking the attempt count');
  assert.ok(count < failedInsert, 'failed attempts must be counted only after acquiring the lock');
  assert.match(fn, /tried_at > now\(\) - interval '15 minutes'\) >= 5/);
});

test('the intermediate atomic migration fails closed until a later login migration grants execution', () => {
  assert.match(atomicMigration, /pg_advisory_xact_lock/);
  assert.match(atomicMigration, /revoke all on function public\.patient_portal_login\(text, date\) from public, anon, authenticated/);
  assert.doesNotMatch(atomicMigration, /grant execute on function public\.patient_portal_login/);
});

test('temporary staging migration removes only the phone OTP gate and grants the portal RPC to anon', () => {
  const fn = loginFunction(migration);
  assert.doesNotMatch(fn, /auth\.uid\(\)|phone_confirmed_at|auth\.users/);
  assert.match(fn, /birth_date = p_birth[\s\S]*?norm_phone_eg\(phone\) = v_key/);
  assert.match(migration, /grant execute on function public\.patient_portal_login\(text, date\) to anon, authenticated/);
  assert.match(migration, /TEMPORARY STAGING ONLY[\s\S]*?Do not apply to production/);

  const portal = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
  assert.match(portal, /DB\.sb\.rpc\('patient_portal_login'/);
  assert.doesNotMatch(portal, /signInWithOtp|verifyOtp/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /ptOtpCode|ptOtpResend/);
  assert.match(html, /id="ptBirthDay"/);
  assert.match(html, /id="ptBirthMonth"/);
  assert.match(html, /id="ptBirthYear" type="text" inputmode="numeric"/);
  assert.match(portal, /function portalBirthDate\(dayValue, monthValue, yearValue\)/);
});

test('the effective (last) login rule in the fresh-install SQL is the staging one, not an OTP gate', () => {
  const definitions = loginFunctions(setup);
  const staging = loginFunction(migration);
  assert.ok(definitions.length > 0, 'setup SQL defines portal login');
  // Every definition, including the LAST one that actually takes effect,
  // must be the phone + birth-date staging rule.
  definitions.forEach((fn, i) => assert.equal(fn, staging, 'login definition #' + (i + 1) + ' matches staging'));
  assert.doesNotMatch(setup, /phone_confirmed_at/, 'no verified-phone OTP gate survives in the setup script');

  const grants = setup.match(/grant execute on function public\.patient_portal_login\(text, date\) to [^;]+;/g) || [];
  assert.ok(grants.length > 0, 'setup SQL grants EXECUTE on portal login');
  grants.forEach(line => assert.match(line, /anon, authenticated/, 'staging grant stays available to anon clients'));

  // The activation path stays in its own migration, never inside this script.
  assert.match(setup, /20261105_patient_portal_phone_otp\.sql/);
});

test('the OTP activation migration is preserved as the future switch', () => {
  const fn = loginFunction(otpMigration);
  assert.match(fn, /phone_confirmed_at/);
  assert.match(fn, /auth\.users/);
  assert.match(fn, /auth\.uid\(\) is null/);
  assert.match(otpMigration, /grant execute on function public\.patient_portal_login\(text, date\) to authenticated;/);
  assert.doesNotMatch(otpMigration, /grant execute on function public\.patient_portal_login\(text, date\) to anon/);
  assert.match(otpMigration, /delete from public\.patient_sessions;/);
});

test('README records the deferred-OTP decision and the activation checklist', () => {
  assert.match(readme, /OTP مؤجّل/);
  assert.match(readme, /أول تجربة فعلية/);
  assert.match(readme, /20261109_patient_portal_phone_otp_temporary_disable\.sql/);
  assert.match(readme, /20261105_patient_portal_phone_otp\.sql/);
  assert.match(readme, /20261110_fix_portal_phone_normalization\.sql/);
  assert.match(readme, /signInWithOtp/);
  assert.match(readme, /verifyOtp/);
  assert.match(readme, /anon/);
  assert.match(readme, /غير جاهز لبيانات مرضى حقيقية/);
  assert.doesNotMatch(readme, /بوابة المريض تتطلب الآن Supabase Auth Phone OTP/);
});
