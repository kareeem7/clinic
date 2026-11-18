'use strict';

/* اختبار DOM حقيقي للترجمة. المشروع بيشتغل بلا أي اعتماديات (npm test
   محتاج Node بس)، فـ jsdom اختياري: لو موجود بنجرّب فعلاً، ولو مش موجود
   الاختبار بيتخطى برسالة واضحة بدل ما يفشل. اللي عايز يشغّله:
       npm i --no-save jsdom && npm test
   من غير jsdom الاختبارات الباقية في i18n.test.cjs بتحمي المفاتيح والقاموس. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* اعتمادية اختيارية */ }

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function bootDom() {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'https://clinic.test/' });
  const { window } = dom;
  // ملفين الترجمة بس. بنمرّر I18N على window لأن const في eval ما بتطلعش
  // للـ global scope.
  window.eval(read('js/i18n.js') + '\n' + read('js/lang-en.js') + '\nwindow.__I18N = I18N;');
  const I18N = window.__I18N;
  I18N.applyDom(window.document);
  return { window, I18N, document: window.document };
}

const text = (d, sel) => {
  const el = d.querySelector(sel);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '(مفقود: ' + sel + ')';
};

test('the login screen translates in a real DOM and flips to LTR', { skip: !JSDOM && 'jsdom غير منزّل' }, () => {
  const { I18N, document: d } = bootDom();

  assert.equal(text(d, '#loginView h1'), 'عيادتي', 'البداية عربي');
  assert.equal(d.documentElement.dir, 'rtl');

  I18N.setLang('en');

  assert.equal(text(d, '#loginView h1'), 'My Clinic');
  assert.equal(text(d, '#tabLogin'), 'Sign in');
  assert.equal(text(d, '#loginForm h2'), 'Welcome back, doctor');
  assert.equal(text(d, 'label[for="loginEmail"]'), 'Email');
  assert.equal(text(d, '#demoBtn span'), 'Open the demo — a clinic already filled in');
  assert.equal(d.documentElement.dir, 'ltr', 'الاتجاه اقلب');
  assert.equal(d.documentElement.lang, 'en');
});

test('switching back restores the Arabic exactly, element by element', { skip: !JSDOM && 'jsdom غير منزّل' }, () => {
  const { I18N, document: d } = bootDom();
  const before = ['#loginView h1', '#tabLogin', '#loginForm h2', '#demoBtn span'].map(s => text(d, s));

  I18N.setLang('en');
  I18N.setLang('ar');

  const after = ['#loginView h1', '#tabLogin', '#loginForm h2', '#demoBtn span'].map(s => text(d, s));
  assert.deepEqual(after, before, 'الرجوع للعربي لازم يرجّع نفس النص');
  assert.equal(d.documentElement.dir, 'rtl');
});

test('the language toggle on the page actually changes the language', { skip: !JSDOM && 'jsdom غير منزّل' }, () => {
  const { I18N, document: d, window } = bootDom();
  const btn = d.querySelector('#langToggle');
  assert.ok(btn, 'زر التبديل موجود في شاشة الدخول');

  // الضغطة بتمر على المستمع العام في i18n.js — بنحاكيها زي المتصفح
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(I18N.lang, 'en', 'الضغطة بدّلت اللغة');
  assert.equal(text(d, '#loginView h1'), 'My Clinic');
  assert.equal(btn.textContent.trim(), 'العربية', 'والزر عرض اللغة التانية');

  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(I18N.lang, 'ar', 'ضغطة تانية رجّعت العربي');
});

test('icons inside translated elements survive the switch', { skip: !JSDOM && 'jsdom غير منزّل' }, () => {
  const { I18N, document: d } = bootDom();
  const li = d.querySelector('.brand-feats li');
  assert.ok(li && li.querySelector('i'), 'العنصر فيه أيقونة قبل التبديل');
  I18N.setLang('en');
  assert.ok(li.querySelector('i'), 'الأيقونة لسه مكانها بعد الترجمة');
  assert.match(li.textContent, /patient files/i);
});

test('an Arabic page with no data-i18n is left untouched', { skip: !JSDOM && 'jsdom غير منزّل' }, () => {
  const { I18N, document: d } = bootDom();
  const plain = d.createElement('p');
  plain.textContent = 'نص مش متظبط للترجمة';
  d.body.appendChild(plain);
  I18N.setLang('en');
  assert.equal(plain.textContent, 'نص مش متظبط للترجمة');
  d.body.removeChild(plain);
});
