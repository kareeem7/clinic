'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const setup = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261111_multi_clinic_branches.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'sql/demo_seed_synthetic.sql'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

const BRANCH_TABLES = [
  'plans', 'patients', 'appointments', 'patient_records', 'patient_notes',
  'patient_labs', 'patient_health_readings', 'patient_sessions', 'portal_login_attempts'
];

test('the branch migration is transactional and purely additive', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /إضافة فقط|additive/);
  assert.doesNotMatch(migration, /clinic_id uuid not null/i, 'columns stay nullable during the transition');
  const destructive = migration.split('\n').filter(line => /delete from|truncate|drop table|drop column/i.test(line));
  destructive.forEach(line => assert.match(line, /^\s*--/, 'no live destructive statement'));
  // Optional tables must be skipped when a migration has not been applied.
  assert.match(migration, /to_regclass\('public\.' \|\| t\)/);
  assert.match(migration, /pg_constraint/);
});

test('clinics has a globally unique, doctor-chosen prefix and one default per doctor', () => {
  assert.match(migration, /create table if not exists public\.clinics/);
  assert.match(migration, /code text unique/);
  assert.match(migration, /unique \(id, doctor_id\)/);
  assert.match(migration, /clinics_code_format/);
  assert.match(migration, /A-Z0-9/);
  assert.match(migration, /create unique index if not exists clinics_one_default_per_doctor/);
  assert.match(migration, /insert into public\.clinics \(doctor_id, name, is_default, code\)/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /code\)/, 'a NULL prefix is allowed until the doctor picks one');
  assert.match(migration, /select d\.id, coalesce\(nullif\(btrim\(d\.settings->>'clinicName'\)/);
});

test('clinic_id is added to every clinical table and guarded by a composite FK', () => {
  BRANCH_TABLES.forEach(table => assert.ok(migration.includes(`'${table}'`), `${table} is covered`));
  assert.match(migration, /add column if not exists clinic_id uuid/);
  assert.match(migration, /_clinic_same_doctor/);
  assert.match(migration, /references public\.clinics\(id, doctor_id\) on delete restrict/);
  assert.match(migration, /'patient_sessions'/);
  // portal_login_attempts has no doctor_id: it must NOT get the composite FK.
  const fkList = migration.slice(migration.indexOf("declare t text; cname text;"), migration.indexOf('end $$;', migration.indexOf("declare t text; cname text;")));
  assert.doesNotMatch(fkList, /portal_login_attempts/);
});

test('RLS isolates clinics by the SAME doctor_id rule; no existing policy is rewritten', () => {
  assert.match(migration, /alter table public\.clinics enable row level security/);
  assert.match(migration, /create policy clinics_own/);
  assert.match(migration, /auth\.uid\(\) = doctor_id and public\.clinic_active\(auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /drop policy (?!if exists clinics_own)/);
  assert.doesNotMatch(migration, /create policy patients_own|create policy appointments_own|create policy plans_own/);
});

test('the fresh-install SQL stays in sync with the migration', () => {
  const shared = [
    'create table if not exists public.clinics',
    'code text unique',
    'unique (id, doctor_id)',
    'clinics_code_format',
    'create policy clinics_own',
    'auth.uid() = doctor_id',
    'add column if not exists clinic_id uuid',
    '_clinic_same_doctor',
    'references public.clinics(id, doctor_id) on delete restrict',
    'clinics_one_default_per_doctor',
    'clinics_live_doctor_idx',
    'patients_clinic_live_idx',
    'appointments_clinic_live_idx',
    'insert into public.clinics (doctor_id, name, is_default, code)',
    'on conflict do nothing'
  ];
  shared.forEach(fragment => {
    assert.ok(setup.includes(fragment), `baseline SQL contains ${fragment}`);
    assert.ok(migration.includes(fragment), `migration contains ${fragment}`);
  });
  // The baseline block must come AFTER the tables it alters.
  assert.ok(setup.indexOf('PHASE 19 (الدفعة ١): clinic_id') > setup.indexOf('create table if not exists public.patient_health_readings'));
  assert.ok(setup.lastIndexOf('commit;') > setup.indexOf('PHASE 19 (الدفعة ١): clinic_id'));
});

test('the branch migration is additive and no OTP/SMS runtime was introduced', () => {
  assert.doesNotMatch(migration, /patient_portal_login|signInWithOtp|verifyOtp|phone_confirmed_at/);
  assert.doesNotMatch(migration, /grant execute|revoke all/);
  assert.doesNotMatch(setup, /signInWithOtp|verifyOtp|phone_confirmed_at/);
  // الدفعة ٢ غيّرت الدخول إلى الكود الدائم؛ الدفعة ١ نفسها ما لمستش OTP.
  assert.match(setup, /grant execute on function public\.patient_portal_login\(text, text\) to anon, authenticated/);
});

test('the synthetic demo seed links its patients to the default branch when present', () => {
  assert.match(seed, /to_regclass\('public\.clinics'\)/);
  assert.match(seed, /set clinic_id = \(select c\.id from public\.clinics c/);
  assert.match(seed, /column_name = 'clinic_id'/);
});

test('README records the four branch decisions and the no-rotation consequence', () => {
  assert.match(readme, /فروع العيادة \(/);
  assert.match(readme, /20261111_multi_clinic_branches\.sql/);
  assert.match(readme, /لوج واحد/);
  assert.match(readme, /بادئة الكود يختارها الدكتور/);
  assert.match(readme, /دائم بلا زر تغيير/);
  assert.match(readme, /أكتر من لوج إن/);
  assert.match(readme, /ما لهوش استرجاع آمن/);
  assert.match(readme, /فروع العيادة \(الدفعات ١–٣\)/);
  assert.match(readme, /20261113_active_clinic\.sql/);
});
