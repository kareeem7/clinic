'use strict';

// الإصلاح المركزي: مصدر واحد للـ SQL، مصدر واحد لبيانات الصفحة والمشاركة،
// عدم تسريب أسرار/مخطط للمتصفح، وحماية على مستوى الاستضافة.
// اختبارات ثابتة فقط — لا متصفح ولا Supabase ولا بيانات مرضى.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));
const clientFiles = [
  'index.html', 'reset.html', 'sw.js', 'js/config.js', 'js/main.js', 'js/app.js',
  'js/db.js', 'js/utils.js', 'js/message-style.js', 'js/patient-portal.js',
  'js/patient.js', 'js/admin.js', 'js/state.js', 'js/offline.js',
  'js/offline-capture.js', 'js/offline-snapshot.js'
];

test('SQL التأسيس في مصدر واحد خارج حزمة المتصفح', () => {
  const sql = read('sql/baseline.sql');
  assert.ok(sql.length > 100000, 'baseline.sql holds the full fresh-install schema');
  assert.match(sql.trim(), /commit;$/);
  assert.match(sql, /create table if not exists public\.doctors/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /create or replace function public\.patient_portal_login\(/);
  // لا يُشحن أي مخطط أو تعريف جدول في أي ملف يصل للمتصفح
  for (const f of clientFiles) {
    const src = read(f);
    assert.doesNotMatch(src, /SUPABASE_SQL/, f + ' must not reference SUPABASE_SQL');
    assert.doesNotMatch(src, /create table if not exists public\./i, f + ' leaks DDL');
    assert.doesNotMatch(src, /create policy /i, f + ' leaks RLS definitions');
    assert.doesNotMatch(src, /setupSql|copy-sql|sql-box/, f + ' still has the SQL setup UI');
  }
  const ignore = read('.assetsignore');
  assert.ok(ignore.split('\n').includes('sql/'), 'sql/ must never be published');
  assert.doesNotMatch(read('sw.js'), /baseline\.sql|sql\//, 'SQL is not precached for offline use');
});

test('js/config.js يحتوي anon key فقط ولا أي سر سيرفر', () => {
  const cfg = read('js/config.js');
  assert.match(cfg, /const supabaseConfig = \{/);
  assert.match(cfg, /anonKey:/);
  assert.match(cfg, /const SUPABASE_READY =/);
  assert.match(cfg, /const TRIAL_DAYS = 14;/);
  assert.match(cfg, /const APP_BRAND =/);
  const tokens = cfg.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  assert.equal(tokens.length, 1, 'exactly one JWT (the public anon key)');
  const payload = JSON.parse(Buffer.from(tokens[0].split('.')[1], 'base64url').toString());
  assert.equal(payload.role, 'anon');
  assert.equal(payload.ref, 'xfppempsztxidjmlwrza');
  assert.match(cfg, /https:\/\/xfppempsztxidjmlwrza\.supabase\.co/);
  assert.doesNotMatch(cfg, /phmkvbszyaqagezpaduz/, 'the deleted clinicv2 project must never come back');
  for (const f of clientFiles) {
    const src = read(f);
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/, f);
    assert.doesNotMatch(src, /service_role[^;\n]*eyJ/i, f);
    assert.doesNotMatch(src, /CLOUDFLARE_API_TOKEN\s*=|api\.cloudflare\.com\/client\/v4/i, f);
  }
});

test('شاشة الإنتاج لا تعرض SQL ولا تطلب لصق مفاتيح', () => {
  const html = read('index.html');
  assert.match(html, /id="setupView"/);
  assert.doesNotMatch(html, /خطوة واحدة قبل التشغيل|SQL Editor|supabaseConfig أعلى|setupSql|data-action="copy-sql"/);
  assert.doesNotMatch(read('js/main.js'), /copy-sql|SUPABASE_SQL|الصقه في SQL Editor/);
  assert.match(html, /تعذّر الاتصال بالسيرفر/);
  // بوابة الإقلاع نفسها لازم تفضل مانعة
  assert.match(read('js/main.js'), /showScreen\('setup'\)/);
  assert.match(read('js/main.js'), /return; \/\/ شاشة مانعة/);
});

test('الأيقونة ملف حقيقي في كل الصفحات، بلا data: URI', () => {
  assert.ok(exists('favicon.svg'));
  const svg = read('favicon.svg');
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const f of ['index.html', 'reset.html']) {
    const html = read(f);
    assert.match(html, /<link rel="icon" href="\.\/favicon\.svg" type="image\/svg\+xml">/, f);
    assert.doesNotMatch(html, /rel="icon" href="data:|about:invalid|zCSafez/, f);
  }
});

test('وسوم المشاركة تتولّد من site.config.json وصورتها URL مطلق', () => {
  const cfg = JSON.parse(read('site.config.json'));
  assert.equal(cfg.locale, 'ar_EG');
  assert.equal(cfg.previewWidth, 1200);
  assert.equal(cfg.previewHeight, 630);
  assert.equal(cfg.allowIndexing, false);
  assert.ok(exists('preview.png'));
  const png = fs.readFileSync(path.join(root, 'preview.png'));
  assert.equal(png.subarray(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  for (const f of ['index.html', 'reset.html']) {
    const html = read(f);
    assert.match(html, /<!-- SITE-META:START -->[\s\S]*?<!-- SITE-META:END -->/, f);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, f);
    assert.match(html, /<meta property="og:description" content="[^"]+">/, f);
    const image = html.match(/<meta property="og:image" content="([^"]+)">/);
    assert.ok(image && /^https:\/\//.test(image[1]), f + ' og:image must be absolute https');
    assert.match(html, /<meta property="og:locale" content="ar_EG">/, f);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, f);
    assert.match(html, /<meta name="robots" content="noindex/, f);
  }
  assert.match(read('reset.html'), /<title>إعادة تعيين كلمة المرور — عيادتي<\/title>/);
});

test('مولّد البيانات الوصفية مركزي ومتكرر التشغيل بلا تغيير', () => {
  const before = ['index.html', 'reset.html', 'robots.txt'].map(read);
  execFileSync(process.execPath, [path.join(root, 'scripts/build-site-meta.mjs')], { encoding: 'utf8' });
  assert.deepEqual(['index.html', 'reset.html', 'robots.txt'].map(read), before,
    'run: npm run meta — then commit the regenerated files');
  assert.equal(exists('sitemap.xml'), false, 'no sitemap while indexing is off');
  assert.match(read('robots.txt'), /Disallow: \/reset\.html/);
  assert.match(read('package.json'), /"meta":\s*"node scripts\/build-site-meta\.mjs"/);
});

test('لا أسماء عيادات/أطباء/مواقع/أرقام ثابتة في واجهة الإنتاج', () => {
  const banned = [/أحمد سامي/, /مركز الشروق/, /عيادة الشروق/, /شبين الكوم/, /المنوفية/, /01005001234/, /د\. محمد علي/];
  for (const f of ['index.html', 'reset.html', 'js/app.js', 'js/message-style.js', 'js/patient-portal.js']) {
    for (const rx of banned) assert.doesNotMatch(read(f), rx, f + ' still hardcodes ' + rx);
  }
  // القيم المحايدة في مصدر واحد
  const cfg = read('js/config.js');
  assert.match(cfg, /product: 'عيادتي'/);
  assert.match(cfg, /clinic: 'عيادتي'/);
  assert.match(cfg, /doctor: 'الدكتور'/);
  assert.match(read('js/app.js'), /syncShellIdentity\(\)/);
  assert.match(read('js/app.js'), /State\.settings|active\.name/, 'identity comes from settings/clinics');
});

test('frame-ancestors على مستوى الاستضافة وليس داخل <meta>', () => {
  const headers = read('_headers');
  assert.match(headers, /X-Frame-Options: SAMEORIGIN/);
  assert.match(headers, /Content-Security-Policy: frame-ancestors 'self'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  for (const f of ['index.html', 'reset.html']) {
    const csp = read(f).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.doesNotMatch(csp, /frame-ancestors/, 'frame-ancestors in a meta tag is ignored by browsers');
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  }
});

test('الأصول الجديدة منشورة ومخزّنة أوفلاين، وملفات البناء مستبعدة', () => {
  const ignore = read('.assetsignore').split('\n');
  for (const p of ['sql/', 'supabase/', 'scripts/', 'tests/', '.git/', 'site.config.json']) {
    assert.ok(ignore.includes(p), p + ' must be excluded from published assets');
  }
  const sw = read('sw.js');
  assert.match(sw, /CACHE_NAME = 'clinic-shell-v10'/);
  for (const f of ['./favicon.svg', './preview.png']) {
    assert.ok(sw.includes("'" + f + "'"), f + ' is precached');
  }
  assert.ok(exists('favicon.svg') && exists('preview.png'));
  // _headers يجب أن يبقى داخل الأصول ليطبّقه Cloudflare
  assert.ok(!ignore.includes('_headers'), '_headers must be uploaded, not ignored');
});

test('الـ Route Guard و RLS لسه خط الحماية الحقيقي خلف الشاشات المخفية', () => {
  const app = read('js/app.js');
  assert.match(app, /const ADMIN_ROUTES = \[/);
  assert.match(app, /ADMIN_ROUTES\.includes\(route\) && !State\.isAdmin/);
  assert.match(app, /\$\('#appShell'\)\.hidden = name !== 'app'/);
  assert.match(read('js/db.js'), /async isSuperAdmin\(\)/);
  assert.match(read('js/db.js'), /from\('superadmins'\)/);
  assert.match(read('js/main.js'), /await DB\.isSuperAdmin\(\)/);
  assert.match(read('sql/baseline.sql'), /clinic_active\(auth\.uid\(\)\)/);
});

test('الهوية المحايدة مصدرها APP_BRAND وتُملأ بعد الدخول من settings/clinics', () => {
  const app = read('js/app.js');
  const msg = read('js/message-style.js');
  const portal = read('js/patient-portal.js');
  assert.match(app, /SHELL_BRAND = \(typeof APP_BRAND !== 'undefined' && APP_BRAND\)/);
  assert.match(app, /s\.clinicName \|\| SHELL_BRAND\.clinic/);
  assert.match(app, /s\.doctorName \|\| SHELL_BRAND\.doctor/);
  assert.match(msg, /MSG_BRAND = \(typeof APP_BRAND !== 'undefined' && APP_BRAND\)/);
  assert.match(portal, /PORTAL_BRAND = \(typeof APP_BRAND !== 'undefined' && APP_BRAND\)/);
  // هيكل تحميل مؤقت بدل اسم ثابت؛ syncShellIdentity يشيله بعد ما البيانات توصل
  const html = read('index.html');
  assert.match(html, /id="sideClinicName" class="skel"/);
  assert.match(html, /id="sideDoctor" class="skel"/);
  assert.match(app, /\$\('#sideClinicName'\)\.classList\.remove\('skel'\)/);
  assert.match(app, /\$\('#sideDoctor'\)\.classList\.remove\('skel'\)/);
  assert.match(read('css/layout.css'), /#sideClinicName\.skel,#sideDoctor\.skel/);
});

test('التوثيق اتصحّح: مفيش تعليمات SQL قديمة ولا إنكار لبناء main', () => {
  const readme = read('README.md');
  assert.match(readme, /الإصلاح المركزي/);
  assert.match(readme, /sql\/baseline\.sql/);
  assert.doesNotMatch(readme, /SQL التأسيس الكامل موجود في `SUPABASE_SQL`/);
  assert.doesNotMatch(readme, /ما أقدرش أأكد إصلاحه عن بُعد/);
  assert.doesNotMatch(readme, /بقت \*\*«قاعدة البيانات غير محدّثة — طبّق ملفات الترحيل/);
  assert.match(readme, /بناء الإنتاج على `main` نجح/);
  assert.doesNotMatch(read('js/utils.js'), /20261111 \/ 20261112 \/ 20261113/);
  const fn = read('supabase/functions/portal-photo-upload/README.md');
  assert.match(fn, /Deployment status \(verified 2026-11-05\)/);
  assert.match(fn, /\*\*Do not re-apply\.\*\*/);
  // لا نثبّت رقماً: الدليل يُحدَّث مع كل إضافة اختبارات، والاختبار يتحقق فقط
  // من وجود عبارة «N اختبار من N» متطابقة (مصدرها تشغيل npm test الفعلي).
  const guide = read('tests/MANUAL_TEST_GUIDE.md');
  const m = guide.match(/(\d+) اختبار من (\d+)/);
  assert.ok(m, 'MANUAL_TEST_GUIDE must report the test count');
  assert.equal(m[1], m[2], 'reported pass count must equal total');
  assert.ok(Number(m[1]) >= 274, 'no tests may be silently dropped');
});

test('الأصول العامة الجديدة تُرفع، وملفات البناء/الSQL مستبعدة', () => {
  const ignore = read('.assetsignore').split('\n');
  for (const f of ['favicon.svg', 'preview.png', 'robots.txt', '_headers', 'sitemap.xml', 'index.html', 'reset.html', 'sw.js']) {
    assert.ok(!ignore.includes(f), f + ' must be published');
  }
  const cfg = JSON.parse(read('site.config.json'));
  assert.equal(cfg.allowIndexing, false);
  assert.match(cfg.siteUrl, /^https:\/\/[a-z0-9.-]+\.workers\.dev$/,
    'a real siteUrl is required: canonical/og:url and same-origin og:image depend on it');
  for (const f of ['index.html', 'reset.html']) {
    const html = read(f);
    assert.match(html, /rel="canonical" href="https:\/\//);
    assert.match(html, /property="og:url" content="https:\/\//);
  }
  assert.match(read('index.html'), /frame-ancestors is delivered by the _headers file/);

  // 2026-11-06: «غير متصل بالخادم» كان سببه (أ) ربط بمشروع Supabase محذوف و
  // (ب) كاش Service Worker قديم بيقدّم js/config.js القديم بعد تحديثه على السيرفر.
  const headers = read('_headers');
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  // config.js يجب أن يكون آخر قاعدة: "! Cache-Control" يلغي قيم /js/* و /*
  const rules = headers.split('\n').filter(l => /^\//.test(l));
  assert.equal(rules[rules.length - 1], '/js/config.js');
  assert.match(headers, /\/js\/config\.js\n  ! Cache-Control\n  Cache-Control: no-store/);
  assert.ok(!ignore.includes('_headers'), '_headers must reach Cloudflare to be applied');
  assert.match(read('sw.js'), /CACHE_NAME = 'clinic-shell-v10'/);
  assert.match(read('js/config.js'), /xfppempsztxidjmlwrza/);
  assert.doesNotMatch(read('js/config.js'), /phmkvbszyaqagezpaduz/);
  assert.equal(JSON.parse(read('site.config.json')).siteUrl,
    'https://clinic-staging.kemo8298.workers.dev');
});
