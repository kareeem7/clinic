'use strict';

// InBody form and persistence tests use synthetic values and a mocked PostgREST client.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const notesSource = fs.readFileSync(path.join(root, 'js/notes.js'), 'utf8');
const patientSource = fs.readFileSync(path.join(root, 'js/patient.js'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'js/state.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_clinical_records.sql'), 'utf8');
const portalFilterMigration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_inbody_portal_filter.sql'), 'utf8');

function makeDB() {
  const calls = [];
  const patient = { id: 'patient-1', measurements: [] };
  const context = vm.createContext({
    State: { patients: [patient], patientIndex: {} },
    getPatient: id => id === patient.id ? patient : null,
    todayISO: () => '2026-11-02'
  });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.uid = 'doctor-A';
  DB.audit = async (...args) => calls.push({ audit: args });
  DB.sb = {
    from(table) {
      const call = { table, filters: [], operation: null, payload: null };
      calls.push(call);
      const query = {
        insert(payload) { call.operation = 'insert'; call.payload = payload; return this; },
        update(payload) { call.operation = 'update'; call.payload = payload; return this; },
        eq(key, value) { call.filters.push(['eq', key, value]); return this; },
        is(key, value) { call.filters.push(['is', key, value]); return this; },
        select() { return this; },
        async maybeSingle() { return { data: { id: 'record-1', doctor_id: 'doctor-A', patient_id: patient.id, ...call.payload }, error: null }; },
        then(resolve, reject) {
          const result = call.operation === 'insert'
            ? { data: [{ id: 'record-1', doctor_id: 'doctor-A', patient_id: patient.id, ...call.payload }], error: null }
            : { error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    }
  };
  return { DB, calls, patient };
}

function formHarness({ enabled = true, patient = { id: 'patient-1', name: 'Synthetic patient', height: 170, measurements: [] }, existing = null, values = {} } = {}) {
  const calls = { opened: [], adds: [], updates: [], deletes: [], toasts: [], closed: 0, rendered: 0 };
  const button = { disabled: false };
  const form = {};
  const fields = {
    '#ib_date': { value: values.date || '2026-11-02' },
    '#ib_weight': { value: values.weight ?? '' }, '#ib_bmi': { value: values.bmi ?? '' }, '#ib_bmi_preview': { textContent: '' },
    '#ib_fat': { value: values.fat ?? '' }, '#ib_fat_mass': { value: values.bodyFatMass ?? '' },
    '#ib_muscle': { value: values.skeletalMuscleMass ?? '' }, '#ib_visceral': { value: values.visceralFatLevel ?? '' },
    '#ib_water': { value: values.bodyWaterPct ?? '' }, '#ib_note': { value: values.note || '' },
    '#ibErr': { textContent: '', classList: { add() {}, remove() {} } }
  };
  Object.values(fields).forEach(field => {
    if (!field.addEventListener) field.addEventListener = (name, handler) => { (field._listeners ||= {})[name] = handler; };
  });
  let context;
  const db = {
    async addRecord(pid, rec) { calls.adds.push({ pid, rec }); },
    async updateRecord(pid, id, rec) { calls.updates.push({ pid, id, rec }); },
    async deleteRecord(pid, id) { calls.deletes.push({ pid, id }); }
  };
  context = vm.createContext({
    State: { settings: { clinicalFeatures: { inbody: enabled } } },
    normalizeClinicalFeatures: f => ({ inbody: Boolean(f && f.inbody) }),
    getPatient: id => id === patient.id ? patient : null,
    $: selector => selector === '#inbodyForm' ? form : fields[selector] || null,
    openModal: (title, html) => calls.opened.push({ title, html }),
    closeModal: () => calls.closed++,
    renderPatientDetail: () => calls.rendered++,
    toast: (message, type) => calls.toasts.push({ message, type }),
    confirmDlg: async () => true,
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    todayISO: () => '2026-11-02', humanDate: value => String(value),
    emptyHTML: (_icon, title) => '<p>' + title + '</p>',
    DB: db
  });
  vm.runInContext(notesSource, context, { filename: 'notes.js' });
  if (existing) {
    context.__existing = existing;
    vm.runInContext("openInBodyModal('patient-1', __existing)", context);
  } else vm.runInContext("openInBodyModal('patient-1')", context);
  return { context, calls, fields, button, form, patient, submit: () => form.onsubmit({ preventDefault() {}, target: { querySelector: () => button } }) };
}

test('InBody schema reuses patient_records with distinct record_type and existing clinic isolation', () => {
  assert.match(migration, /add column if not exists body_fat_mass numeric/);
  assert.match(migration, /add column if not exists skeletal_muscle_mass numeric/);
  assert.match(migration, /add column if not exists visceral_fat_level numeric/);
  assert.match(migration, /add column if not exists body_water_pct numeric/);
  assert.match(migration, /record_type in \('manual', 'inbody', 'physio'\)/);
  assert.match(configSource, /create policy records_own on public\.patient_records[\s\S]*?auth\.uid\(\) = doctor_id and public\.clinic_active\(auth\.uid\(\)\)/);
  assert.match(configSource, /constraint records_patient_same_doctor foreign key \(patient_id, doctor_id\)/);
  assert.match(configSource, /record_type is distinct from 'inbody'/);
  assert.match(portalFilterMigration, /record_type is distinct from 'inbody'/);
  assert.match(dbSource, /\.eq\('patient_id', pid\)\.eq\('doctor_id', this\.uid\)/);
});

test('DB saves a complete dated InBody scan with clinic and patient identity assigned by the DB layer', async () => {
  const { DB, calls, patient } = makeDB();
  const rec = {
    date: '2026-10-30', recordType: 'inbody', weight: 82.4, bmi: 28.5, fat: 31.2,
    bodyFatMass: 25.7, skeletalMuscleMass: 30.4, visceralFatLevel: 12, bodyWaterPct: 49.6, note: 'Full scan'
  };
  await DB.addRecord('patient-1', rec);
  const insert = calls.find(c => c.table === 'patient_records' && c.operation === 'insert');
  assert.equal(insert.payload.doctor_id, 'doctor-A');
  assert.equal(insert.payload.patient_id, 'patient-1');
  assert.equal(insert.payload.source, 'clinic');
  assert.equal(insert.payload.record_type, 'inbody');
  assert.equal(insert.payload.date, '2026-10-30');
  assert.equal(insert.payload.weight, 82.4);
  assert.equal(insert.payload.bmi, 28.5);
  assert.equal(insert.payload.fat, 31.2);
  assert.equal(insert.payload.body_fat_mass, 25.7);
  assert.equal(insert.payload.skeletal_muscle_mass, 30.4);
  assert.equal(insert.payload.visceral_fat_level, 12);
  assert.equal(insert.payload.body_water_pct, 49.6);
  assert.equal(Object.hasOwn(insert.payload, 'height'), false);
  assert.equal(patient.measurements[0].recordType, 'inbody');
});

test('partial scans retain only supplied values; missing metrics are never coerced to zero', async () => {
  const { DB, calls } = makeDB();
  await DB.addRecord('patient-1', {
    date: '2026-11-02', recordType: 'inbody', weight: 77, bmi: null, fat: null,
    bodyFatMass: null, skeletalMuscleMass: 28.2, visceralFatLevel: null, bodyWaterPct: null
  });
  const row = calls.find(c => c.table === 'patient_records' && c.operation === 'insert').payload;
  assert.equal(row.weight, 77);
  assert.equal(row.skeletal_muscle_mass, 28.2);
  assert.equal(row.bmi == null, true);
  assert.equal(row.fat, null);
  assert.equal(Object.hasOwn(row, 'body_fat_mass'), false);
  assert.equal(Object.hasOwn(row, 'visceral_fat_level'), false);
  assert.equal(Object.hasOwn(row, 'body_water_pct'), false);
  assert.equal(row.record_type, 'inbody');
});

test('empty, invalid, and future-dated InBody records are rejected before DB calls', async () => {
  const { DB, calls } = makeDB();
  for (const record of [
    { date: '2026-11-02', recordType: 'inbody' },
    { date: '2026-11-02', recordType: 'inbody', fat: 101 },
    { date: '2026-11-03', recordType: 'inbody', weight: 70 }
  ]) await assert.rejects(DB.addRecord('patient-1', record), e => e.code === 'invalid_inbody_record');
  assert.equal(calls.some(c => c.table === 'patient_records'), false);
});

test('edit and soft-delete of InBody records remain scoped to patient and doctor', async () => {
  const { DB, calls } = makeDB();
  await DB.updateRecord('patient-1', 'record-1', {
    date: '2026-11-02', recordType: 'inbody', weight: 70, bmi: null, fat: null,
    bodyFatMass: null, skeletalMuscleMass: 27, visceralFatLevel: null, bodyWaterPct: null
  });
  const update = calls.find(c => c.table === 'patient_records' && c.operation === 'update');
  for (const [key, value] of [['id', 'record-1'], ['patient_id', 'patient-1'], ['doctor_id', 'doctor-A']]) {
    assert.ok(update.filters.some(f => f[0] === 'eq' && f[1] === key && f[2] === value));
  }
  assert.ok(update.filters.some(f => f[0] === 'is' && f[1] === 'deleted_at' && f[2] === null));
  await DB.deleteRecord('patient-1', 'record-1');
  const deletion = calls.find(c => c.table === 'patient_records' && c.operation === 'update' && c.payload.deleted_at);
  for (const [key, value] of [['id', 'record-1'], ['patient_id', 'patient-1'], ['doctor_id', 'doctor-A']]) {
    assert.ok(deletion.filters.some(f => f[0] === 'eq' && f[1] === key && f[2] === value));
  }
  assert.ok(deletion.filters.some(f => f[0] === 'is' && f[1] === 'deleted_at' && f[2] === null));
});

test('InBody form writes a full scan with dated fields, units, and no duplicated height', async () => {
  const ui = formHarness({ values: { weight: '80', bmi: '27.7', fat: '31', bodyFatMass: '24.8', skeletalMuscleMass: '29.5', visceralFatLevel: '10', bodyWaterPct: '50' } });
  assert.match(ui.calls.opened[0].html, /نسبة الدهون \(%\)/);
  assert.match(ui.calls.opened[0].html, /كتلة الدهون \(كجم\)/);
  assert.match(ui.calls.opened[0].html, /كتلة العضلات الهيكلية \(كجم\)/);
  assert.match(ui.calls.opened[0].html, /الدهون الحشوية \(مستوى\)/);
  assert.match(ui.calls.opened[0].html, /نسبة الماء \(%\)/);
  assert.match(ui.calls.opened[0].html, /تاريخ الفحص/);
  await ui.submit();
  assert.equal(ui.calls.adds[0].rec.date, '2026-11-02');
  assert.equal(ui.calls.adds[0].rec.recordType, 'inbody');
  assert.equal(ui.calls.adds[0].rec.weight, 80);
  assert.equal(ui.calls.adds[0].rec.bmi, 27.7);
  assert.equal(Object.hasOwn(ui.calls.adds[0].rec, 'height'), false);
  ui.fields['#ib_weight'].value = '85';
  ui.fields['#ib_weight']._listeners.input();
  assert.equal(ui.fields['#ib_bmi_preview'].textContent, 29.4);
});

test('BMI is derived from the baseline height when omitted; absent device indicators stay null', async () => {
  const ui = formHarness({ patient: { id: 'patient-1', name: 'Synthetic patient', height: 175, measurements: [] }, values: { weight: '80', skeletalMuscleMass: '28' } });
  await ui.submit();
  const record = ui.calls.adds[0].rec;
  assert.equal(record.bmi, 26.1);
  assert.equal(record.fat, null);
  assert.equal(record.bodyFatMass, null);
  assert.equal(record.visceralFatLevel, null);
  assert.equal(record.bodyWaterPct, null);
});

test('device BMI remains optionally enterable when the patient profile has no valid height', async () => {
  const ui = formHarness({ patient: { id: 'patient-1', name: 'Synthetic patient', height: null, measurements: [] }, values: { bmi: '24.8' } });
  assert.match(ui.calls.opened[0].html, /id="ib_bmi"/);
  await ui.submit();
  assert.equal(ui.calls.adds[0].rec.bmi, 24.8);
});

test('InBody scans stay separate from ordinary weight history and trends', () => {
  const context = vm.createContext({ todayISO: () => '2026-11-02' });
  vm.runInContext(stateSource, context, { filename: 'state.js' });
  context.__patient = { measurements: [
    { date: '2026-10-01', weight: 90, recordType: 'manual' },
    { date: '2026-10-15', weight: 86, recordType: 'inbody' },
    { date: '2026-11-01', weight: 88, source: 'patient' }
  ] };
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('weightChange(__patient)', context))), { diff: -2, current: 88 });
  assert.equal(vm.runInContext('lastMeasure(__patient).source', context), 'patient');
});

test('InBody section shows only present values with source and units, and hides without deleting when disabled', () => {
  const section = { hidden: false, classList: { toggle(_name, hidden) { section.hidden = hidden; } } };
  const list = { innerHTML: '' };
  const patient = { id: 'patient-1', measurements: [
    { id: 'ib-full', date: '2026-10-30', recordType: 'inbody', weight: 82, bmi: 27.1, fat: 30, bodyFatMass: 24, skeletalMuscleMass: 29, visceralFatLevel: 11, bodyWaterPct: 51 },
    { id: 'ib-partial', date: '2026-11-01', recordType: 'inbody', skeletalMuscleMass: 28, fat: null, bodyFatMass: null }
  ] };
  const context = vm.createContext({
    State: { settings: { clinicalFeatures: { inbody: true } } },
    normalizeClinicalFeatures: f => ({ inbody: Boolean(f && f.inbody) }),
    $: selector => selector === '#patInbodySection' ? section : list,
    esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    humanDate: value => value, emptyHTML: () => '<p>empty</p>'
  });
  vm.runInContext(patientSource, context, { filename: 'patient.js' });
  context.__patient = patient;
  vm.runInContext('renderPatientInBody(__patient)', context);
  assert.equal(section.hidden, false);
  assert.match(list.innerHTML, /InBody/);
  assert.match(list.innerHTML, /BMI: 27\.1 كجم\/م²/);
  assert.match(list.innerHTML, /نسبة الدهون: 30 %/);
  assert.match(list.innerHTML, /كتلة العضلات الهيكلية: 28 كجم/);
  assert.doesNotMatch(list.innerHTML, /كتلة الدهون: 0/);
  assert.doesNotMatch(list.innerHTML, /نسبة الماء: 0/);
  const oldHTML = list.innerHTML;
  context.State.settings.clinicalFeatures.inbody = false;
  vm.runInContext('renderPatientInBody(__patient)', context);
  assert.equal(section.hidden, true);
  assert.equal(list.innerHTML, oldHTML);
  assert.equal(patient.measurements.length, 2);
});

test('InBody form stays hidden and cannot save while the clinic feature is disabled', async () => {
  const ui = formHarness({ enabled: false, values: { weight: '70' } });
  assert.equal(ui.calls.opened.length, 0);
  assert.equal(ui.calls.adds.length, 0);
  assert.match(ui.calls.toasts[0].message, /غير مفعّلة/);
});

test('InBody edit uses the scoped record update rather than inserting another dated row', async () => {
  const existing = { id: 'ib-1', date: '2026-10-20', recordType: 'inbody', weight: 81, bmi: 27, fat: 30 };
  const ui = formHarness({ existing, values: { date: '2026-10-21', weight: '80', bmi: '26.5', fat: '29' } });
  await ui.submit();
  assert.equal(ui.calls.updates.length, 1);
  assert.equal(ui.calls.adds.length, 0);
  assert.equal(ui.calls.updates[0].id, 'ib-1');
  assert.equal(ui.calls.updates[0].rec.recordType, 'inbody');
});
