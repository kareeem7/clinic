'use strict';

// التحقق من نسخة النشر أحاديّة الملف + إعداد Workers Builds.
// الدالة الحقيقية اتنشرت على Supabase عبر Management API، اللي بيقبل ملف
// مصدر واحد؛ أما نشر CLI فيستخدم index.ts + handler.mjs. الاختبار ده
// بيمنع أي انحراف بين الاتنين.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const base = 'supabase/functions/portal-photo-upload/';
const handler = read(base + 'handler.mjs');
const indexTs = read(base + 'index.ts');
const standalone = read(base + 'standalone.ts');

function rebuilt() {
  const h = handler.replace('export function createPhotoHandler(', 'function createPhotoHandler(');
  const i = indexTs.split('\n').filter(l => !l.startsWith('import ')).join('\n')
    .replace('// Supabase injects these variables into Edge Functions; never expose the key to clients.\n', '');
  const header =
    '// single-file deployment variant — generated from handler.mjs + index.ts\n' +
    '// because the Supabase Management API accepts one source file per function.\n' +
    '// Keep in sync: scripts/build-edge-standalone.mjs ; verified by tests/edge-standalone.test.cjs\n' +
    '// Runtime: Deno (Supabase Edge Functions). verify_jwt = false (portal token gate).\n';
  return header + h.trimEnd() + '\n\n' + i.replace(/^\n+/, '');
}

test('the single-file Edge Function is exactly the canonical handler + entrypoint', () => {
  assert.equal(standalone, rebuilt(),
    'run: node scripts/build-edge-standalone.mjs');
  assert.match(standalone, /Deno\.serve\(createPhotoHandler\(/);
  assert.match(standalone, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(standalone, /patient_portal_photo_authorize/);
  assert.equal(/\bimport\s|\bexport\s/.test(standalone), false,
    'Management API cannot resolve relative imports');
  assert.doesNotMatch(standalone, /eyJ[A-Za-z0-9_-]{10,}/, 'no embedded key');
  assert.doesNotMatch(standalone, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/, 'no hardcoded secret');
  assert.doesNotMatch(standalone, /console\.log/, 'never log tokens/images/ids');
  // الملف لازم يفضل يParsى كـ JavaScript في الـ Deno runtime
  execFileSync(process.execPath, ['--check', path.join(root, base + 'standalone.ts')]);
});

test('the generator script reproduces the deployed file byte for byte', () => {
  const script = read('scripts/build-edge-standalone.mjs');
  assert.match(script, /writeFileSync/);
  assert.match(script, /handler\.mjs/);
  assert.match(script, /index\.ts/);
  const out = execFileSync(process.execPath,
    [path.join(root, 'scripts/build-edge-standalone.mjs')], { encoding: 'utf8' });
  assert.match(out, /rebuilt/);
  assert.equal(read(base + 'standalone.ts'), rebuilt());
});

test('Supabase function flags match the portal-token authorization model', () => {
  const toml = read('supabase/config.toml');
  assert.match(toml, /\[functions\.portal-photo-upload\][\s\S]*verify_jwt\s*=\s*false/);
  assert.match(toml, /\[functions\.purge-patient-photos\][\s\S]*verify_jwt\s*=\s*true/);
  assert.match(standalone, /x-patient-token/);
  assert.match(standalone, /await authorize\(token\)/);
});

test('Cloudflare Workers Builds config serves only the static web shell', () => {
  const wrangler = read('wrangler.toml');
  assert.match(wrangler, /^name\s*=\s*"clinic-staging"$/m);
  assert.match(wrangler, /^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"$/m);
  assert.match(wrangler, /\[assets\]/);
  assert.match(wrangler, /directory\s*=\s*"\.\/"/);
  const ignore = read('.assetsignore');
  for (const p of ['sql/', 'supabase/', 'tests/', 'scripts/', '.git/', 'node_modules/']) {
    assert.ok(ignore.split('\n').includes(p), p + ' must not be publicly served');
  }
  assert.doesNotMatch(ignore, /^js\/$/m, 'the app JS must stay served');
  assert.doesNotMatch(ignore, /^css\/$/m, 'the app CSS must stay served');
  // ملفات الواجهة اللي فعلاً لازم تتبعت
  for (const f of ['index.html', 'reset.html', 'sw.js', 'js/config.js', 'css/main.css']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});
