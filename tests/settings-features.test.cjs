'use strict';

// Feature-setting defaults, persistence, legacy normalization and UI hydration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const defaultsSource = fs.readFileSync(path.join(root, 'js/defaults.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'js/settings.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function createDbContext() {
  const context = vm.createContext({ State: { settings: {}, patientIndex: {} }, console, Date, Number, Object, Array, String, Math });
  vm.runInContext(defaultsSource, context, { filename: 'defaults.js' });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  return { context, DB: vm.runInContext('DB', context), State: context.State };
}

test('all clinical features default to disabled for new clinics', () => {
  const { context } = createDbContext();
  const settings = vm.runInContext('defaultClinicData().settings', context);
  assert.deepEqual(JSON.parse(JSON.stringify(settings.clinicalFeatures)), {
    measurements: false, inbody: false, labs: false, glucoseTracking: false, bloodPressureTracking: false
  });
});

test('legacy, missing and malformed feature settings normalize safely to disabled', () => {
  const { context } = createDbContext();
  const legacy = vm.runInContext('normalizeClinicSettings({ clinicName: "old clinic" })', context);
  assert.equal(legacy.clinicName, 'old clinic');
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.clinicalFeatures)), {
    measurements: false, inbody: false, labs: false, glucoseTracking: false, bloodPressureTracking: false
  });
  const partial = vm.runInContext('normalizeClinicalFeatures({ labs: true, inbody: 1, glucoseTracking: "true" })', context);
  assert.deepEqual(JSON.parse(JSON.stringify(partial)), {
    measurements: false, inbody: false, labs: true, glucoseTracking: false, bloodPressureTracking: false
  });
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('normalizeClinicalFeatures(null)', context))), {
    measurements: false, inbody: false, labs: false, glucoseTracking: false, bloodPressureTracking: false
  });
});

function settingsClient(response) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => response }) }) }) };
}

test('settings load restores saved flags and defaults absent keys on existing clinics', async () => {
  const { DB, State } = createDbContext();
  DB.uid = 'doctor-A';
  DB.sb = settingsClient({ data: { settings: { clinicName: 'Clinic', clinicalFeatures: { labs: true, glucoseTracking: true } } }, error: null });
  const loaded = await DB.loadSettingsRow();
  assert.equal(loaded.clinicName, 'Clinic');
  assert.equal(loaded.clinicalFeatures.labs, true);
  assert.equal(loaded.clinicalFeatures.glucoseTracking, true);
  assert.equal(loaded.clinicalFeatures.measurements, false);
  assert.equal(loaded.clinicalFeatures.bloodPressureTracking, false);
  DB.sb = settingsClient({ data: { settings: { clinicName: 'Legacy clinic' } }, error: null });
  await DB.loadSettingsRow();
  assert.equal(State.settings.clinicalFeatures.labs, false);
});

test('full clinic loading also normalizes persisted flags and legacy profiles', async () => {
  const { DB, State, context } = createDbContext();
  DB.uid = 'doctor-A';
  context.todayISO = () => '2026-11-02';
  context.addDaysISO = date => date;
  DB.loadRoster = async () => [];
  DB.fetchAll = async () => [];
  DB.audit = async () => {};
  let row = { settings: { clinicName: 'Clinic', clinicalFeatures: { inbody: true } } };
  DB.sb = { from(table) {
    if (table === 'doctors') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row, error: null }; } };
    return { insert() { return this; }, select: async () => ({ data: [], error: null }) };
  } };
  await DB.loadAll();
  assert.equal(State.settings.clinicalFeatures.inbody, true);
  assert.equal(State.settings.clinicalFeatures.labs, false);
  assert.equal(State.loaded, true);
  State.loaded = false;
  row = { settings: { clinicName: 'Legacy' } };
  await DB.loadAll();
  assert.equal(State.settings.clinicalFeatures.measurements, false);
  assert.equal(State.settings.clinicalFeatures.bloodPressureTracking, false);
});

test('saving persists clinic-specific normalized flags and does not mutate state on DB failure', async () => {
  const { DB, State } = createDbContext();
  DB.uid = 'doctor-A';
  DB.audit = async () => {};
  State.settings = { clinicName: 'Before', account: { status: 'trial' }, customValue: 'preserve', clinicalFeatures: { labs: false } };
  let call;
  DB.sb = { async rpc(name, args) { call = { name, args }; return { error: null }; } };
  await DB.saveSettings({ clinicName: 'After', clinicalFeatures: { measurements: true, inbody: true, labs: true, glucoseTracking: false, bloodPressureTracking: true, extra: true }, account: { status: 'active' } });
  assert.equal(call.name, 'save_clinic_settings');
  assert.equal(call.args.patch.account, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.patch.clinicalFeatures)), {
    measurements: true, inbody: true, labs: true, glucoseTracking: false, bloodPressureTracking: true
  });
  assert.equal(State.settings.clinicName, 'After');
  assert.equal(State.settings.account.status, 'trial');
  assert.equal(State.settings.customValue, 'preserve');

  const beforeFailure = JSON.parse(JSON.stringify(State.settings));
  DB.sb = { async rpc() { return { error: { code: 'network' } }; } };
  await assert.rejects(DB.saveSettings({ clinicName: 'Not saved', clinicalFeatures: { labs: false } }), e => e.code === 'network');
  assert.deepEqual(JSON.parse(JSON.stringify(State.settings)), beforeFailure);
});

function renderContext(settings) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', checked: false, innerHTML: '', textContent: '', style: {} });
    return elements.get(selector);
  };
  const context = vm.createContext({
    State: { settings }, $, ensureMsgStyleUI() {}, supabaseConfig: { url: 'https://clinic.example.supabase.co' },

    DB: { healthProbe: async () => ({ ok: true, label: 'متصل' }) },
    document: { getElementById: () => ({ textContent: '', style: {} }) },
    esc: x => String(x), humanDate: () => '', console
  });
  vm.runInContext(defaultsSource, context, { filename: 'defaults.js' });
  vm.runInContext(settingsSource, context, { filename: 'settings.js' });
  vm.runInContext('renderSettings()', context);
  return $;
}

test('settings UI hydrates every flag and treats old settings as disabled', () => {
  let $ = renderContext({ clinicalFeatures: { measurements: true, inbody: true, labs: false, glucoseTracking: true, bloodPressureTracking: false } });
  assert.equal($('#setFeatureMeasurements').checked, true);
  assert.equal($('#setFeatureInbody').checked, true);
  assert.equal($('#setFeatureLabs').checked, false);
  assert.equal($('#setFeatureGlucose').checked, true);
  assert.equal($('#setFeatureBloodPressure').checked, false);
  $ = renderContext({ clinicName: 'Legacy' });
  for (const id of ['#setFeatureMeasurements', '#setFeatureInbody', '#setFeatureLabs', '#setFeatureGlucose', '#setFeatureBloodPressure']) assert.equal($(id).checked, false);
});

test('settings controls are native labelled checkboxes and save handler sends each independent flag', () => {
  for (const id of ['setFeatureMeasurements', 'setFeatureInbody', 'setFeatureLabs', 'setFeatureGlucose', 'setFeatureBloodPressure']) {
    assert.match(html, new RegExp(`<input type="checkbox" id="${id}"`));
  }
  assert.match(html, /<fieldset class="feature-settings full"/);
  assert.match(mainSource, /clinicalFeatures:\s*\{[\s\S]*?measurements:[\s\S]*?inbody:[\s\S]*?labs:[\s\S]*?glucoseTracking:[\s\S]*?bloodPressureTracking:/);
});
