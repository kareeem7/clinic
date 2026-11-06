'use strict';

// node --test tests/mobile-ux.test.cjs
// الهاتف هو جهاز الاستخدام الأساسي. الاختبارات هنا تمنع عودة سبع مشاكل كانت
// بتخلي التجربة «مش سلسة»: zoom تلقائي في iOS، أهداف لمس < 44px، تجاهل
// safe-area، hover لازق على اللمس، زر أيقونة بلا اسم، وحالة تنقل غير واضحة.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mobile = read('css/mobile.css');
const mainCss = read('css/main.css');
const responsive = read('css/responsive.css');
const html = read('index.html');
const sw = read('sw.js');
const variables = read('css/variables.css');

// استخراج جسم media query مع عدّ الأقواس (القواعد متداخلة جوّه)
function mediaBlock(css, query) {
  const at = css.indexOf(query);
  assert.notEqual(at, -1, `الـ media query مش موجود: ${query}`);
  const start = css.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  throw new Error(`media query غير مقفول: ${query}`);
}

const tablet = mediaBlock(mobile, '@media (max-width:992px)');
const phone = mediaBlock(mobile, '@media (max-width:768px)');
const tiny = mediaBlock(mobile, '@media (max-width:420px)');
const touch = mediaBlock(mobile, '@media (hover:none) and (pointer:coarse)');
const reduced = mediaBlock(mobile, '@media (prefers-reduced-motion:reduce)');

function hexToLum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function varHex(name) {
  const m = variables.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `المتغيّر --${name} مش موجود`);
  return m[1];
}
function contrast(a, b) {
  const [hi, lo] = [hexToLum(a), hexToLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('mobile.css مستورد آخراً ومُخزّن في الـ service worker بكاش جديدة', () => {
  const imports = [...mainCss.matchAll(/@import\s+url\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(imports.indexOf('mobile.css') > imports.indexOf('responsive.css'),
    'لازم يتحمّل بعد responsive.css عشان يغلّبها');
  assert.equal(new Set(imports).size, imports.length, 'مفيش استيراد مكرر');
  assert.match(sw, /'\.\/css\/mobile\.css',/);
  assert.match(sw, /CACHE_NAME = 'clinic-shell-v12'/);
});

test('منع التكبير التلقائي في iOS: كل حقول الإدخال ≥ 16px على الهاتف', () => {
  assert.match(phone, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\),/);
  assert.match(phone, /select,textarea,\.input,select\.input,textarea\.input,/);
  assert.match(phone, /\.in-wrap>input,\.in-wrap>select\{font-size:16px\}/);
  // الحقول اللي ليها inline font-size لازم تكون فوق العتبة كمان
  for (const id of ['ptPhone', 'ptCode']) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
    const size = parseFloat(tag.match(/font-size:\s*([\d.]+)px/)[1]);
    assert.ok(size >= 16, `#${id} بيعمل zoom في Safari (${size}px)`);
  }
  // القاعدة مش المفروض تسرى على الكمبيوتر
  assert.doesNotMatch(mobile.replace(/@media \(max-width:768px\)\{[\s\S]*?\n\}/, ''), /input:not\(\[type="checkbox"\]\)/);
});

test('أهداف اللمس ≥ 44px لكل العناصر التفاعلية على الهاتف', () => {
  const heights = [
    ['#bottomNav button', tablet.match(/#bottomNav button\{[^}]*min-height:(\d+)px/)?.[1]],
    ['.icon-btn', tablet.match(/\.icon-btn,\.icon-btn\.sm\{[^}]*height:(\d+)px/)?.[1]],
    ['.btn.sm', tablet.match(/\.btn\.sm\{[^}]*min-height:(\d+)px/)?.[1]],
    ['.modal-foot .btn', tablet.match(/\.modal-foot \.btn\{min-height:(\d+)px/)?.[1]],
    ['.ptabs button', tablet.match(/\.ptabs button\{min-height:(\d+)px/)?.[1]],
    ['.forgot-link', tablet.match(/\.forgot-link\{min-height:(\d+)px/)?.[1]],
    ['زر مريض جديد', tablet.match(/#topActions \[data-action="add-patient"\]\{[^}]*height:(\d+)px/)?.[1]],
  ];
  for (const [name, raw] of heights) {
    assert.ok(raw, `${name}: مفيش ارتفاع صريح`);
    assert.ok(Number(raw) >= 44, `${name}: ${raw}px < 44px`);
  }
  assert.match(tiny, /#bottomNav button\{font-size:11px/, 'على 320px الأزرار تتقسم بالتساوي');
});

test('كل استخدامات env(safe-area-inset-*) ليها fallback وإلا الـ calc يبقى invalid', () => {
  const cssFiles = fs.readdirSync(path.join(root, 'css')).filter(f => f.endsWith('.css'));
  for (const f of cssFiles) {
    const body = read(`css/${f}`);
    for (const m of body.matchAll(/env\(([^)]*)\)/g)) {
      assert.match(m[1], /,\s*0px\s*$/, `css/${f}: env(${m[1]}) من غير fallback`);
    }
  }
  // مساحات الأمان الفعلية اللي كانت ناقصة
  for (const sel of ['#topbar', '.content', '#bottomNav', '#toastRoot', '#sidebar', '.modal']) {
    assert.ok(tablet.includes(sel), `${sel} مش متغطّى في ≤992px`);
  }
  assert.match(tablet, /#topbar\{[\s\S]*?safe-area-inset-top/);
  assert.match(tablet, /\.modal\{padding-bottom:env\(safe-area-inset-bottom, 0px\)/);
});

test('سلاسة اللمس: منع تأخير النقر، وميض اللمس، والسحب الأفقي، وتقليل الحركة', () => {
  assert.match(mobile, /-webkit-tap-highlight-color:transparent/);
  assert.match(mobile, /touch-action:manipulation/);
  assert.match(mobile, /:focus-visible\{[\s\S]*?outline:3px/);
  assert.match(mobile, /@supports \(overflow-x:clip\)\{html,body\{overflow-x:clip\}\}/,
    'clip أحسن من hidden عشان ما يكسرش position:sticky');
  assert.match(touch, /transform:scale\(\.97\)/);
  assert.match(touch, /\.btn-primary:hover,\.quick-grid button:hover\{transform:none\}/);
  assert.match(reduced, /animation-duration:\.01ms!important/);
});

test('زر «مريض جديد» له اسم واضح لما يبقى أيقونة بس، والحقول كيبوردها مناسب', () => {
  assert.match(html, /data-action="add-patient" aria-label="إضافة مريض جديد"/);
  assert.match(html, /<nav id="bottomNav" aria-label="التنقل الرئيسي">/);
  // hide-sm لسه بيخفي النص على الموبايل — فالـ aria-label هو اسم الزر الوحيد
  assert.match(responsive, /\.hide-sm\{display:none\}/);
  for (const [id, attr] of [
    ['loginEmail', 'autocomplete="username"'], ['loginPass', 'autocomplete="current-password"'],
    ['regPass', 'autocomplete="new-password"'], ['mfaCode', 'inputmode="numeric"'],
    ['mfaCode', 'autocomplete="one-time-code"'], ['patientSearch', 'type="search"'],
    ['admSearch', 'inputmode="search"'], ['resetEmail', 'autocomplete="username"'],
  ]) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, new RegExp(attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `#${id}: ${attr}`);
  }
});

test('الحالة النشطة في شريط التنقل السفلي واضحة بصرياً وبتباين AA', () => {
  assert.match(tablet, /#bottomNav button\.active\{background:var\(--teal-50\);color:var\(--teal-700\)\}/);
  assert.match(tablet, /#bottomNav button\.active::before\{/);
  assert.match(tablet, /#bottomNav button\{[^}]*position:relative/, 'الشارة محتاجة position:relative');
  const ratio = contrast(varHex('teal-700'), varHex('teal-50'));
  assert.ok(ratio >= 4.5, `تباين الحالة النشطة ${ratio.toFixed(2)}:1 < 4.5`);
  assert.ok(ratio >= 4.5 && ratio < 21, 'تباين منطقي مش identical');
});

test('شاشة الدخول: الفورم يبان فوق الطية على هاتف صغير', () => {
  assert.match(phone, /\.login-view\{padding:12px\}/);
  assert.match(phone, /\.login-brand\{padding:16px 20px\}/);
  assert.match(phone, /\.login-brand h1\{font-size:22px/);
  assert.match(phone, /\.brand-sub,\.brand-loc\{display:none\}/);
  assert.match(phone, /\.login-form\{padding:20px 20px 24px/);
});

test('bottom sheet: مقبض بصري + عدم تسريب السكرول، بس على ≤768px فقط', () => {
  assert.match(phone, /\.modal-head::before\{/);
  assert.match(phone, /\.modal-head\{position:relative;padding-top:26px\}/);
  assert.doesNotMatch(tablet, /\.modal-head::before/, 'على التابلت المودال لسه في النص');
  assert.match(tablet, /\.modal\{padding-bottom:env\(safe-area-inset-bottom, 0px\);overscroll-behavior:contain\}/);
  assert.match(tablet, /\.modal-body,\.modal-foot\{overscroll-behavior:contain\}/);
  assert.match(responsive, /\.modal-overlay\{align-items:flex-end;padding:0\}/);
});

test('لا regression: القائمة الجانبية لسه بتفتح وتتقفل، والـ sticky محمي', () => {
  assert.match(responsive, /#sidebar\.open\{transform:none\}/);
  assert.match(responsive, /#sidebar\{transform:translateX\(100%\);box-shadow:var\(--shadow-lg\)\}/);
  // mobile.css ما يغيّرش الـ transform إطلاقاً
  assert.doesNotMatch(mobile, /#sidebar\{[^}]*transform/);
  assert.match(mobile, /@supports \(overflow-x:clip\)/);
});
