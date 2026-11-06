'use strict';

// Simulated form and DB only; no real patient information is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/patients.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8');
const setupSource = fs.readFileSync(path.join(__dirname, '../sql/baseline.sql'), 'utf8');
const measurementMigration = fs.readFileSync(path.join(__dirname, '../sql/migrations/20261102_patient_baseline_height.sql'), 'utf8');

function patientForm({ editing, weight = '', height = '', waist = '', hips = '', arm = '', features = true, failUpdate = false, patient = null, otherChecked = false, otherName = '' }) {
  const calls = { updates: [], adds: [], records: [], toasts: [], closed: 0, refreshed: 0 };
  const button = { disabled: false };
  const form = {};
  const fields = {
    '#f_name': { value: '  Test patient  ' }, '#f_phone': { value: '  00000  ' },
    '#f_age': { value: '30' }, '#f_gender': { value: 'ذكر' }, '#f_type': { value: 'nutrition' },
    '#f_height': { value: height }, '#f_weight': { value: weight }, '#f_waist': { value: waist },
    '#f_hips': { value: hips }, '#f_arm': { value: arm }, '#f_bmi': { textContent: '' },
    '#f_measure_date': { value: '2026-11-02' }, '#f_target': { value: '70' }, '#f_birth': { value: '2000-01-01' },
    '#f_consent': { checked: true }, '#f_diag': { value: '  goal  ' }, '#f_notes': { value: '  notes  ' },
    '#f_chronic_other': { checked: otherChecked || Boolean(patient && patient.chronic && patient.chronic.some(x => x && x.customCondition)) },
    '#f_chronic_other_name': { value: otherName || (patient && patient.chronic ? (patient.chronic.find(x => x && x.customCondition) || {}).customCondition || '' : '') },
    '#patientFormError': { textContent: '', classList: { add() {}, remove() {} } }
  };
  Object.values(fields).forEach(field => {
    if (!field.addEventListener) field.addEventListener = (name, handler) => { (field._listeners ||= {})[name] = handler; };
  });
  let markup = '';
  const context = vm.createContext({
    $: selector => selector === '#patientForm' ? form : (fields[selector] || null),
    $$: selector => selector === '[data-chronic]:checked' ? [{ value: 'diabetes' }] : [],
    openModal: (_title, html) => { markup = html; },
    closeModal: () => { calls.closed++; },
    refreshCurrent: () => { calls.refreshed++; },
    toast: (message, type) => { calls.toasts.push({ message, type }); },
    esc: value => String(value), weightChange: () => ({ current: null }), CHRONIC: { diabetes: { label: 'السكري', icon: 'fa-droplet', cls: 'rose' } },
    State: { settings: { clinicalFeatures: { measurements: features } } },
    normalizeClinicalFeatures: value => ({ measurements: Boolean(value && value.measurements) }),
    todayISO: () => '2026-11-02', uid: () => 'test-measurement',
    DB: {
      async update(col, id, data) { calls.updates.push({ col, id, data }); if (failUpdate) throw new Error('simulated failure'); },
      async add(col, data) { calls.adds.push({ col, data }); },
      async addRecord(id, data) { calls.records.push({ id, data }); }
    }
  });
  vm.runInContext(source, context, { filename: 'patients.js' });
  const patientData = patient || { id: 'test-patient', name: 'Test patient', measurements: [], _recordsLoaded: true };
  if (editing) { context.__patient = patientData; vm.runInContext('openPatientModal(__patient)', context); }
  else vm.runInContext('openPatientModal()', context);
  return {
    calls, button, fields, markup,
    submit: () => form.onsubmit({ preventDefault() {}, target: { querySelector: () => button } })
  };
}

test('editing an older patient with no measurement history safely leaves optional baseline inputs empty', async () => {
  const ui = patientForm({ editing: true });
  assert.equal(ui.markup.includes('id="f_weight"'), true);
  await ui.submit();
  assert.equal(ui.calls.updates.length, 1);
  assert.equal(ui.calls.updates[0].col, 'patients');
  assert.equal(ui.calls.updates[0].id, 'test-patient');
  const patch = ui.calls.updates[0].data;
  assert.equal(patch.name, 'Test patient');
  assert.equal(patch.phone, '00000');
  assert.equal(patch.birthDate, '2000-01-01');
  assert.equal(patch.consentWa, true);
  assert.deepEqual(Array.from(patch.chronic), ['diabetes']);
  assert.equal('measurements' in patch, false);
  assert.equal(ui.calls.adds.length, 0);
  assert.equal(ui.calls.records.length, 0);
  assert.equal(ui.calls.closed, 1);
  assert.equal(ui.calls.refreshed, 1);
});

test('adding still records an initial weight when present', async () => {
  const ui = patientForm({ editing: false, weight: '82.5' });
  assert.equal(ui.markup.includes('id="f_weight"'), true);
  await ui.submit();
  assert.equal(ui.calls.adds.length, 1);
  const data = ui.calls.adds[0].data;
  assert.equal(data.status, 'active');
  assert.equal(data.measurements.length, 1);
  assert.equal(data.measurements[0].weight, 82.5);
  assert.equal(ui.calls.closed, 1);
});

test('adding without baseline measurements keeps the measurement history empty', async () => {
  const ui = patientForm({ editing: false });
  await ui.submit();
  assert.equal(ui.calls.adds[0].data.measurements.length, 0);
});

test('initial body measurements are stored as a dated record with computed BMI', async () => {
  const ui = patientForm({ editing: false, weight: '82.5', height: '170', waist: '90', hips: '105', arm: '31' });
  assert.match(ui.markup, /id="f_bmi"/);
  await ui.submit();
  const patient = ui.calls.adds[0].data;
  assert.equal(patient.height, 170);
  assert.equal(patient.measurements.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(patient.measurements[0])), {
    date: '2026-11-02', height: 170, weight: 82.5, waist: 90, hips: 105, arm: 31,
    bmi: 28.5, recordType: 'manual', note: 'قياسات البداية'
  });
  assert.match(ui.fields['#f_bmi'].textContent, /28.5/);
});

test('BMI preview recalculates live and stays blank until weight and height are valid', () => {
  const ui = patientForm({ editing: false });
  assert.match(ui.fields['#f_bmi'].textContent, /سيظهر/);
  ui.fields['#f_weight'].value = '80';
  ui.fields['#f_height'].value = '175';
  ui.fields['#f_weight']._listeners.input();
  assert.match(ui.fields['#f_bmi'].textContent, /26\.1/);
  ui.fields['#f_height'].value = '70';
  ui.fields['#f_height']._listeners.change();
  assert.match(ui.fields['#f_bmi'].textContent, /سيظهر/);
});

test('invalid measurements are rejected before patient or measurement writes', async () => {
  const ui = patientForm({ editing: false, weight: '351', height: '170' });
  await ui.submit();
  assert.equal(ui.calls.adds.length, 0);
  assert.match(ui.fields['#patientFormError'].textContent, /راجع قياسات البداية/);
  assert.equal(ui.button.disabled, false);
});

test('disabling body measurements hides all its fields and keeps old height unchanged on edit', async () => {
  const legacy = { id: 'test-patient', name: 'Test patient', height: 168, measurements: [], _recordsLoaded: true };
  const ui = patientForm({ editing: true, features: false, patient: legacy });
  assert.doesNotMatch(ui.markup, /id="f_(?:height|weight|waist|hips|arm)"/);
  await ui.submit();
  assert.equal(Object.hasOwn(ui.calls.updates[0].data, 'height'), false);
  assert.equal(ui.calls.records.length, 0);
  const create = patientForm({ editing: false, features: false, height: '170' });
  assert.doesNotMatch(create.markup, /id="f_height"/);
  await create.submit();
  assert.equal(create.calls.adds[0].data.height, undefined);
  assert.deepEqual(Array.from(create.calls.adds[0].data.measurements), []);
});

test('editing a patient with measurement history does not rewrite profile height or append a duplicate baseline', async () => {
  const patient = { id: 'test-patient', name: 'Test patient', height: 175,
    measurements: [{ date: '2026-10-12', height: 175, weight: 80, waist: 88, bmi: 26.1 }], _recordsLoaded: true };
  const ui = patientForm({ editing: true, patient });
  assert.match(ui.markup, /id="f_height"[^>]* disabled/);
  assert.match(ui.markup, /id="f_weight"[^>]* disabled/);
  await ui.submit();
  assert.equal(Object.hasOwn(ui.calls.updates[0].data, 'height'), false);
  assert.equal(ui.calls.records.length, 0);
});

test('custom condition is saved with standard checkboxes and restored in the edit form', async () => {
  const add = patientForm({ editing: false, otherChecked: true, otherName: 'حساسية الصدر' });
  await add.submit();
  const chronic = add.calls.adds[0].data.chronic;
  assert.deepEqual(JSON.parse(JSON.stringify(chronic)), ['diabetes', { customCondition: 'حساسية الصدر' }]);
  const edit = patientForm({ editing: true, patient: { id: 'test-patient', name: 'Test patient', chronic, measurements: [], _recordsLoaded: true } });
  assert.match(edit.markup, /id="f_chronic_other" checked/);
  assert.match(edit.markup, /id="f_chronic_other_name" maxlength="100" value="حساسية الصدر"/);
  await edit.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(edit.calls.updates[0].data.chronic)), ['diabetes', { customCondition: 'حساسية الصدر' }]);
});

test('custom condition chips render legacy and custom entries safely', () => {
  const context = vm.createContext({ esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const html = vm.runInContext("chronicChips({chronic:['diabetes',{customCondition:'<script>x</script>'}]}, false)", context);
  assert.match(html, /السكري/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('manual record persistence recalculates BMI and ignores a stale supplied value', async () => {
  let inserted;
  const patient = { measurements: [] };
  const context = vm.createContext({
    State: { patients: [], patientIndex: {} },
    getPatient: () => patient,
    fromRow: (_table, row) => row
  });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const db = vm.runInContext('DB', context);
  db.uid = 'test-doctor';
  db.sb = { from: table => ({ insert: row => { assert.equal(table, 'patient_records'); inserted = row; return { select: async () => ({ data: [{ id: 'record-id' }], error: null }) }; } }) };
  db.audit = async () => {};
  await db.addRecord('patient-id', { date: '2026-11-02', height: 170, weight: 82.5, bmi: 99, recordType: 'manual' });
  assert.equal(inserted.height, 170);
  assert.equal(inserted.bmi, 28.5);
  assert.equal(patient.measurements[0].bmi, 28.5);
});

test('baseline measurement SQL is embedded, additive, dated and recomputes BMI from its own height and weight', () => {
  assert.match(measurementMigration, /add column if not exists height numeric/i);
  assert.match(measurementMigration, /insert into public\.patient_records\s*\([\s\S]*?date, height, weight, waist, hips, arm, bmi/i);
  assert.match(measurementMigration, /round\(v_weight \/ power\(v_height \/ 100, 2\), 1\)/i);
  assert.match(measurementMigration, /create or replace function public\.create_patient_with_measurements/i);
  assert.match(setupSource, /patient_records_height_range/);
  assert.match(dbSource, /date: m\.date \|\| todayISO\(\), height: m\.height \?\? null, weight: m\.weight \?\? null/);
  assert.match(dbSource, /height: 'height'/);
});

test('custom condition checkbox requires a name', async () => {
  const ui = patientForm({ editing: false, otherChecked: true, otherName: '' });
  await ui.submit();
  assert.equal(ui.calls.adds.length, 0);
  assert.match(ui.fields['#patientFormError'].textContent, /اسم الحالة الأخرى/);
});

test('a failed edit keeps the form open and allows retry', async () => {
  const ui = patientForm({ editing: true, failUpdate: true });
  await ui.submit();
  assert.equal(ui.calls.updates.length, 1);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.calls.closed, 0);
  assert.equal(ui.calls.refreshed, 0);
  assert.equal(ui.calls.toasts.at(-1).type, 'error');
});

const mainSource = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');

function editAction(patient, loadPatientFull, measurementsEnabled = false) {
  const opened = [], notices = [], loads = [], recordLoads = [];
  const context = vm.createContext({
    document: { addEventListener() {} },
    getPatient: () => patient,
    State: { settings: { clinicalFeatures: { measurements: measurementsEnabled } } },
    normalizeClinicalFeatures: value => ({ measurements: Boolean(value && value.measurements) }),
    DB: { async loadPatientFull(id) { loads.push(id); return loadPatientFull(id); }, async loadRecords(id) { recordLoads.push(id); } },
    openPatientModal: p => opened.push(p),
    toast: (message, type) => notices.push({ message, type }),
    logError() {}, explainError: () => 'safe error'
  });
  vm.runInContext(mainSource, context, { filename: 'main.js' });
  return { opened, notices, loads, recordLoads, run: () => vm.runInContext("Actions['edit-patient']({id:'test-patient'})", context) };
}

test('editing a full patient opens it without another fetch', async () => {
  const full = { id: 'test-patient', _full: true };
  const action = editAction(full, () => { throw new Error('unexpected fetch'); });
  await action.run();
  assert.equal(action.opened[0], full);
  assert.equal(action.loads.length, 0);
});

test('editing a lightweight patient fetches the full record before opening the form', async () => {
  const full = { id: 'test-patient', _full: true, notes: 'test notes' };
  const action = editAction({ id: 'test-patient' }, async () => full);
  await action.run();
  assert.deepEqual(action.loads, ['test-patient']);
  assert.equal(action.opened[0], full);
});

test('edit loads measurement history first when that clinic feature is enabled', async () => {
  const full = { id: 'test-patient', _full: true };
  const action = editAction(full, () => { throw new Error('unexpected full-patient fetch'); }, true);
  await action.run();
  assert.deepEqual(action.recordLoads, ['test-patient']);
  assert.equal(full._recordsLoaded, true);
  assert.equal(action.opened[0], full);
});

test('a missing or failed full-patient fetch never opens an incomplete edit form', async () => {
  for (const load of [async () => null, async () => { throw new Error('simulated fetch failure'); }]) {
    const action = editAction({ id: 'test-patient' }, load);
    await action.run();
    assert.equal(action.opened.length, 0);
    assert.equal(action.notices[0].type, 'error');
  }
  const missing = editAction(null, () => { throw new Error('unexpected fetch'); });
  await missing.run();
  assert.equal(missing.opened.length, 0);
  assert.equal(missing.loads.length, 0);
  assert.equal(missing.notices[0].type, 'error');
});
