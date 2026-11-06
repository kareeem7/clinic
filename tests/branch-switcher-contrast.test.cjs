'use strict';

// node --test tests/branch-switcher-contrast.test.cjs
// حادثة 2026-11-06: عند إضافة فرع ثانٍ كان مُبدّل الفروع في الشريط الجانبي
// يظهر «أبيض على أبيض» لأن .input يفرض خلفية فاتحة و#sidebar يورّث نصاً فاتحاً.
// الاختبارات هنا تحسب تباين WCAG فعلياً وتمنع عودة التعمية.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const layout = read('css/layout.css');
const components = read('css/components.css');
const base = read('css/base.css');
const mainCss = read('css/main.css');
const html = read('index.html');
const app = read('js/app.js');

const switcher = layout.slice(layout.indexOf('.side-brand select#activeClinic{'));

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function luminance([r, g, b]) {
  const f = c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
// خلفية الشريط عند منطقة الشعار = --teal-900، وفوقها طبقة rgba بيضاء شفافة
function overWhite(baseHex, alpha) {
  return hexToRgb(baseHex).map(c => Math.round(c * (1 - alpha) + 255 * alpha));
}

test('القاعدة الجديدة تُحمّل بعد .input وتغلبه بالخصوصية', () => {
  assert.ok(mainCss.indexOf("@import url('components.css')") < mainCss.indexOf("@import url('layout.css')"),
    'layout.css must load after components.css');
  assert.match(components, /\.input[^{]*\{[^}]*background:#fbfdfd/, '.input really forces a light background');
  assert.match(layout, /#sidebar\{[^}]*color:#d8f3ef/, 'sidebar really inherits a light text colour');
  assert.match(switcher, /\.side-brand select#activeClinic\{/);
  assert.match(switcher, /color:#e8fbf8/, 'text colour must be set explicitly, never inherited');
  assert.match(switcher, /background-color:rgba\(255,255,255,\.10\)/);
});

test('لا يوجد inline style يغطّي ألوان/أحجام المُبدّل في HTML', () => {
  const tag = html.match(/<select id="activeClinic"[^>]*>/)[0];
  assert.doesNotMatch(tag, /style=/, 'inline styles would beat the stylesheet');
  assert.match(tag, /class="input hide"/);
  assert.match(tag, /aria-label="الفرع الحالي"/);
});

test('قائمة الخيارات تُرسم بنص داكن على خلفية فاتحة', () => {
  assert.match(switcher, /select#activeClinic option\{color:#12211f;background-color:#ffffff\}/);
  assert.match(switcher, /option:checked\{color:#0f766e;background-color:#eefaf8\}/);
});

test('السهم وحالات hover/focus بلون متباين على الشريط الداكن', () => {
  assert.match(switcher, /stroke='%23a7e8df'/, 'chevron must be light, not #64748b');
  assert.match(switcher, /select#activeClinic:hover\{background-color:rgba\(255,255,255,\.17\)/);
  assert.match(switcher, /select#activeClinic:focus\{[^}]*border-color:var\(--teal-500\)/);
  assert.match(switcher, /box-shadow:0 0 0 3px rgba\(20,184,166,\.30\)/);
});

test('الفرع الواحد لازم يفضل مخفياً رغم خصوصية قاعدة المُبدّل', () => {
  assert.match(base, /\.hide\{display:none!important\}/);
  assert.match(switcher, /select#activeClinic\.hide\{display:none\}/);
  const fn = app.slice(app.indexOf('function syncShellIdentity()'));
  assert.match(fn, /sel\.classList\.toggle\('hide', clinics\.length < 2\)/);
});

test('تباين WCAG للنص على خلفية الشريط ≥ 7:1 في كل الحالات (AAA)', () => {
  const teal900 = '#083634'; // --teal-900 من variables.css
  const text = hexToRgb('#e8fbf8');
  // نقرأ الشفافية من ملف الستايل نفسه حتى يفشل الاختبار لو حد غيّرها،
  // بدل رقم ثابت في الاختبار يمرّ بينما الواجهة اتغيرت.
  const alphaOf = rule => {
    const m = switcher.match(new RegExp(rule + '\\{[^}]*background-color:rgba\\(255,255,255,\\.(\\d+)\\)'));
    assert.ok(m, rule + ' must declare an explicit background alpha');
    return Number('0.' + m[1]);
  };
  const states = [
    ['عادي', alphaOf('\\.side-brand select#activeClinic')],
    ['hover', alphaOf('\\.side-brand select#activeClinic:hover')],
    ['focus', alphaOf('\\.side-brand select#activeClinic:focus')]
  ];
  for (const [name, alpha] of states) {
    const bg = overWhite(teal900, alpha);
    const ratio = contrast(text, bg);
    assert.ok(ratio >= 7, name + ' contrast = ' + ratio.toFixed(2) + ':1 (مطلوب ≥ 7)');
  }
  // قائمة الخيارات: نص داكن على أبيض
  assert.ok(contrast(hexToRgb('#12211f'), hexToRgb('#ffffff')) >= 7);
  assert.ok(contrast(hexToRgb('#0f766e'), hexToRgb('#eefaf8')) >= 4.5);
});

test('التباين القديم كان فعلاً أقل من 4.5 — الاختبار يثبت إننا بنصلح مشكلة حقيقية', () => {
  // النص الموروث #d8f3ef على خلفية .input الأصلية #fbfdfd
  const broken = contrast(hexToRgb('#d8f3ef'), hexToRgb('#fbfdfd'));
  assert.ok(broken < 4.5, 'old contrast = ' + broken.toFixed(2) + ':1');
});

test('قائمة الفروع في الإعدادات: اسم داكن + كود chip تركوازي بتباين كافٍ', () => {
  const settings = read('css/settings.css');
  assert.match(settings, /#clinicBranchesList\{color:var\(--ink\)\}/);
  assert.match(settings, /#clinicBranchesList \.sys-row > span\{color:var\(--ink\);font-weight:700\}/);
  assert.match(settings, /#clinicBranchesList \.sys-row > b\.ltr\{[\s\S]*?color:var\(--teal-700\)/);
  // الألوان من variables.css، لا قيم مكتوبة عشوائياً
  const vars = read('css/variables.css');
  const teal700 = vars.match(/--teal-700:(#[0-9a-f]{6})/)[1];
  const teal50 = vars.match(/--teal-50:(#[0-9a-f]{6})/)[1];
  const ink = vars.match(/--ink:(#[0-9a-f]{6})/)[1];
  assert.ok(contrast(hexToRgb(teal700), hexToRgb(teal50)) >= 4.5);
  assert.ok(contrast(hexToRgb(ink), hexToRgb('#ffffff')) >= 7);
});
