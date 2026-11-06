'use strict';

// الدفعة ٤: نسخة البوابة المشفّرة بعد reload، الصور المشفّرة، وتذاكر التعارض.
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
const snapshotSrc = read('js/offline-snapshot.js');
const dbSrc = read('js/db.js');
const stateSrc = read('js/state.js');
const portalSrc = read('js/patient-portal.js');
const sw = read('sw.js');
const html = read('index.html');
const sql = read('sql/migrations/20261114_offline_conflict_tickets.sql');

function memoryStore() {
  const stores = new Map();
  const box = s => { if (!stores.has(s)) stores.set(s, new Map()); return stores.get(s); };
  return {
    stores,
    async getAll(s) { return Array.from(box(s).values()).map(v => ({ ...v })); },
    async get(s, k) { const v = box(s).get(k); return v ? { ...v } : undefined; },
    async put(s, v) { box(s).set(v.id || v.k, { ...v }); },
    async del(s, k) { box(s).delete(k); }
  };
}

function harness(opts = {}) {
  const store = memoryStore(), writes = [], toasts = [], session = {};
  let clipboardText = '';
  const rpcResults = opts.rpcResults || {};
  const State = { patients: [], patientIndex: {}, notes: [], appointments: [], plans: [],
    settings: {}, activeClinicId: null, loaded: false };
  const Portal = { token: opts.token || null, data: opts.patientId ? { patient: { id: opts.patientId } } : null };
  const ctx = vm.createContext({
    console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    Date, Number, Object, Array, String, Math, Promise, JSON, RegExp, Intl, Map, Error,
    navigator: { onLine: true, serviceWorker: null,
      clipboard: { writeText: t => { clipboardText = t; return Promise.resolve(); } } },
    window: { addEventListener() {} },
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {},
      body: { classList: { add() {}, remove() {} } } },
    toast: (m, t) => toasts.push([m, t]), esc: x => String(x), logError() {},
    showScreen: s => writes.push({ showScreen: s }), switchAuthTab() {},
    todayISO: () => '2026-11-05', newRequestId: () => 'req-test', getPatient: () => null,
    normalizeClinicalFeatures: v => v || {}, State, Portal,
    sessionStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null),
      setItem: (k, v) => { session[k] = String(v); },
      removeItem: k => { delete session[k]; }
    }
  });
  vm.runInContext(offlineSrc, ctx, { filename: 'offline.js' });
  vm.runInContext(captureSrc, ctx, { filename: 'offline-capture.js' });
  vm.runInContext(snapshotSrc, ctx, { filename: 'offline-snapshot.js' });
  vm.runInContext(dbSrc, ctx, { filename: 'db.js' });
  const Offline = vm.runInContext('Offline', ctx);
  const OfflineCapture = vm.runInContext('OfflineCapture', ctx);
  const OfflineSnapshot = vm.runInContext('OfflineSnapshot', ctx);
  const DB = vm.runInContext('DB', ctx);
  Offline._openDB = async () => store;
  Offline._key = null;
  Offline.encryption = true;
  Offline.isOnline = opts.online !== false;
  DB.uid = 'doctor-A';
  DB.audit = async (...a) => writes.push({ audit: a });
  DB.loadAll = async () => writes.push({ loadAll: true });
  DB.sb = {
    from(table) {
      const call = { table, op: 'select', payload: null };
      writes.push(call);
      const q = {
        select() { return q; }, insert(p) { call.op = 'insert'; call.payload = p; return q; },
        upsert(p) { call.op = 'upsert'; call.payload = p; return q; },
        update(p) { call.op = 'update'; call.payload = p; return q; },
        eq() { return q; }, is() { return q; }, order() { return q; }, range() { return q; },
        single: () => Promise.resolve({ data: Object.assign({ id: 'srv-1' }, call.payload || {}), error: null }),
        maybeSingle: () => Promise.resolve({ data: Object.assign({ id: 'srv-1' }, call.payload || {}), error: null }),
        then(res, rej) { return Promise.resolve({ data: call.payload ? [call.payload] : [], error: null }).then(res, rej); }
      };
      return q;
    },
    rpc(name, args) {
      writes.push({ rpc: name, args });
      if (Object.prototype.hasOwnProperty.call(rpcResults, name)) return Promise.resolve(rpcResults[name]);
      return Promise.resolve({ data: { ok: true }, error: null });
    }
  };
  return { ctx, store, writes, toasts, session, Offline, OfflineCapture, OfflineSnapshot, DB, State, Portal };
}

const sampleData = () => ({
  ok: true,
  patient: { id: 'p1', doctorId: 'doctor-A', name: 'مريضة تجريبية', type: 'weight', sessions: 3 },
  clinic: { clinicName: 'عيادة النور', doctorName: 'د. أحمد', phone: '+201000000000' },
  nextAppointment: { id: 'a1', date: '2026-11-09', time: '10:00' },
  lastMeasure: { date: '2026-11-04', weight: 82 },
  healthTracking: { glucose: true, bloodPressure: false },
  accessCode: 'SHB1-482913',   // لازم يتشال قبل التشفير
  plan: { title: 'خطة' }
});

// ------------------------------------------------------------------ static
test('batch 4 is wired into the shell, the worker and the portal boot', () => {
  assert.match(html, /<script src="js\/offline-snapshot\.js"><\/script>/);
  assert.match(sw, /CACHE_NAME = 'clinic-shell-v2'/);
  assert.match(sw, /'\.\/js\/offline-snapshot\.js'/);
  assert.match(offlineSrc, /clinic-offline-v1', 2\)/, 'IndexedDB upgraded for photos');
  assert.match(offlineSrc, /createObjectStore\('photos'/);
  assert.match(snapshotSrc, /OfflineSnapshot\.save/);
  assert.match(portalSrc, /OfflineSnapshot\.restore\(this\)/);
  assert.match(portalSrc, /OfflineSnapshot\.save\(data\)/);
  assert.match(portalSrc, /OfflineSnapshot\.clear\(\)/);
  assert.match(portalSrc, /await OfflineSnapshot\.clear\(\)/, 'a new login clears the previous patient snapshot');
  assert.match(portalSrc, /Offline\.putPhoto\(/);
  assert.match(captureSrc, /OfflineCapture\.uploadPhoto\(photo, token\)/);
  assert.match(captureSrc, /offline_report_conflict/);
  assert.match(captureSrc, /offline_list_conflicts/);
  assert.match(captureSrc, /offline_ack_conflict/);
});

test('the conflict-tickets migration is safe by construction and stores no PHI', () => {
  assert.match(sql, /create table if not exists public\.offline_conflict_tickets/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /language plpgsql security definer/);
  assert.match(sql, /language sql security definer/);
  assert.match(sql, /on conflict \(doctor_id, request_id\) do nothing/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /revoke execute on function public\.offline_report_conflict/);
  assert.match(sql, /grant execute on function public\.offline_ack_conflict\(uuid\) to authenticated/);
  assert.match(sql, /acknowledged_at is null/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  for (const phi of ['\bname\b', '\bphone\b', '\bweight\b', '\bnote\b', '\bphoto\b']) {
    assert.doesNotMatch(sql, new RegExp(phi), 'no PHI column: ' + phi);
  }
  assert.doesNotMatch(sql, /create policy[\s\S]{0,300}for insert/i, 'no client-side insert policy');
});

// ---------------------------------------------------------------- behaviour
test('the snapshot strips every code-like key before it touches the notebook', () => {
  const h = harness();
  const clean = h.OfflineSnapshot.sanitize({ a: 1, accessCode: 'SHB1-482913',
    nested: { token: 'tok', patientCode: 'X', keep: 'yes' }, list: [{ apiKey: 'k', v: 2 }] });
  assert.equal(clean.accessCode, undefined);
  assert.equal(clean.nested.token, undefined);
  assert.equal(clean.nested.patientCode, undefined);
  assert.equal(clean.nested.keep, 'yes');
  assert.equal(clean.list[0].apiKey, undefined);
  assert.equal(clean.list[0].v, 2);
});

test('the snapshot round-trips encrypted and never exposes the access code or patient name', async () => {
  const h = harness();
  assert.equal(await h.OfflineSnapshot.save(sampleData()), true);
  const raw = JSON.stringify([...h.store.stores.get('meta').values()]);
  assert.equal(raw.includes('SHB1-482913'), false, 'no access code');
  assert.equal(raw.includes('مريضة تجريبية'), false, 'no PHI plaintext');
  const snap = await h.OfflineSnapshot.read();
  assert.equal(snap.data.patient.name, 'مريضة تجريبية');
  assert.equal(snap.data.accessCode, undefined);
  assert.equal(snap.patientId, 'p1');
  assert.equal(snap.stale, false);
  assert.match(String(snap.savedAt), /^\d{4}-/);
});

test('restore refuses without a session token, and clears the snapshot on demand', async () => {
  const h = harness();
  await h.OfflineSnapshot.save(sampleData());
  const portal = { token: null, render: () => h.writes.push({ rendered: true }) };
  assert.equal(await h.OfflineSnapshot.restore(portal), false);
  portal.token = 'tok';
  assert.equal(await h.OfflineSnapshot.restore(portal), true);
  assert.equal(portal.data.patient.name, 'مريضة تجريبية');
  assert.equal(portal.data.accessCode, null, 'the code is never read back');
  assert.match(h.Offline.snapshotNote, /نسخة أوفلاين للقراءة/);
  assert.equal(h.Offline.role, 'patient');
  assert.ok(h.writes.some(w => w.rendered));
  await h.OfflineSnapshot.clear();
  assert.equal(await h.OfflineSnapshot.read(), null);
  assert.equal(h.Offline.snapshotNote, null);
});

test('an older-than-30-days snapshot is still readable but explicitly marked stale', async () => {
  const h = harness();
  await h.OfflineSnapshot.save(sampleData());
  const db = await h.Offline._openDB();
  const row = await db.get('meta', 'OFFLINE_TEST_ONLY');
  assert.equal(row, undefined);
  // نبدّل savedAt داخل النسخة المشفّرة عن طريق إعادة الحفظ بـ Date مزيّف
  const RealDate = h.ctx.Date;
  h.ctx.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [RealDate.now() - 40 * 86400000])); }
    static now() { return RealDate.now() - 40 * 86400000; }
  };
  try { await h.OfflineSnapshot.save(sampleData()); }
  finally { h.ctx.Date = RealDate; }
  const snap = await h.OfflineSnapshot.read();
  assert.equal(snap.stale, true);
  const portal = { token: 'tok', render() {} };
  await h.OfflineSnapshot.restore(portal);
  assert.match(h.Offline.snapshotNote, /قديمة/);
});

test('a photo is encrypted in its own store and its bytes are never in the queue plaintext', async () => {
  const h = harness();
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
  await h.Offline.putPhoto('req-photo', bytes, 'image/png');
  const row = await h.Offline._openDB().then(db => db.get('photos', 'req-photo'));
  assert.equal(row.type, 'image/png');
  const raw = JSON.stringify(row);
  assert.equal(raw.includes('مريض'), false);
  assert.equal(raw.includes('1,2,3,4,5,6'), false);
  const got = await h.Offline.getPhoto('req-photo');
  assert.deepEqual(Array.from(got.bytes), [1, 2, 3, 4, 5, 6]);
  assert.equal(got.name, 'photo.png');
  assert.throws(() => h.Offline.putPhoto('bad', new Uint8Array(4).buffer, 'application/pdf'), e => e && e.code === 'offline_photo_type');
  assert.throws(() => h.Offline.putPhoto('big', new Uint8Array(6 * 1024 * 1024).buffer, 'image/jpeg'), e => e && e.code === 'offline_photo_size');
});

test('removing a queued item also deletes its encrypted photo', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1' });
  await h.Offline.putPhoto('req-photo', new Uint8Array([9, 8, 7]).buffer, 'image/jpeg');
  await h.Offline.enqueue({ kind: 'rpc', name: 'patient_portal_add_measurement',
    origin: 'patient', requestId: 'req-photo', args: { __photo: 'req-photo' } });
  const item = (await h.Offline.all())[0];
  assert.equal(item.requestId, 'req-photo');
  await h.Offline.remove(item.id);
  assert.equal(h.store.stores.get('photos').size, 0);
});

test('replay uploads the encrypted photo, injects its path and drops the key from RPC args', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_records: { data: { ok: true, records: [] }, error: null } } });
  const uploaded = [];
  h.OfflineCapture.photoUploader = async (photo, token) => {
    uploaded.push({ size: photo.bytes.length, type: photo.type, token });
    return 'doctor-A/p1/photo.jpg';
  };
  await h.Offline.putPhoto('req-photo', new Uint8Array([1, 2, 3]).buffer, 'image/jpeg');
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_add_measurement',
    origin: 'patient', requestId: 'req-photo',
    args: { __session: true, __photo: 'req-photo', p_date: '2026-11-05', p_weight: 80 },
    label: 'قياس وزن' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.sent, 1);
  assert.equal(res.conflicts, 0);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].token, 'tok');
  const call = h.writes.find(w => w.rpc === 'patient_portal_add_measurement');
  assert.equal(call.args.p_photo_path, 'doctor-A/p1/photo.jpg');
  assert.equal('__photo' in call.args, false);
  assert.equal('__session' in call.args, false);
  assert.equal(call.args.p_token, 'tok');
  assert.equal(h.store.stores.get('photos').size, 0, 'photo cleaned after a successful replay');
});

test('a failed photo upload becomes an attachment conflict and keeps the item and photo', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_records: { data: { ok: true, records: [] }, error: null } } });
  h.OfflineCapture.photoUploader = async () => { throw { message: 'تعذّر رفع الصورة' }; };
  await h.Offline.putPhoto('req-photo', new Uint8Array([1, 2, 3]).buffer, 'image/jpeg');
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_add_measurement',
    origin: 'patient', requestId: 'req-photo',
    args: { __session: true, __photo: 'req-photo', p_date: '2026-11-05', p_weight: 80 },
    label: 'قياس وزن' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.conflicts, 1);
  assert.equal(h.Offline.conflicts[0].kind, 'attachment');
  assert.equal(h.writes.some(w => w.rpc === 'patient_portal_add_measurement'), false);
  assert.equal(h.store.stores.get('photos').size, 1);
});

test('remote conflict reporting is best-effort and never stores a token', async () => {
  const h = harness({ token: 'tok', patientId: 'p1' });
  const ok = await h.OfflineCapture.reportConflict({
    requestId: 'req-1', kind: 'daily-limit', label: 'قياس وزن',
    reason: 'وصلت للحد اليومي', origin: 'patient'
  });
  assert.equal(ok, true);
  const call = h.writes.find(w => w.rpc === 'offline_report_conflict');
  assert.equal(call.args.p_token, 'tok', 'token only in the live request');
  assert.equal(call.args.p_request_id, 'req-1');
  assert.equal(JSON.stringify([...(h.store.stores.get('queue') || new Map()).values()]).includes('tok'), false);
});

test('a missing migration degrades gracefully to the local ticket', async () => {
  const h = harness({ rpcResults: {
    offline_report_conflict: { error: { code: 'PGRST205', message: 'function not found' } },
    offline_list_conflicts: { error: { code: '42883', message: 'function not found' } },
    offline_ack_conflict: { error: { code: '42883', message: 'function not found' } }
  } });
  assert.equal(await h.OfflineCapture.reportConflict({ requestId: 'r', kind: 'duplicate',
    label: 'x', reason: 'y', origin: 'patient' }), false);
  assert.equal((await h.OfflineCapture.listConflicts()).length, 0);
  assert.equal(await h.OfflineCapture.ackConflict('t1'), false);
  await h.Offline.refreshRemoteTickets();
  assert.equal(h.Offline.remoteTickets.length, 0);
});

test('remote tickets are listed for the doctor and acknowledged explicitly', async () => {
  const h = harness({ rpcResults: {
    offline_list_conflicts: { data: [{ id: 't1', requestId: 'r1', kind: 'daily-limit',
      label: 'قياس وزن', reason: 'وصلت للحد اليومي', origin: 'patient',
      createdAt: '2026-11-05T10:00:00Z' }], error: null },
    offline_ack_conflict: { data: { ok: true }, error: null }
  } });
  h.Offline.setRole('clinic');
  await h.Offline.refreshRemoteTickets();
  assert.equal(h.Offline.remoteTickets.length, 1);
  assert.equal(h.Offline.remoteTickets[0].kind, 'daily-limit');
  assert.equal(await h.OfflineCapture.ackConflict('t1'), true);
});

test('identity conflicts are never reported remotely with the wrong patient token', async () => {
  const h = harness({ token: 'tok', patientId: 'p2' });
  h.Offline.reportConflictRemote(
    { requestId: 'r1', payload: { origin: 'patient', patientId: 'p1', label: 'قياس' } },
    'identity', 'مريض آخر');
  assert.equal(h.writes.some(w => w.rpc === 'offline_report_conflict'), false);
  h.Offline.reportConflictRemote(
    { requestId: 'r2', payload: { origin: 'patient', patientId: 'p1', label: 'قياس' } },
    'daily-limit', 'حد يومي');
  assert.equal(h.writes.some(w => w.rpc === 'offline_report_conflict'), false,
    'cross-patient payload is refused even with another kind');
});

// --------------------------------------------- نسخة الدكتور + تنظيف الدفتر
const doctorState = () => ({
  settings: { doctorName: 'د. أحمد', clinicName: 'عيادة النور', accessCode: 'SHB1-1' },
  clinics: [{ id: 'c1', name: 'الفرع الأول', code: 'SHB1' }],
  activeClinicId: 'c1',
  patientIndex: { p1: { id: 'p1', name: 'مريضة تجريبية', phone: '+201000000000', status: 'active' } },
  pTotal: 1,
  appointments: [{ id: 'a1', date: '2026-11-05', status: 'confirmed' }],
  plans: [{ id: 'pl1', title: 'خطة' }],
  healthAlerts: [], stats: { visits: [], revenue: [] }
});

test('doctor offline view, snapshot hygiene and server-only screen guard are wired', () => {
  const main = read('js/main.js');
  const app = read('js/app.js');
  assert.match(snapshotSrc, /saveDoctor\(/);
  assert.match(snapshotSrc, /readDoctor\(uid\)/);
  assert.match(snapshotSrc, /clearAll\(/);
  assert.match(snapshotSrc, /MAX_ROSTER/);
  assert.match(dbSrc, /OfflineSnapshot\.saveDoctor\(State, this\.uid\)/);
  assert.match(main, /tryOfflineDoctorFallback/);
  assert.match(main, /OfflineSnapshot\.clearAll\(\)/);
  assert.match(main, /window\.addEventListener\('online'/);
  assert.match(stateSrc, /State\.offlineSnapshot = null/);
  assert.match(app, /State\.offlineSnapshot && typeof Offline/);
  assert.match(offlineSrc, /purgeOrphanPhotos\(\)/);
  assert.match(offlineSrc, /data-offline-action="clear-snapshot"/);
});

test('the doctor snapshot is bound to the doctor uid and the session cache', async () => {
  const h = harness();
  assert.equal(await h.OfflineSnapshot.saveDoctor(doctorState(), 'doctor-A'), true);
  // لا جلسة ولا uid مطابق → مفيش استرجاع (حتى لو النسخة موجودة على الجهاز)
  assert.equal(await h.OfflineSnapshot.readDoctor('doctor-A'), null);
  h.session['clinic_doctor'] = JSON.stringify({ uid: 'doctor-B' });
  assert.equal(await h.OfflineSnapshot.readDoctor('doctor-A'), null);
  h.session['clinic_doctor'] = JSON.stringify({ uid: 'doctor-A' });
  const snap = await h.OfflineSnapshot.readDoctor('doctor-A');
  assert.ok(snap);
  assert.equal(snap.data.uid, 'doctor-A');
  assert.equal(snap.data.settings.accessCode, undefined, 'no access codes in the snapshot');
  assert.equal(snap.data.clinics[0].code, undefined, 'no clinic prefix code in the snapshot');
  assert.equal(snap.data.patientIndex.p1.name, 'مريضة تجريبية');
  assert.equal(snap.stale, false);
  assert.equal(await h.OfflineSnapshot.readDoctor('doctor-B'), null, 'another doctor cannot read it');
  const raw = JSON.stringify([...h.store.stores.get('meta').values()]);
  assert.equal(raw.includes('مريضة تجريبية'), false);
  assert.equal(raw.includes('SHB1-1'), false);
});

test('the doctor snapshot caps the roster and clearAll removes both snapshots', async () => {
  const h = harness();
  const st = doctorState();
  for (let i = 0; i < 20; i++) st.patientIndex['x' + i] = { id: 'x' + i, name: 'م' };
  const orig = h.OfflineSnapshot.MAX_ROSTER;
  h.OfflineSnapshot.MAX_ROSTER = 5;
  const d = h.OfflineSnapshot.doctorData(st, 'doctor-A');
  h.OfflineSnapshot.MAX_ROSTER = orig;
  assert.equal(Object.keys(d.patientIndex).length, 5);
  assert.equal(d.rosterTruncated, true);
  await h.OfflineSnapshot.save(sampleData());
  await h.OfflineSnapshot.saveDoctor(doctorState(), 'doctor-A');
  await h.OfflineSnapshot.clearAll();
  assert.equal(await h.OfflineSnapshot.read(), null);
  assert.equal(h.store.stores.get('meta').size, 1); // مفتاح الجهاز بس
});

test('orphan encrypted photos are purged while referenced ones survive', async () => {
  const h = harness();
  await h.Offline.putPhoto('orphan', new Uint8Array([1, 2]).buffer, 'image/png');
  await h.Offline.putPhoto('req-kept', new Uint8Array([3, 4]).buffer, 'image/png');
  await h.Offline.enqueue({ kind: 'rpc', name: 'x', requestId: 'req-kept' });
  assert.equal(await h.Offline.purgeOrphanPhotos(), 1);
  assert.equal(h.store.stores.get('photos').size, 1);
  assert.ok(await h.Offline.getPhoto('req-kept'));
  assert.equal(await h.Offline.getPhoto('orphan'), null);
});

test('clearing the offline snapshot never deletes pending queued data', async () => {
  const h = harness({ online: false });
  await h.OfflineSnapshot.save(sampleData());
  await h.Offline.enqueue({ kind: 'rpc', name: 'x', requestId: 'r1' });
  const before = (await h.Offline.all()).length;
  h.Offline.snapshotNote = 'نسخة أوفلاين';
  await h.Offline.clearSnapshot();
  assert.equal((await h.Offline.all()).length, before);
  assert.equal(await h.OfflineSnapshot.read(), null);
  assert.equal(h.Offline.snapshotNote, null);
  assert.ok(h.toasts.some(t => /التسجيلات المعلّقة ما اتمسّتش/.test(t[0])));
});
