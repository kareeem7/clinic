'use strict';

// Simulated form and DB only; no real patient information is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/patients.js'), 'utf8');

function patientForm({ editing, weight = '', failUpdate = false }) {
  const calls = { updates: [], adds: [], toasts: [], closed: 0, refreshed: 0 };
  const button = { disabled: false };
  const form = {};
  const fields = {
    '#f_name': { value: '  Test patient  ' }, '#f_phone': { value: '  00000  ' },
    '#f_age': { value: '30' }, '#f_gender': { value: 'ذكر' }, '#f_type': { value: 'nutrition' },
    '#f_height': { value: '170' }, '#f_target': { value: '70' }, '#f_birth': { value: '2000-01-01' },
    '#f_consent': { checked: true }, '#f_diag': { value: '  goal  ' }, '#f_notes': { value: '  notes  ' }
  };
  if (!editing) fields['#f_weight'] = { value: weight };
  let markup = '';
  const context = vm.createContext({
    $: selector => selector === '#patientForm' ? form : (fields[selector] || null),
    $$: selector => selector === '[data-chronic]:checked' ? [{ value: 'diabetes' }] : [],
    openModal: (_title, html) => { markup = html; },
    closeModal: () => { calls.closed++; },
    refreshCurrent: () => { calls.refreshed++; },
    toast: (message, type) => { calls.toasts.push({ message, type }); },
    esc: value => String(value), weightChange: () => ({ current: null }), CHRONIC: {},
    todayISO: () => '2026-11-01', uid: () => 'test-measurement',
    DB: {
      async update(col, id, data) { calls.updates.push({ col, id, data }); if (failUpdate) throw new Error('simulated failure'); },
      async add(col, data) { calls.adds.push({ col, data }); }
    }
  });
  vm.runInContext(source, context, { filename: 'patients.js' });
  if (editing) vm.runInContext("openPatientModal({id:'test-patient', name:'Test patient', measurements:[]})", context);
  else vm.runInContext('openPatientModal()', context);
  return {
    calls, button, markup,
    submit: () => form.onsubmit({ preventDefault() {}, target: { querySelector: () => button } })
  };
}

test('editing saves patient details without reading a nonexistent starting-weight input', async () => {
  const ui = patientForm({ editing: true });
  assert.equal(ui.markup.includes('id="f_weight"'), false);
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

test('adding without initial weight keeps measurements empty', async () => {
  const ui = patientForm({ editing: false });
  await ui.submit();
  assert.equal(ui.calls.adds[0].data.measurements.length, 0);
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

function editAction(patient, loadPatientFull) {
  const opened = [], notices = [], loads = [];
  const context = vm.createContext({
    document: { addEventListener() {} },
    getPatient: () => patient,
    DB: { async loadPatientFull(id) { loads.push(id); return loadPatientFull(id); } },
    openPatientModal: p => opened.push(p),
    toast: (message, type) => notices.push({ message, type }),
    logError() {}, explainError: () => 'safe error'
  });
  vm.runInContext(mainSource, context, { filename: 'main.js' });
  return { opened, notices, loads, run: () => vm.runInContext("Actions['edit-patient']({id:'test-patient'})", context) };
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
