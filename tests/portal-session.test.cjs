'use strict';

// Run with: node --test tests/portal-session.test.cjs
// The DOM and RPC responses are simulated; no real patient data or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'js/utils.js'), 'utf8');
const escapeHtml = vm.runInNewContext(utils.match(/^const esc = .*$/m)[0] + '\nesc');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function harness() {
  const elements = new Map(), storage = new Map(), calls = [];
  const screens = [], charts = {}, toasts = [];
  let rpc = async (name, args) => {
    if (name === 'patient_portal_login') return { data: { ok: true, token: args.p_phone }, error: null };
    if (name === 'patient_portal_data') return { data: { ok: true, patient: {}, clinic: {} }, error: null };
    if (name === 'patient_portal_records') return { data: { ok: true, records: [{ weight: args.p_token === 'A' ? 71 : 82 }] }, error: null };
    return { data: null, error: null };
  };
  function $(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        value: '', innerHTML: '', textContent: '', dataset: {}, src: '', style: {},
        classList: {
          add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
          contains(name) { return classes.has(name); },
          toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
        },
        removeAttribute(name) { delete this[name]; }
      });
    }
    return elements.get(selector);
  }
  const context = vm.createContext({
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    document: { body: { classList: { add() {}, remove() {} } }, querySelector: $ },
    window: {}, $, $$: () => [], Charts: charts,
    todayISO: () => '2026-11-01', humanDate: date => date, relDay: date => date, fmtTime: time => time, esc: escapeHtml,
    toast(message, type) { toasts.push({ message, type }); }, switchAuthTab() {}, showScreen(name) { screens.push(name); },
    DB: { sb: { rpc(name, args) { calls.push({ name, args }); return rpc(name, args); } } }
  });
  vm.runInContext(source, context, { filename: 'patient-portal.js' });
  vm.runInContext('Portal.render = () => {}', context);
  return {
    run: expression => vm.runInContext(expression, context), $, charts, storage, calls, screens, toasts,
    setRpc(fn) { rpc = fn; }
  };
}

test('records and form data are cleared between patients on the same page', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  const first = await app.run('portalLoadRecords()');
  assert.equal(first[0].weight, 71);
  assert.equal((await app.run('portalLoadRecords()'))[0].weight, 71);
  app.$('#lgNote').value = 'private note';
  app.$('#ptRows').innerHTML = 'private history';
  let destroyed = 0;
  app.charts.pw1 = { destroy() { destroyed++; } };
  await app.run('Portal.logout()');
  assert.equal(app.$('#lgNote').value, '');
  assert.equal(app.$('#ptRows').innerHTML, '');
  assert.equal(destroyed, 1);
  await app.run("Portal.login('B', '2000-01-01')");
  const second = await app.run('portalLoadRecords()');
  assert.equal(second[0].weight, 82);
  assert.equal(app.calls.filter(x => x.name === 'patient_portal_records').length, 2);
});

test('late records response cannot populate the next patient session', async () => {
  const app = harness(), pending = deferred();
  app.setRpc(async (name, args) => {
    if (name === 'patient_portal_login') return { data: { ok: true, token: args.p_phone } };
    if (name === 'patient_portal_data') return { data: { ok: true, patient: {}, clinic: {} } };
    if (name === 'patient_portal_records' && args.p_token === 'A') return pending.promise;
    if (name === 'patient_portal_records') return { data: { ok: true, records: [{ weight: 82 }] } };
    return { data: null };
  });
  await app.run("Portal.login('A', '2000-01-01')");
  const oldRequest = app.run('portalLoadRecords()');
  await app.run('Portal.logout()');
  await app.run("Portal.login('B', '2000-01-01')");
  pending.resolve({ data: { ok: true, records: [{ weight: 71 }] } });
  assert.equal(await oldRequest, null);
  assert.equal((await app.run('portalLoadRecords()'))[0].weight, 82);
});

test('late portal data and appointments responses do not overwrite the new session', async () => {
  const app = harness(), oldData = deferred(), oldAppointments = deferred();
  app.setRpc(async (name, args) => {
    if (name === 'patient_portal_login') return { data: { ok: true, token: args.p_phone } };
    if (name === 'patient_portal_data' && args.p_token === 'A') return oldData.promise;
    if (name === 'patient_portal_data') return { data: { ok: true, patient: { name: 'B' }, clinic: {} } };
    if (name === 'patient_portal_appointments') return oldAppointments.promise;
    return { data: null };
  });
  const loginA = app.run("Portal.login('A', '2000-01-01')");
  await new Promise(resolve => setImmediate(resolve));
  const appointmentsA = app.run('portalRenderAppointments()');
  await app.run('Portal.logout()');
  await app.run("Portal.login('B', '2000-01-01')");
  oldData.resolve({ data: { ok: true, patient: { name: 'A' }, clinic: {} } });
  oldAppointments.resolve({ data: { ok: true, upcoming: [], past: [] } });
  await loginA; await appointmentsA;
  assert.equal(app.run('Portal.data.patient.name'), 'B');
  assert.equal(app.$('#ptAppointmentsView').innerHTML, '');
});

test('logout clears local data before an unresponsive server returns', async () => {
  const app = harness(), pending = deferred();
  await app.run("Portal.login('A', '2000-01-01')");
  app.setRpc((name) => name === 'patient_portal_logout' ? pending.promise : Promise.resolve({ data: null }));
  const logout = app.run('Portal.logout()');
  assert.equal(app.run('Portal.token'), null);
  assert.equal(app.storage.has('clinic_patient_token'), false);
  assert.equal(app.screens.at(-1), 'login');
  pending.resolve({ data: null });
  await logout;
});

test('rejected portal data clears the session and its cached records', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  await app.run('portalLoadRecords()');
  app.setRpc(async () => ({ data: { ok: false, error: 'unavailable' } }));
  await app.run('Portal.load(true)');
  assert.equal(app.run('Portal.token'), null);
  assert.equal(app.run('portalRecordsCache'), null);
  assert.equal(app.storage.has('clinic_patient_token'), false);
});

test('SQL source guards every data and mutation RPC before its operation', () => {
  // Structural check only; this does not execute PostgreSQL or test deployed RLS.
  const names = ['data', 'records', 'add_measurement', 'appointments', 'cancel'];
  for (const name of names) {
    const start = config.indexOf('create or replace function public.patient_portal_' + name + '(');
    assert.notEqual(start, -1, name);
    const end = config.indexOf('end; $$;', start);
    assert.notEqual(end, -1, name);
    const body = config.slice(start, end);
    assert.match(body, /where token = p_token and expires_at > now\(\)/, name);
    assert.match(body, /if not public\.clinic_active\(v_s\.doctor_id\) or not exists\s*\(/, name);
    assert.match(body, /p\.id = v_s\.patient_id and p\.doctor_id = v_s\.doctor_id and p\.deleted_at is null/, name);
    const guard = body.indexOf('if not public.clinic_active');
    const operation = body.search(/\n\s*(?:insert into public\.(?:audit_logs|patient_records)|update public\.appointments|select \* into v_p)/);
    assert.ok(operation > guard, name + ' operation must follow the guard');
  }
});

test('successful save followed by refresh failure does not invite a duplicate retry', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  await app.run('portalLoadRecords()');
  app.$('#lgWeight').value = '80';
  app.$('#lgDate').value = '2026-11-01';
  app.$('#lgNote').value = 'test note';
  app.$('#ptProgressView').classList.add('hide');
  app.setRpc(async name => {
    if (name === 'patient_portal_add_measurement') return { data: { ok: true }, error: null };
    if (name === 'patient_portal_data') return { data: null, error: new Error('network') };
    throw new Error('unexpected RPC');
  });
  await app.run('portalSubmitMeasurement()');
  assert.equal(app.calls.filter(x => x.name === 'patient_portal_add_measurement').length, 1);
  assert.equal(app.$('#lgWeight').value, '');
  assert.equal(app.$('#lgNote').value, '');
  assert.equal(app.run('portalRecordsCache'), null);
  assert.equal(app.$('#lgSave').disabled, false);
  assert.equal(app.$('#lgErr').classList.contains('show'), false);
  assert.match(app.toasts.at(-1).message, /تم حفظ القياس.*تعذّر تحديث/);
});

test('rejected save retains the form and reports the failure', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  app.$('#lgWeight').value = '80';
  app.$('#lgDate').value = '2026-11-01';
  app.setRpc(async () => ({ data: { ok: false, error: 'rejected' }, error: null }));
  await app.run('portalSubmitMeasurement()');
  assert.equal(app.$('#lgWeight').value, '80');
  assert.equal(app.$('#lgErr').textContent, 'rejected');
  assert.equal(app.$('#lgErr').classList.contains('show'), true);
  assert.equal(app.$('#lgSave').disabled, false);
});

test('successful save and refresh still clears the form and shows feedback', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  app.$('#lgWeight').value = '80';
  app.$('#lgDate').value = '2026-11-01';
  app.$('#ptProgressView').classList.add('hide');
  app.setRpc(async name => name === 'patient_portal_add_measurement'
    ? { data: { ok: true }, error: null }
    : { data: { ok: true, patient: {}, clinic: {} }, error: null });
  await app.run('portalSubmitMeasurement()');
  assert.equal(app.$('#lgWeight').value, '');
  assert.match(app.toasts.at(-1).message, /أول قياس/);
});

test('nutrition progress without weights shows the records and restores chart when weights appear', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  app.run("Portal.data.patient.type = 'nutrition'");
  let records = [{ date: '2026-11-01', weight: null, waist: 90, note: 'test' }];
  app.setRpc(async () => ({ data: { ok: true, records }, error: null }));
  await app.run('portalRenderProgress()');
  assert.match(app.$('#ptMotive').innerHTML, /مفيش قياسات وزن/);
  assert.match(app.$('#ptRows').innerHTML, /2026-11-01/);
  assert.equal(app.$('#ptProgressView .chart-box').style.display, 'none');
  records = [{ date: '2026-11-01', weight: 80 }];
  app.run('portalRecordsCache = null; renderWeightStory = () => {}');
  await app.run('portalRenderProgress()');
  assert.equal(app.$('#ptProgressView .chart-box').style.display, '');
});

test('SQL source restricts portal cancellation to today or later in Cairo', () => {
  // Structural check only; database behavior still requires PostgreSQL tests.
  const start = config.indexOf('create or replace function public.patient_portal_cancel(');
  const end = config.indexOf('end; $$;', start);
  const body = config.slice(start, end);
  assert.match(body, /where id = p_appt and patient_id = v_s\.patient_id and doctor_id = v_s\.doctor_id\s+and deleted_at is null and status <> 'done'\s+and date >= \(now\(\) at time zone 'Africa\/Cairo'\)::date/);
});


test('appointment statuses are escaped in upcoming and past markup', async () => {
  const app = harness();
  await app.run("Portal.login('A', '2000-01-01')");
  const payload = '<img src=x onerror=alert(1)>';
  app.setRpc(async () => ({ data: { ok: true,
    upcoming: [{ id: 'up', date: '2026-11-01', time: '10:00', status: payload },
               { id: 'normal', date: '2026-11-01', time: '11:00', status: 'confirmed' }],
    past: [{ id: 'past', date: '2026-10-31', time: '10:00', status: payload },
           { id: 'prototype', date: '2026-10-30', time: '10:00', status: '__proto__' }]
  } }));
  await app.run('portalRenderAppointments()');
  const markup = app.$('#ptAppointmentsView').innerHTML;
  assert.equal(markup.split('&lt;img src=x onerror=alert(1)&gt;').length - 1, 2);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /chip-teal[^>]*>مؤكد/);
  assert.match(markup, /chip-gray[^>]*>__proto__/);
});

test('photo path validation is shared by setup SQL and standalone migration', () => {
  // Structural regression check; PostgreSQL/RLS behavior requires an integration test.
  const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261101_validate_patient_photo_path.sql'), 'utf8');
  const start = config.indexOf('create or replace function public.patient_portal_add_measurement(');
  const end = config.indexOf('end; $$;', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = config.slice(start, end + 'end; $$;'.length);
  assert.ok(migration.includes(body));
  assert.match(body, /if coalesce\(p_photo_path, ''\) <> '' and \(/);
  assert.match(body, /split_part\(p_photo_path, '\/', 1\) <> v_s\.doctor_id::text/);
  assert.match(body, /split_part\(p_photo_path, '\/', 2\) <> v_s\.patient_id::text/);
  assert.match(body, /split_part\(p_photo_path, '\/', 3\) = ''/);
  assert.match(body, /from storage\.objects o\s+where o\.bucket_id = 'patient-photos' and o\.name = p_photo_path/);
  assert.ok(body.indexOf('if coalesce(p_photo_path') < body.indexOf('insert into public.patient_records'));
});
