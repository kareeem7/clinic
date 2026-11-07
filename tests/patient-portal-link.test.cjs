'use strict';

// node --test tests/patient-portal-link.test.cjs
// لينك مشاركة بوابة المريض: ?portal=1 يفتح تبويب «دخول بوابة المرضى» مباشرة،
// واللينك يُشتقّ من نطاق الصفحة نفسها بلا كود/توكن/بيانات مريض.
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
const sw = read('sw.js');

function patientCtx(href) {
  const copied = [], toasts = [], opened = [];
  const el = () => ({ innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, classList: { toggle() {} } });
  const ctx = vm.createContext({
    console, $: el, $$: () => [],
    DB: { sb: { rpc: async () => ({ data: { ok: true, code: 'SHB1-482913' }, error: null }) } },
    esc: x => String(x), logError() {}, toast: (m, t) => toasts.push([m, t]),
    getPatient: () => ({ id: 'p1', phone: '01000000001' }), normPhoneEG: () => '201000000001',
    navigator: { clipboard: { writeText: async t => { copied.push(t); } } },
    window: { open: (...a) => opened.push(a) },
    ...(href === null ? {} : { location: { href, search: new URL(href).search, hash: new URL(href).hash } }),
    URL: href === null ? undefined : URL, URLSearchParams: href === null ? undefined : URLSearchParams,
    State: { settings: {} }
  });
  vm.runInContext(patient, ctx, { filename: 'patient.js' });
  return {
    ctx, copied, toasts, opened,
    link: () => vm.runInContext('portalShareLink()', ctx),
    message: (c, l) => vm.runInContext(`patientCodeMessage(${JSON.stringify(c)},${JSON.stringify(l)})`, ctx),
    copyLink: () => vm.runInContext('copyPortalLink()', ctx),
    render: () => vm.runInContext('renderPatientAccess({id:"p1"})', ctx),
    wa: () => vm.runInContext('sendPatientCodeWA("p1")', ctx)
  };
}

// نشغّل بلوك الـ deep-link فقط من init() بـ DOM وهمي
function deepLinkTabs(search, hash) {
  const calls = [];
  const i = main.indexOf('// لينك المشاركة (?portal=1');
  assert.notEqual(i, -1, 'بلوك الـ deep-link مش موجود');
  const j = main.indexOf("$('#adminLink').onclick", i);
  const block = main.slice(i, j);
  vm.runInNewContext(block, {
    location: { search, hash }, URLSearchParams,
    switchAuthTab: t => calls.push(t)
  });
  return calls;
}

test('?portal=1 يفتح تبويب دخول بوابة المرضى مباشرة', () => {
  assert.deepEqual(deepLinkTabs('?portal=1', ''), ['patient']);
  assert.match(main, /new URLSearchParams\(location\.search \|\| ''\)\.get\('portal'\) === '1'/);
});

test('#portal كمان بيشتغل كبديل للمشاركة اليدوية', () => {
  assert.deepEqual(deepLinkTabs('', '#portal'), ['patient']);
});

test('الصفحة العادية / ?portal=0 / #reset ما تفتحش بوابة المريض', () => {
  assert.deepEqual(deepLinkTabs('', ''), []);
  assert.deepEqual(deepLinkTabs('?portal=0', ''), []);
  assert.deepEqual(deepLinkTabs('?foo=bar', '#x'), []);
  // reset.html لسه شغال زي ما هو
  assert.match(main, /location\.hash === '#reset'\) switchAuthTab\('reset'\)/);
});

test('اللينك يُشتقّ من نطاق الصفحة نفسه (staging / إنتاج / محلي)', () => {
  assert.equal(patientCtx('https://clinic-staging.kemo8298.workers.dev/').link(),
    'https://clinic-staging.kemo8298.workers.dev/?portal=1');
  assert.equal(patientCtx('https://clinic.example.com/').link(),
    'https://clinic.example.com/?portal=1');
  assert.equal(patientCtx('http://localhost:8080/index.html').link(),
    'http://localhost:8080/index.html?portal=1');
  assert.doesNotMatch(patient, /clinic-staging\.kemo8298|workers\.dev/, 'ما نثبّتش نطاق في الكود');
});

test('أي query أو hash قديم بيتمسح قبل ما اللينك يتبعت', () => {
  const link = patientCtx('https://clinic.example.com/index.html?code=SECRET&token=abc#reset').link();
  assert.equal(link, 'https://clinic.example.com/index.html?portal=1');
  assert.equal(link.includes('SECRET'), false);
  assert.equal(link.includes('token'), false);
  assert.equal(link.includes('#reset'), false);
  assert.match(patient, /u\.search = ''; u\.hash = '';/);
});

test('لو location مش متاح (اختبارات/SSR) الدالة ترجّع فارغ بأمان بدل ما ترمي', () => {
  assert.equal(patientCtx(null).link(), '');
  const msg = patientCtx(null).message('SHB1-482913', '');
  assert.match(msg, /SHB1-482913/);
  assert.doesNotMatch(msg, /undefined|https:\/\//, 'ما نبعتش لينك مكسور');
});

test('اللينك عام بلا كود ولا توكن ولا بيانات مريض', () => {
  const link = patientCtx('https://clinic.example.com/').link();
  assert.doesNotMatch(link, /SHB1|482913|code=|token=|phone=|patient_id=/i);
  assert.match(html, /id="ptCode"/);
  assert.doesNotMatch(html, /[?&]code=|#code=/);
  assert.match(sw, /CACHE_NAME = 'clinic-shell-v13'/);
});

test('الرسالة الجاهزة فيها الكود واللينك مع بعض، بس الكود مش جوه أي لينك', async () => {
  const h = patientCtx('https://clinic.example.com/');
  await h.render(); // الكود بيتحمّل في patientAccessCode عبر RPC
  const msg = h.message('SHB1-482913', h.link());
  assert.match(msg, /كود دخولك الدائم: SHB1-482913/);
  assert.match(msg, /https:\/\/clinic\.example\.com\/\?portal=1/);
  assert.match(msg, /هتدخل على صفحتك مباشرة/);
  await h.wa();
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0][0], 'https://wa.me/201000000001');
  assert.equal(h.opened[0][0].includes('?text='), false);
  assert.equal(h.opened[0][0].includes('482913'), false);
  assert.equal(h.opened[0][0].includes('portal'), false);
  assert.match(h.copied.join(','), /SHB1-482913/);
  assert.match(h.copied.join(','), /portal=1/);
});

test('زر «نسخ اللينك» بينسخ اللينك لوحده بلا الكود', async () => {
  const h = patientCtx('https://clinic.example.com/');
  await h.copyLink();
  assert.equal(h.copied.length, 1);
  assert.equal(h.copied[0], 'https://clinic.example.com/?portal=1');
  assert.equal(h.copied[0].includes('482913'), false);
  assert.ok(h.toasts.some(t => /اتنسخ لينك/.test(t[0])));
  assert.match(main, /'pt-link-copy':\s*\(\) => copyPortalLink\(\)/);
});

test('ما اتغيرش أي SQL / Auth / منطق الدخول، و?text= لسه ممنوع', () => {
  // التعليقات بتذكر ?text= كشرح للسبب، فنفحص الكود التنفيذي بس
  const patientCode = patient.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(patientCode, /\?text=|encodeURIComponent|openWA\(|waLink\(/);
  assert.doesNotMatch(patient, /signInWithOtp|verifyOtp|service_role/);
  assert.match(patient, /issue_patient_code/);
  assert.match(main, /Portal\.login\(phone, code\)/);
  assert.match(main, /patient_portal_login|Portal\.login/);
  assert.doesNotMatch(main, /new URLSearchParams\([^)]*\)\.get\('code'\)/, 'اللينك ما بيقرأش كود');
});
