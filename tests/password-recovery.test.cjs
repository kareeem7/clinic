'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const resetSource = fs.readFileSync(path.join(root, 'js/reset.js'), 'utf8');
const resetHtml = fs.readFileSync(path.join(root, 'reset.html'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

function exportedApi() {
  const context = vm.createContext({
    window: {},
    document: { addEventListener() {}, querySelector() { return null; } },
    URLSearchParams: URLSearchParams,
    console: console
  });
  vm.runInContext(resetSource + '\nglobalThis.__api = window.ClinicReset;', context);
  return context.__api;
}

function el() {
  const classes = new Set();
  return {
    textContent: '', value: '', innerHTML: '', style: {}, dataset: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, force) => {
        const next = force === undefined ? !classes.has(c) : force;
        if (next) classes.add(c); else classes.delete(c);
      }
    },
    focus() { this.focused = true; },
    addEventListener() {}
  };
}

function fakeSupabase(options) {
  const opts = options || {};
  const calls = { updateUser: [], signOut: 0, exchange: [], listener: null };
  return {
    calls: calls,
    auth: {
      getSession: async () => opts.noSession
        ? { data: { session: null }, error: null }
        : { data: { session: { user: { id: 'synthetic-user' } } }, error: null },
      onAuthStateChange: fn => {
        calls.listener = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      updateUser: async args => {
        if (opts.throwOnUpdate) throw new Error('network down');
        calls.updateUser.push(args);
        return { error: opts.updateUserError || null };
      },
      signOut: async () => { calls.signOut += 1; return { error: null }; },
      exchangeCodeForSession: async code => {
        calls.exchange.push(code);
        return { error: opts.exchangeError || null };
      }
    }
  };
}

function harness(options) {
  const opts = options || {};
  const nodes = {};
  ['#recoveryForm', '#recoveryError', '#recoveryOk', '#recoveryOkText',
    '#recoveryStatus', '#recoveryHelp', '#recoveryPass', '#recoveryPass2']
    .forEach(id => { nodes[id] = el(); });
  // مطابقة الحالة الابتدائية في reset.html
  nodes['#recoveryForm'].classList.add('hide');
  nodes['#recoveryHelp'].classList.add('hide');
  const cleaned = [];
  const sb = opts.sb || fakeSupabase(opts.sbOptions);
  const controller = exportedApi().createRecoveryController({
    sb: sb,
    doc: { querySelector: sel => nodes[sel] || null },
    loc: opts.loc || { pathname: '/reset.html', search: '', hash: '' },
    hist: { replaceState(_state, _title, url) { cleaned.push(url); } }
  });
  return { controller: controller, nodes: nodes, cleaned: cleaned, sb: sb };
}

test('the recovery page is standalone, pinned and free of inline scripts or secrets', () => {
  const scripts = resetHtml.match(/<script\b[^>]*>/gi) || [];
  assert.ok(scripts.length >= 3, 'loads supabase UMD, config and reset scripts');
  scripts.forEach(tag => assert.match(tag, /src=/, 'no inline JavaScript'));
  assert.match(resetHtml, /Content-Security-Policy/);
  assert.match(resetHtml, /@supabase\/supabase-js@2\.118\.0/);
  assert.match(resetHtml, /integrity="sha384-/);
  assert.ok(resetHtml.indexOf('js/config.js') < resetHtml.indexOf('js/reset.js'), 'config loads first');
  assert.match(resetHtml, /id="recoveryForm"/);
  assert.match(resetHtml, /index\.html#reset/);
  assert.doesNotMatch(resetHtml, /service_role|SUPABASE_SERVICE_ROLE_KEY|eyJhbGciOiJIUzI1Ni/);
  assert.match(resetSource, /updateUser\(\{ password: password \}\)/);
  assert.match(resetSource, /detectSessionInUrl: true/);
});

test('both reset-link senders target the dedicated recovery page', () => {
  assert.match(dbSource, /new URL\('reset\.html', location\.origin \+ location\.pathname\)\.href/);
  assert.match(adminSource, /new URL\('reset\.html', location\.origin \+ location\.pathname\)\.href/);
  assert.doesNotMatch(dbSource, /redirectTo: location\.origin \+ location\.pathname/);
  assert.match(mainSource, /location\.hash === '#reset'/);
  assert.match(mainSource, /switchAuthTab\('reset'\)/);
});

test('a valid PKCE recovery link saves the password, signs out and cleans the URL', async () => {
  const h = harness({ loc: { pathname: '/reset.html', search: '?code=synthetic-code', hash: '' } });
  const started = await h.controller.init();
  assert.equal(started.state, 'ready');
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), false);
  assert.deepEqual(h.sb.calls.exchange, ['synthetic-code']);

  const result = await h.controller.submit('NewPass123', 'NewPass123');
  assert.equal(result.ok, true);
  assert.equal(h.sb.calls.updateUser.length, 1);
  assert.equal(h.sb.calls.updateUser[0].password, 'NewPass123');
  assert.deepEqual(Object.keys(h.sb.calls.updateUser[0]), ['password']);
  assert.equal(h.sb.calls.signOut, 1, 'recovery session must not linger');
  assert.ok(h.cleaned.length >= 1, 'tokens are stripped from the address bar');
  assert.ok(h.cleaned.every(url => url === '/reset.html'));
  assert.match(h.nodes['#recoveryOkText'].textContent, /تم تغيير كلمة المرور/);
  assert.equal(h.nodes['#recoveryOk'].style.display, 'flex');
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), true);
  assert.equal(h.nodes['#recoveryHelp'].classList.contains('hide'), false);
});

test('an implicit recovery hash also opens the form without a code exchange', async () => {
  const h = harness({ loc: { pathname: '/reset.html', search: '', hash: '#access_token=x&type=recovery' } });
  assert.equal((await h.controller.init()).state, 'ready');
  assert.deepEqual(h.sb.calls.exchange, []);
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), false);
});

test('PASSWORD_RECOVERY enables the form even when the session arrives late', async () => {
  const h = harness({
    loc: { pathname: '/reset.html', search: '', hash: '#type=recovery' },
    sbOptions: { noSession: true }
  });
  assert.equal((await h.controller.init()).state, 'pending');
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), true);
  assert.equal(typeof h.sb.calls.listener, 'function');
  h.sb.calls.listener('PASSWORD_RECOVERY');
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), false);
  assert.ok(h.cleaned.length > 0);
});

test('short or mismatched passwords never reach the server', async () => {
  const h = harness({ loc: { pathname: '/reset.html', search: '?code=abc', hash: '' } });
  await h.controller.init();
  assert.equal((await h.controller.submit('123', '123')).reason, 'short');
  assert.match(h.nodes['#recoveryError'].textContent, /8 أحرف/);
  assert.equal((await h.controller.submit('abcdefgh', 'abcdefgx')).reason, 'mismatch');
  assert.match(h.nodes['#recoveryError'].textContent, /غير متطابقتين/);
  assert.equal(h.sb.calls.updateUser.length, 0);
  assert.equal(h.sb.calls.signOut, 0);
});

test('expired or used links show a friendly message and request a new link', async () => {
  const h = harness({ loc: { pathname: '/reset.html', search: '?error=access_denied&error_code=otp_expired', hash: '' } });
  assert.equal((await h.controller.init()).state, 'invalid');
  assert.match(h.nodes['#recoveryError'].textContent, /انتهت صلاحية/);
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), true);
  assert.equal(h.nodes['#recoveryHelp'].classList.contains('hide'), false);
  assert.equal(h.sb.calls.updateUser.length, 0);
});

test('opening the page without a recovery link shows guidance instead of a fake form', async () => {
  const h = harness({ loc: { pathname: '/reset.html', search: '', hash: '' } });
  assert.equal((await h.controller.init()).state, 'invalid');
  assert.match(h.nodes['#recoveryError'].textContent, /رابط استعادة/);
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), true);
});

test('server errors keep the form usable and raw server text is never echoed', async () => {
  const h = harness({
    loc: { pathname: '/reset.html', search: '?code=abc', hash: '' },
    sbOptions: { updateUserError: { message: 'AuthApiError: weak password detected internally' } }
  });
  await h.controller.init();
  const result = await h.controller.submit('NewPass123', 'NewPass123');
  assert.equal(result.reason, 'server');
  assert.equal(h.nodes['#recoveryForm'].classList.contains('hide'), false);
  assert.match(h.nodes['#recoveryError'].textContent, /8 أحرف/);
  assert.doesNotMatch(h.nodes['#recoveryError'].textContent, /AuthApiError|internally/);
  assert.equal(h.sb.calls.signOut, 0);
});

test('a lost connection is reported without claiming success', async () => {
  const h = harness({
    loc: { pathname: '/reset.html', search: '?code=abc', hash: '' },
    sbOptions: { throwOnUpdate: true }
  });
  await h.controller.init();
  assert.equal((await h.controller.submit('NewPass123', 'NewPass123')).reason, 'network');
  assert.match(h.nodes['#recoveryError'].textContent, /تعذّر الاتصال/);
  assert.equal(h.sb.calls.signOut, 0);
});

test('the minimum length matches the signup rule', () => {
  assert.equal(exportedApi().MIN_PASSWORD_LENGTH, 8);
});
