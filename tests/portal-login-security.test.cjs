'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261103_patient_portal_login_atomic.sql'), 'utf8');

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

test('setup SQL and the standalone atomic-login migration use the same function body and explicit portal grants', () => {
  assert.equal(loginFunction(setup), loginFunction(migration));
  for (const source of [setup, migration]) {
    assert.match(source, /revoke all on function public\.patient_portal_login\(text, date\) from public, anon, authenticated/);
    assert.match(source, /grant execute on function public\.patient_portal_login\(text, date\) to anon, authenticated/);
  }
});
