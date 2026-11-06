'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261108_patient_portal_clinical_history.sql'), 'utf8');
const config = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const portalSource = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');

function portalHarness(rpc) {
  const nodes = new Map();
  const context = vm.createContext({
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {} } }, querySelector(selector) { return getNode(selector); } },
    window: {},
    DB: { sb: { rpc } },
    $: getNode,
    $$: () => [],
    esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); },
    humanDate(value) { return String(value || ''); },
    toast() {}, switchAuthTab() {}, showScreen() {},
    resetPortalSessionState() {},
    Charts: {}
  });
  function getNode(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, contains() { return false; } } });
    return nodes.get(selector);
  }
  vm.runInContext(portalSource, context, { filename: 'patient-portal.js' });
  return { context, nodes, getNode };
}

test('clinical history RPC is embedded, token-scoped, active-clinic checked, and returns only explicit patient fields', () => {
  assert.ok(config.includes(migration.trim()), 'fresh-install setup SQL must include the clinical-history RPC migration');
  assert.match(migration, /create or replace function public\.patient_portal_clinical_history\(p_token uuid\)/);
  assert.match(migration, /security definer set search_path = public/);
  assert.match(migration, /where token = p_token and expires_at > now\(\)/);
  assert.match(migration, /public\.clinic_active\(v_s\.doctor_id\)/);
  assert.match(migration, /p\.id = v_s\.patient_id[\s\S]*?p\.doctor_id = v_s\.doctor_id[\s\S]*?p\.deleted_at is null/);
  assert.match(migration, /l\.patient_id = v_s\.patient_id[\s\S]*?l\.doctor_id = v_s\.doctor_id[\s\S]*?l\.deleted_at is null/);
  assert.match(migration, /h\.patient_id = v_s\.patient_id[\s\S]*?h\.doctor_id = v_s\.doctor_id[\s\S]*?h\.deleted_at is null/);
  assert.match(migration, /'glucoseUnit', h\.glucose_unit/);
  assert.match(migration, /h\.reading_type = 'glucose' and v_glucose_enabled/);
  assert.match(migration, /h\.reading_type = 'blood_pressure' and v_pressure_enabled/);
  assert.match(migration, /revoke all on function public\.patient_portal_clinical_history\(uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.patient_portal_clinical_history\(uuid\) to anon, authenticated/);
});

test('portal requests clinical history with its session token, caches only for that session, and renders labs and readings', async () => {
  const calls = [];
  const payload = {
    ok: true,
    labs: [{ testName: '<CBC>', testedOn: '2026-10-31', results: [{ name: '<Hb>', value: '13.5', unit: 'g/dL' }], source: 'clinic' }],
    readings: [
      { readingType: 'glucose', recordedAt: '2026-11-01T10:00:00Z', glucoseValue: 68, glucoseType: 'fasting', glucoseUnit: 'mg/dL', source: 'patient' },
      { readingType: 'glucose', recordedAt: '2026-10-30T10:00:00Z', glucoseValue: 120, glucoseType: 'random', glucoseUnit: null, source: 'clinic' },
      { readingType: 'blood_pressure', recordedAt: '2026-10-29T10:00:00Z', systolic: 121, diastolic: 79, pulse: 72, source: 'clinic' }
    ]
  };
  const app = portalHarness(async (name, args) => { calls.push({ name, args }); return { data: payload, error: null }; });
  vm.runInContext("Portal.token = 'fake-session-token'", app.context);
  const clinical = await vm.runInContext('portalLoadClinical()', app.context);
  await vm.runInContext('portalLoadClinical()', app.context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'patient_portal_clinical_history');
  assert.equal(calls[0].args.p_token, 'fake-session-token');
  vm.runInContext('renderPortalClinicalHistory(portalClinicalCache)', app.context);
  const html = app.getNode('#ptClinicalHistory').innerHTML;
  assert.match(html, /تحاليلك/);
  assert.match(html, /&lt;CBC&gt;/);
  assert.match(html, /&lt;Hb&gt;/);
  assert.match(html, /سكر الدم/);
  assert.match(html, /68 mg\/dL/);
  assert.match(html, /الوحدة غير مسجلة/);
  assert.match(html, /121\/79 mmHg/);
  assert.match(html, /مسجل من بوابتك/);
  assert.match(html, /مسجل من العيادة/);
  assert.doesNotMatch(html, /<CBC>|<Hb>/);
  assert.equal(clinical.labs.length, 1);
});

test('clinical-history read failure is visible without exposing raw backend details', async () => {
  const app = portalHarness(async () => ({ data: null, error: { message: 'secret database detail' } }));
  vm.runInContext("Portal.token = 'fake-session-token'", app.context);
  await assert.rejects(vm.runInContext('portalLoadClinical()', app.context));
  vm.runInContext('renderPortalClinicalHistory(null)', app.context);
  const html = app.getNode('#ptClinicalHistory').innerHTML;
  assert.match(html, /تعذّر تحميل التحاليل والقياسات/);
  assert.doesNotMatch(html, /secret database detail/);
});
