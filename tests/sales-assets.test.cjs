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
