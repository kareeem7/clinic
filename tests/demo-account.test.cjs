'use strict';

// الحساب التجريبي العام: أسوأ حاجة ممكن تحصل هنا إن الإعفاء يتسرّب لحساب
// تاني (يعني دكتور حقيقي يدخل من غير 2FA)، أو إن الطبقتين يختلفوا — الواجهة
// تعدّي والداتابيز ترجّع فاضي. الاختبارات دي بتحرس الاتنين.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const migration = read('sql/migrations/20261118_demo_account.sql');
const seed = read('sql/demo_account_seed.sql');
const dbSource = read('js/db.js');
const mainSource = read('js/main.js');
const html = read('index.html');

/* ───────────────────────── الترحيل / RLS ───────────────────────── */

test('the demo migration only ORs an exception onto aal2 — it never replaces it', () => {
  assert.match(migration, /^-- [\s\S]*?\bbegin;/);
  assert.match(migration, /\bcommit;\s*$/);
  // الشرط الأصلي لازم يفضل موجود، والإضافة تبقى OR على معرّف واحد
  assert.match(migration, /''aal''::text\) = ''aal2''::text\) or \(auth\.uid\(\) = %L::uuid\)/);
  // ممنوع أي شكل من أشكال الفتح العام
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migration, /aclitem|grant\s+all|bypassrls/i);
});

test('the demo migration leaves admin-only tables on mandatory MFA', () => {
  const loop = migration.match(/foreach t in array array\[([\s\S]*?)\] loop/);
  assert.ok(loop, 'في لوب على جداول العيادة');
  for (const tenantTable of ['patients', 'appointments', 'patient_records', 'patient_notes', 'patient_labs', 'plans']) {
    assert.ok(loop[1].includes("'" + tenantTable + "'"), tenantTable);
  }
  // الجداول الإدارية ما تتلمسش خالص في أي سطر تنفيذي
  const executable = migration
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  for (const adminTable of ['superadmins', 'admin_notes', 'system_settings', 'audit_logs', 'storage.objects']) {
    assert.ok(!executable.includes(adminTable), adminTable + ' مش من ضمن الإعفاء');
  }
  // حذف صف الطبيب يفضل محتاج aal2
  assert.doesNotMatch(executable, /require_mfa_delete/);
});

test('the exemption is pinned to a resolved uid, not to an email the user can change', () => {
  // المعرّف بيتقرأ من auth.users وقت التنفيذ؛ مفيش uid مكتوب بالسالب في الملف
  assert.match(migration, /select id into v_demo from auth\.users where email = 'demo@clinic\.dev'/);
  assert.match(migration, /v_pred := format\(/);
  // ولو الحساب مش موجود، الترحيل ما بيعملش حاجة بدل ما يفتح كل حاجة
  assert.match(migration, /if v_demo is null then[\s\S]*?return;/);
});

/* ───────────────────── السلوك الحقيقي لـ mfaGate ───────────────────── */

function gateWith(uid) {
  const context = vm.createContext({
    State: {}, defaultClinicData: () => ({ settings: {} }),
    addDaysISO: () => '2026-11-15', todayISO: () => '2026-11-01', TRIAL_DAYS: 14, console
  });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.sb = {
    auth: {
      async getSession() {
        return { data: { session: uid ? { user: { id: uid, email: 'whatever@example.com' } } : null } };
      },
      mfa: {
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null };
        }
      }
    }
  };
  return DB;
}

test('the demo account skips TOTP and every other account still hits the mandatory gate', async () => {
  const demoUid = dbSource.match(/const DEMO_UID = '([0-9a-f-]{36})'/);
  assert.ok(demoUid, 'DEMO_UID معرّف كـ uuid ثابت');
  const uid = demoUid[1];

  assert.equal(await gateWith(uid).mfaGate(), 'ready', 'الديمو يعدّي من غير عامل');

  // نفس الإيميل بالظبط لكن معرّف مختلف = حساب تاني، ولازم ياخد مسار 2FA
  const other = await gateWith('11111111-2222-4333-8444-555555555555').mfaGate();
  assert.equal(other, 'mfa-enroll', 'دكتور تاني لسه 2FA إجباري عليه');

  // من غير جلسة أصلاً، مفيش إعفاء
  assert.equal(await gateWith(null).mfaGate(), 'mfa-enroll');
});

test('the demo exemption is a uid match, never an email match', () => {
  assert.match(dbSource, /user\.id === DEMO_UID/);
  assert.doesNotMatch(dbSource, /user\.email === DEMO_EMAIL/);
  // الإعفاء بيحصل قبل أي نداء لـ aal
  const gate = dbSource.slice(dbSource.indexOf('async mfaGate()'));
  const body = gate.slice(0, gate.indexOf('},'));
  assert.ok(body.indexOf('isDemoAccount') < body.indexOf('getAuthenticatorAssuranceLevel'));
});

/* ───────────────────────── الواجهة ───────────────────────── */

test('the demo button is labelled as a demo and the visitor can see it is fake data', () => {
  assert.match(html, /id="demoBtn"/);
  assert.match(html, /دخول ديمو/);
  assert.match(html, /بيانات وهمية|البيانات وهمية/);
});

test('the demo button goes through the same sign-in path as a real login', () => {
  const handler = mainSource.slice(mainSource.indexOf("$('#demoBtn').onclick"));
  assert.ok(handler.length > 0, 'في معالج للزر');
  assert.match(handler, /DB\.signIn\(DEMO_EMAIL, DEMO_PASSWORD\)/);
  assert.match(handler, /routeAfterAuth\(step, 'doctor'\)/);
  // ممنوع أي مسار دخول موازي بيتخطى الطبقة الموحدة
  assert.doesNotMatch(mainSource, /signInWithPassword/);
  assert.doesNotMatch(mainSource, /setSession\(/);
});

/* ───────────────────────── ملف البذور ───────────────────────── */

test('the demo seed is transactional, idempotent and clearly synthetic', () => {
  assert.equal((seed.match(/^begin;/gm) || []).length, 1, 'معاملة واحدة بالظبط');
  assert.equal((seed.match(/^commit;/gm) || []).length, 1);
  assert.match(seed, /بيانات عرض اصطناعية 100%/);
  assert.match(seed, /Africa\/Cairo/);

  const conflicts = seed.match(/on conflict \(id\) do nothing/gi) || [];
  assert.ok(conflicts.length >= 8, 'كل إدخال آمن عند إعادة التشغيل');

  // أرقام اصطناعية: بادئة +2019 مش مخصصة لأي مشغّل مصري حقيقي
  assert.doesNotMatch(seed, /\+20(10|11|12|15)\d{8}/);
  assert.match(seed, /\+201900000001/);
  assert.doesNotMatch(seed, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('every seeded row is tenant-scoped and the safety barrier is present', () => {
  const inserts = [...seed.matchAll(/insert into public\.[a-z_]+\s*\(([\s\S]*?)\)\s*(?:values|select)/gi)];
  assert.ok(inserts.length >= 6, 'البذور بتكتب في عدة جداول');
  inserts.forEach(m => assert.match(m[1], /doctor_id/, 'كل إدخال مربوط بدكتور'));
  assert.match(seed, /DEMO_SEED: هذا الحساب يحتوي بيانات مرضى أخرى/);
  assert.match(seed, /id::text not like 'd0d0d0d0-%'/);
});

test('the seed keeps the demo alive without leaving the account guard disabled', () => {
  const disables = seed.match(/disable trigger trg_guard_account/gi) || [];
  const enables = seed.match(/enable trigger trg_guard_account/gi) || [];
  assert.equal(disables.length, 1);
  assert.equal(enables.length, 1);
  assert.ok(seed.indexOf('disable trigger') < seed.indexOf('enable trigger'), 'الترتيب صح');
  // التعطيل جوّه نفس المعاملة، مش معاملة منفصلة
  assert.ok(seed.indexOf('disable trigger') > seed.indexOf('begin;'));
  assert.ok(seed.indexOf('enable trigger') < seed.lastIndexOf('commit;'));
  assert.match(seed, /clinic_active\(\)/);
});

test('destructive cleanup is documented but never executed', () => {
  const destructive = seed
    .split('\n')
    .filter(line => /delete from|truncate|drop table/i.test(line));
  assert.ok(destructive.length > 0, 'في وصفة تنظيف');
  destructive.forEach(line => assert.match(line, /^\s*--/, 'التنظيف معطّل'));
});
