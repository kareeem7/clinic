'use strict';

// الدفعة ١ من الأوفلاين: نسخة الموقع + الدفتر المشفّر + تنبيه الدكتور.
// اختبارات مستندية + محاكاة IndexedDB/WebCrypto؛ لا متصفح ولا Supabase حقيقي.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
const offline = read('js/offline.js');
const utils = read('js/utils.js');
const readme = read('README.md');

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

function harness(store = memoryStore()) {
  const toasts = [];
  const ctx = vm.createContext({
    console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    navigator: { onLine: true, serviceWorker: null },
    window: { addEventListener() {} },
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
    toast: (m, t) => toasts.push([m, t]), esc: x => String(x), logError() {},
    DB: { sb: null }
  });
  vm.runInContext(offline, ctx, { filename: 'offline.js' });
  const Offline = vm.runInContext('Offline', ctx);
  Offline._openDB = async () => store; // مخزن ذاكرة بدل IndexedDB
  Offline._key = null;
  Offline.encryption = true;
  Offline.isOnline = true;
  return { Offline, store, toasts, ctx };
}

test('service worker precaches every local shell file and never touches Supabase', () => {
  assert.match(sw, /CACHE_NAME = 'clinic-shell-v4'/);
  assert.match(sw, /self\.addEventListener\('install'/);
  assert.match(sw, /self\.addEventListener\('activate'/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /req\.method !== 'GET'\) return;/, 'writes are never intercepted');
  assert.match(sw, /supabase\\\.co\$/i, 'explicit bypass for patient data / tokens');
  assert.match(sw, /Promise\.allSettled/, 'optional CDN failures must not break install');
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  const expected = [
    './css/landing.css',
    ...fs.readdirSync(path.join(root, 'css')).filter(f => f.endsWith('.css')).map(f => './css/' + f),
    ...fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => './js/' + f)
  ];
  for (const f of ['./index.html', './reset.html', './js/offline.js', './css/main.css', ...expected]) {
    assert.ok(shell.includes("'" + f + "'"), f + ' is precached');
  }
  assert.doesNotMatch(sw, /fetch\([^)]*https?:\/\/(?!cdn\.jsdelivr)/, 'no third-party fetch');
  assert.match(sw, /\/index\\\.html\$/i, 'only the main page refreshes the index fallback');
  assert.match(sw, /cache\.match\(req\)/, 'offline navigation returns the requested cached page');
});

test('page registers the worker through an external script and shows an offline bar', () => {
  assert.match(html, /<script src="js\/offline\.js"><\/script>/);
  assert.match(html, /<script src="js\/offline-snapshot\.js"><\/script>/);
  for (const id of ['offlineBar', 'offlineLabel', 'offlinePending', 'offlineFlushBtn', 'offlineReviewBtn', 'offlineConflictCount', 'offlinePanel']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\bsrc\s*=/i, 'CSP forbids inline scripts');
    assert.equal(m[2].trim(), '');
  }
  assert.match(html, /تُحفظ مؤقتاً على هذا الجهاز فقط بصيغة مشفّرة/);
  assert.doesNotMatch(html, /لن تُحفظ محلياً إطلاقاً/);
  // القاعدة القديمة «لا تخزين محلي إطلاقاً» اتلغت بموافقة صاحب المشروع
  for (const f of ['js/db.js', 'js/main.js']) {
    assert.doesNotMatch(read(f), /must never be written to localStorage|must never touch localStorage/);
  }
  assert.match(read('js/db.js'), /navigator\.onLine === false/);
  assert.match(read('js/db.js'), /نسخة مكتبة Supabase لسه مش محفوظة/);
});

test('offline queue is device-only, encrypted, and refuses codes/tokens', () => {
  assert.match(offline, /indexedDB\.open\('clinic-offline-v1'/);
  assert.doesNotMatch(offline, /localStorage\.setItem|sessionStorage\.setItem/);
  assert.match(offline, /generateKey\(\s*\{ name: 'AES-GCM', length: 256 \}, false/);
  assert.match(offline, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/);
  assert.match(offline, /assertSafe\(payload\)/);
  assert.match(offline, /offline_forbidden_field/);
  assert.match(offline, /offline_crypto_missing/);
  assert.match(offline, /requestId/); // منع التكرار عند إعادة المحاولة
  assert.match(offline, /if \(!Offline\.isOnline\)/);
  assert.match(offline, /Offline\.alertDoctor\(\)/);
  assert.match(offline, /DB\.sb/, 'replay goes only through the configured Supabase client');
  assert.doesNotMatch(offline, /fetch\(\s*['"]https?:\/\//, 'no third-party host in replay path');
});

test('enqueue stores only ciphertext on the device', async () => {
  const { Offline, store } = harness();
  const id = await Offline.enqueue({ kind: 'insert', table: 'patients', row: { name: 'تجريبي واحد' }, requestId: 'req-1' });
  assert.match(String(id), /^op-/);
  assert.equal(await Offline.refreshCount(), 1);
  const stored = store.rows.get(id);
  assert.ok(stored);
  assert.equal(stored.requestId, 'req-1');
  assert.equal(stored.iv.length, 12);
  assert.ok(Array.isArray(stored.data) && stored.data.length > 0);
  assert.equal(JSON.stringify(stored).includes('تجريبي واحد'), false, 'no plaintext at rest');
  assert.equal(JSON.stringify(stored).includes('patients'), false);
  const items = await Offline.all();
  assert.equal(items[0].payload.row.name, 'تجريبي واحد', 'decrypts back correctly');
  assert.equal(store.meta.has('deviceKey'), true, 'device key kept on this device only');
});

test('flush replays in order and removes only successfully uploaded items', async () => {
  const { Offline, store } = harness();
  await Offline.enqueue({ kind: 'insert', table: 'patients', row: { n: 1 } });
  await Offline.enqueue({ kind: 'insert', table: 'patients', row: { n: 2 } });
  const seen = [];
  const res = await Offline.flush(async op => { seen.push(op.row.n); return { ok: true }; });
  assert.equal(seen.join(','), '1,2', 'strict order');
  assert.equal(res.sent, 2);
  assert.equal(res.conflicts, 0);
  assert.equal(store.rows.size, 0);
  assert.equal(await Offline.refreshCount(), 0);
});

test('a permanent failure raises a doctor alert and the item waits for review', async () => {
  const { Offline, store, toasts } = harness();
  const id = await Offline.enqueue({ kind: 'insert', table: 'patients', row: { n: 1 } });
  const res = await Offline.flush(async () => { throw { code: '23505', message: 'duplicate key' }; });
  assert.equal(res.sent, 0);
  assert.equal(res.conflicts, 1);
  assert.equal(store.rows.size, 1, 'nothing is silently dropped');
  assert.ok(toasts.some(t => /مراجعتك/.test(t[0])), 'doctor is notified, not auto-resolved');
  assert.equal(Offline.conflicts.length, 1);
  assert.match(Offline.conflicts[0].reason, /تكرار/);
  // الدكتور هو اللي يقرر
  await Offline.resolveConflict(id, 'discard');
  assert.equal(store.rows.size, 0);
  assert.equal(Offline.conflicts.length, 0);
});

test('a network failure stops the flush and keeps everything for the next attempt', async () => {
  const { Offline, store } = harness();
  await Offline.enqueue({ kind: 'insert', table: 'patients', row: { n: 1 } });
  await Offline.enqueue({ kind: 'insert', table: 'patients', row: { n: 2 } });
  const res = await Offline.flush(async () => { throw { message: 'Failed to fetch' }; });
  assert.equal(res.stopped, true);
  assert.equal(res.sent, 0);
  assert.equal(res.conflicts, 0);
  assert.equal(store.rows.size, 2);
  const again = await Offline.flush(async () => ({ ok: true }));
  assert.equal(again.sent, 2);
  assert.equal(store.rows.size, 0);
});

test('an already-flagged conflict is never retried without the doctor decision', async () => {
  const { Offline, store } = harness();
  const id = await Offline.enqueue({ kind: 'rpc', name: 'x', args: {} });
  await Offline.markConflict(id, 'راجع الموعد');
  let calls = 0;
  const res = await Offline.flush(async () => { calls++; return { ok: true }; });
  assert.equal(calls, 0);
  assert.equal(res.conflicts, 1);
  assert.equal(store.rows.get(id).conflict, 'راجع الموعد');
  Offline.replay = async () => ({ ok: true });
  await Offline.resolveConflict(id, 'retry'); // مع مُرسِل ناجح → يُرفع ويتشال
  assert.equal(store.rows.size, 0);
});

test('codes, tokens and secrets can never enter the local notebook', async () => {
  const { Offline, store } = harness();
  for (const payload of [
    { kind: 'rpc', args: { p_token: 'abc' } },
    { kind: 'rpc', args: { p_code: 'SHB1-482913' } },
    { kind: 'insert', row: { token: 'abc' } },
    { kind: 'insert', row: { password: 'abc' } },
    { kind: 'insert', row: { code: 'SHB1-482913' } },
    { kind: 'insert', row: { access_code: 'SHB1-482913' } },
    { kind: 'insert', row: { accessCode: 'SHB1-482913' } },
    { kind: 'rpc', name: 'set_clinic_prefix', args: { p_clinic_id: 'x', p_code: 'SHB1' } },
    { kind: 'rpc', name: 'x', args: { anonKey: 'abc' } }
  ]) {
    await assert.rejects(Offline.enqueue(payload), e => e.code === 'offline_forbidden_field');
  }
  assert.equal(store.rows.size, 0);
});

test('without WebCrypto the app refuses to store any patient data at all', async () => {
  const { Offline, store } = harness();
  Offline.encryption = false;
  await assert.rejects(Offline.enqueue({ kind: 'insert', table: 'patients', row: { name: 'x' } }),
    e => e.code === 'offline_crypto_missing');
  assert.equal(store.rows.size, 0);
});

test('the default replay never invents a destination outside the configured client', async () => {
  const { Offline, ctx } = harness();
  await assert.rejects(Offline.defaultReplay({ kind: 'insert', table: 'patients', row: {} }),
    e => e.code === 'offline_no_client');
  ctx.DB.sb = {}; // عميل مضبوط (بدون أي وجهة خارجية)
  await assert.rejects(Offline.defaultReplay({ kind: 'nonsense' }),
    e => e.code === 'offline_unknown_op');
});

test('schema-cache errors now produce an actionable Arabic message instead of the generic one', () => {
  const a = utils.indexOf('// رسالة واحدة واضحة');
  const b = utils.indexOf('// ---- الصور الرمزية', a);
  assert.ok(a > -1 && b > a);
  const src = utils.slice(a, b);
  const run = expr => {
    const ctx = vm.createContext({ logError() {}, __out: '' });
    vm.runInContext(src + '\n__out = ' + expr + ';', ctx);
    return ctx.__out;
  };
  assert.match(run('explainError({code:"PGRST205"})'), /غير محدّثة/);
  assert.match(run('explainError({code:"42703"})'), /20261111/);
  assert.match(run('explainError({message:"Could not find the table public.clinics in the schema cache"})'), /الترحيل/);
  assert.match(run('explainError({message:"Failed to fetch"})'), /الاتصال/);
  assert.match(run('explainError({code:"totally-unknown"})'), /حدث خطأ غير متوقع/);
});

test('README records the offline decisions, all four batches and the remaining limits', () => {
  assert.match(readme, /الأوفلاين \(الدفعات ١–٤ من ٤\)/);
  assert.match(readme, /جهاز صاحبه فقط/);
  assert.match(readme, /جهاز العيادة وموبايل المريض معاً/);
  assert.match(readme, /تنبيه للدكتور/);
  assert.match(readme, /AES-GCM/);
  assert.match(readme, /لا يتدخل ولا يخزّن أي طلب لـ `supabase\.co`/);
  assert.match(readme, /مفيش توكن ولا كود دخول جوه الدفتر/);
  assert.match(readme, /الصور بقت جوه الدفتر/);
  assert.match(readme, /measurementLooksUploaded/);
  assert.match(readme, /بلا أي اسم مريض ولا قيم سريرية/);
  assert.match(readme, /20261114_offline_conflict_tickets/);
  assert.match(readme, /كل الاختبارات `node:test`/);
  assert.match(readme, /OTP\/SMS لسه مؤجّل/);
});
