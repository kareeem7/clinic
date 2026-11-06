'use strict';

// الدفعة ٣: قواعد التعارض، منع التكرار، تذكرة المراجعة، والمسارات المتبقّية.
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

function harness(opts = {}) {
  const store = memoryStore(), writes = [], toasts = [];
  let clipboardText = '';
  const rpcResults = opts.rpcResults || {};
  const State = {
    patients: [], patientIndex: {}, notes: [], appointments: [], plans: [],
    settings: {}, activeClinicId: null, loaded: false
  };
  const Portal = { token: opts.token || null, data: opts.patientId ? { patient: { id: opts.patientId } } : null };
  const ctx = vm.createContext({
    console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    Date, Number, Object, Array, String, Math, Promise, JSON, RegExp, Intl, Map,
    navigator: {
      onLine: true, serviceWorker: null,
      clipboard: { writeText: t => { clipboardText = t; return Promise.resolve(); } }
    },
    window: { addEventListener() {} },
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
    toast: (m, t) => toasts.push([m, t]), esc: x => String(x), logError() {},
    todayISO: () => '2026-11-05', newRequestId: () => 'req-test',
    getPatient: () => null, State, Portal,
    normalizeClinicalFeatures: v => v || {},
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
  Offline.encryption = true;
  Offline.isOnline = opts.online !== false;
  DB.uid = 'doctor-A';
  DB.audit = async (...a) => writes.push({ audit: a });
  DB.loadAll = async () => writes.push({ loadAll: true });
  DB.sb = {
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null };
      writes.push(call);
      const q = {
        select() { return q; },
        insert(p) { call.op = 'insert'; call.payload = p; return q; },
        upsert(p) { call.op = 'upsert'; call.payload = p; return q; },
        update(p) { call.op = 'update'; call.payload = p; return q; },
        eq(k, v) { call.filters.push(['eq', k, v]); return q; },
        is(k, v) { call.filters.push(['is', k, v]); return q; },
        order() { return q; }, range() { return q; },
        single() { return Promise.resolve({ data: Object.assign({ id: 'srv-1' }, call.payload || {}), error: null }); },
        maybeSingle() { return Promise.resolve({ data: Object.assign({ id: 'srv-1' }, call.payload || {}), error: null }); },
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
  return { ctx, store, writes, toasts, Offline, OfflineCapture, DB, State, Portal,
    clipboard: () => clipboardText };
}

const measurementOp = () => ({
  kind: 'rpc', name: 'patient_portal_add_measurement', origin: 'patient',
  args: { __session: true, p_weight: 80, p_date: '2026-11-05', p_note: 'قياس من البيت' },
  label: 'قياس وزن من المريض'
});

async function queueMeasurement(h) {
  await h.OfflineCapture.call(measurementOp(),
    () => Promise.resolve({ data: { ok: true }, error: null }),
    { data: { ok: true }, error: null });
  return (await h.Offline.all())[0].id;
}

// ------------------------------------------------------------------ static
test('batch 3 wires the remaining safe paths and documents the unsafe one', () => {
  assert.match(dbSrc, /kind: 'rpc', name: 'save_clinic_settings'/);
  assert.match(dbSrc, /label: 'استعادة من الأرشيف'/);
  assert.match(dbSrc, /kind: 'method', method: 'updateHealthReading'/);
  assert.match(captureSrc, /if \(op\.kind === 'method'\)/);
  assert.match(captureSrc, /measurementLooksUploaded/);
  assert.match(captureSrc, /classifyRpcMessage/);
  assert.match(captureSrc, /classifyThrown/);
  assert.match(captureSrc, /warnBudget/);
  assert.match(captureSrc, /timeZone: 'Africa\/Cairo'/);
  assert.match(offlineSrc, /reportText\(\)/);
  assert.match(offlineSrc, /data-offline-action="force"/);
  assert.match(offlineSrc, /async setFlag\(/);
});

// ---------------------------------------------------------------- behaviour
test('a likely duplicate measurement becomes a doctor-review conflict, never a silent duplicate or delete', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_records: {
      data: { ok: true, records: [{ date: '2026-11-05', weight: 80, note: 'قياس من البيت' }] }, error: null
    } } });
  const id = await queueMeasurement(h);
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.sent, 0);
  assert.equal(res.conflicts, 1);
  assert.equal(h.store.rows.size, 1, 'nothing dropped automatically');
  assert.equal(h.Offline.conflicts[0].kind, 'possible-duplicate');
  assert.match(h.Offline.conflicts[0].reason, /محتمل/);
  assert.equal(h.writes.some(w => w.rpc === 'patient_portal_add_measurement'), false);
});

test('the doctor can force a review item, and only then is it actually uploaded', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_records: {
      data: { ok: true, records: [{ date: '2026-11-05', weight: 80, note: 'قياس من البيت' }] }, error: null
    } } });
  const id = await queueMeasurement(h);
  h.Offline.isOnline = true;
  await h.Offline.flush();
  assert.equal(h.Offline.conflicts.length, 1);
  await h.Offline.resolveConflict(id, 'force');
  assert.equal(h.store.rows.size, 0);
  assert.equal(h.Offline.conflicts.length, 0);
  assert.equal(h.writes.some(w => w.rpc === 'patient_portal_add_measurement'), true);
  assert.equal(h.writes.filter(w => w.rpc === 'patient_portal_records').length, 1,
    'the duplicate check is skipped after the decision');
});

test('setFlag keeps the operation decryptable and exposes forced to the replay worker', async () => {
  const h = harness({ online: false });
  await h.DB.addNote({ patientId: 'p1', note: 'زيارة' });
  const id = (await h.Offline.all())[0].id;
  assert.equal((await h.Offline.all())[0].forced, false);
  await h.Offline.setFlag(id, 'forced', true);
  const item = (await h.Offline.all())[0];
  assert.equal(item.forced, true);
  assert.equal(item.payload.row.note, 'زيارة');
  assert.equal(JSON.stringify([...h.store.rows.values()]).includes('زيارة'), false);
});

test('an already-cancelled appointment is recognised as an idempotent success', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_cancel: {
      data: { ok: false, error: 'الموعد مش موجود أو مكتمل أو تاريخه فات' }, error: null
    } } });
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_cancel', origin: 'patient',
    args: { __session: true, p_appt: 'a1' }, label: 'إلغاء موعد' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.sent, 1);
  assert.equal(res.conflicts, 0);
  assert.equal(h.store.rows.size, 0);
});

test('server refusals are classified into actionable Arabic reasons', async () => {
  const cases = [
    ['وصلت للحد اليومي المسموح به وهو 20 قراءة؛ حاول غدًا', 'daily-limit'],
    ['التاريخ لازم يكون النهارده أو خلال آخر أسبوع', 'date-window'],
    ['العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة', 'permission'],
    ['قيمة غير مقبولة', 'validation']
  ];
  for (const [msg, kind] of cases) {
    const h = harness({ online: false, token: 'tok', patientId: 'p1',
      rpcResults: { patient_portal_add_health_reading: { data: { ok: false, error: msg }, error: null } } });
    await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_add_health_reading',
      origin: 'patient', args: { __session: true, p_request_id: 'r1' }, label: 'قراءة' },
      () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
    h.Offline.isOnline = true;
    const res = await h.Offline.flush();
    assert.equal(res.conflicts, 1, msg);
    assert.equal(h.Offline.conflicts[0].kind, kind, msg);
    assert.match(h.Offline.conflicts[0].reason, /\S/);
  }
});

test('an expired session inside an RPC reply stays pending, not a conflict', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_add_health_reading: {
      data: { ok: false, error: 'انتهت جلستك — سجّل دخولك من جديد' }, error: null
    } } });
  await h.OfflineCapture.call({ kind: 'rpc', name: 'patient_portal_add_health_reading',
    origin: 'patient', args: { __session: true, p_request_id: 'r1' }, label: 'قراءة' },
    () => Promise.resolve({ data: { ok: true }, error: null }), { data: { ok: true }, error: null });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.skipped, 1);
  assert.equal(res.conflicts, 0);
  assert.equal(h.store.rows.size, 1);
});

test('PostgREST errors are classified by kind instead of a generic failure', () => {
  const h = harness();
  const C = h.OfflineCapture;
  assert.equal(C.classifyThrown({ code: '23505' }).kind, 'duplicate');
  assert.equal(C.classifyThrown({ code: '23503' }).kind, 'foreign-key');
  assert.equal(C.classifyThrown({ code: 'PGRST205' }).kind, 'schema');
  assert.equal(C.classifyThrown({ code: '42501' }).kind, 'permission');
  assert.equal(C.classifyThrown({ code: '22023' }).kind, 'validation');
  assert.equal(C.classifyThrown({ code: 'weird' }).kind, 'unknown');
  assert.equal(C.classifyRpcMessage('الموعد مش موجود أو مكتمل أو تاريخه فات').alreadyApplied, true);
});

test('network failures stop the flush and keep the item instead of raising a false conflict', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1',
    rpcResults: { patient_portal_records: { error: { message: 'Failed to fetch' } } } });
  await queueMeasurement(h);
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.stopped, true);
  assert.equal(res.conflicts, 0);
  assert.equal(h.store.rows.size, 1);
});

test('the portable review ticket contains no patient data', async () => {
  const h = harness({ online: false });
  await h.DB.add('patients', { name: 'اسم_خاص_123', phone: '+201000000000', status: 'active' });
  const id = (await h.Offline.all())[0].id;
  await h.Offline.markConflict(id, 'تكرار محتمل — راجعه', 'possible-duplicate');
  const report = h.Offline.reportText();
  assert.match(report, /تذكرة مراجعة أوفلاين/);
  assert.match(report, /possible-duplicate/);
  assert.match(report, /تكرار محتمل/);
  assert.equal(report.includes('اسم_خاص_123'), false, 'no patient name');
  assert.equal(report.includes('+201000000000'), false, 'no phone');
  assert.match(report, /البيانات دي لسه على الجهاز/);
  await h.Offline.copyReport();
  assert.match(h.clipboard(), /تذكرة مراجعة أوفلاين/);
});

test('remaining doctor paths are captured offline without hitting the network', async () => {
  const h = harness({ online: false });
  await h.DB.saveSettings({ clinicName: 'عيادة' });
  await h.DB.restore('patients', 'p1');
  await h.DB.updateHealthReading('p1', 'r1', {
    readingType: 'glucose', glucoseValue: 110, glucoseType: 'fasting'
  });
  const items = await h.Offline.all();
  assert.equal(items.length, 3);
  assert.equal(items[0].payload.name, 'save_clinic_settings');
  assert.equal(items[1].payload.kind, 'update');
  assert.equal(items[2].payload.kind, 'method');
  assert.equal(items[2].payload.method, 'updateHealthReading');
  assert.equal(h.writes.some(w => w.loadAll), false, 'restore skips loadAll while offline');
  assert.equal(h.writes.filter(w => w.op === 'update').length, 0, 'no live writes');
});

test('a deferred method op really replays through the validated live method', async () => {
  const h = harness({ online: false });
  await h.DB.updateHealthReading('p1', 'r1', {
    readingType: 'glucose', glucoseValue: 110, glucoseType: 'fasting'
  });
  h.Offline.isOnline = true;
  const res = await h.Offline.flush();
  assert.equal(res.sent, 1);
  assert.equal(res.conflicts, 0);
  assert.ok(h.writes.some(w => w.op === 'update' && w.table === 'patient_health_readings'));
});

test('approaching the daily server limit produces a soft warning, never a block', async () => {
  const h = harness({ online: false, token: 'tok', patientId: 'p1' });
  for (let i = 0; i < 18; i++) {
    await h.OfflineCapture.call(measurementOp(),
      () => Promise.resolve({ data: { ok: true }, error: null }),
      { data: { ok: true }, error: null });
  }
  assert.equal(await h.Offline.refreshCount(), 18);
  assert.ok(h.toasts.some(t => /20 كتابة/.test(t[0])), 'warning shown');
  assert.equal(h.store.rows.size, 18, 'nothing was blocked or dropped');
});
