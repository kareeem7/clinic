'use strict';

// الدفعة ٢: ربط الكتابة بالدفتر المشفّر + إعادة الرفع.
// محاكاة IndexedDB/WebCrypto/PostgREST داخل vm؛ لا متصفح ولا Supabase حقيقي.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const offlineSrc = read('js/offline.js');
const captureSrc = read('js/offline-capture.js');
const dbSrc = read('js/db.js');
const portalSrc = read('js/patient-portal.js');
const html = read('index.html');
const sw = read('sw.js');
const mainSrc = read('js/main.js');

function memoryStore() {
  const q = new Map(), m = new Map();
  const box = s => (s === 'queue' ? q : m);
  return {
    rows: q, meta: m,
    async getAll(s) { return Array.from(box(s).values()).map(v => ({ ...v })); },
    async get(s, k) { const v = box(s).get(k); return v ? { ...v } : undefined; },
    async put(s, v) { box(s).set(v.id || v.k, { ...v }); },
    async del(s, k) { box(s).delete(k); }
  };
}

function fakeSb(writes, opts = {}) {
  return {
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null, opts: null };
      writes.push(call);
      const q = {
        select() { return q; },
        insert(p) { call.op = 'insert'; call.payload = p; return q; },
        upsert(p, o) { call.op = 'upsert'; call.payload = p; call.opts = o; return q; },
        update(p) { call.op = 'update'; call.payload = p; return q; },
        eq(k, v) { call.filters.push(['eq', k, v]); return q; },
        is(k, v) { call.filters.push(['is', k, v]); return q; },
        order() { return q; }, range() { return q; },
        single() { return Promise.resolve({ data: Object.assign({ id: 'srv-1' }, call.payload || {}), error: null }); },
        maybeSingle() { return Promise.resolve({ data: Object.assign({ id: 'srv-1' }, call.payload || {}), error: null }); },
        then(res, rej) {
          if (opts.failLegacy && call.op === 'upsert' && call.payload && call.payload.clinic_id && !call.__retried) {
            call.__retried = true;
            return Promise.resolve({ data: null, error: { code: '42703', message: 'column clinic_id does not exist' } }).then(res, rej);
          }
          if (opts.networkFail) return Promise.reject({ message: 'Failed to fetch' }).then(res, rej);
          return Promise.resolve({ data: call.payload ? [call.payload] : [], error: null }).then(res, rej);
        }
      };
      return q;
    },
    rpc(name, args) {
      writes.push({ rpc: name, args });
      if (opts.rpcResult) return Promise.resolve(opts.rpcResult);
      return Promise.resolve({ data: { ok: true }, error: null });
    }
  };
}

function harness(opts = {}) {
  const store = memoryStore(), writes = [], toasts = [];
  const State = {
    patients: [], patientIndex: {}, notes: [], appointments: [], plans: [],
    settings: {}, activeClinicId: opts.clinicId || null, loaded: false
  };
  const Portal = { token: opts.token || null, data: opts.patientId ? { patient: { id: opts.patientId } } : null };
  const ctx = vm.createContext({
    console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    Date, Number, Object, Array, String, Math, Promise, JSON, RegExp,
    navigator: { onLine: opts.online !== false, serviceWorker: null },
    window: { addEventListener() {} },
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
    toast: (m, t) => toasts.push([m, t]), esc: x => String(x), logError() {},
    todayISO: () => '2026-11-04', newRequestId: () => 'req-test',
    getPatient: () => null, State, Portal,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  });
  vm.runInContext(offlineSrc, ctx, { filename: 'offline.js' });
  vm.runInContext(captureSrc, ctx, { filename: 'offline-capture.js' });
  vm.runInContext(dbSrc, ctx, { filename: 'db.js' });
  const Offline = vm.runInContext('Offline', ctx);
  const OfflineCapture = vm.runInContext('OfflineCapture', ctx);
  const DB = vm.runInContext('DB', ctx);
  Offline._openDB = async () => store;
  Offline._key = null;
  Offline.encryption = opts.encryption !== false;
  Offline.isOnline = opts.online !== false;
  DB.uid = opts.uid === undefined ? 'doctor-A' : opts.uid;
  DB.audit = async (...a) => writes.push({ audit: a });
  DB.sb = fakeSb(writes, opts);
  return { ctx, store, writes, toasts, Offline, OfflineCapture, DB, State, Portal };
}

// ---------------------------------------------------------------- static
test('batch 2 wires both device kinds through explicit, guarded seams', () => {
  assert.match(html, /<script src="js\/offline\.js"><\/script>\s*\n<script src="js\/offline-capture\.js"><\/script>\s*\n<script src="js\/app\.js"><\/script>/);
  for (const f of ['./js/offline.js', './js/offline-capture.js']) assert.ok(sw.includes("'" + f + "'"), f + ' precached');
  assert.match(dbSrc, /function offlineCall\(/);
  assert.match(dbSrc, /function offlineId\(/);
  assert.match(dbSrc, /typeof Offline !== 'undefined' && !Offline\.isOnline\) return;/, 'audit skips offline');
  assert.match(portalSrc, /function portalOfflineCall\(/);
  assert.match(portalSrc, /function portalIsOffline\(/);
  assert.match(mainSrc, /OfflineCapture\.enter\('clinic'\)/);
  assert.match(mainSrc, /OfflineCapture\.syncWhenReady\(\)/);
  assert.match(portalSrc, /OfflineCapture\.enter\('patient'\)/);
  assert.match(portalSrc, /OfflineCapture\.syncWhenReady\(\)/);
});

test('portal queue descriptors carry a session marker, never a token or an access code', () => {
  assert.match(portalSrc, /__session: true/);
  assert.match(captureSrc, /delete args\.__session; args\.p_token = token/);
  assert.match(captureSrc, /if \(op\.patientId && op\.patientId !== current\)/, 'cross-patient guard');
  assert.match(captureSrc, /if \(op\.doctorId && op\.doctorId !== uid\)/, 'cross-doctor guard');
  assert.match(captureSrc, /if \(!token\) return \{ skipped: true \}/, 'expired session stays pending');
  assert.match(captureSrc, /if \(!uid\) return \{ skipped: true \}/, 'no doctor session stays pending');
  assert.match(captureSrc, /offline_no_client/, 'replay refuses without a client');
  assert.match(captureSrc, /ignoreDuplicates: true/, 'idempotent inserts');
  assert.match(captureSrc, /42703/, 'legacy schemas without clinic_id');
  assert.match(captureSrc, /ready\(\)/, 'no replay before a session exists');
  for (const name of ['patient_portal_add_measurement', 'patient_portal_add_health_reading', 'patient_portal_cancel']) {
    assert.match(portalSrc, new RegExp("name: '" + name + "'"));
  }
  assert.match(portalSrc, /الصورة مش هتتحفظ أوفلاين/, 'photos are explicitly deferred');
  assert.match(offlineSrc, /const canDiscard = Offline\.role !== 'patient'/,
    'a patient must not be offered a delete button for a doctor-review item');
  assert.match(offlineSrc, /if \(res && res\.skipped\) \{ skipped\+\+; continue; \}/,
    'session-less items stay pending instead of becoming false conflicts');
});

// ---------------------------------------------------------------- behaviour
test('offline doctor note is encrypted on the device and replayed after reconnection', async () => {
  const h = harness({ online: false });
  const rec = { patientId: 'p1', note: 'زيارة متابعة', visit: '2026-11-04' };
  await h.DB.addNote(rec);
  assert.equal(h.writes.some(w => w.op === 'insert'), false, 'no live network write while offline');
  assert.equal(await h.Offline.refreshCount(), 1);
  assert.equal(JSON.stringify([...h.store.rows.values()]).includes('زيارة متابعة'), false);
  const item = (await h.Offline.all())[0];
  assert.equal(item.payload.origin, 'clinic');
  assert.equal(item.payload.doctorId, 'doctor-A');
  assert.equal(item.payload.table, 'patient_notes');
  assert.match(String(item.payload.row.id), /^[0-9a-f-]{36}$/i, 'client-generated UUID');
  assert.equal(rec.id, item.payload.row.id, 'optimistic state uses the same stable id');
  assert.equal(h.State.notes.length, 1);

  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.sent, 1);
  assert.equal(res.conflicts, 0);
  assert.equal(h.store.rows.size, 0);
  assert.ok(h.writes.some(w => w.op === 'upsert' && w.table === 'patient_notes' && w.opts.ignoreDuplicates === true));
  assert.ok(h.writes.some(w => w.audit && w.audit[0] === 'sync'), 'replay is audited');
});

test('an online write keeps the original direct path and queues nothing', async () => {
  const h = harness({ online: true });
  await h.DB.addNote({ patientId: 'p1', note: 'x' });
  assert.equal(await h.Offline.refreshCount(), 0);
  assert.ok(h.writes.some(w => w.op === 'insert' && w.table === 'patient_notes'));
});

test('a lost network response is captured instead of being thrown away', async () => {
  const h = harness({ online: true, networkFail: true });
  await h.DB.addNote({ patientId: 'p1', note: 'x' });
  assert.equal(await h.Offline.refreshCount(), 1, 'the note is not lost');
  assert.equal(h.State.notes.length, 1, 'optimistic UI still shows it');
});

test('a new patient offline is queued as ordered ops sharing one stable id', async () => {
  const h = harness({ online: false, clinicId: 'branch-A' });
  const data = { name: 'مريض تجريبي', phone: '+201000000000', status: 'active',
    measurements: [{ date: '2026-11-04', weight: 80, height: 170, recordType: 'manual' }] };
  await h.DB.add('patients', data);
  const items = await h.Offline.all();
  assert.equal(items.length, 2);
  assert.equal(items[0].payload.table, 'patients');
  assert.equal(items[1].payload.table, 'patient_records');
  assert.equal(items[1].payload.row.patient_id, items[0].payload.row.id);
  assert.equal(items[0].payload.clinicId, 'branch-A');
  assert.equal(data.id, items[0].payload.row.id);
  assert.equal(h.State.patients.length, 1);
  h.Offline.isOnline = true;
  assert.equal((await h.Offline.flush()).sent, 2);
});

test('a portal token is never written to the notebook and is injected only at replay', async () => {
  const h = harness({ online: false, token: 'SECRET-PORTAL-TOKEN', patientId: 'patient-1' });
  await h.OfflineCapture.call(
    { kind: 'rpc', name: 'patient_portal_add_measurement', origin: 'patient',
      args: { __session: true, p_weight: 80 }, label: 'قياس' },
    () => Promise.resolve({ data: { ok: true }, error: null }),
    { data: { ok: true }, error: null }
  );
  assert.equal(JSON.stringify([...h.store.rows.values()]).includes('SECRET-PORTAL-TOKEN'), false);
  const payload = (await h.Offline.all())[0].payload;
  assert.equal(payload.patientId === 'patient-1', true);
  assert.equal(payload.args.p_token, undefined);
  assert.equal(payload.args.__session, true);
  h.Offline.isOnline = true;
  assert.equal((await h.Offline.flush()).sent, 1);
  const rpc = h.writes.find(w => w.rpc === 'patient_portal_add_measurement');
  assert.equal(rpc.args.p_token, 'SECRET-PORTAL-TOKEN');
  assert.equal(rpc.args.__session, undefined);
});

test('queuing a token directly is rejected by the notebook', async () => {
  const h = harness({ online: false });
  await assert.rejects(
    h.OfflineCapture.call({ kind: 'rpc', name: 'x', args: { p_token: 'SECRET' } },
      () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null }),
    e => e.code === 'offline_forbidden_field');
  assert.equal(h.store.rows.size, 0);
});

test('an expired patient session keeps the item pending, never uploads, and needs no manual retry', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'patient-1' });
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_cancel', origin: 'patient',
    args: { __session: true, p_appt: 'a1' }, label: 'إلغاء' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  h.ctx.Portal.token = null;
  const res = await h.Offline.flush();
  assert.equal(res.skipped, 1);
  assert.equal(res.conflicts, 0, 'not a data conflict — just waiting');
  assert.equal(res.sent, 0);
  assert.equal(h.store.rows.size, 1, 'kept pending, never dropped');
  assert.equal(h.Offline.conflicts.length, 0);
  assert.equal(h.writes.some(w => w.rpc), false);
  // أول ما يسجّل دخول تاني، نفس الدفعة بترفع لوحدها
  h.ctx.Portal.token = 'tok2';
  assert.equal((await h.Offline.flush()).sent, 1);
  assert.equal(h.store.rows.size, 0);
});

test('a different patient logging in can never receive another patient data', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'patient-1' });
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_add_measurement', origin: 'patient',
    args: { __session: true, p_weight: 80 }, label: 'قياس' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  h.ctx.Portal.data.patient.id = 'patient-2';
  const res = await h.Offline.flush();
  assert.equal(res.conflicts, 1);
  assert.match(h.Offline.conflicts[0].reason, /مريض آخر|حساب خاطئ/);
  assert.equal(h.writes.some(w => w.rpc), false);
});

test('a different doctor account raises a review conflict instead of a wrong-tenant write', async () => {
  const h = harness({ online: false });
  await h.DB.update('patients', 'p1', { notes: 'x' });
  h.Offline.isOnline = true;
  h.DB.uid = 'doctor-B';
  const res = await h.Offline.flush();
  assert.equal(res.conflicts, 1);
  assert.match(h.Offline.conflicts[0].reason, /حساب دكتور آخر/);
  assert.equal(h.writes.some(w => w.op === 'update'), false);
});

test('no replay happens before a session is ready, even if the online event fires early', async () => {
  const h = harness({ online: false, uid: null });
  await h.DB.addNote({ patientId: 'p1', note: 'x' });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.stopped, true);
  assert.equal(res.sent, 0);
  assert.equal(h.store.rows.size, 1);
  h.DB.uid = 'doctor-A';
  assert.equal((await h.Offline.flush()).sent, 1);
});

test('a server-side daily-limit refusal becomes a doctor-review conflict', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'patient-1',
    rpcResult: { data: { ok: false, error: 'وصلت للحد اليومي (20 كتابة)' }, error: null } });
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_add_measurement', origin: 'patient',
    args: { __session: true, p_weight: 80 }, label: 'قياس' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.conflicts, 1);
  assert.match(h.Offline.conflicts[0].reason, /اليومي|20 كتابة/);
  assert.ok(h.toasts.some(t => /مراجعة/.test(t[0])), 'someone is notified, not auto-resolved');
});

test('a legacy schema without clinic_id is retried without the column', async () => {
  const h = harness({ online: false, clinicId: 'branch-A', failLegacy: true });
  await h.DB.addNote({ patientId: 'p1', note: 'x' });
  h.Offline.isOnline = true;
  assert.equal((await h.Offline.flush()).sent, 1);
  const upserts = h.writes.filter(w => w.op === 'upsert');
  assert.equal(upserts.length, 2);
  assert.equal('clinic_id' in upserts[0].payload, true);
  assert.equal('clinic_id' in upserts[1].payload, false);
});

test('without WebCrypto no patient data is stored at all', async () => {
  const h = harness({ online: false, encryption: false });
  await assert.rejects(h.DB.addNote({ patientId: 'p1', note: 'x' }), e => e.code === 'offline_crypto_missing');
  assert.equal(h.store.rows.size, 0);
});
