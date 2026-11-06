'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261107_patient_portal_daily_write_limit.sql'), 'utf8');

function body(source, name, last = false) {
  const needle = 'create or replace function public.' + name + '(';
  const start = last ? source.lastIndexOf(needle) : source.indexOf(needle);
  assert.notEqual(start, -1);
  const end = source.indexOf('end; $$;', start) + 'end; $$;'.length;
  assert.ok(end > start);
  return source.slice(start, end);
}

test('atomic Cairo-day quota caps all patient-submitted reading types and does not charge idempotent retries twice', () => {
  const names = ['patient_portal_add_measurement', 'patient_portal_add_health_reading'];
  for (const name of names) {
    const fn = body(migration, name);
    assert.match(fn, /patient-portal-daily-writes:/);
    assert.match(fn, /pg_advisory_xact_lock/);
    assert.match(fn, /created_at at time zone 'Africa\/Cairo'/);
    assert.match(fn, /v_daily_count >= 20/);
    assert.match(fn, /patient_records/);
    assert.match(fn, /patient_health_readings/);
  }
  assert.match(body(migration, 'patient_portal_add_health_reading'), /portal_request_id is distinct from p_request_id/);
  assert.match(config, /2026-11-07 atomic 20\/day patient-portal write cap/);
  assert.match(migration, /add column if not exists created_at timestamptz/);
  assert.match(body(migration, 'patient_portal_add_measurement'), /source, created_at\)[\s\S]*'patient', now\(\)/);
  for (const name of names) assert.equal(body(config, name, true), body(migration, name));
});
