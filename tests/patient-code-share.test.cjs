'use strict';

// تقصير كود المريض + زر واتساب بدون ما الكود يظهر في أي URL.
// اختبارات مستندية + محاكاة DOM/RPC؛ لا PostgreSQL ولا واتساب حقيقي.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const patient = read('js/patient.js');
const main = read('js/main.js');
const html = read('index.html');
const migration = read('sql/migrations/20261112_patient_access_codes.sql');
const setup = read('sql/baseline.sql');
const seed = read('sql/demo_seed_synthetic.sql');
const readme = read('README.md');
const block = migration.slice(migration.indexOf('begin;') + 6, migration.lastIndexOf('commit;')).trim();

function harness({ code = 'SHB1-482913', clipboard = true, phone = '01000000001' } = {}) {
  const opened = [], copied = [], toasts = [], elements = new Map();
  const el = () => ({ innerHTML: '', textContent: '', value: '', dataset: {}, style: {} });
  const $ = sel => { if (!elements.has(sel)) elements.set(sel, el()); return elements.get(sel); };
  const ctx = vm.createContext({
    console, $, $$: () => [],
    DB: { sb: { rpc: async () => ({ data: { ok: true, code, alreadyIssued: false }, error: null }) } },
    esc: x => String(x), logError() {}, toast: (m, t) => toasts.push([m, t]),
    getPatient: () => ({ id: 'p1', name: 'تجريبي', phone, consentWa: true }),
    normPhoneEG: () => '201000000001',
    navigator: clipboard ? { clipboard: { writeText: async t => { copied.push(t); } } } : {},
    window: { open: (url, target, features) => opened.push({ url, target, features }) },
    State: { settings: {} }
  });
  vm.runInContext(patient, ctx, { filename: 'patient.js' });
  return {
    $, opened, copied, toasts,
    render: () => vm.runInContext('renderPatientAccess({id:"p1"})', ctx),
    wa: () => vm.runInContext('sendPatientCodeWA("p1")', ctx),
    copy: () => vm.runInContext('copyPatientCode()', ctx)
  };
}

test('client accepts the new short numeric code AND the old long card code', () => {
  const line = main.split('\n').find(l => l.includes('.test(code)') && l.includes('-\\d{6}'));
  assert.ok(line, 'patient portal code regex exists');
  const pattern = line.match(/(\/.*?\/)\.test\(code\)/)[1];
  const rx = vm.runInNewContext(pattern);
  assert.ok(rx.test('SHB1-482913'), 'short code accepted');
  assert.ok(rx.test('DEMO1-000001'), 'demo short code accepted');
  assert.ok(rx.test('SHB1-K7M2-9QX4-PL3T'), 'already-issued long code still accepted');
  assert.ok(!rx.test('SHB1-48291'), 'too short rejected');
  assert.ok(!rx.test('SHB1-4829134'), 'too long rejected');
  assert.ok(!rx.test('SHB1-ABCDE'), 'letters rejected');
  assert.match(html, /placeholder="SHB1-482913"/);
  assert.doesNotMatch(html, /placeholder="SHB1-XXXX-XXXX-XXXX"/);
});

test('SQL issues six digits, retries collisions, and still accepts long codes', () => {
  assert.ok(block.length > 1000);
  assert.ok(setup.includes(block), 'baseline.sql still embeds 20261112 verbatim');
  assert.match(migration, /PREFIX-######/);
  assert.match(migration, /for v_try in 1\.\.12 loop/);
  assert.match(migration, /exit when not exists \(select 1 from public\.patient_portal_credentials where code = v_code\)/);
  assert.match(migration, /hashtextextended\(gen_random_uuid\(\)::text \|\| clock_timestamp\(\)::text, 0\)/);
  assert.match(migration, /coalesce\(array_length\(v_parts, 1\), 0\) not in \(2, 4\)/);
  assert.doesNotMatch(migration, /substr\(v_secret, 9, 4\)/, 'old 12-char generation removed');
  assert.doesNotMatch(migration, /update public\.patient_portal_credentials\s+set code/, 'no rotation');
  // الكود القديم ما بيتغيرش: الدالة لسه idempotent
  assert.match(migration, /alreadyIssued/);
});

test('demo seed uses short numeric codes', () => {
  assert.match(seed, /DEMO1-/);
  assert.match(seed, /translate\(substr\(replace\(p\.id::text, '-', ''\), 27, 6\), 'ABCDEF', '012345'\)/);
  assert.doesNotMatch(seed, /substr\(replace\(p\.id::text, '-', ''\), 9, 4\)/);
  assert.match(readme, /DEMO1-000001/);
});

test('the WhatsApp button copies the code and opens an EMPTY chat — code never in a URL', async () => {
  const h = harness();
  await h.render();
  assert.match(h.$('#patAccessBody').innerHTML, /SHB1-482913/);
  assert.match(h.$('#patAccessBody').innerHTML, /data-action="pt-code-wa"/);
  assert.match(h.$('#patAccessBody').innerHTML, /data-action="pt-code-copy"/);

  await h.wa();
  assert.equal(h.opened.length, 1, 'one chat window');
  assert.equal(h.opened[0].url, 'https://wa.me/201000000001');
  assert.equal(h.opened[0].target, '_blank');
  assert.match(h.opened[0].features, /noopener,noreferrer/);
  assert.equal(h.opened[0].url.includes('?text='), false);
  assert.equal(h.opened[0].url.includes('482913'), false, 'the code is NOT in the URL');
  assert.equal(h.opened[0].url.includes('SHB1'), false);
  assert.equal(h.copied.join(','), 'SHB1-482913', 'code copied locally instead');
  assert.ok(h.toasts.some(t => /الصقه/.test(t[0])));
});

test('the standalone copy button works and never opens a link', async () => {
  const h = harness();
  await h.render();
  await h.copy();
  assert.equal(h.copied.join(','), 'SHB1-482913');
  assert.equal(h.opened.length, 0);
});

test('a blocked clipboard degrades gracefully without ever putting the code in a URL', async () => {
  const h = harness({ clipboard: false });
  await h.render();
  await h.wa();
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].url, 'https://wa.me/201000000001');
  assert.equal(h.copied.length, 0);
  assert.ok(h.toasts.some(t => /يدوياً/.test(t[0])));
});

test('no code-shaped data is embedded in markup or encoded into a link anywhere', () => {
  const waFn = patient.slice(patient.indexOf('async function sendPatientCodeWA'), patient.indexOf('async function copyPatientCode'));
  assert.doesNotMatch(waFn, /\?text=/);
  assert.doesNotMatch(waFn, /encodeURIComponent/);
  // ما يمرّش أبداً على دوال الواتساب العامة اللي بتحط النص جوه ?text=
  assert.doesNotMatch(waFn, /openWA\(|waLink\(|buildStyledMessage\(/);
  assert.doesNotMatch(patient, /openWA\([^)]*patientAccessCode|waLink\([^)]*code/);
  assert.doesNotMatch(html, /[?&]code=|#code=/);
  assert.doesNotMatch(patient, /encodeURIComponent/);
  assert.doesNotMatch(patient, /data-code=/);
  assert.doesNotMatch(html, /id="patAccessBody"[^>]*data-code/);
  assert.match(patient, /let patientAccessCode = '';/);
});

test('buttons are wired into the central dispatcher, with no rotate/change action', () => {
  assert.match(main, /'pt-code-wa':\s*ds => sendPatientCodeWA\(ds\.id\)/);
  assert.match(main, /'pt-code-copy':\s*\(\) => copyPatientCode\(\)/);
  for (const src of [patient, main, html]) {
    assert.doesNotMatch(src, /pt-code-(?:rotate|change|regenerate)|rotate_patient_code|change_patient_code/);
  }
});

test('README states the no-URL rule, the weaker 6-digit trade-off, and the re-run step', () => {
  assert.match(readme, /SHB1-482913/);
  assert.match(readme, /مش في لينك/);
  assert.match(readme, /مش بيستخدم `\?text=`/);
  assert.match(readme, /مليون احتمال/);
  assert.match(readme, /أعد تشغيل الملف/);
  assert.match(readme, /staging|تجريبي/);
});

test('OTP/SMS is still deferred and no service key leaked into the new path', () => {
  assert.doesNotMatch(patient, /signInWithOtp|verifyOtp|service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(main, /signInWithOtp|verifyOtp/);
  assert.match(readme, /OTP\/SMS مؤجّل/);
});
