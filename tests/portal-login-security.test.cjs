'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261105_patient_portal_phone_otp.sql'), 'utf8');
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

test('the intermediate atomic migration fails closed until OTP is installed', () => {
  assert.match(atomicMigration, /pg_advisory_xact_lock/);
  assert.match(atomicMigration, /revoke all on function public\.patient_portal_login\(text, date\) from public, anon, authenticated/);
  assert.doesNotMatch(atomicMigration, /grant execute on function public\.patient_portal_login/);
});

test('setup SQL and the standalone OTP migration use the same function body and authenticated-only grant', () => {
  assert.equal(loginFunction(setup), loginFunction(migration));
  for (const source of [setup, migration]) {
    assert.match(source, /auth\.uid\(\) is null or not exists[\s\S]*?phone_confirmed_at is not null[\s\S]*?norm_phone_eg\(u\.phone\) = v_key/);
    assert.match(source, /revoke all on function public\.patient_portal_login\(text, date\) from public, anon, authenticated/);
    assert.match(source, /grant execute on function public\.patient_portal_login\(text, date\) to authenticated/);
    assert.doesNotMatch(source, /grant execute on function public\.patient_portal_login\(text, date\) to anon/);
  }
  assert.match(migration, /delete from public\.patient_sessions/);
  const portal = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
  assert.match(portal, /signInWithOtp\(\{ phone: normalized, options: \{ shouldCreateUser: true \} \}\)/);
  assert.match(portal, /verifyOtp\(\{ phone: normalized, token: String\(otp\), type: 'sms' \}\)/);
  assert.match(portal, /auth\.rpc\('patient_portal_login'/);
});
