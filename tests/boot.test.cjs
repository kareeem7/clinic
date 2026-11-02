'use strict';

// Run with: node --test tests/boot.test.cjs
// These tests use fake DOM and Supabase objects; no network or patient data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const portalSource = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

function createApp({ setup = false, token = null, response = { ok: true, patient: {} }, rpcError = null } = {}) {
  const elements = new Map();
  const listeners = {};
  const storage = new Map(token ? [['clinic_patient_token', token]] : []);
  const result = { screens: [], copied: null, reloads: 0, modalCloses: 0, gateCalls: 0, authListener: null };
  function element() {
    return {
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: {}, dataset: {}, value: '', textContent: '',
      addEventListener(type, fn) { this['on' + type] = fn; },
      querySelector() { return element(); }, removeAttribute() {}, focus() {}
    };
  }
  function $(selector) {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  }
  const document = {
    body: element(), querySelector: $,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
  };
  const DB = {
    uid: null, configError: setup ? 'setup-required' : null,
    async init() { return !setup; },
    async mfaGate() { result.gateCalls++; return 'mfa-verify'; },
    async signIn() { this.uid = 'doctor'; return 'mfa-verify'; },
    sb: {
      async rpc(name) {
        if (name === 'patient_portal_logout') return { data: null, error: null };
        if (rpcError) return { data: null, error: new Error('network') };
        return { data: response, error: null };
      },
      auth: { onAuthStateChange(fn) { result.authListener = fn; } }
    }
  };
  const context = vm.createContext({
    document, window: {}, $, $$: () => [], DB,
    sessionStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    },
    navigator: { clipboard: { async writeText(text) { result.copied = text; } } },
    location: { reload() { result.reloads++; } },
    showScreen(name) { result.screens.push(name); },
    closeModal() { result.modalCloses++; }, leaveAdmin() {}, toast() {}, logError() {},
    SUPABASE_SQL: ' test SQL ', State: {}, Cal: {}, Charts: {},
    setTimeout() {}, clearTimeout() {}, console
  });
  vm.runInContext(portalSource, context, { filename: 'patient-portal.js' });
  vm.runInContext(mainSource, context, { filename: 'main.js' });
  // The render details are outside the scope of the boot/session tests.
  vm.runInContext('Portal.render = () => {}', context);
  result.boot = () => vm.runInContext('boot()', context);
  result.portal = vm.runInContext('Portal', context);
  result.DB = DB;
  result.$ = $;
  result.storage = storage;
  result.click = (selector, dataset = {}) => {
    const target = { dataset, closest(s) { return s === selector ? this : null; }, classList: { contains() { return false; } } };
    for (const fn of listeners.click || []) fn({ target });
  };
  result.keydown = key => { for (const fn of listeners.keydown || []) fn({ key }); };
  return result;
}

test('setup screen actions work even when Supabase initialization fails', async () => {
  const app = createApp({ setup: true });
  await app.boot();
  assert.deepEqual(app.screens, ['setup']);
  assert.equal(app.$('#setupSql').textContent, 'test SQL');
  app.click('[data-action]', { action: 'copy-sql' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.copied, 'test SQL');
  app.click('[data-action]', { action: 'refresh-setup' });
  assert.equal(app.reloads, 1);
  assert.equal(app.authListener, null);
});

test('restored patient portal retains UI handlers without opening doctor session', async () => {
  const app = createApp({ token: 'test-token' });
  await app.boot();
  assert.deepEqual(app.screens, ['portal']);
  assert.equal(typeof app.$('#settingsForm').onsubmit, 'function');
  assert.equal(typeof app.$('#btnLogout').onclick, 'function');
  assert.equal(typeof app.authListener, 'function');
  app.click('[data-close]');
  app.keydown('Escape');
  assert.equal(app.modalCloses, 2);
  await app.authListener('INITIAL_SESSION', { user: { id: 'doctor' } });
  await app.authListener('SIGNED_OUT', null);
  assert.equal(app.DB.uid, null);
  assert.deepEqual(app.screens, ['portal']);
  await app.portal.logout();
  await app.authListener('SIGNED_OUT', null);
  assert.equal(app.screens.at(-1), 'login');
  await app.$('#loginForm').onsubmit({ preventDefault() {} });
  assert.equal(app.DB.uid, 'doctor');
  assert.equal(typeof app.$('#settingsForm').onsubmit, 'function');
});

test('rejected patient session is cleared and doctor session can restore', async () => {
  const app = createApp({ token: 'expired', response: { ok: false } });
  await app.boot();
  assert.equal(app.portal.token, null);
  assert.equal(app.storage.has('clinic_patient_token'), false);
  assert.equal(app.screens.at(-1), 'login');
  await app.authListener('INITIAL_SESSION', { user: { id: 'doctor' } });
  assert.equal(app.DB.uid, 'doctor');
  assert.equal(app.gateCalls, 1);
  assert.equal(typeof app.$('#settingsForm').onsubmit, 'function');
});

test('portal network error clears saved token and continues initialization', async () => {
  const app = createApp({ token: 'test-token', rpcError: true });
  await app.boot();
  assert.equal(app.portal.token, null);
  assert.equal(app.storage.has('clinic_patient_token'), false);
  assert.equal(typeof app.authListener, 'function');
  assert.equal(typeof app.$('#btnLogout').onclick, 'function');
});

test('normal boot registers handlers and restores a doctor session through MFA', async () => {
  const app = createApp();
  await app.boot();
  assert.equal(typeof app.authListener, 'function');
  await app.authListener('INITIAL_SESSION', { user: { id: 'doctor' } });
  assert.equal(app.DB.uid, 'doctor');
  assert.equal(app.gateCalls, 1);
});
