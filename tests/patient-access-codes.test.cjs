'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261112_patient_access_codes.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'sql/demo_seed_synthetic.sql'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// نفس نمط ترحيل 20261108: كتلة الترحيل مضمّنة حرفياً في SQL التأسيسي
const block = migration.slice(migration.indexOf('begin;') + 6, migration.lastIndexOf('commit;')).trim();

test('the fresh-install SQL embeds the access-code migration verbatim', () => {
  assert.ok(block.length > 1000);
  assert.ok(setup.includes(block), 'SUPABASE_SQL is byte-identical to the migration body');
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
});

test('the credentials table is invisible to the browser and never exported', () => {
  assert.match(migration, /create table if not exists public\.patient_portal_credentials/);
  assert.match(migration, /code text not null unique/);
  assert.match(migration, /disabled_at timestamptz/);
  assert.match(migration, /credentials_patient_same_doctor/);
  assert.match(migration, /credentials_clinic_same_doctor/);
  assert.match(migration, /alter table public\.patient_portal_credentials enable row level security/);
  assert.doesNotMatch(migration, /create policy [a-z_]*credentials/);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete) on public\.patient_portal_credentials/);
  const db = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
  assert.match(db, /dumpAll\(\)/); // export path still exists but excludes credentials
  assert.doesNotMatch(db, /g\('patient_portal_credentials'\)/);
  assert.doesNotMatch(setup, /g\('patient_portal_credentials'\)/);
});

test('the doctor chooses the prefix: format, global uniqueness, immutable after first code', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.set_clinic_prefix'),
                             migration.indexOf('end; $$;', migration.indexOf('create or replace function public.set_clinic_prefix')));
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /v_code !~ '\^\[A-Z0-9\]\{2,12\}\$'/);
  assert.match(fn, /where code = v_code and id <> p_clinic_id/);
  assert.match(fn, /البادئة دي مستخدمة في عيادة تانية/);
  assert.match(fn, /exists \(select 1 from public\.patient_portal_credentials where clinic_id = p_clinic_id\)/);
  assert.match(fn, /البادئة اتقفلت بعد إصدار أول كود مريض/);
  assert.match(migration, /grant execute on function public\.set_clinic_prefix\(uuid, text\) to authenticated;/);
  assert.doesNotMatch(migration, /grant execute on function public\.set_clinic_prefix\(uuid, text\) to [^;]*anon/);
});

test('codes are permanent, issued once, random and there is NO rotation function', () => {
  assert.match(migration, /create or replace function public\.issue_patient_code\(p_patient_id uuid\)/);
  assert.match(migration, /alreadyIssued/);
  assert.match(migration, /اختار بادئة الفرع من الإعدادات قبل إصدار الكود/);
  // الكود القصير: ٦ أرقام من هاش عشوائي + إعادة محاولة عند التكرار
  assert.match(migration, /hashtextextended\(gen_random_uuid\(\)::text \|\| clock_timestamp\(\)::text, 0\)/);
  assert.match(migration, /for v_try in 1\.\.12 loop/);
  assert.match(migration, /exit when not exists \(select 1 from public\.patient_portal_credentials where code = v_code\)/);
  assert.match(migration, /lpad\(right\(/);
  // الكود القديم الطويل لسه مقبول (ما فيش تدوير لأي كود اتسلّم)
  assert.match(migration, /coalesce\(array_length\(v_parts, 1\), 0\) not in \(2, 4\)/);
  assert.doesNotMatch(migration, /substr\(v_secret, 9, 4\)/);
  assert.match(migration, /on conflict|alreadyIssued/, 're-issuing returns the same code');
  assert.doesNotMatch(migration, /create or replace function public\.(rotate|change|regenerate|update)_?patient_?code/);
  assert.match(migration, /grant execute on function public\.issue_patient_code\(uuid\) to authenticated;/);
  assert.doesNotMatch(migration, /grant execute on function public\.issue_patient_code\(uuid\) to [^;]*anon/);
});

test('the emergency off-switch disables a stolen card without changing the code', () => {
  assert.match(migration, /create or replace function public\.set_patient_portal_access\(p_patient_id uuid, p_enabled boolean\)/);
  assert.match(migration, /delete from public\.patient_sessions where patient_id = p_patient_id/);
  assert.match(migration, /set disabled_at = case when coalesce\(p_enabled, false\)/);
  assert.doesNotMatch(migration, /update public\.patient_portal_credentials\s+set code/);
  assert.match(migration, /grant execute on function public\.set_patient_portal_access\(uuid, boolean\) to authenticated;/);
});

test('the code is shown to the logged-in patient only, through a token-scoped RPC', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.patient_portal_access_code'),
                             migration.indexOf('end; $$;', migration.indexOf('create or replace function public.patient_portal_access_code')));
  assert.match(fn, /select \* into v_s from public\.patient_sessions where token = p_token and expires_at > now\(\)/);
  assert.match(fn, /where patient_id = v_s\.patient_id and clinic_id = v_s\.clinic_id and disabled_at is null/);
  assert.match(fn, /'code', v_cred\.code/);
  assert.match(fn, /'clinicName'/);
  assert.match(migration, /grant execute on function public\.patient_portal_access_code\(uuid\) to anon, authenticated;/);
  assert.match(portal, /DB\.sb\.rpc\('patient_portal_access_code', \{ p_token: token \}\)/);
  assert.match(portal, /data\.accessCode = info\.code/);
  assert.match(html, /id="ptAccessCode"/);
  assert.match(html, /الكود ده دائم/);
  assert.match(html, /ما تشاركهوش مع حد/);
});

test('no OTP/SMS runtime, service key or raw secret leaks into the app', () => {
  assert.doesNotMatch(migration, /signInWithOtp|verifyOtp|phone_confirmed_at|service_role/);
  assert.doesNotMatch(setup, /signInWithOtp|verifyOtp|phone_confirmed_at/);
  assert.doesNotMatch(portal, /signInWithOtp|verifyOtp/);
  // مفتاح anon عام ومقصود وجوده في الواجهة؛ لا يوجد مفتاح خدمة في أي ملف عميل
  assert.doesNotMatch(portal, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('the synthetic demo seed issues clearly fake codes for its demo patients', () => {
  assert.match(seed, /DEMO1-/);
  assert.match(seed, /to_regclass\('public\.patient_portal_credentials'\)/);
  assert.match(seed, /insert into public\.patient_portal_credentials/);
  assert.match(seed, /on conflict \(patient_id\) do nothing/);
});

test('README documents the plain-storage decision and its real consequence', () => {
  assert.match(readme, /تخزين الكود/);
  assert.match(readme, /كما هو/);
  assert.match(readme, /أي جهة تقرأ الداتابيز/);
  assert.match(readme, /ما لهوش استرجاع آمن/);
  assert.match(readme, /إيقاف/);
  assert.match(readme, /20261112_patient_access_codes\.sql/);
});
