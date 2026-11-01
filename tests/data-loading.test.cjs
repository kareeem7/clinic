'use strict';

// node --test tests/data-loading.test.cjs
// The tests use simulated Supabase/DOM objects and no real clinical data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dbSource = fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8');

function databaseContext() {
  const context = vm.createContext({
    State: { settings: {}, patientIndex: {} },
    defaultClinicData: () => ({ settings: { clinicName: 'default' } }),
    console
  });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  return { context, DB: vm.runInContext('DB', context), State: context.State };
}

test('patient list starts with select and keeps identical filters for rows and count', async () => {
  const { DB, State } = databaseContext();
  const requests = [];
  DB.uid = 'doctor-test';
  DB.sb = {
    from(table) {
      assert.equal(table, 'patients');
      // Like supabase-js, this object deliberately has no eq() before select().
      return { select(columns, options) {
        const req = { columns, options, filters: [], order: [], range: null };
        requests.push(req);
        const b = {
          eq(k, v) { req.filters.push(['eq', k, v]); return b; },
          is(k, v) { req.filters.push(['is', k, v]); return b; },
          or(value) { req.filters.push(['or', value]); return b; },
          order(k) { req.order.push(k); return b; },
          range(from, to) { req.range = [from, to]; return Promise.resolve({ data: [{ id: 'patient-test', name: 'Test' }], error: null }); },
          then(resolve, reject) { return Promise.resolve({ count: 12, error: null }).then(resolve, reject); }
        };
        return b;
      } };
    }
  };
  const page = await DB.pagePatients({ q: '123', type: 'nutrition', page: 2, per: 10 });
  assert.equal(page.total, 12);
  assert.equal(page.rows[0].id, 'patient-test');
  assert.equal(State.patientIndex['patient-test']._full, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].columns, '*');
  assert.equal(requests[1].columns, '*');
  assert.equal(requests[1].options.count, 'exact');
  assert.equal(requests[1].options.head, true);
  assert.deepEqual(requests[0].filters, requests[1].filters);
  assert.deepEqual(requests[0].order, ['name', 'id']);
  assert.deepEqual(requests[0].range, [10, 19]);
  assert.ok(requests[0].filters.some(f => f[0] === 'eq' && f[1] === 'doctor_id' && f[2] === 'doctor-test'));
  assert.ok(requests[0].filters.some(f => f[0] === 'is' && f[1] === 'deleted_at' && f[2] === null));
  assert.ok(requests[0].filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'active'));
  assert.ok(requests[0].filters.some(f => f[0] === 'eq' && f[1] === 'type' && f[2] === 'nutrition'));
  assert.ok(requests[0].filters.some(f => f[0] === 'or' && f[1].includes('123')));
});

function settingsClient(response) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => response }) }) }) };
}

test('clinic settings load rejects database errors and missing doctor profiles', async () => {
  const { DB, State } = databaseContext();
  const error = { code: 'test_database_error' };
  DB.sb = settingsClient({ data: null, error });
  await assert.rejects(DB.loadSettingsRow(), e => e === error);
  DB.sb = settingsClient({ data: null, error: null });
  await assert.rejects(DB.loadSettingsRow(), e => e.code === 'clinic_profile_missing');
  DB.sb = settingsClient({ data: { settings: { clinicName: 'test' } }, error: null });
  await DB.loadSettingsRow();
  assert.equal(State.settings.clinicName, 'test');
});

test('full load also rejects errors or an inaccessible profile on its second settings read', async () => {
  const { DB, State, context } = databaseContext();
  context.todayISO = () => '2026-01-01';
  context.addDaysISO = date => date;
  DB.loadRoster = async () => [];
  DB.fetchAll = async () => [];
  const error = { code: 'test_database_error' };
  DB.sb = settingsClient({ data: null, error });
  await assert.rejects(DB.loadAll(), e => e === error);
  assert.notEqual(State.loaded, true);
  DB.sb = settingsClient({ data: null, error: null });
  await assert.rejects(DB.loadAll(), e => e.code === 'clinic_profile_missing');
  assert.notEqual(State.loaded, true);
});

function authContext({ step = 'ready', failureAt = 'loadAll', accountError = null } = {}) {
  const elements = new Map();
  const screens = [];
  const state = { settings: {} };
  let listener = null;
  const cls = () => ({ values: new Set(), add(c) { this.values.add(c); }, remove(c) { this.values.delete(c); }, toggle() {}, contains(c) { return this.values.has(c); } });
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, classList: cls(),
      addEventListener() {}, querySelector() { return { textContent: '' }; }, focus() {}
    });
    return elements.get(selector);
  };
  const DB = {
    uid: null, signOutCount: 0,
    async init() { return true; },
    async signIn() { this.uid = 'doctor-test'; return step; },
    async mfaGate() { return step; },
    async mfaVerify() {},
    async isSuperAdmin() { return false; },
    async loadSettingsRow() { if (failureAt === 'settings') throw { code: 'clinic_profile_missing' }; },
    assertActive() { if (accountError) throw { code: accountError }; },
    async loadAll() { if (failureAt === 'loadAll') throw { code: '42501' }; },
    async signOut() { this.signOutCount++; this.uid = null; },
    sb: { auth: { onAuthStateChange(fn) { listener = fn; } } }
  };
  const context = vm.createContext({
    document: { addEventListener() {}, querySelector: $, body: { classList: cls() } },
    window: {}, $, $$: () => [], DB, State: state, Cal: {}, Charts: {}, Portal: { token: null },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    showScreen(name) { screens.push(name); }, go() {}, syncShellIdentity() {},
    explainError(e) { return 'safe: ' + e.code; }, esc: x => x,
    logError() {}, toast() {}, leaveAdmin() {}, closeModal() {},
    setTimeout() {}, clearTimeout() {}, console
  });
  vm.runInContext(mainSource, context, { filename: 'main.js' });
  return { $, DB, screens, boot: () => vm.runInContext('boot()', context), listener: () => listener };
}

test('normal login shows post-auth loading errors on the visible login screen', async () => {
  const app = authContext();
  await app.boot();
  await app.$('#loginForm').onsubmit({ preventDefault() {} });
  assert.equal(app.screens.at(-1), 'login');
  assert.equal(app.$('#loginError').innerHTML, 'safe: 42501');
  assert.equal(app.$('#loginError').classList.contains('show'), true);
});

test('MFA login shows settings errors after leaving the loading screen', async () => {
  const app = authContext({ step: 'mfa-verify', failureAt: 'settings' });
  await app.boot();
  await app.$('#loginForm').onsubmit({ preventDefault() {} });
  app.$('#mfaCode').value = '123456';
  await app.$('#mfaGo').onclick();
  assert.equal(app.screens.at(-1), 'login');
  assert.equal(app.$('#mfaError').textContent, 'safe: clinic_profile_missing');
  assert.equal(app.$('#mfaError').classList.contains('show'), true);
});

test('session restoration displays an actionable error instead of a hidden message', async () => {
  const app = authContext({ failureAt: 'settings' });
  await app.boot();
  await app.listener()('INITIAL_SESSION', { user: { id: 'doctor-test' } });
  assert.equal(app.screens.at(-1), 'login');
  assert.equal(app.$('#loginError').textContent, 'safe: clinic_profile_missing');
  assert.equal(app.$('#loginError').classList.contains('show'), true);
});

test('blocked accounts still sign out and a successful login stays in the app', async () => {
  const blocked = authContext({ failureAt: null, accountError: 'account_suspended' });
  await blocked.boot();
  await blocked.$('#loginForm').onsubmit({ preventDefault() {} });
  assert.equal(blocked.DB.signOutCount, 1);
  assert.equal(blocked.screens.at(-1), 'login');
  const ok = authContext({ failureAt: null });
  await ok.boot();
  await ok.$('#loginForm').onsubmit({ preventDefault() {} });
  assert.equal(ok.screens.at(-1), 'app');
});

test('missing profile message is safe and explains the next step', () => {
  const context = vm.createContext({ console });
  vm.runInContext(utilsSource, context, { filename: 'utils.js' });
  assert.match(vm.runInContext("explainError({code:'clinic_profile_missing'})", context), /ملف العيادة/);
  assert.match(vm.runInContext("explainError({code:'42501'})", context), /صلاحية/);
});
