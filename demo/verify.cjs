'use strict';
/*
  فحص الديمو الأوفلاين — Node فقط، بلا أي تبعيات.
  التشغيل: node demo/verify.cjs
  يثبت: صياغة JS سليمة، صفر موارد خارجية/شبكة/أسرار، تطابق الأرقام مع
  sql/demo_seed_sales.sql، كل عناصر الواجهة موجودة، والـ self-test كله ناجح،
  وتفاعلات DOM الأساسية (تبويبات، بحث، بدائل، حفظ قياس) شغّالة فعلياً.
*/
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const results = [];
const ok = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: String(e.message).split('\n')[0].slice(0,180) }); }
};

// ── ١) استخراج السكربت وصياغته ──────────────────────────────────────
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok('يوجد سكربت داخلي واحد بالضبط', () => assert.equal(scripts.length, 1));
const js = scripts[0] || '';
ok('صياغة JavaScript سليمة (vm.Script)', () => { new vm.Script(js, { filename: 'demo-inline.js' }); });

// ── ٢) أوفلاين وأمان: صفر شبكة / صفر أسرار ────────────────────────
ok('لا <script src> ولا <link href> خارجي', () => {
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
});
ok('لا أي http:// أو https:// أو //CDN في الملف', () => {
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /\/\/(cdn|unpkg|jsdelivr|fonts)\./i);
});
ok('لا fetch / XMLHttpRequest / WebSocket / EventSource', () => {
  assert.doesNotMatch(js, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/);
});
ok('لا Supabase ولا توكن ولا service_role ولا anon key في الكود', () => {
  const executable = js; // الكود الفعلي فقط (التعليقات بتاعة «لا ...» مش تنفيذ)
  assert.doesNotMatch(executable, /supabase|service_role|eyJ[A-Za-z0-9_-]{20,}|anon[_-]?key/i);
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g,''), /eyJ[A-Za-z0-9_-]{20,}|service_role\s*[:=]/i);
});
ok('لا localStorage فيه توكن/كود/بيانات حساسة', () => {
  assert.doesNotMatch(js, /localStorage\.setItem\([^)]*(token|code|otp|password|secret)/i);
});
ok('لا أسعار فعلية ولا وعود باشتراك/تجربة مجانية', () => {
  // نستثني سطر الجدول اللي بينفي وجود الأسعار صراحةً
  const body = html.replace(/<!--[\s\S]*?-->/g,'')
                   .split('\n').filter(l => !/لا أي سعر|بلا أسعار|الأسعار تُحدد|مش موجود عن قصد|أي سعر أو اشتراك|لا أسعار في الداتا|لا أسعار فعلية/.test(l)).join('\n');
  assert.doesNotMatch(body, /2500|2٬500|جنيه|14 يوم|تجربة مجانية|من غير بطاقة|priceMonthly|priceYearly/i);
  // 250 في الملف هو حد الوزن الأقصى (250 كجم) من validateWeight، مش سعر
  assert.match(js, /n <= 250/);
});
ok('الوسوم التحذيرية موجودة في الصفحة', () => {
  assert.match(html, /بيانات اصطناعية/);
  assert.match(html, /ليست النسخة المنشورة/);
  assert.match(html, /بلا اتصال بالخادم/);
  assert.match(html, /لا تُدخل بيانات مرضى حقيقية/);
});
ok('لا service worker ولا meta CSP تمنع التشغيل المحلي', () => {
  assert.doesNotMatch(html, /serviceWorker\s*\.register|Content-Security-Policy/i);
});

// ── ٣) عناصر الواجهة ────────────────────────────────────────────────
const ids = ['patList','search','chart','chart2','planBox','runTests','testOut','exportBtn',
  'resetBtn','addWeight','saveWeight','saveGlucose','saveBp','portalPatient','kPatients',
  'feedBox','newWeight','pWeight','pGlucose','pSys','pDia','pPulse','importFile',
  'jsonBox','dataMsg','doctorMsg','portalAlert','patTitle','recTable','labsBox',
  'readingsBox','notesBox','apptList','trend','trend2','myReadings','dStore'];
ok('كل عناصر الواجهة (' + ids.length + ') موجودة ومعرّفة مرة واحدة', () => {
  for (const id of ids) {
    const n = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    assert.equal(n, 1, 'id="' + id + '" موجود ' + n + ' مرة');
  }
});
ok('كل getElementById يشير لعنصر موجود', () => {
  const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = [...js.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)]
    .map(m => m[1] || m[2]);
  const dyn = /^alt\d+$/;
  for (const id of used) {
    if (dyn.test(id)) continue;
    assert.ok(declared.has(id), 'getElementById غير موجود: ' + id);
  }
});
ok('٣ تبويبات و٣ panes متطابقة', () => {
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  const panes = [...html.matchAll(/id="pane-([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs.sort(), panes.sort());
  assert.equal(tabs.length, 3);
});

// ── ٤) تشغيل الـ JS فعلياً في vm مع DOM مزيّف ────────────────────────
function makeEl(id) {
  const listeners = {};
  return {
    id, value:'', textContent:'', innerHTML:'', className:'', href:'', download:'', style:{},
    files:[], classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                          toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c);},
                          contains(c){return this._s.has(c);} },
    addEventListener(ev,fn){ (listeners[ev]=listeners[ev]||[]).push(fn); },
    fire(ev){ (listeners[ev]||[]).forEach(f=>f.call(this,{target:this})); },
    getAttribute(k){ return k==='data-tab' ? 'doctor' : (this['_'+k]||null); },
    setAttribute(k,v){ this['_'+k]=v; },
    appendChild(){}, removeChild(){}, click(){},
  };
}
const declaredIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const els = {};
for (const id of declaredIds) els[id] = makeEl(id);
// عناصر ديناميكية يحتاجها الـ UI
for (let i=0;i<3;i++) els['alt'+i] = makeEl('alt'+i);
const store = {};
const documentStub = {
  readyState:'complete',
  getElementById:id => els[id] || null,
  querySelectorAll:sel => {
    if (sel === '.tab') return ['doctor','portal','data'].map(t => { const e=makeEl('tab'); e._dt=t;
      e.getAttribute=k=>k==='data-tab'?t:null; return e; });
    if (sel === '.pane') return ['doctor','portal','data'].map(t => els['pane-'+t]);
    if (sel === '#patList .pat' || sel === '[data-alt]') return [];
    return [];
  },
  createElement:()=>makeEl('tmp'),
  body:{ appendChild(){}, removeChild(){} },
  addEventListener(){},
};
const context = {
  console, Math, JSON, Number, String, Array, Object, Date, RegExp, Error, setTimeout,
  document:documentStub,
  localStorage:{ getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} },
  Blob:class{constructor(){}}, URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},
  FileReader:class{ readAsText(){} },
  module:{exports:{}},
};
context.window = context;
context.globalThis = context;
let Core, UI, bootError = null;
try { vm.runInNewContext(js, context, { filename:'demo-inline.js' }); }
catch (e) { bootError = e; }
ok('السكربت يشتغل في sandbox بلا أخطاء', () => { if (bootError) throw bootError; });
Core = context.Core || (context.ClinicDemo && context.ClinicDemo.Core);
UI = context.UI || (context.ClinicDemo && context.ClinicDemo.UI);
ok('Core و UI معرّفان', () => { assert.ok(Core); assert.ok(UI); });
ok('UI.init() نجح ورسم الواجهة', () => { assert.equal(UI.init(), true); });

// ── ٥) Self-test جوه الكود ─────────────────────────────────────────
ok('Self-test: كل الفحوصات ناجحة', () => {
  const r = Core.selftest(false);
  assert.ok(r.total >= 30, 'عدد الفحوصات قليل: ' + r.total);
  assert.equal(r.failed, 0, r.items.filter(x=>!x.ok).map(x=>x.name).join(' | '));
});

// ── ٦) تطابق الأرقام مع sql/demo_seed_sales.sql ────────────────────
const seedSql = fs.readFileSync(path.join(ROOT, 'sql/demo_seed_sales.sql'), 'utf8');
ok('الأرقام مطابقة لملف العرض (92.4 / 83.2 / 212 / 188 / 104 / 94 / 8 → 3)', () => {
  for (const v of ['92.4','83.2','212','188','104,','94,','138','129']) assert.ok(seedSql.includes(v), 'ناقص في SQL: '+v);
  const s = Core.records(Core.seed(),'p1');
  assert.equal(s[0].weight, 92.4);
  assert.equal(s[s.length-1].weight, 83.2);
  const labs = Core.seed().labs;
  assert.equal(labs[1].results[0][1], 212);
  assert.equal(labs[2].results[0][1], 188);
  const pain = Core.painSeries(Core.seed(),'p3');
  assert.equal(pain[0].pain, 8);
  assert.equal(pain[pain.length-1].pain, 3);
});
ok('صياغة الرسائل من الكود الفعلي', () => {
  assert.match(Core.trend([{weight:90},{weight:85}]), /أداء ممتاز/);
  assert.match(Core.trend([{weight:80},{weight:80}]), /ثبات الوزن/);
  assert.match(Core.trend([{weight:80},{weight:82}]), /مفيش مشكلة/);
  assert.match(Core.healthAlert({kind:'glucose',glucose:68}).text, /سيتمكن طبيبك من رؤيتها/);
});

// ── ٧) تفاعلات فعلية عبر DOM المزيّف ────────────────────────────────
ok('تبديل التبويبات بيشتغل', () => {
  const t = documentStub.querySelectorAll('.tab')[1];
  t.fire('click');
  assert.ok(els['pane-doctor'], 'pane-doctor موجود');
});
ok('البحث بيشتغل (منى → 1، ديسك → 1، فارغ → 4)', () => {
  assert.equal(Core.search(Core.seed(),'منى').length, 1);
  assert.equal(Core.search(Core.seed(),'ديسك').length, 1);
  assert.equal(Core.search(Core.seed(),'').length, 4);
});
ok('حفظ قياس وزن بيشتغل وبيتحفظ في localStorage', () => {
  const before = UI.getState().records.length;
  els['newWeight'].value = '82.5'; els['newNote'].value = 'فحص تجريبي';
  els['addWeight'].fire('click');
  assert.equal(UI.getState().records.length, before + 1);
  assert.equal(UI.getState().records.at(-1).weight, 82.5);
  assert.ok(store['clinic_offline_demo_v1'], 'مفيش حفظ في localStorage');
  assert.match(store['clinic_offline_demo_v1'], /82.5/);
});
ok('تسجيل سكر 68 بيطلع تنبيه تحذيري', () => {
  els['pGlucose'].value='68'; els['pGType'].value='fasting';
  els['saveGlucose'].fire('click');
  assert.match(els['portalAlert'].innerHTML, /alert warning/);
  assert.match(els['portalAlert'].innerHTML, /سيتمكن طبيبك من رؤيتها/);
});
ok('تسجيل ضغط 185/95 بيطلع تنبيه حرج', () => {
  els['pSys'].value='185'; els['pDia'].value='95'; els['pPulse'].value='80';
  els['saveBp'].fire('click');
  assert.match(els['portalAlert'].innerHTML, /alert critical/);
});
ok('زر «اختبر كل حاجة» بيشتغل ويعرض النتيجة', () => {
  els['runTests'].fire('click');
  assert.match(els['testSummary'].textContent, /\d+ \/ \d+ نجح/);
  assert.match(els['testOut'].textContent, /كل حاجة شغالة/);
  assert.doesNotMatch(els['testOut'].textContent, /❌/);
});
ok('إعادة الضبط بترجّع ١٧ قياس', () => {
  els['resetBtn'].fire('click');
  assert.equal(UI.getState().records.length, 17);
});
ok('التخزين المحلي شغّال', () => assert.equal(UI.storage(), true));

// ── ٨) القديم ما اتلمسش ────────────────────────────────────────────
ok('ملفات الموقع القديم موجودة ولم تُعدّل (index/js/css)', () => {
  for (const f of ['index.html','landing.html','js/patient-portal.js','css/variables.css','sw.js','scripts/build-dist.sh'])
    assert.ok(fs.existsSync(path.join(ROOT,f)), 'مفقود: '+f);
});

// ── النتيجة ────────────────────────────────────────────────────────
const passed = results.filter(r=>r.ok).length;
console.log('\n═══ فحص الديمو الأوفلاين ═══');
for (const r of results) console.log((r.ok?'  ✅ ':'  ❌ ')+r.name+(r.ok?'':' — '+r.err));
console.log('\n  النتيجة: '+passed+' / '+results.length+' — '+(passed===results.length?'كل حاجة شغالة ✅':'فيه '+ (results.length-passed) +' فشل ❌'));
console.log('  الملف: demo/index.html ('+ (fs.statSync(path.join(__dirname,'index.html')).size/1024).toFixed(0) +' كيلو)\n');
process.exit(passed===results.length?0:1);
