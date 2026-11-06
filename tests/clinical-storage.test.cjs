'use strict';

// Schema-source and mocked PostgREST tests. Actual RLS/JWT behavior requires Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_clinical_records.sql'), 'utf8');
const config = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');

function migrationBody(sql) {
  return sql.slice(sql.indexOf('begin;') + 'begin;'.length, sql.lastIndexOf('commit;')).trim();
}

test('setup SQL embeds the standalone additive clinical storage migration', () => {
  assert.ok(config.includes(migrationBody(migration)));
  for (const table of ['patient_labs', 'patient_health_readings']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /alter table public\.patient_records\s+add column if not exists bmi numeric/);
  assert.match(migration, /foreign key \(patient_id, doctor_id\)\s+references public\.patients\(id, doctor_id\)/);
  assert.doesNotMatch(migration, /\b(drop table|delete from public\.(patient_labs|patient_health_readings|patient_records))\b/i);
});

test('new clinical tables constrain MFA, active-clinic ownership and keep direct anon access closed', () => {
  for (const table of ['patient_labs', 'patient_health_readings']) {
    assert.match(migration, new RegExp(`create policy ${table}_own on public\\.${table}[\\s\\S]*?auth\\.uid\\(\\) = doctor_id[\\s\\S]*?clinic_active\\(auth\\.uid\\(\\)\\)[\\s\\S]*?aal2`));
    assert.match(migration, new RegExp(`create policy require_mfa on public\\.${table} as restrictive`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon, public`));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on public\\.${table} to authenticated`));
  }
  assert.doesNotMatch(migration, /grant[^;]*\b anon\b/i);
});

test('lab panels allow named numeric or text components with optional units and bounded component count', () => {
  assert.match(migration, /patient_lab_results_valid\(p_results jsonb\)/);
  assert.match(migration, /jsonb_typeof\(c->'value'\) not in \('number', 'string'\)/);
  assert.match(migration, /char_length\(btrim\(c->>'name'\)\) not between 1 and 100/);
  assert.match(migration, /jsonb_array_length\(p_results\) > 100/);
  assert.match(migration, /glucose_value is not null[\s\S]*?systolic is not null[\s\S]*?diastolic is not null/);
});

function makeHarness() {
  const calls = [];
  const context = vm.createContext({ State: {}, console, Date, Number, Object, Array, String, Math, todayISO: () => '2026-11-02' });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.uid = 'doctor-A';
  DB.audit = async (...args) => { calls.push({ audit: args }); };
  DB.fetchAll = async build => {
    const q = build();
    return q.rows || [];
  };
  DB.sb = {
    from(table) {
      const call = { table, filters: [], operation: 'select' };
      calls.push(call);
      const q = {
        rows: [],
        select() { return this; },
        insert(payload) { call.operation = 'insert'; call.payload = payload; return this; },
        update(payload) { call.operation = 'update'; call.payload = payload; return this; },
        eq(key, value) { call.filters.push(['eq', key, value]); return this; },
        is(key, value) { call.filters.push(['is', key, value]); return this; },
        order() { return this; }, range() { return this; },
        async single() { return { data: { id: 'record-1', ...call.payload }, error: null }; },
        async maybeSingle() {
          if (call.operation === 'select') return { data: { id: 'record-1', doctor_id: 'doctor-A', patient_id: 'patient-1', reading_type: 'glucose', glucose_value: 100, glucose_type: 'fasting', recorded_at: '2026-11-02T09:00:00Z' }, error: null };
          return { data: { id: 'record-1', ...call.payload }, error: null };
        },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
      };
      return q;
    }
  };
  return { DB, calls, context };
}

test('DB creates lab panels with caller-independent tenant and patient ownership', async () => {
  const { DB, calls } = makeHarness();
  const lab = await DB.addLab('patient-1', {
    testName: 'تحليل دهون', testedOn: '2026-11-02',
    results: [{ name: 'LDL', value: 120, unit: 'mg/dL' }, { name: 'ملاحظة', value: 'مرتفع' }],
    doctorId: 'attacker', patientId: 'other-patient', source: 'patient'
  });
  const insert = calls.find(c => c.table === 'patient_labs');
  assert.equal(insert.payload.doctor_id, 'doctor-A');
  assert.equal(insert.payload.patient_id, 'patient-1');
  assert.equal(insert.payload.source, 'clinic');
  assert.equal(insert.payload.results.length, 2);
  assert.equal(lab.testName, 'تحليل دهون');
});

test('DB rejects malformed lab components before issuing a database request', async () => {
  const { DB, calls } = makeHarness();
  await assert.rejects(DB.addLab('patient-1', { testName: 'تحليل', results: [{ name: '', value: NaN }] }), e => e.code === 'invalid_lab_results');
  assert.equal(calls.some(c => c.table === 'patient_labs'), false);
});

test('DB inserts blood pressure and glucose readings with the fixed clinic source', async () => {
  const { DB, calls } = makeHarness();
  await DB.addHealthReading('patient-1', { readingType: 'blood_pressure', systolic: 120, diastolic: 80, pulse: 72, source: 'patient', doctorId: 'other' });
  await DB.addHealthReading('patient-1', { readingType: 'glucose', glucoseValue: 105, glucoseType: 'post_meal' });
  const inserts = calls.filter(c => c.table === 'patient_health_readings' && c.operation === 'insert');
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].payload.doctor_id, 'doctor-A');
  assert.equal(inserts[0].payload.source, 'clinic');
  assert.equal(inserts[0].payload.systolic, 120);
  assert.equal(inserts[0].payload.diastolic, 80);
  assert.equal(inserts[0].payload.pulse, 72);
  assert.equal(inserts[1].payload.glucose_type, 'post_meal');
});

test('DB refuses incomplete or invalid readings and scopes updates to tenant and patient', async () => {
  const { DB, calls } = makeHarness();
  await assert.rejects(DB.addHealthReading('patient-1', { readingType: 'glucose', glucoseValue: 90 }), e => e.code === 'invalid_health_reading');
  await assert.rejects(DB.addHealthReading('patient-1', { readingType: 'blood_pressure', systolic: 120 }), e => e.code === 'invalid_health_reading');
  assert.equal(calls.length, 0);
  await DB.updateHealthReading('patient-1', 'record-1', { glucoseValue: 110 });
  const update = calls.find(c => c.table === 'patient_health_readings' && c.operation === 'update');
  assert.ok(update.filters.some(x => x[0] === 'eq' && x[1] === 'id' && x[2] === 'record-1'));
  assert.ok(update.filters.some(x => x[0] === 'eq' && x[1] === 'patient_id' && x[2] === 'patient-1'));
  assert.ok(update.filters.some(x => x[0] === 'eq' && x[1] === 'doctor_id' && x[2] === 'doctor-A'));
  assert.ok(update.filters.some(x => x[0] === 'is' && x[1] === 'deleted_at' && x[2] === null));
});
