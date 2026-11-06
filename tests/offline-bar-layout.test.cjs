'use strict';

// node --test tests/offline-bar-layout.test.cjs
// حادثة 2026-11-06 (٧): شريط «النت مقطوع» كان position:fixed;top:0;z-index:9999
// مع flex-wrap:wrap و label بـ min-width:200px ⇒ على الموبايل يتمدد ٣-٤ صفوف
// ويغطي الشريط العلوي كله، بما فيه زر «إضافة مريض جديد».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('css/offline-bar.css');
const mainCss = read('css/main.css');
const html = read('index.html');
const js = read('js/offline.js');
const sw = read('sw.js');
const layout = read('css/layout.css');

function blockOf(sel) {
  const at = css.indexOf(sel);
  assert.notEqual(at, -1, `القاعدة مش موجودة: ${sel}`);
  const start = css.indexOf('{', at);
  // التعليقات التشخيصية جوّه القواعد بتذكر القيم القديمة عن قصد
  return css.slice(start + 1, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
}

const barTag = html.match(/<div id="offlineBar"[^>]*>/)[0];
const labelTag = html.match(/<span id="offlineLabel"[^>]*>/)[0];
const panelTag = html.match(/<div id="offlinePanel"[^>]*>/)[0];

test('offline-bar.css مستورد آخراً، ومُخزّن في SHELL بكاش جديدة', () => {
  const imports = [...mainCss.matchAll(/@import\s+url\('([^']+)'\)/g)].map(m => m[1]);
  assert.equal(imports[imports.length - 1], 'offline-bar.css');
  assert.equal(new Set(imports).size, imports.length);
  assert.match(sw, /'\.\/css\/offline-bar\.css',/);
  assert.match(sw, /CACHE_NAME = 'clinic-shell-v12'/);
  // عقد offline-foundation: كل أوراق CSS لازم تكون في SHELL
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  for (const f of fs.readdirSync(path.join(root, 'css')).filter(f => f.endsWith('.css'))) {
    assert.ok(shell.includes(`'./css/${f}'`), `${f} مش في SHELL`);
  }
});

test('الشريط في تدفّق الصفحة (sticky) مش طبقة ثابتة فوق الأزرار', () => {
  const bar = blockOf('#offlineBar{');
  assert.match(bar, /position:sticky/);
  assert.match(bar, /top:0/);
  // الأب بيخلق stacking context: لازم يبقى فوق المودال (100) عشان البانل يظهر فوقه
  const z = Number((bar.match(/z-index:(\d+)/) || [])[1]);
  assert.ok(z >= 100, `z-index=${z} أقل من المودال فالبانل هيتغطى`);
  assert.match(read('css/overlays.css'), /\.modal-overlay\{[^}]*z-index:100/);
  assert.match(read('css/overlays.css'), /#toastRoot\{[^}]*z-index:200/);
  assert.doesNotMatch(bar, /position:fixed/);
  // لا أثر للـ inline style القديم لا في HTML ولا في أي ورقة
  assert.doesNotMatch(html, /z-index:9999/);
  assert.doesNotMatch(html, /position:fixed;top:0/);
  assert.doesNotMatch(barTag, /style=/);
});

test('سطر واحد فقط: nowrap + min-width:0 + ellipsis، ولا أثر لـ min-width:200px', () => {
  const bar = blockOf('#offlineBar{');
  assert.match(bar, /flex-wrap:nowrap/);
  const label = blockOf('#offlineLabel{');
  assert.match(label, /flex:1/);
  assert.match(label, /min-width:0/);
  assert.match(label, /white-space:nowrap/);
  assert.match(label, /text-overflow:ellipsis/);
  assert.doesNotMatch(labelTag, /style=/);
  // القيمة القديمة ما ترجعش في الشريط نفسه. (`.search` في patients.css ليها
  // min-width:200px خاصة بيها وهي برّه نطاق الشريط، فما نمنعهاش عموماً.)
  assert.doesNotMatch(blockOf('#offlineBar{') + blockOf('#offlineLabel{'), /min-width:200px/);
  assert.doesNotMatch(labelTag, /min-width/);
  assert.doesNotMatch(barTag, /min-width/);
});

test('الـ inline styles اتنقلت للـ CSS، والشريط معلن عنه لقارئ الشاشة', () => {
  assert.match(barTag, /\bhidden\b/);
  assert.match(barTag, /role="status"/);
  assert.match(barTag, /aria-live="polite"/);
  assert.doesNotMatch(panelTag, /hidden/, 'render() هو اللي بيتحكم في display');
  assert.match(panelTag, /style="display:none"/);
  assert.doesNotMatch(panelTag, /flex-basis|margin-top|border-top/);
});

test('ارتفاع ثابت معلوم + مساحة الأمان العلوية، وكل env() له fallback', () => {
  assert.match(css, /:root\{--offline-bar-h:calc\(46px \+ env\(safe-area-inset-top, 0px\)\)\}/);
  assert.match(blockOf('#offlineBar{'), /min-height:var\(--offline-bar-h\)/);
  assert.match(blockOf('#offlineBar{'), /padding-top:calc\(6px \+ env\(safe-area-inset-top, 0px\)\)/);
  for (const f of fs.readdirSync(path.join(root, 'css')).filter(f => f.endsWith('.css'))) {
    for (const m of read(`css/${f}`).matchAll(/env\(([^)]*)\)/g)) {
      assert.match(m[1], /,\s*0px\s*$/, `css/${f}: env(${m[1]}) بلا fallback`);
    }
  }
});

test('#topbar بيتزاح تحت الشريط عند السكرول (الإتنين sticky)', () => {
  assert.match(layout, /#topbar\{position:sticky;top:0/);
  assert.match(css, /body\.offline-bar-visible #topbar\{top:var\(--offline-bar-h\);padding-top:12px\}/,
    'safe-area ما يتحسبش مرتين (الشريط + الـ topbar)');
  assert.match(js, /document\.body\.classList\.toggle\('offline-bar-visible', show\)/);
  assert.match(css, /@media \(max-width:420px\)\{[\s\S]*?#offlineBar\{gap:6px/);
});

test('لوحة المراجعة طبقة مستقلة من الأسفل فالشريط يفضل رفيع', () => {
  const panel = blockOf('#offlinePanel{');
  assert.match(panel, /position:fixed/);
  assert.match(panel, /bottom:0/);
  assert.match(panel, /max-height:70dvh/);
  assert.match(panel, /overflow-y:auto/);
  assert.match(panel, /overscroll-behavior:contain/);
  assert.doesNotMatch(panel, /flex-basis:100%/);
  // لازم تفضل جوّه #offlineBar في الـ DOM عشان تفويض النقر ما ينكسرش
  const barHtml = html.slice(html.indexOf('<div id="offlineBar"'), html.indexOf('</div>', html.indexOf('id="offlinePanel"')));
  assert.match(barHtml, /id="offlinePanel"/);
  assert.match(js, /bar\.addEventListener\('click'/);
  assert.match(js, /e\.target && e\.target\.closest \? e\.target\.closest\('\[data-offline-action\]'\)/);
});

test('[hidden] يغلب الـ inline display، وكل عناصر العقد لسه موجودة', () => {
  assert.match(css, /#offlineBar\[hidden\],#offlinePanel\[hidden\]\{display:none!important\}/);
  assert.match(js, /bar\.hidden = !show/);
  assert.match(js, /bar\.style\.display = show \? 'flex' : 'none'/);
  assert.match(js, /panel\.style\.display =/);
  for (const id of ['offlineBar','offlineLabel','offlinePending','offlineFlushBtn',
                    'offlineReviewBtn','offlineConflictCount','offlinePanel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ['offlineFlushBtn','offlineReviewBtn','offlinePending']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*style="display:none"`), `#${id} لازم يفضل مخفي افتراضياً`);
  }
});

test('النص الكامل ما فقدناش منه حاجة: محفوظ في title و aria-label', () => {
  assert.match(js, /النت مقطوع — الكتابة هتتحفظ على هذا الجهاز فقط \(مشفّرة\) وهتترفع أول ما النت يرجع/);
  assert.match(js, /const full = Offline\.snapshotNote/);
  assert.match(js, /label\.textContent = full/);
  assert.match(js, /label\.title = full/);
  assert.match(js, /bar\.setAttribute\('aria-label', full\)/);
});

test('لا regression في ثوابت الأوفلاين وأمان البيانات', () => {
  assert.match(js, /assertSafe\(payload\)/);
  assert.match(js, /offline_forbidden_field/);
  assert.match(js, /name: 'AES-GCM', length: 256/);
  assert.match(js, /false, \['encrypt', 'decrypt'\]/, 'المفتاح غير قابل للتصدير');
  assert.match(sw, /req\.method !== 'GET'\) return/);
  assert.match(sw, /supabase\\\.co/);
  assert.match(sw, /Promise\.allSettled/);
  // ما اتغيرش أي منطق رفع/تعارض
  assert.match(js, /Offline\.flush\(\)\.catch/);
  assert.match(js, /Offline\.resolveConflict\(id/);
  assert.match(js, /data-offline-action/);
});
