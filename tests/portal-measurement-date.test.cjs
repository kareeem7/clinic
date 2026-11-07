'use strict';

// Regression: لا يجوز وجود تاريخ انتهاء ثابت في حقل تاريخ القياس.
// الحد الأقصى يُضبط ديناميكياً من todayISO() وقت فتح البوابة، والتحقق يرفض المستقبل.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const portal = read('js/patient-portal.js');
const utils = read('js/utils.js');

test('حقل تاريخ القياس موجود وبلا أي حد تاريخ ثابت', () => {
  const input = html.match(/<input[^>]*id="lgDate"[^>]*>/);
  assert.ok(input, 'حقل lgDate لازم يكون موجود في index.html');
  assert.doesNotMatch(input[0], /\bmax\s*=/i, 'ممنوع max ثابت على حقل تاريخ القياس');
  // لا يوجد أي تاريخ YYYY-MM-DD مكتوب كقيمة حد في الصفحة كلها
  assert.doesNotMatch(html, /max\s*=\s*["']\d{4}-\d{2}-\d{2}["']/i,
    'ممنوع أي تاريخ انتهاء ثابت في HTML');
});

test('القيمة والحد الأقصى يُضبطان ديناميكياً عند فتح البوابة', () => {
  assert.match(portal, /\$\('#lgDate'\)\.value\s*=\s*todayISO\(\)/,
    'لازم تتضبط القيمة الافتراضية على النهارده');
  assert.match(portal, /\$\('#lgDate'\)\.max\s*=\s*todayISO\(\)/,
    'لازم يتضبط max على النهارده ديناميكياً');
});

test('التحقق عند الحفظ بيرفض أي تاريخ أكبر من النهارده', () => {
  assert.match(portal, /date\s*>\s*todayISO\(\)/,
    'لازم يفضل التحقق من التاريخ في portalSubmitMeasurement');
});

test('todayISO() ديناميكي فعلًا: يتبع تاريخ الجهاز مش ثابت', () => {
  // نقتطع تعريفات pad/isoOf/todayISO من الملف الحقيقي ونشغّلها بـ Date مزيف
  const defs = [
    /const pad = n =>[^\n]+/,
    /const isoOf = d =>[^\n]+/,
    /const todayISO = \(\) =>[^\n]+/
  ].map(re => {
    const m = utils.match(re);
    assert.ok(m, 'تعريف مفقود في js/utils.js: ' + re);
    return m[0];
  }).join('\n');

  const run = iso => {
    class FrozenDate extends Date {
      constructor(...args) { super(...(args.length ? args : [iso + 'T12:00:00Z'])); }
      static now() { return new Date(iso + 'T12:00:00Z').getTime(); }
    }
    const ctx = vm.createContext({ Date: FrozenDate, String, Number, Math, Array, Object });
    vm.runInContext(defs + '\nglobalThis.__out = todayISO();', ctx);
    return ctx.__out;
  };

  assert.equal(run('2026-11-07'), '2026-11-07');
  assert.equal(run('2027-01-15'), '2027-01-15', 'بعد 2026-12-31 لازم يفضل شغال');
  assert.equal(run('2031-06-30'), '2031-06-30', 'أي سنة مستقبلية لازم تشتغل');
});

test('لا توجد تواريخ انتهاء ثابتة في ملفات الواجهة', () => {
  const sources = ['index.html', 'reset.html', 'js/patient-portal.js', 'js/utils.js'];
  for (const f of sources) {
    assert.doesNotMatch(read(f), /20\d{2}-\d{2}-\d{2}["']?\s*(?:\/>|>)/,
      'تاريخ ثابت مكتوب كقيمة حد في ' + f);
  }
});
