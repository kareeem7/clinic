'use strict';

// node --test tests/test-runner-safety.test.cjs
// حادثة 2026-11-06 (٩): وحدة اختبارات على main فشلت عابراً رغم نجاحها على
// نفس الشجرة على الفرع. السبب البنيوي: اختباران بيشغّلان سكربتات **تكتب**
// index.html / reset.html / robots.txt / standalone.ts، و node --test بشكل
// افتراضي بيشغّل ملفات الاختبار في عمليات متوازية → قراءة ناقصة ممكنة.
// الحل: --test-concurrency=1 (تسلسل ملفات الاختبار بلا تغيير في أي اختبار).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('npm test يشغّل ملفات الاختبار بالتسلسل (بلا race على الكتابة)', () => {
  assert.match(pkg.scripts.test, /^node --test /);
  assert.match(pkg.scripts.test, /--test-concurrency=1/);
  assert.match(pkg.scripts.test, /tests\/\*\.test\.cjs$/);
  // لازم يفضل نفس glob ونفس عدّاد الملفات
  const files = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.cjs'));
  assert.ok(files.length >= 20, 'كل ملفات الاختبار لسه موجودة');
});

test('الاختبارات اللي بتكتب ملفات موجودة فعلاً — ده سبب التسلسل', () => {
  assert.match(read('tests/central-hardening.test.cjs'), /execFileSync\(process\.execPath, \[path\.join\(root, 'scripts\/build-site-meta\.mjs'\)\]/);
  assert.match(read('tests/edge-standalone.test.cjs'), /execFileSync\(process\.execPath,\s*\[path\.join\(root, 'scripts\/build-edge-standalone\.mjs'\)\]/);
  assert.match(read('scripts/build-site-meta.mjs'), /writeFileSync/);
  assert.match(read('scripts/build-edge-standalone.mjs'), /writeFileSync/);
  // نفس الملفات اللي بتقرأها اختبارات تانية
  assert.match(read('tests/offline-foundation.test.cjs'), /read\('index\.html'\)|read\('reset\.html'\)/);
});

test('preflight و CI بيستخدموا npm test نفسه، فالتسلسل يسري عليهم', () => {
  assert.match(read('scripts/preflight.sh'), /npm test/);
  assert.match(read('.github/workflows/test.yml'), /run: npm test/);
  assert.match(read('.github/workflows/test.yml'), /node --check/);
  // مفيش bump للكاش: التغيير في package.json/tests فقط، لا ملفات واجهة منشورة
  assert.match(read('sw.js'), /CACHE_NAME = 'clinic-shell-v12'/);
});
