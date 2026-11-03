'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261109_patient_portal_phone_otp_temporary_disable.sql'), 'utf8');
const atomicMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261103_patient_portal_login_atomic.sql'), 'utf8');

function loginFunction(source) {
  const start = source.indexOf('create or replace function public.patient_portal_login(p_phone text, p_birth date)');
  assert.notEqual(start, -1, 'patient portal login function exists');
  const endMarker = 'end; $$;';
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'patient portal login function terminates');
  return source.slice(start, end + endMarker.length);
}

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
  assert.equal(loginFunction(setup), fn);
  assert.match(setup, /grant execute on function public\.patient_portal_login\(text, date\) to anon, authenticated/);

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
