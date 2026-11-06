'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const landing = read('landing.html');
const siteConfig = read('js/site-config.js');
const landingJs = read('js/landing.js');
const seedSales = read('sql/demo_seed_sales.sql');

test('صفحة العرض لا تحمّل أي كود من التطبيق ولا بيانات اعتماد', () => {
  // الصفحة التسويقية مستقلة تمامًا: ممنوع تحميل supabase أو js/config.js
  assert.doesNotMatch(landing, /js\/config\.js/);
  assert.doesNotMatch(landing, /supabase/i);
  assert.doesNotMatch(landing, /js\/main\.js|js\/app\.js|js\/db\.js/);
  // ولا أي مفتاح أو توكن
  assert.doesNotMatch(landing, /eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(landing, /service_role/);
  // السكربتات المسموحة فقط
  const scripts = [...landing.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['js/site-config.js', 'js/landing.js']);
});

test('الأسعار في صفحة العرض تطابق SYS_DEFAULT في js/admin.js', () => {
  const admin = read('js/admin.js');
  const m = admin.match(/const SYS_DEFAULT = \{[^}]*monthly:\s*(\d+),\s*yearly:\s*(\d+)/);
  assert.ok(m, 'SYS_DEFAULT موجود');
  const [, monthly, yearly] = m;

  const cfg = siteConfig.match(/priceMonthly:\s*(\d+)/);
  const cfgy = siteConfig.match(/priceYearly:\s*(\d+)/);
  assert.equal(cfg[1], monthly, 'السعر الشهري متطابق');
  assert.equal(cfgy[1], yearly, 'السعر السنوي متطابق');

  // والقيم الافتراضية في صفحة العرض نفسها
  assert.match(landing, new RegExp('data-price-m>\\s*' + monthly + '<'));
});

test('كل أزرار واتساب تُعبَّأ من site-config — لا رقم مكتوب داخل HTML', () => {
  // الرقم مصدره الواحد site-config.js
  assert.match(siteConfig, /whatsapp:\s*'\d{10,15}'/);
  assert.match(siteConfig, /function waLink/);
  assert.match(landingJs, /\[data-wa\]/);
  // ممنوع رقم واتساب مكتوب مباشرة في HTML
  assert.doesNotMatch(landing, /wa\.me\/\d+/);
  assert.doesNotMatch(landing, /api\.whatsapp\.com\/send/);
});

test('الفوتر يحمل هوية تجارية ولا يحتوي وعدًا طبيًا أو ادعاءً غير قابل للإثبات', () => {
  // ادعاءات طبية/تنظيمية ممنوعة في صفحة عرض لبرنامج إدارة عيادات
  const banned = [
    /معتمد من وزارة الصحة/,
    /FDA/,
    /HIPAA/,
    /علاج مضمون/,
    /نتيجة مضمونة/,
    /أفضل برنامج في مصر/,
  ];
  banned.forEach(re => assert.doesNotMatch(landing, re));
  // ولا ادعاء بعدد عملاء لا نستطيع إثباته
  assert.doesNotMatch(landing, /\d+\s*(عيادة|دكتور|طبيب)\s*(بيستخدمو|مستخدم)/);
});

test('بوابة المريض مذكورة دون ادعاء بأنها مفعّلة بالكامل', () => {
  assert.match(landing, /فيه بوابة للمريض|بوابة للمريض/);
  assert.doesNotMatch(landing, /بوابة المريض مفعّلة/);
});

test('the sales seed is synthetic, idempotent and tenant-scoped', () => {
  assert.match(seedSales, /بيانات عرض \*\*للتصوير والفيديو\*\*|اصطناعية 100%/);
  assert.match(seedSales, /^begin;/m);
  assert.match(seedSales, /^commit;/m);
  assert.match(seedSales, /demo-doctor@clinic\.invalid/);
  // لا أسرار
  assert.doesNotMatch(seedSales, /service_role|eyJhbGciOiJIUzI1Ni/);
  // لا أرقام موبايل مصرية حقيقية
  assert.doesNotMatch(seedSales, /\+20(10|11|12|15)\d{8}/);
  assert.match(seedSales, /\+201900000101/);
  // تكرار آمن + رفض الخلط مع مرضى حقيقيين
  const conflicts = seedSales.match(/on conflict \(id\) do nothing/gi) || [];
  assert.ok(conflicts.length >= 5, 'كل insert آمن للتكرار');
  assert.match(seedSales, /هذا الحساب يحتوي بيانات مرضى أخرى/);
  // كل insert مقيد بالدكتور
  const inserts = [...seedSales.matchAll(/insert into public\.[a-z_]+\s*\(([\s\S]*?)\)\s*values/gi)];
  assert.ok(inserts.length >= 5);
  inserts.forEach(m => assert.match(m[1], /doctor_id/, 'insert مقيد بالدكتور'));
  // لا يمس حالة الاشتراك
  assert.doesNotMatch(seedSales, /'account'/);
});

test('the sales seed uses the real column names (guards against drift)', () => {
  // أعمدة التحاليل الفعلية: tested_on + results (jsonb) — مش date/result/unit
  assert.match(seedSales, /\(id, doctor_id, patient_id, tested_on, test_name, results\)/);
  assert.doesNotMatch(seedSales, /test_name,\s*result,/);
  // قراءات الصحة: reading_type + glucose_value + systolic + diastolic
  assert.match(seedSales, /reading_type, recorded_at, glucose_value, glucose_type/);
  assert.doesNotMatch(seedSales, /kind, value_1/);
});

test('the gate sends new visitors to the landing page but never traps a signed-in user', () => {
  const gate = read('js/app-gate.js');
  const index = read('index.html');

  // يُحمَّل أول سكربت — قبل أي حاجة من التطبيق
  const firstScript = index.match(/<script src="([^"]+)"/);
  assert.equal(firstScript[1], 'js/app-gate.js', 'gate is the first script');

  // مسار الهروب موجود
  assert.match(gate, /\?app=1/);
  assert.match(gate, /#app/);
  // جلسة سابقة تمنع التحويل
  assert.match(gate, /clinic_doctor/);
  // لو sessionStorage مقفول → استنتاج آمن = ابقَ في التطبيق
  assert.match(gate, /catch[\s\S]{0,200}return true/);
  // التحويل بـ replace (مش href) عشان زر الرجوع ما يعلّقش
  assert.match(gate, /location\.replace\('landing\.html'\)/);
  // ممنوع أي تعامل مع Supabase أو تخزين
  assert.doesNotMatch(gate, /supabase|localStorage|fetch\(/);
});

test('every in-app entry point from the landing page carries the ?app=1 escape hatch', () => {
  // كل رابط لـindex.html في صفحة العرض لازم يكون معاه ?app=1
  const hrefs = [...landing.matchAll(/href="(index\.html[^"]*)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 3, 'landing links to the app');
  hrefs.forEach(h => assert.match(h, /\?app=1/, 'رابط التطبيق لازم يحمل ?app=1: ' + h));
});

// ── اختبار وظيفي حقيقي للبوابة: نشغّل الملف فعليًا ببيئة وهمية ──
const vm = require('node:vm');

function runGate({ search = '', hash = '', sessionValue = null, sessionThrows = false }) {
  const calls = [];
  const sandbox = {
    location: {
      search, hash,
      replace: url => calls.push(url),
    },
    sessionStorage: {
      getItem() {
        if (sessionThrows) throw new Error('blocked');
        return sessionValue;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/app-gate.js'), sandbox, { filename: 'app-gate.js' });
  return calls;
}

test('the gate never redirects a user who already has a session', () => {
  assert.deepEqual(runGate({ sessionValue: '{"id":"x"}' }), [], 'no redirect when clinic_doctor exists');
});

test('the gate never redirects when ?app=1 or #app is present', () => {
  assert.deepEqual(runGate({ search: '?app=1' }), [], '?app=1 keeps the app');
  assert.deepEqual(runGate({ hash: '#app' }), [], '#app keeps the app');
  // حتى لو فيه باراميترات تانية
  assert.deepEqual(runGate({ search: '?x=1&app=1&y=2' }), [], 'app=1 anywhere in the query');
});

test('the gate sends a brand-new visitor to the landing page', () => {
  assert.deepEqual(runGate({}), ['landing.html'], 'new visitor → landing');
  assert.deepEqual(runGate({ search: '?x=1' }), ['landing.html'], 'unrelated param still redirects');
});

test('the gate fails safe: a blocked sessionStorage keeps the user in the app', () => {
  assert.deepEqual(runGate({ sessionThrows: true }), [], 'never trap the user behind a redirect error');
});

test('the gate does not hijack the landing page or any other page', () => {
  // الملف بيتحمّل في index.html فقط — نتأكد إنه مش موجود في باقي الصفحات
  ['landing.html', 'reset.html'].forEach(page => {
    assert.doesNotMatch(read(page), /app-gate\.js/, page + ' must not load the gate');
  });
});

// ── الفيديو مربوط بصفحة البيع ──
// الغرض: الفيديو كان بيتعمل ويترفع لكن الصفحة تفضل بتقول «جاي قريب».
// الاختبارات دي بتثبّت الربط نفسه، مش وجود الملف بس.

test('الفيديو والغلاف ملفات موجودة فعلاً على القرص', () => {
  ['media/clinic_demo_60s.mp4', 'media/poster.jpg'].forEach(f => {
    const p = path.join(root, f);
    assert.ok(fs.existsSync(p), f + ' مفقود');
    assert.ok(fs.statSync(p).size > 10000, f + ' حجمه صغير بشكل مريب');
  });
});

test('صفحة البيع تشغّل الفيديو فعلاً — مش لافتة «جاي قريب»', () => {
  const slot = landing.match(/<div id="demoVideoSlot">[\s\S]*?<\/div>/);
  assert.ok(slot, 'مفيش demoVideoSlot');
  assert.match(slot[0], /<video[^>]*controls/, 'المشغّل لازم يكون موجود بـ controls');
  assert.match(slot[0], /src="media\/clinic_demo_60s\.mp4/, 'مصدر الفيديو لازم يكون مربوط');
  assert.match(slot[0], /poster="media\/poster\.jpg/, 'الغلاف لازم يكون مربوط');
  // اللافتة القديمة ممنوع ترجع
  assert.doesNotMatch(landing, /جاي قريب/);
  assert.doesNotMatch(landing, /lp-video-fallback/, 'البديل القديم اتشال');
});

test('SITE.demoVideo و SITE.demoPoster بيشاوروا على نفس الملفات وببصمة', () => {
  const vm = siteConfig.match(/demoVideo:\s*'([^']+)'/);
  const pm = siteConfig.match(/demoPoster:\s*'([^']+)'/);
  assert.ok(vm && vm[1], 'demoVideo لازم يكون متملي');
  assert.ok(pm && pm[1], 'demoPoster لازم يكون متملي');
  assert.match(vm[1], /^media\/clinic_demo_60s\.mp4\?v=[0-9a-f]{7,}$/, 'demoVideo لازم يكون فيه ?v= بصمة');
  assert.match(pm[1], /^media\/poster\.jpg\?v=[0-9a-f]{7,}$/, 'demoPoster لازم يكون فيه ?v= بصمة');
  // نفس البصمة في الاثنين عشان مايتناقضوش
  assert.equal(vm[1].split('?v=')[1], pm[1].split('?v=')[1]);
  // والـ HTML يستخدم نفس البصمة
  assert.ok(landing.includes(vm[1]), 'landing.html لازم يستخدم نفس رابط الفيديو');
  assert.ok(landing.includes(pm[1]), 'landing.html لازم يستخدم نفس رابط الغلاف');
});

test('الـ service worker مايخزّنش الفيديو في كاش الواجهة', () => {
  const sw = read('sw.js');
  assert.match(sw, /SKIP_CACHE/, 'لازم يكون فيه استثناء للملفات الكبيرة');
  assert.match(sw, /SKIP_CACHE\.test\(url\.pathname\)/, 'الاستثناء لازم يتنفّذ فعلاً في الـ fetch');
  // الفيديو كبير: ٣.٩ ميجا × كل تحديث كاش = مساحة جهاز وبطء
  const mp4 = fs.statSync(path.join(root, 'media/clinic_demo_60s.mp4')).size;
  assert.ok(mp4 > 1024 * 1024, 'الفيديو أكبر من ١ ميجا — مايصحش يدخل SHELL');
  assert.doesNotMatch(sw, /SHELL[\s\S]{0,4000}?clinic_demo_60s\.mp4/, 'الفيديو ممنوع في قائمة SHELL');
});

test('حزمة النشر فيها الفيديو والغلاف', () => {
  const build = read('scripts/build-dist.sh');
  assert.match(build, /media\/clinic_demo_60s\.mp4/, 'build-dist لازم ينسخ الفيديو');
  assert.match(build, /media\/poster\.jpg/, 'build-dist لازم ينسخ الغلاف');
  // وبيتأكد من وجودهم في الفحص النهائي
  assert.match(build, /for f in[\s\S]*?media\/clinic_demo_60s\.mp4/, 'الفيديو لازم يكون في قائمة الملفات الحرجة');
});
