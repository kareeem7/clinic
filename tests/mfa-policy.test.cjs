'use strict';

// Structural SQL and mocked client tests. Database/JWT behavior needs integration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261101_require_mfa.sql'), 'utf8').trim();
const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');

test('setup SQL includes the MFA migration without committing an outer transaction', () => {
  assert.match(migration, /^-- Require a verified MFA session[\s\S]*\bbegin;[\s\S]*\bcommit;$/);
  const embedded = migration.replace('\nbegin;\n', '\n').replace(/\ncommit;$/, '');
  assert.ok(config.includes(embedded));
});

test('MFA policies restrict medical and administrative tables while preserving initial doctor insert', () => {
  const loop = migration.match(/foreach t in array array\[([\s\S]*?)\] loop/);
  assert.ok(loop);
  for (const table of ['patients', 'appointments', 'patient_records', 'patient_notes', 'plans', 'audit_logs', 'superadmins', 'admin_notes', 'system_settings']) {
    assert.ok(loop[1].includes("'" + table + "'"), table);
  }
  assert.match(migration, /as restrictive for all to authenticated using \(\(auth\.jwt\(\)->>''aal''\) = ''aal2''\) with check/);
  for (const operation of ['select', 'update', 'delete']) {
    assert.match(migration, new RegExp('on public\\.doctors as restrictive for ' + operation + ' to authenticated'));
  }
  assert.doesNotMatch(migration, /on public\.doctors as restrictive for (?:all|insert)\b/);
  assert.match(migration, /on storage\.objects as restrictive for select to authenticated\s+using \(bucket_id <> 'patient-photos' or \(auth\.jwt\(\)->>'aal'\) = 'aal2'\)/);
});

test('security-definer admin and clinic settings functions check MFA independently of RLS', () => {
  assert.match(migration, /function public\.is_super_admin\(\)[\s\S]*?coalesce\(auth\.jwt\(\)->>'aal' = 'aal2', false\)[\s\S]*?exists \(select 1 from public\.superadmins/);
  assert.match(migration, /function public\.save_clinic_settings\(patch jsonb\)[\s\S]*?if auth\.uid\(\) is null or coalesce\(auth\.jwt\(\)->>'aal', ''\) <> 'aal2' then[\s\S]*?errcode = '42501'/);
});

function registerContext({ session = true, insertError = null } = {}) {
  const calls = [];
  const context = vm.createContext({
    State: {}, defaultClinicData: () => ({ settings: {} }),
    addDaysISO: () => '2026-11-15', todayISO: () => '2026-11-01', TRIAL_DAYS: 14, console
  });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  const DB = vm.runInContext('DB', context);
  DB.sb = {
    auth: { async signUp() { return { data: { user: { id: 'doctor-test' }, session: session ? {} : null }, error: null }; } },
    from(table) {
      calls.push({ table });
      return { async insert(row) { calls.push({ row }); return { error: insertError }; } };
    }
  };
  return { DB, calls };
}

test('registration inserts a new doctor profile before MFA enrollment', async () => {
  const { DB, calls } = registerContext();
  assert.equal(await DB.register('Test Doctor', 'nutrition', 'Test Clinic', 'test@example.com', 'password'), 'mfa-enroll');
  // الدفعة ٣: بعد صف الدكتور يُنشأ فرع افتراضي واحد (بلا بادئة) لنفس الحساب
  assert.equal(calls.length, 4);
  assert.equal(calls[0].table, 'doctors');
  assert.equal(calls[1].row.id, 'doctor-test');
  assert.equal(calls[1].row.settings.clinicName, 'Test Clinic');
  assert.equal(calls[2].table, 'clinics');
  assert.equal(calls[3].row.doctor_id, 'doctor-test');
  assert.equal(calls[3].row.name, 'Test Clinic');
  assert.equal(calls[3].row.is_default, true);
  assert.equal(calls[3].row.code, undefined, 'البادئة يختارها الدكتور لاحقاً، مش عند إنشاء الحساب');
});

test('registration preserves confirmation and insert failures', async () => {
  const noSession = registerContext({ session: false });
  await assert.rejects(noSession.DB.register('Test', 'nutrition', 'Clinic', 'test@example.com', 'password'), e => e.code === 'confirm-email');
  assert.equal(noSession.calls.length, 0);
  const error = { code: '23505' };
  const failed = registerContext({ insertError: error });
  await assert.rejects(failed.DB.register('Test', 'nutrition', 'Clinic', 'test@example.com', 'password'), e => e === error);
});
