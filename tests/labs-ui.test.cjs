'use strict';

// Synthetic laboratory values only. DB calls are mocked and no live patient data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const labsSource = fs.readFileSync(path.join(root, 'js/labs.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261102_clinical_records.sql'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');

function makeDB() {
  const calls = [], rows = [];
  const context = vm.createContext({ todayISO: () => '2026-11-02' });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.uid = 'doctor-A';
  DB.audit = async (...args) => calls.push({ audit: args });
  DB.fetchAll = async build => {
    const query = build();
    return rows.filter(row => query.filters.every(([kind, key, value]) => kind === 'eq'
      ? row[key] === value : (value === null ? row[key] == null : row[key] === value)));
  };
  DB.sb = {
    from(table) {
      const call = { table, filters: [], operation: null, payload: null };
      calls.push(call);
      const query = {
        filters: call.filters,
        insert(payload) { call.operation = 'insert'; call.payload = payload; return this; },
        update(payload) { call.operation = 'update'; call.payload = payload; return this; },
        eq(key, value) { call.filters.push(['eq', key, value]); return this; },
        is(key, value) { call.filters.push(['is', key, value]); return this; },
        order() { return this; },
        select() { return this; },
        async single() {
          const saved = { id: 'lab-' + (rows.length + 1), ...call.payload };
          rows.push(saved); return { data: { ...saved }, error: null };
        },
        async maybeSingle() {
          const match = rows.find(row => call.filters.every(([kind, key, value]) => kind === 'eq'
            ? row[key] === value : (value === null ? row[key] == null : row[key] === value)));
          if (!match) return { data: null, error: null };
          if (call.operation === 'update') Object.assign(match, call.payload);
          return { data: { ...match }, error: null };
        }
      };
      return query;
    }
  };
  return { DB, calls, rows };
}

function makeResultRow({ name, value, kind = 'number', unit = '' }) {
  const controls = {
    '.lab-component-name': { value: name },
    '.lab-component-value': { value },
    '.lab-component-kind': { value: kind },
    '.lab-component-unit': { value: unit }
  };
  return { querySelector: selector => controls[selector] };
}

function makeUI({ enabled = true, existing = null, patient = null } = {}) {
  const calls = { opened: [], adds: [], updates: [], deletes: [], toasts: [], closed: 0, refreshed: 0, loaded: 0 };
  const p = patient || { id: 'patient-1', name: 'Synthetic patient', labs: [] };
  const button = { disabled: false };
  const form = {};
  const testInput = { value: existing ? existing.testName : '' };
  const componentContainer = {
    innerHTML: '',
    querySelector() { return nameInput; },
    querySelectorAll() { return [nameInput]; },
    insertAdjacentHTML(_where, html) { this.innerHTML += html; }
  };
  const nameInput = { value: '', dataset: {}, addEventListener(_name, handler) { this.oninput = handler; } };
  const error = { textContent: '', classList: { add() {}, remove() {} } };
  const dateInput = { value: existing ? existing.testedOn : '2026-11-02' };
  const list = { innerHTML: '' };
  const tab = { classList: { hidden: !enabled, active: false, toggle(_class, hidden) { this.hidden = hidden; }, contains(name) { return name === 'active' && this.active; } } };
  const panel = { classList: { hidden: true, toggle(_class, hidden) { this.hidden = hidden; }, add() { this.hidden = true; } } };
  let resultRows = [];
  const fields = {
    '#labForm': form, '#labTestName': testInput, '#labComponents': componentContainer,
    '#labTestDate': dateInput, '#labError': error, '#labAddComponent': {},
    '#patLabsTab': tab, '#ptab-labs': panel, '#patLabsList': list
  };
  const db = {
    async addLab(pid, payload) { calls.adds.push({ pid, payload }); return { id: 'lab-1', ...payload }; },
    async updateLab(pid, id, payload) { calls.updates.push({ pid, id, payload }); return { id, ...payload }; },
    async deleteLab(pid, id) { calls.deletes.push({ pid, id }); },
    async loadLabs(pid) { calls.loaded++; return p.labs || []; }
  };
  const context = vm.createContext({
    State: { settings: { clinicalFeatures: { labs: enabled } }, route: 'patient', param: p.id },
    normalizeClinicalFeatures: features => ({ labs: Boolean(features && features.labs) }),
    getPatient: id => id === p.id ? p : null,
    $: selector => fields[selector] || null,
    $$: selector => selector === '#labComponents .lab-result-row' ? resultRows : [],
    openModal: (title, html) => calls.opened.push({ title, html }),
    closeModal: () => calls.closed++, renderPatientDetail: () => calls.refreshed++,
    emptyHTML: (_icon, title) => '<p>' + title + '</p>',
    humanDate: value => String(value),
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    todayISO: () => '2026-11-02', toast: (message, type) => calls.toasts.push({ message, type }),
    confirmDlg: async () => true, switchPTab() {}, logError() {}, DB: db
  });
  vm.runInContext(labsSource, context, { filename: 'labs.js' });
  context.p = p;
  if (existing) { context.__existing = existing; vm.runInContext("openLabModal('patient-1', __existing)", context); }
  else vm.runInContext("openLabModal('patient-1')", context);
  return {
    context, calls, p, fields, form, button, testInput, componentContainer, error, tab, panel, list,
    setResults(rows) { resultRows = rows; },
    submit: () => form.onsubmit({ preventDefault() {}, target: { querySelector: () => button } })
  };
}

test('database schema supports a dated panel with named numeric or text components and optional units', () => {
  assert.match(migration, /test_name text not null/);
  assert.match(migration, /tested_on date not null/);
  assert.match(migration, /results jsonb not null/);
  assert.match(migration, /jsonb_typeof\(c->'value'\) not in \('number', 'string'\)/);
  assert.match(migration, /c \? 'unit'/);
  assert.match(configSource, /patient_labs_patient_same_doctor foreign key \(patient_id, doctor_id\)/);
});

test('common test search suggests a multi-component CBC while allowing a completely free test name', () => {
  const ui = makeUI();
  assert.match(ui.calls.opened[0].html, /list="labCommonTests"/);
  assert.match(ui.calls.opened[0].html, /اكتب اسم التحليل كاملًا/);
  assert.match(ui.calls.opened[0].html, /<datalist id="labCommonTests">[\s\S]*?صورة دم كاملة/);
  ui.testInput.value = 'صورة دم كاملة (CBC)';
  ui.testInput.oninput();
  assert.equal((ui.componentContainer.innerHTML.match(/class="lab-result-row"/g) || []).length, 14);
  ui.testInput.value = 'تحليل مناعي مخصص كامل';
  ui.testInput.oninput();
  assert.match(ui.componentContainer.innerHTML, /تحليل مناعي مخصص كامل/);
});

test('save keeps free test names, text and numeric components, units, and tested date', async () => {
  const ui = makeUI();
  ui.testInput.value = 'تحليل مناعي مخصص كامل الاسم';
  ui.setResults([
    makeResultRow({ name: 'النتيجة', value: 'Positive', kind: 'text' }),
    makeResultRow({ name: 'Concentration', value: '4.25', unit: 'mg/L' })
  ]);
  await ui.submit();
  assert.equal(ui.calls.adds.length, 1);
  assert.equal(ui.calls.adds[0].payload.testName, 'تحليل مناعي مخصص كامل الاسم');
  assert.equal(ui.calls.adds[0].payload.testedOn, '2026-11-02');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.adds[0].payload.results)), [
    { name: 'النتيجة', value: 'Positive' }, { name: 'Concentration', value: 4.25, unit: 'mg/L' }
  ]);
});

test('missing components are omitted; empty result sets, invalid numbers, and future dates are rejected', async () => {
  const ui = makeUI();
  ui.testInput.value = 'CBC';
  ui.setResults([
    makeResultRow({ name: 'Hb', value: '13.2', unit: 'g/dL' }),
    makeResultRow({ name: 'WBC', value: '  ' })
  ]);
  await ui.submit();
  assert.equal(ui.calls.adds[0].payload.results.length, 1);
  const blank = makeUI();
  blank.testInput.value = 'CBC'; blank.setResults([makeResultRow({ name: 'Hb', value: '' })]);
  await blank.submit();
  assert.equal(blank.calls.adds.length, 0);
  assert.ok(blank.error.textContent);
  const invalid = makeUI();
  invalid.testInput.value = 'CBC'; invalid.setResults([makeResultRow({ name: 'Hb', value: 'not-a-number' })]);
  await invalid.submit();
  assert.equal(invalid.calls.adds.length, 0);
  const future = makeUI();
  future.testInput.value = 'CBC'; future.fields['#labTestDate'].value = '2026-11-03';
  future.setResults([makeResultRow({ name: 'Hb', value: '12' })]);
  await future.submit();
  assert.equal(future.calls.adds.length, 0);
});

test('DB validates lab panels and enforces clinic and patient scoping for load, edit, and soft delete', async () => {
  const { DB, calls, rows } = makeDB();
  const saved = await DB.addLab('patient-1', {
    testName: 'Panel', testedOn: '2026-10-30', results: [{ name: 'Marker', value: 'Detected', unit: 'index' }],
    doctorId: 'attacker', patientId: 'patient-B', source: 'patient'
  });
  assert.equal(saved.testName, 'Panel');
  assert.equal(rows[0].doctor_id, 'doctor-A');
  assert.equal(rows[0].patient_id, 'patient-1');
  assert.equal(rows[0].source, 'clinic');
  await DB.updateLab('patient-1', saved.id, { testedOn: '2026-11-01', results: [{ name: 'Marker', value: 0 }] });
  const update = calls.find(call => call.table === 'patient_labs' && call.operation === 'update');
  const reopened = await DB.loadLabs('patient-1');
  assert.equal(reopened[0].testedOn, '2026-11-01');
  assert.deepEqual(JSON.parse(JSON.stringify(reopened[0].results)), [{ name: 'Marker', value: 0 }]);
  for (const [key, value] of [['id', saved.id], ['patient_id', 'patient-1'], ['doctor_id', 'doctor-A']]) {
    assert.ok(update.filters.some(f => f[0] === 'eq' && f[1] === key && f[2] === value));
  }
  assert.ok(update.filters.some(f => f[0] === 'is' && f[1] === 'deleted_at' && f[2] === null));
  await DB.deleteLab('patient-1', saved.id);
  assert.equal((await DB.loadLabs('patient-1')).length, 0);
  const deletion = calls.find(call => call.table === 'patient_labs' && call.operation === 'update' && call.payload.deleted_at);
  for (const [key, value] of [['id', saved.id], ['patient_id', 'patient-1'], ['doctor_id', 'doctor-A']]) {
    assert.ok(deletion.filters.some(f => f[0] === 'eq' && f[1] === key && f[2] === value));
  }
  assert.ok(calls.some(call => call.audit && call.audit[0] === 'edit'));
  await assert.rejects(DB.addLab('patient-1', { testName: 'Bad', testedOn: '2026-11-03', results: [{ name: 'x', value: 1 }] }), e => e.code === 'invalid_lab_date');
  await assert.rejects(DB.addLab('patient-1', { testName: 'Bad', results: [{ name: 'x', value: '  ' }] }), e => e.code === 'invalid_lab_results');
  await assert.rejects(DB.addLab('patient-1', { testName: 'Bad', results: [{ name: 'x', value: 1, unit: { unexpected: true } }] }), e => e.code === 'invalid_lab_results');
});

test('editing an existing result saves a correction instead of creating a second record', async () => {
  const existing = { id: 'lab-existing', testName: 'HbA1c', testedOn: '2026-10-30', results: [{ name: 'HbA1c', value: 6.2, unit: '%' }] };
  const ui = makeUI({ existing });
  ui.testInput.value = 'HbA1c';
  ui.setResults([makeResultRow({ name: 'HbA1c', value: '6.0', unit: '%' })]);
  await ui.submit();
  assert.equal(ui.calls.updates.length, 1);
  assert.equal(ui.calls.updates[0].id, 'lab-existing');
  assert.equal(ui.calls.adds.length, 0);
  assert.equal(ui.calls.refreshed, 1);
});

test('lab save errors expose safe actionable codes without revealing backend details', () => {
  const context = vm.createContext({});
  vm.runInContext(labsSource + '\nglobalThis.__message = labSaveFailureMessage;', context);
  const message = context.__message;
  assert.match(message({ code: '42501', message: 'private database detail' }), /MFA/);
  assert.match(message({ code: '23503' }), /العيادة الحالية/);
  assert.match(message({ code: 'PGRST205' }), /مخطط التحاليل/);
  assert.match(message({ message: 'private database detail' }), /تحقق من الاتصال/);
  assert.doesNotMatch(message({ code: '42501', message: 'private database detail' }), /private database detail/);
});

test('lab setting hides tab and does not load or erase prior results; enabling it reloads the list', async () => {
  const previous = [{ id: 'lab-old', testName: 'CBC', testedOn: '2026-10-10', results: [
    { name: 'Hb', value: 0, unit: 'g/dL' }, { name: 'Morphology', value: 'Normal' }
  ] }];
  const disabled = makeUI({ enabled: false, patient: { id: 'patient-1', name: 'Synthetic patient', labs: previous } });
  await vm.runInContext('loadPatientLabs(p)', disabled.context, { timeout: 1000 });
  assert.equal(disabled.tab.classList.hidden, true);
  assert.equal(disabled.calls.loaded, 0);
  assert.equal(disabled.p.labs.length, 1);
  const enabled = makeUI({ enabled: true, patient: { id: 'patient-1', name: 'Synthetic patient', labs: previous } });
  await vm.runInContext('loadPatientLabs(p)', enabled.context, { timeout: 1000 });
  assert.equal(enabled.calls.loaded, 1);
  assert.equal(enabled.tab.classList.hidden, false);
  assert.match(enabled.list.innerHTML, /CBC/);
  assert.match(enabled.list.innerHTML, /2026-10-10/);
  assert.match(enabled.list.innerHTML, /0 <small>g\/dL/);
  assert.match(enabled.list.innerHTML, /Normal/);
});
