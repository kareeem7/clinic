'use strict';

// Portal/RPC checks use synthetic tokens and values; no live patient data or Supabase calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const portalSource = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_patient_portal_health_readings.sql'), 'utf8');
const clinicalMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_clinical_records.sql'), 'utf8');
const portalIndex = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf('create or replace function public.' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const end = source.indexOf('end; $$;', start);
  assert.notEqual(end, -1, name + ' body must terminate');
  return source.slice(start, end);
}

test('server RPCs are session-, clinic-, patient-, and feature-scoped; portal cannot access readings directly', () => {
  const flags = functionBody(migration, 'patient_portal_health_tracking');
  const write = functionBody(migration, 'patient_portal_add_health_reading');
  for (const body of [flags, write]) {
    assert.match(body, /where token = p_token and expires_at > now\(\)/);
    assert.match(body, /public\.clinic_active\(v_s\.doctor_id\)/);
    assert.match(body, /id = v_s\.patient_id and doctor_id = v_s\.doctor_id and deleted_at is null/);
  }
  assert.match(flags, /glucose_tracking_enabled/);
  assert.match(flags, /blood_pressure_tracking_enabled/);
  assert.match(write, /glucose_tracking_enabled/);
  assert.match(write, /blood_pressure_tracking_enabled/);
  assert.match(write, /glucoseTracking/);
  assert.match(write, /bloodPressureTracking/);
  assert.match(write, /p_glucose_value is null[\s\S]*?p_glucose_value > 2000/);
  assert.match(write, /p_glucose_type is null[\s\S]*?p_glucose_type not in \('fasting', 'post_meal', 'random'\)/);
  assert.match(write, /p_systolic is null[\s\S]*?p_systolic > 400/);
  assert.match(write, /p_diastolic is null[\s\S]*?p_diastolic > 300/);
  assert.match(write, /p_pulse is not null and \(p_pulse < 1 or p_pulse > 400\)/);
  assert.match(write, /recorded_at[\s\S]*?now\(\)[\s\S]*?'patient', p_request_id/);
  assert.doesNotMatch(write.slice(0, write.indexOf('returns jsonb')), /p_patient_id|p_recorded_at|p_source|p_date/);
  assert.match(write, /on conflict \(patient_id, portal_request_id\)[\s\S]*?do nothing/);
  assert.match(write, /v_existing\.glucose_value is not distinct from p_glucose_value/);
  assert.match(write, /return jsonb_build_object\('ok', true, 'duplicate', true\)/);
  assert.match(write, /jsonb_build_object\('via', 'portal'\)/);
  assert.doesNotMatch(write, /jsonb_build_object\([^\n]*(?:glucose_value|systolic|diastolic|pulse)/i);
  assert.match(migration, /revoke all on function public\.patient_portal_add_health_reading\([\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.patient_portal_add_health_reading\([\s\S]*?to anon, authenticated/);
  assert.match(clinicalMigration, /revoke all on public\.patient_health_readings from anon, public/);
  assert.doesNotMatch(portalSource, /\.from\(['"]patient_health_readings['"]\)/);
  assert.match(portalIndex, /id="ptHealthTracking"/);
  assert.match(portalSource, /id=.{0,1}ptHealthGlucoseValue/);
  assert.match(portalSource, /id=.{0,1}ptHealthSystolic/);
  const patientHealthFormSource = portalSource.slice(portalSource.indexOf('function renderPortalHealthTracking'), portalSource.indexOf('async function portalSubmitHealthReading'));
  assert.doesNotMatch(patientHealthFormSource, /type=.{0,2}(?:file|date)/);
});

test('standalone migration and setup SQL both install request idempotency and both portal RPCs', () => {
  for (const source of [migration, config]) {
    assert.match(source, /portal_request_id uuid/);
    assert.match(source, /patient_health_readings_portal_request_uidx/);
    assert.match(source, /patient_portal_health_tracking\(p_token uuid\)/);
    assert.match(source, /patient_portal_add_health_reading\(/);
    assert.match(source, /grant execute on function public\.patient_portal_health_tracking\(uuid\) to anon, authenticated/);
  }
});

function harness(rpcImpl = async () => ({ data: { ok: true }, error: null })) {
  const elements = new Map(), session = new Map(), calls = [], screens = [], toasts = [];
  const charts = {};
  function $(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      const element = {
        value: '', innerHTML: '', textContent: '', dataset: {}, disabled: false,
        classList: {
          add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
          contains(name) { return classes.has(name); },
          toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
        },
        addEventListener(name, handler) { this['on' + name] = handler; },
        removeAttribute(name) { delete this[name]; }
      };
      elements.set(selector, element);
    }
    return elements.get(selector);
  }
  const crypto = { randomUUID: () => '11111111-1111-4111-8111-111111111111' };
  const context = vm.createContext({
    sessionStorage: {
      getItem: key => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
      removeItem: key => session.delete(key)
    },
    document: { body: { classList: { add() {}, remove() {} } }, querySelector: $ },
    window: { crypto }, $, $$: () => [], Charts: charts,
    todayISO: () => '2026-11-02', humanDate: value => value, relDay: value => value,
    fmtTime: value => value, esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    toast: (message, type) => toasts.push({ message, type }), switchAuthTab() {}, showScreen: name => screens.push(name),
    DB: { sb: { rpc(name, args) { calls.push({ name, args }); return rpcImpl(name, args); } } }
  });
  vm.runInContext(portalSource, context, { filename: 'patient-portal.js' });
  vm.runInContext('Portal.render = () => {}', context);
  return {
    context, $, calls, screens, toasts, session,
    setRpc(fn) { rpcImpl = fn; },
    setPatient({ id = 'patient-A', glucose = true, pressure = true, type = 'nutrition' } = {}) {
      vm.runInContext(`Portal.token = 'token-A'; Portal.data = { patient: { id: '${id}', type: '${type}', healthTracking: { glucose: ${glucose}, bloodPressure: ${pressure} } } }`, context);
    }
  };
}

function setGlucose(app, { value = '117', type = 'random' } = {}) {
  app.$('#ptHealthGlucoseValue').value = value;
  app.$('#ptHealthGlucoseType').value = type;
}
function setPressure(app, { systolic = '128', diastolic = '82', pulse = '' } = {}) {
  app.$('#ptHealthSystolic').value = systolic;
  app.$('#ptHealthDiastolic').value = diastolic;
  app.$('#ptHealthPulse').value = pulse;
}

 test('only doctor-enabled tracking types render numeric manual forms with no date or attachment control', () => {
  const app = harness(); app.setPatient({ glucose: true, pressure: false });
  vm.runInContext("renderPortalHealthTracking(Portal.data.patient.healthTracking)", app.context);
  const html = app.$('#ptHealthTracking').innerHTML;
  assert.match(html, /ptHealthGlucoseForm/);
  assert.doesNotMatch(html, /ptHealthPressureForm/);
  assert.doesNotMatch(html, /type="file"|<input[^>]+type="date"|ptHealth.*Date/);
  const disabled = harness(); disabled.setPatient({ glucose: false, pressure: false });
  vm.runInContext("renderPortalHealthTracking(Portal.data.patient.healthTracking)", disabled.context);
  assert.equal(disabled.$('#ptHealthTracking').innerHTML, '');
});

test('physiotherapy patient sees an explanation instead of a blank measurement tab when tracking is disabled', () => {
  const app = harness(); app.setPatient({ type: 'pt', glucose: false, pressure: false });
  vm.runInContext("renderPortalHealthTracking(Portal.data.patient.healthTracking)", app.context);
  assert.match(app.$('#ptHealthTracking').innerHTML, /غير مفعّل لهذا الملف/);
  assert.match(app.$('#ptHealthTracking').innerHTML, /تواصل مع العيادة/);
});

test('authorized patient writes glucose and blood-pressure values through the session RPC only', async () => {
  const app = harness(); app.setPatient();
  let saves = 0;
  app.setRpc(async () => { saves++; return { data: { ok: true, duplicate: false }, error: null }; });
  setGlucose(app, { value: '117.5', type: 'post_meal' });
  await vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  const glucose = app.calls[0];
  assert.equal(glucose.name, 'patient_portal_add_health_reading');
  assert.equal(glucose.args.p_token, 'token-A');
  assert.equal(glucose.args.p_reading_type, 'glucose');
  assert.equal(glucose.args.p_glucose_value, 117.5);
  assert.equal(glucose.args.p_glucose_type, 'post_meal');
  assert.equal(glucose.args.p_systolic, null);
  assert.equal(glucose.args.p_source, undefined);
  assert.equal(glucose.args.p_recorded_at, undefined);
  assert.equal(app.$('#ptHealthGlucoseMessage').textContent, 'تم حفظ القراءة بنجاح.');
  assert.equal(app.$('#ptHealthGlucoseValue').value, '');

  app.setPatient(); setPressure(app, { systolic: '128', diastolic: '82', pulse: '' });
  await vm.runInContext("portalSubmitHealthReading('blood_pressure')", app.context);
  const pressure = app.calls.at(-1);
  assert.equal(pressure.args.p_reading_type, 'blood_pressure');
  assert.equal(pressure.args.p_systolic, 128);
  assert.equal(pressure.args.p_diastolic, 82);
  assert.equal(pressure.args.p_pulse, null);
  assert.equal(pressure.args.p_glucose_value, null);
  assert.equal(saves, 2);
});

test('disabled type cannot submit directly; client validation rejects missing or unreasonable values before RPC', async () => {
  const app = harness(); app.setPatient({ glucose: false, pressure: false });
  await vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  assert.equal(app.calls.length, 0);
  app.setPatient({ glucose: true, pressure: true });
  setGlucose(app, { value: '0', type: '' });
  await vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  setPressure(app, { systolic: '', diastolic: '80', pulse: 'bad' });
  await vm.runInContext("portalSubmitHealthReading('blood_pressure')", app.context);
  assert.equal(app.calls.length, 0);
  assert.match(app.$('#ptHealthGlucoseMessage').textContent, /تحقق/);
  assert.match(app.$('#ptHealthPressureMessage').textContent, /أدخل/);
});

test('double submit is locked, retry reuses the idempotency key, and late old-session replies cannot affect another patient', async () => {
  const app = harness(); app.setPatient(); setGlucose(app);
  let release;
  app.setRpc(() => new Promise(resolve => { release = resolve; }));
  const first = vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  await Promise.resolve();
  const duplicateClick = await vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  assert.equal(duplicateClick, undefined);
  assert.equal(app.calls.length, 1);
  const requestId = app.calls[0].args.p_request_id;
  assert.match(requestId, /^[0-9a-f-]{36}$/i);
  vm.runInContext("Portal.token = 'token-B'; Portal.data = { patient: { id: 'patient-B', healthTracking: { glucose: true } } }", app.context);
  release({ data: { ok: true, duplicate: false }, error: null });
  await first;
  assert.equal(app.$('#ptHealthGlucoseValue').value, '117');
  assert.notEqual(app.$('#ptHealthGlucoseMessage').textContent, 'تم حفظ القراءة بنجاح.');
});

test('network retry reuses the request key; expired or rejected sessions never show success', async () => {
  const app = harness(); app.setPatient(); setGlucose(app);
  let attempt = 0;
  app.setRpc(async () => {
    attempt++;
    if (attempt === 1) throw new Error('network down');
    return { data: { ok: true, duplicate: true }, error: null };
  });
  await vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  const firstId = app.calls[0].args.p_request_id;
  assert.match(app.$('#ptHealthGlucoseMessage').textContent, /تعذّر الاتصال/);
  await vm.runInContext("portalSubmitHealthReading('glucose')", app.context);
  assert.equal(app.calls[1].args.p_request_id, firstId);
  assert.match(app.$('#ptHealthGlucoseMessage').textContent, /محفوظة بالفعل/);

  const expired = harness(); expired.setPatient(); setGlucose(expired);
  expired.setRpc(async () => ({ data: { ok: false, error: 'انتهت جلستك — سجّل دخولك من جديد' }, error: null }));
  await vm.runInContext("portalSubmitHealthReading('glucose')", expired.context);
  assert.equal(vm.runInContext('Portal.token', expired.context), null);
  assert.ok(expired.screens.includes('login'));
  assert.equal(expired.calls.length, 1);
});
