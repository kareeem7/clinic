'use strict';

// Synthetic records only. All PostgREST calls are mocked; no live clinic data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'js/health-monitoring.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_patient_health_tracking.sql'), 'utf8');
const clinicalMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_clinical_records.sql'), 'utf8');
const setup = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const patientSource = fs.readFileSync(path.join(root, 'js/patient.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function makeDB({ patients = [], readings = [], fail = null } = {}) {
  const calls = [], store = readings.map(row => ({ ...row })), patientRows = patients.map(row => ({ ...row }));
  const state = { patients: patientRows, patientIndex: Object.fromEntries(patientRows.map(p => [p.id, p])) };
  const context = vm.createContext({ State: state, Date, Number, Object, Array, String, Math, todayISO: () => '2026-11-02' });
  context.getPatient = id => state.patients.find(p => p.id === id) || state.patientIndex[id] || null;
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.uid = 'doctor-A';
  DB.audit = async (...args) => calls.push({ audit: args });
  DB.fetchAll = async build => {
    const query = build();
    const tableRows = query.table === 'patient_health_readings' ? store : patientRows;
    return tableRows.filter(row => (query.filters || []).every(([kind, key, value]) => kind === 'eq'
      ? row[key] === value : (value === null ? row[key] == null : row[key] === value)));
  };
  DB.sb = {
    from(table) {
      const call = { table, filters: [], operation: 'select', payload: null };
      calls.push(call);
      const query = {
        table, filters: call.filters,
        select() { return this; },
        eq(key, value) { call.filters.push(['eq', key, value]); return this; },
        is(key, value) { call.filters.push(['is', key, value]); return this; },
        order(key, options = {}) { call.order = [key, options]; return this; },
        insert(payload) { call.operation = 'insert'; call.payload = payload; return this; },
        update(payload) { call.operation = 'update'; call.payload = payload; return this; },
        async single() {
          if (fail === 'insert') return { data: null, error: { message: 'synthetic insert failure' } };
          const row = { id: table + '-' + (store.length + 1), ...call.payload };
          (table === 'patients' ? patientRows : store).push(row);
          return { data: { ...row }, error: null };
        },
        async maybeSingle() {
          if (fail === 'update' && call.operation === 'update') return { data: null, error: { message: 'synthetic update failure' } };
          const tableRows = table === 'patients' ? patientRows : store;
          const row = tableRows.find(item => call.filters.every(([kind, key, value]) => kind === 'eq'
            ? item[key] === value : (value === null ? item[key] == null : item[key] === value)));
          if (!row) return { data: null, error: null };
          if (call.operation === 'update') Object.assign(row, call.payload);
          return { data: { ...row }, error: null };
        }
      };
      return query;
    }
  };
  return { DB, calls, state, store, patientRows, context };
}

function makeUI({ features = { glucoseTracking: true, bloodPressureTracking: true }, patient = null, readings = [], fail = null } = {}) {
  const p = patient || { id: 'patient-1', name: 'Synthetic patient', diagnosis: '', glucoseTrackingEnabled: false, bloodPressureTrackingEnabled: false };
  const calls = { updates: [], adds: [], edits: [], loads: [], toasts: [], errors: [], opened: [], closed: 0 };
  const controls = {};
  const checkbox = checked => ({ checked, disabled: false, onchange: null });
  controls['#patHealthMonitoring'] = { innerHTML: '' };
  controls['#patientTrackGlucose'] = checkbox(p.glucoseTrackingEnabled === true);
  controls['#patientTrackPressure'] = checkbox(p.bloodPressureTrackingEnabled === true);
  controls['#patHealthTab'] = { classList: { active: false, hidden: true, toggle(_c, hidden) { this.hidden = hidden; }, contains(k) { return k === 'active' && this.active; } } };
  controls['#ptab-health'] = { classList: { add() { this.hidden = true; }, hidden: true } };
  controls['#healthReadingForm'] = {};
  controls['#healthDate'] = { value: '2026-11-02' };
  controls['#healthTime'] = { value: '10:00' };
  controls['#healthGlucoseValue'] = { value: '99' };
  controls['#healthGlucoseType'] = { value: 'fasting' };
  controls['#healthSystolic'] = { value: '120' };
  controls['#healthDiastolic'] = { value: '80' };
  controls['#healthPulse'] = { value: '' };
  controls['#healthReadingError'] = { textContent: '', classList: { add() {}, remove() {} } };
  const button = { disabled: false };
  const form = controls['#healthReadingForm'];
  const rows = readings.map(r => ({ ...r }));
  const DB = {
    async updatePatientMonitoring(pid, patch) {
      calls.updates.push({ pid, patch });
      if (fail === 'setting') throw new Error('synthetic setting failure');
      Object.assign(p, patch);
      return patch;
    },
    async loadHealthReadings(pid) { calls.loads.push(pid); return rows.filter(r => r.patientId === pid); },
    async addHealthReading(pid, reading) {
      calls.adds.push({ pid, reading });
      if (fail === 'reading') throw new Error('synthetic reading failure');
      return { id: 'new-reading', ...reading, source: 'clinic' };
    },
    async updateHealthReading(pid, id, reading) { calls.edits.push({ pid, id, reading }); return { id, ...reading }; }
  };
  const context = vm.createContext({
    State: { settings: { clinicalFeatures: features }, route: 'patient', param: p.id },
    Charts: {}, window: { Chart: null },
    normalizeClinicalFeatures: value => ({ glucoseTracking: value && value.glucoseTracking === true, bloodPressureTracking: value && value.bloodPressureTracking === true }),
    getPatient: id => id === p.id ? p : null,
    $: selector => controls[selector] || null,
    $$: () => [],
    DB,
    openModal: (title, html) => calls.opened.push({ title, html }),
    closeModal: () => calls.closed++,
    switchPTab() {},
    toast: (message, type) => calls.toasts.push({ message, type }),
    todayISO: () => '2026-11-02',
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    emptyHTML: (_icon, title) => '<div>' + title + '</div>'
  });
  vm.runInContext(uiSource, context, { filename: 'health-monitoring.js' });
  context.patient = p;
  form.onsubmit = null;
  form.querySelector = () => button;
  return { context, p, calls, controls, form, button, DB, rows };
}

test('per-patient switches live on the scoped patient row and are embedded in setup SQL', () => {
  assert.match(migration, /add column if not exists glucose_tracking_enabled boolean not null default false/i);
  assert.match(migration, /add column if not exists blood_pressure_tracking_enabled boolean not null default false/i);
  assert.match(setup, /add column if not exists glucose_tracking_enabled boolean not null default false/i);
  assert.match(setup, /add column if not exists blood_pressure_tracking_enabled boolean not null default false/i);
  assert.match(index, /id="patHealthTab"[^>]*data-ptab="health"/);
  assert.match(patientSource, /loadPatientHealthMonitoring\(p\)/);
  assert.match(clinicalMigration, /create policy patient_health_readings_own[\s\S]*?auth\.uid\(\) = doctor_id[\s\S]*?clinic_active[\s\S]*?aal2/);
  assert.match(clinicalMigration, /revoke all on public\.patient_health_readings from anon, public/);
  assert.doesNotMatch(uiSource, /console\.(?:log|warn|error)\s*\(/);
});

test('doctor can enable glucose only, pressure only, or both without relying on diagnosis text', async () => {
  for (const [features, expectedFields] of [
    [{ glucoseTracking: true, bloodPressureTracking: false }, ['#patientTrackGlucose']],
    [{ glucoseTracking: false, bloodPressureTracking: true }, ['#patientTrackPressure']],
    [{ glucoseTracking: true, bloodPressureTracking: true }, ['#patientTrackGlucose', '#patientTrackPressure']]
  ]) {
    const ui = makeUI({ features, patient: { id: 'patient-1', name: 'Synthetic patient', diagnosis: '', glucoseTrackingEnabled: false, bloodPressureTrackingEnabled: false } });
    await vm.runInContext('renderPatientHealthMonitoring(patient, [])', ui.context);
    const html = ui.controls['#patHealthMonitoring'].innerHTML;
    assert.match(html, /مستقلة عن التشخيص/);
    assert.doesNotMatch(html, /توصية علاجية|غير طبيعي|سكري مثبت|تشخيص مطلوب/);
    assert.equal(html.includes('id="patientTrackGlucose"'), expectedFields.includes('#patientTrackGlucose'));
    assert.equal(html.includes('id="patientTrackPressure"'), expectedFields.includes('#patientTrackPressure'));
    if (features.glucoseTracking) {
      ui.controls['#patientTrackGlucose'].checked = true;
      await ui.controls['#patientTrackGlucose'].onchange();
      assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.updates[0].patch)), { glucoseTrackingEnabled: true });
    }
    if (features.bloodPressureTracking) {
      ui.controls['#patientTrackPressure'].checked = true;
      await ui.controls['#patientTrackPressure'].onchange();
      const last = ui.calls.updates.at(-1);
      assert.deepEqual(JSON.parse(JSON.stringify(last.patch)), { bloodPressureTrackingEnabled: true });
    }
  }
});

test('DB persists per-patient flags with doctor, patient, and active-row filters; failure leaves state unchanged', async () => {
  const patient = { id: 'patient-1', doctor_id: 'doctor-A', glucose_tracking_enabled: false, blood_pressure_tracking_enabled: false };
  const { DB, calls, state } = makeDB({ patients: [patient] });
  await DB.updatePatientMonitoring('patient-1', { glucoseTrackingEnabled: true, bloodPressureTrackingEnabled: true });
  const query = calls.find(c => c.table === 'patients' && c.operation === 'update');
  assert.equal(query.payload.glucose_tracking_enabled, true);
  assert.equal(query.payload.blood_pressure_tracking_enabled, true);
  assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === 'patient-1'));
  assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'doctor_id' && f[2] === 'doctor-A'));
  assert.ok(query.filters.some(f => f[0] === 'is' && f[1] === 'deleted_at' && f[2] === null));
  assert.equal(state.patients[0].glucoseTrackingEnabled, true);
  await assert.rejects(DB.updatePatientMonitoring('patient-1', { glucoseTrackingEnabled: 'true' }), e => e.code === 'invalid_monitoring_setting');
  const failing = makeDB({ patients: [patient], fail: 'update' });
  await assert.rejects(failing.DB.updatePatientMonitoring('patient-1', { glucoseTrackingEnabled: true }));
  assert.equal(failing.state.patients[0].glucose_tracking_enabled, false);
});

test('doctor-entered glucose and blood-pressure readings validate required fields; pulse remains optional', async () => {
  const { DB, calls, store } = makeDB();
  const glucose = await DB.addHealthReading('patient-1', { readingType: 'glucose', glucoseValue: '5.8', glucoseType: 'fasting', recordedAt: '2026-11-02T08:30:00.000Z', doctorId: 'other', source: 'patient' });
  const pressure = await DB.addHealthReading('patient-1', { readingType: 'blood_pressure', systolic: '121', diastolic: '79', pulse: '', recordedAt: '2026-11-02T09:30:00.000Z' });
  assert.equal(glucose.source, 'clinic');
  assert.equal(pressure.pulse, null);
  const inserts = calls.filter(c => c.table === 'patient_health_readings' && c.operation === 'insert');
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].payload.patient_id, 'patient-1');
  assert.equal(inserts[0].payload.doctor_id, 'doctor-A');
  assert.equal(inserts[0].payload.source, 'clinic');
  assert.equal(store.length, 2);
  for (const invalid of [
    { readingType: 'glucose', glucoseValue: 100 },
    { readingType: 'glucose', glucoseValue: '', glucoseType: 'random' },
    { readingType: 'blood_pressure', systolic: 120 },
    { readingType: 'blood_pressure', systolic: 120, diastolic: '' },
    { readingType: 'blood_pressure', systolic: 120, diastolic: 80, pulse: 'bad' }
  ]) await assert.rejects(DB.addHealthReading('patient-1', invalid), e => e.code === 'invalid_health_reading');
  await assert.rejects(DB.addHealthReading('patient-1', { readingType: 'glucose', glucoseValue: 100, glucoseType: 'random', recordedAt: 'not-a-date' }), e => e.code === 'invalid_health_reading');
});

test('records are filtered by both patient and doctor and retain date, type, source, and independent rows', async () => {
  const readings = [
    { id: 'g1', patient_id: 'patient-1', doctor_id: 'doctor-A', reading_type: 'glucose', glucose_value: 103, glucose_type: 'random', recorded_at: '2026-11-02T10:00:00Z', source: 'clinic' },
    { id: 'bp1', patient_id: 'patient-1', doctor_id: 'doctor-A', reading_type: 'blood_pressure', systolic: 122, diastolic: 81, pulse: null, recorded_at: '2026-11-01T10:00:00Z', source: 'clinic' },
    { id: 'other-patient', patient_id: 'patient-2', doctor_id: 'doctor-A', reading_type: 'glucose', glucose_value: 90, glucose_type: 'fasting', recorded_at: '2026-11-02T10:00:00Z', source: 'clinic' },
    { id: 'other-doctor', patient_id: 'patient-1', doctor_id: 'doctor-B', reading_type: 'glucose', glucose_value: 90, glucose_type: 'fasting', recorded_at: '2026-11-02T10:00:00Z', source: 'clinic' }
  ];
  const { DB, calls } = makeDB({ readings });
  const rows = await DB.loadHealthReadings('patient-1');
  assert.deepEqual(rows.map(r => r.id), ['g1', 'bp1']);
  const query = calls.find(c => c.table === 'patient_health_readings');
  assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'patient_id' && f[2] === 'patient-1'));
  assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'doctor_id' && f[2] === 'doctor-A'));
  assert.equal(rows[0].recordedAt, '2026-11-02T10:00:00Z');
  assert.equal(rows[0].glucoseType, 'random');
  assert.equal(rows[0].source, 'clinic');
});

test('doctor forms save sugar and pressure independently and show a clear error on database failure', async () => {
  const sugar = makeUI({ patient: { id: 'patient-1', name: 'Synthetic patient', glucoseTrackingEnabled: true, bloodPressureTrackingEnabled: false } });
  vm.runInContext("openHealthReadingModal('patient-1', 'glucose')", sugar.context);
  assert.match(sugar.calls.opened[0].html, /نوع التحليل/);
  await sugar.form.onsubmit({ preventDefault() {}, target: { querySelector: () => sugar.button } });
  assert.equal(sugar.calls.adds[0].reading.glucoseType, 'fasting');
  assert.equal(sugar.calls.adds[0].reading.glucoseValue, '99');
  assert.equal(sugar.calls.closed, 1);

  const pressure = makeUI({ patient: { id: 'patient-1', name: 'Synthetic patient', glucoseTrackingEnabled: false, bloodPressureTrackingEnabled: true } });
  vm.runInContext("openHealthReadingModal('patient-1', 'blood_pressure')", pressure.context);
  assert.match(pressure.calls.opened[0].html, /الضغط الانقباضي \*/);
  assert.match(pressure.calls.opened[0].html, /الضغط الانبساطي \*/);
  assert.match(pressure.calls.opened[0].html, /النبض \(اختياري\)/);
  await pressure.form.onsubmit({ preventDefault() {}, target: { querySelector: () => pressure.button } });
  assert.equal(pressure.calls.adds[0].reading.systolic, '120');
  assert.equal(pressure.calls.adds[0].reading.diastolic, '80');
  assert.equal(pressure.calls.adds[0].reading.pulse, null);

  const failing = makeUI({ patient: { id: 'patient-1', name: 'Synthetic patient', glucoseTrackingEnabled: true }, fail: 'reading' });
  vm.runInContext("openHealthReadingModal('patient-1', 'glucose')", failing.context);
  await failing.form.onsubmit({ preventDefault() {}, target: { querySelector: () => failing.button } });
  assert.ok(failing.controls['#healthReadingError'].textContent);
  assert.equal(failing.calls.closed, 0);
});

test('disabling a patient switch preserves the history, and the UI renders dated typed source-labelled entries', async () => {
  const patient = { id: 'patient-1', name: 'Synthetic patient', diagnosis: '', glucoseTrackingEnabled: false, bloodPressureTrackingEnabled: true };
  const entries = [
    { id: 'g1', patientId: 'patient-1', readingType: 'glucose', glucoseValue: 105, glucoseType: 'post_meal', recordedAt: '2026-11-02T10:00:00Z', source: 'clinic' },
    { id: 'bp1', patientId: 'patient-1', readingType: 'blood_pressure', systolic: 123, diastolic: 82, pulse: 71, recordedAt: '2026-11-01T09:00:00Z', source: 'patient' }
  ];
  const ui = makeUI({ patient, readings: entries });
  await vm.runInContext('loadPatientHealthMonitoring(patient)', ui.context);
  const html = ui.controls['#patHealthMonitoring'].innerHTML;
  assert.match(html, /قراءة سكر/);
  assert.match(html, /بعد الأكل/);
  assert.match(html, /من العيادة/);
  assert.match(html, /قراءة ضغط/);
  assert.match(html, /123/);
  assert.match(html, /من بوابة المريض/);
  assert.equal(ui.calls.loads[0], 'patient-1');
  ui.controls['#patientTrackPressure'].checked = false;
  await ui.controls['#patientTrackPressure'].onchange();
  assert.equal(ui.p.bloodPressureTrackingEnabled, false);
  assert.equal(ui.p.healthReadings.length, 2);
  assert.match(ui.controls['#patHealthMonitoring'].innerHTML, /السجل السابق محفوظ/);
});
