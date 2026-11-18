'use strict';

/* الترجمة بتفشل بهدوء: مفتاح غلط = نص عربي في وش مستخدم إنجليزي، ومحدش
   بياخد باله في اختبار عادي. الاختبارات دي بتخلي الفشل ده صوت. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const i18nSource = read('js/i18n.js');
const langSource = read('js/lang-en.js');
const html = read('index.html');
const landing = read('landing.html');

// القاموس زي ما بيتحمّل فعلاً — بنشغّل ملف اللغة مش بنقراه بـregex
function loadDict() {
  const ctx = vm.createContext({ I18N: undefined, console });
  vm.runInContext('var I18N = { init(d){ this.dict = d; } };', ctx);
  // الملف بينادي I18N.init({en}) في آخره، فبنمرّر كائن بسيط يمسك القاموس
  vm.runInContext(langSource.replace('I18N.init({ en: I18N_EN });', 'I18N.init({ en: I18N_EN });'), ctx);
  return ctx.I18N.dict.en;
}

const DICT = loadDict();

/* كل عنصر عليه data-i18n في index.html، والمفتاح هو نصه المباشر بس.
   لازم نمشي بالعمق: العنصر اللي جوّاه <b> أو <span> بياخد نصه هو بس،
   لأن applyDom بيكتب في الـtext nodes المباشرة ومش بيلمس الأبناء.
   وبنشيل التعليقات الأول — دي مكانتش نص في الـDOM من الأساس. */
function htmlKeys(source) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<\/?([a-zA-Z0-9]+)([^>]*?)(\/?)>/g;
  const keys = [];
  let m;
  while ((m = tag.exec(clean))) {
    const isOpen = m[0][1] !== '/';
    if (!isOpen || m[3] === '/' || !(/(^|\s)data-i18n(=|\s|$)/).test(m[2])) continue;
    // نجمع النص المباشر جوّه العنصر ده لحد ما نقفل على نفس العمق
    let depth = 1, direct = '', j = tag.lastIndex;
    while (j < clean.length && depth > 0) {
      tag.lastIndex = j;
      const t = tag.exec(clean);
      if (!t) { direct += clean.slice(j); break; }
      if (depth === 1) direct += clean.slice(j, t.index);
      if (t[0][1] === '/') depth -= 1;
      else if (t[3] !== '/') depth += 1;
      if (depth === 0) { j = t.index; break; }
      j = tag.lastIndex;
    }
    const text = direct.replace(/\s+/g, ' ').trim();
    if (text) keys.push(text);
  }
  return keys;
}

/* ─────────────────────────── القاموس ─────────────────────────── */

/* الصفحتين اللي بيقابلهم الزائر: التطبيق وصفحة العرض */
[['index.html', html], ['landing.html', landing]].forEach(([name, source]) => {
test('every translated element in ' + name + ' has an English entry', () => {
  const keys = htmlKeys(source);
  assert.ok(keys.length >= 40, 'المفروض عشرات العناصر متظبطة في ' + name + '، لقينا ' + keys.length);
  const missing = keys.filter(k => !Object.prototype.hasOwnProperty.call(DICT, k));
  assert.deepEqual(missing, [], 'مفاتيح من غير ترجمة في ' + name + ': ' + missing.slice(0, 5).join(' | '));
});
});

test('every t() call in the code has a translation — no silent Arabic in English mode', () => {
  const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
  const missing = [];
  files.forEach(f => {
    const src = read('js/' + f);
    const re = /\bt\('((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[1];
      if (!Object.prototype.hasOwnProperty.call(DICT, key)) missing.push(f + ': ' + key);
    }
  });
  assert.deepEqual(missing, [], 'نداءات t() بلا قاموس: ' + missing.slice(0, 5).join(' | '));
});

test('the dictionary has no empty values and no duplicated keys', () => {
  const empties = Object.entries(DICT).filter(([, v]) => !v || !String(v).trim());
  assert.deepEqual(empties, [], 'ترجمات فاضية');

  const seen = new Map();
  const re = /^\s*'((?:[^'\\]|\\.)*)':/gm;
  let m;
  while ((m = re.exec(langSource))) {
    const k = m[1];
    if (seen.has(k)) assert.fail('مفتاح مكرر في القاموس: ' + k);
    seen.set(k, true);
  }
});

test('the dictionary actually translates — it is not Arabic copied into English', () => {
  // لو حد نسخ النص العربي مكان الإنجليزي، الاختبار ده بيمسكه
  const arabicValues = Object.entries(DICT)
    .filter(([k, v]) => /[\u0600-\u06FF]/.test(v) && k !== v);
  assert.deepEqual(arabicValues.map(([k]) => k), [],
    'قيم لسه عربي: ' + arabicValues.slice(0, 3).map(([k]) => k).join(' | '));
});

/* ─────────────────────── سلوك الطبقة نفسها ─────────────────────── */

function makeContext(langSaved) {
  const toggles = [{ textContent: 'English' }, { textContent: 'EN' }];
  const doc = {
    documentElement: { lang: 'ar', dir: 'rtl' },
    querySelectorAll: sel => (sel === '[data-lang-toggle]' ? toggles : []),
    addEventListener: () => {}
  };
  const store = {
    _v: langSaved || null,
    getItem() { return this._v; },
    setItem(k, v) { this._v = v; }
  };
  const ctx = vm.createContext({ document: doc, localStorage: store, console, CustomEvent: function () {} });
  vm.runInContext(i18nSource, ctx);
  const I18N = vm.runInContext('I18N', ctx);
  I18N.init({ en: DICT });
  return { I18N, doc, toggles, store };
}

test('switching to English flips the document direction and language it ships with', () => {
  const { I18N, doc } = makeContext();
  assert.equal(I18N.lang, 'ar');
  assert.equal(doc.documentElement.dir, 'rtl');

  I18N.setLang('en');
  assert.equal(I18N.lang, 'en');
  assert.equal(doc.documentElement.dir, 'ltr', 'الإنجليزي لازم يقلب الاتجاه');
  assert.equal(doc.documentElement.lang, 'en');

  I18N.toggle();
  assert.equal(doc.documentElement.dir, 'rtl', 'الرجوع للعربي بيرجّع RTL');
});

test('the saved choice wins on the next load', () => {
  const { I18N, doc } = makeContext('en');
  assert.equal(I18N.lang, 'en', 'اللغة المحفوظة هي اللي بتفتح');
  assert.equal(doc.documentElement.dir, 'ltr');
});

test('an unknown saved value falls back to Arabic instead of breaking', () => {
  const { I18N } = makeContext('de');
  assert.equal(I18N.lang, 'ar');
});

test('t() returns the Arabic source when a key is unknown — never a blank or a key name', () => {
  const { I18N } = makeContext();
  assert.equal(I18N.t('نص مش موجود خلاص'), 'نص مش موجود خلاص');
  assert.equal(I18N.t(null), '');
  assert.equal(I18N.t('مريض جديد'), 'مريض جديد');
  I18N.setLang('en');
  assert.equal(I18N.t('مريض جديد'), 'New patient');
});

test('t() fills placeholders, and leaves unknown ones alone', () => {
  const { I18N } = makeContext();
  I18N.setLang('en');                       // القاموس بيتقرأ للغة الحالية بس
  I18N.dict.en['تحية {name}'] = 'Hello {name}';
  assert.equal(I18N.t('تحية {name}', { name: 'Sara' }), 'Hello Sara');
  assert.equal(I18N.t('تحية {name}', {}), 'Hello {name}');
});

test('the language toggle shows the other language, not the current one', () => {
  const { I18N, toggles } = makeContext();
  assert.equal(toggles[0].textContent, 'English', 'وإحنا في العربي الزر بيقول English');
  I18N.setLang('en');
  assert.equal(toggles[0].textContent, 'العربية', 'وفي الإنجليزي بيقول العربية');
});

test('changing the language re-renders through listeners and survives a throwing one', () => {
  const { I18N } = makeContext();
  let called = 0;
  I18N.onChange(() => { called++; });
  I18N.onChange(() => { throw new Error('مستمع باظ'); });
  I18N.onChange(() => { called++; });
  assert.doesNotThrow(() => I18N.setLang('en'), 'مستمع فاشل ما يوقفش الباقي');
  assert.equal(called, 2);
});

/* دالة toast() كان اسمها بيستخدم متغير محلي اسمه t، ولما بقى t هو دالة
   الترجمة العامة اتغيّر الاسم لـel — ونسينا سطر واحد. السطر ده مكانش بيرمي
   خطأ (الدوال في JS كائنات، فالكتابة على خصائصها مش غلط)؛ النتيجة إن
   التوست يطلع فاضي واللي بيشوفه المستخدم إن الحاجة «مش شغالة» من غير رسالة.
   الاختبار ده بيمنع الفئة دي من الغلط ترجع. */
test('toast() بيكتب على عنصره مش على دالة الترجمة', () => {
  const utils = read('js/utils.js');
  const body = utils.slice(utils.indexOf('function toast('));
  const fn = body.slice(0, body.indexOf('\n}') + 2);
  assert.doesNotMatch(fn, /\bt\.innerHTML/, 'toast() لسه بيكتب على t بدل العنصر');
  assert.match(fn, /el\.innerHTML/, 'toast() مفروض يبني المحتوى على العنصر');
});

/* ختم البناء واسم كاش الـservice worker لازم يمشوا مع بعض. لو الاتنين
   افترقوا، المستخدم بيبقى شايف «build v14» والكاش بيخدم حاجة تانية —
   وده بالظبط اللي بيخلي التشخيص عن بُعد مستحيل. */
test('ختم البناء في index.html مطابق لاسم كاش الـservice worker', () => {
  const m = read('sw.js').match(/CACHE_NAME\s*=\s*'(clinic-shell-v(\d+))'/);
  assert.ok(m, 'CACHE_NAME موجود في sw.js');
  const build = html.match(/data-build="(v\d+)"/);
  assert.ok(build, 'index.html فيه data-build');
  assert.equal(build[1], 'v' + m[2], 'الختم والكاش لازم يكونوا نفس الرقم');
});

/* عنصر عليه data-i18n ونصه كله جوّه أبناءه ملوش عقدة نص مباشرة. قبل الحماية
   دي، applyDom كان بيرمي TypeError → applyLang → boot تقف قبل ربط الأزرار،
   فالصفحة تبان عادية وكل زرار ميت (وده كان هيبان كأن «دخول الديمو» بايظ). */
test('applyDom بيتحمل عنصر مالوش عقدة نص مباشرة', () => {
  const src = read('js/i18n.js');
  assert.match(src, /if \(!first\) return;/, 'الحماية اتشالت من _setDirectText');
});
