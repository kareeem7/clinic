'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const seed = fs.readFileSync(path.join(root, 'sql/demo_seed_synthetic.sql'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('the demo seed is clearly synthetic, isolated and free of real data or secrets', () => {
  assert.match(seed, /بيانات عرض اصطناعية 100%/);
  assert.match(seed, /project Supabase تجريبي منعزل|مشروع Supabase تجريبي منعزل/);
  assert.match(seed, /demo-doctor@clinic\.invalid/);
  assert.doesNotMatch(seed, /service_role|SUPABASE_SERVICE_ROLE_KEY|eyJhbGciOiJIUzI1Ni/);
  // لا أرقام موبايل مصرية حقيقية: البادئة المستخدمة +2019 غير مخصصة للمشغّلين
  assert.doesNotMatch(seed, /\+20(10|11|12|15)\d{8}/);
  assert.match(seed, /\+201900000001/);
});

test('the seed is transactional, idempotent and refuses to mix with real patients', () => {
  assert.match(seed, /^begin;/m);
  assert.match(seed, /^commit;/m);
  assert.match(seed, /DEMO_SEED: أنشئ حساب الدكتور التجريبي/);
  assert.match(seed, /DEMO_SEED: هذا الحساب يحتوي بيانات مرضى أخرى/);
  assert.match(seed, /DEMO_SEED: صف الدكتور غير موجود/);
  const conflicts = seed.match(/on conflict \(id\) do nothing/gi) || [];
  assert.ok(conflicts.length >= 6, 'every insert is safe to re-run');
  assert.match(seed, /raise notice 'DEMO_SEED:/);
  assert.match(seed, /Africa\/Cairo/);
});

test('every inserted row is scoped to the demo doctor and no subscription state is edited', () => {
  const inserts = [...seed.matchAll(/insert into public\.[a-z_]+\s*\(([\s\S]*?)\)\s*values/gi)];
  assert.ok(inserts.length >= 6, 'seed inserts into several tables');
  inserts.forEach(match => assert.match(match[1], /doctor_id/, 'insert is tenant-scoped'));
  assert.doesNotMatch(seed, /'account'/, 'account/subscription is never touched');
  assert.match(seed, /update public\.doctors[\s\S]*?clinicalFeatures/);
});

test('destructive statements are only present as disabled, explicitly scoped comments', () => {
  const lines = seed.split('\n');
  const destructive = lines.filter(line => /delete from|truncate|drop table|supabase db reset/i.test(line));
  assert.ok(destructive.length > 0, 'a cleanup recipe is documented');
  destructive.forEach(line => assert.match(line, /^\s*--/, 'cleanup is commented out'));
  assert.match(seed, /ON DELETE CASCADE|حذف المرضى الأربعة/);
  assert.doesNotMatch(seed, /^\s*delete from public\.patients/m);
});

// A static arity check: a row with one value fewer than the column list would
// abort the whole seed in PostgreSQL, and there is no local DB to catch it.
function splitTop(sql) {
  const out = [];
  let depth = 0, inQuote = false, cur = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inQuote) {
      cur += c;
      if (c === "'") {
        if (sql[i + 1] === "'") { cur += sql[i + 1]; i++; } else inQuote = false;
      }
      continue;
    }
    if (c === "'") { inQuote = true; cur += c; continue; }
    if (c === '(') { depth++; cur += c; continue; }
    if (c === ')') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function extractTuples(body) {
  const tuples = [];
  let depth = 0, inQuote = false, start = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuote) {
      if (c === "'") {
        if (body[i + 1] === "'") i++; else inQuote = false;
      }
      continue;
    }
    if (c === "'") { inQuote = true; continue; }
    if (c === '(') { if (depth === 0) start = i + 1; depth++; }
    else if (c === ')') {
      depth--;
      if (depth === 0 && start !== null) { tuples.push(body.slice(start, i)); start = null; }
    }
  }
  return tuples;
}

test('every INSERT row has exactly as many values as its column list', () => {
  const inserts = [...seed.matchAll(
    /insert into public\.([a-z_]+)\s*\(([\s\S]*?)\)\s*values([\s\S]*?)\bon conflict \(id\) do nothing/gi
  )];
  assert.equal(inserts.length, 6, 'all six seed inserts are checked');
  inserts.forEach(([, table, colList, body]) => {
    const cols = splitTop(colList);
    const tuples = extractTuples(body);
    assert.ok(tuples.length > 0, `${table} has rows`);
    tuples.forEach((tuple, index) => {
      assert.equal(splitTop(tuple).length, cols.length, `${table} row ${index + 1}`);
    });
  });
  assert.equal((seed.match(/\$\$/g) || []).length % 2, 0, 'dollar-quoted block is closed');
});

test('optional clinical tables are guarded so the seed cannot fail on a partial schema', () => {
  assert.match(seed, /to_regclass\('public\.patient_labs'\)/);
  assert.match(seed, /to_regclass\('public\.patient_health_readings'\)/);
  assert.match(seed, /information_schema\.columns/);
  assert.match(seed, /column_name = 'glucose_unit'/);
});

test('README documents the demo seed, recovery page and remaining limitations', () => {
  assert.match(readme, /sql\/demo_seed_synthetic\.sql/);
  assert.match(readme, /demo-doctor@clinic\.invalid/);
  assert.match(readme, /reset\.html/);
  assert.match(readme, /Redirect URLs/);
  assert.match(readme, /Confirm email/);
  assert.match(readme, /patient_health_readings/);
  assert.match(readme, /قيود معروفة قبل الإطلاق/);
});
