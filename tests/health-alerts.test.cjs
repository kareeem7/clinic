'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261104_glucose_unit_alerts.sql'), 'utf8');
const portalSource = fs.readFileSync(path.join(root, 'js/patient-portal.js'), 'utf8');
const doctorSource = fs.readFileSync(path.join(root, 'js/health-monitoring.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');

function exported(source, name, globals = {}) {
  const context = vm.createContext(globals);
  vm.runInContext(source + `\nglobalThis.__fn = ${name};`, context);
  return context.__fn;
}

test('the approved display unit and alert thresholds are applied without guessing legacy units', () => {
  assert.match(migration, /add column if not exists glucose_unit text/);
  assert.match(migration, /reading_type = 'glucose' and glucose_unit = 'mg\/dL'[\s\S]*?reading_type = 'blood_pressure' and glucose_unit is null/);
  assert.match(migration, /if p_glucose_value < 54 then v_alert := 'glucose_critical_low'/);
  assert.match(migration, /elsif p_glucose_value < 70 then v_alert := 'glucose_low'/);
  assert.match(migration, /p_systolic > 180 or p_diastolic > 120/);
  assert.match(migration, /case when p_reading_type = 'glucose' then 'mg\/dL' else null end/);
  assert.match(migration, /Existing rows remain unit-unknown \(NULL\)/);
  const embedded = migration.replace(/^(?:--[^\n]*\n)*begin;\n/, '').replace(/\ncommit;\n?$/, '');
  assert.ok(config.includes(embedded), 'setup SQL must include the additive migration body');
});

test('doctor-side alerts are unit-aware and match the adopted cutoffs', () => {
  const alert = exported(doctorSource, 'healthReadingAlert', { Number });
  assert.equal(alert({ readingType: 'glucose', glucoseValue: 69.9, glucoseUnit: 'mg/dL' }).level, 'warning');
  assert.equal(alert({ readingType: 'glucose', glucoseValue: 53.9, glucoseUnit: 'mg/dL' }).level, 'critical');
  assert.equal(alert({ readingType: 'glucose', glucoseValue: 40, glucoseUnit: null }), null);
  assert.equal(alert({ readingType: 'blood_pressure', systolic: 181, diastolic: 80 }).level, 'critical');
  assert.equal(alert({ readingType: 'blood_pressure', systolic: 120, diastolic: 121 }).level, 'critical');
  assert.equal(alert({ readingType: 'blood_pressure', systolic: 180, diastolic: 120 }), null);
});

test('doctor dashboard renders persistent links for recent threshold alerts', () => {
  const rootElement = { innerHTML: '' };
  const state = { healthAlerts: [{ patientId: 'synthetic-patient', recordedAt: '2026-11-02T10:00:00Z', alertLabel: 'synthetic alert' }] };
  const context = vm.createContext({
    State: state, $: () => rootElement, getPatient: () => ({ name: 'Synthetic patient' }),
    healthTimestampLabel: () => 'synthetic time', esc: value => String(value)
  });
  vm.runInContext(dashboardSource + '\nrenderDashboardHealthAlerts();', context);
  assert.match(rootElement.innerHTML, /role="alert"/);
  assert.match(rootElement.innerHTML, /Synthetic patient/);
  assert.match(rootElement.innerHTML, /data-action="view-patient"/);
  assert.match(rootElement.innerHTML, /synthetic alert/);
  assert.match(rootElement.innerHTML, /ليست خدمة طوارئ/);
});

test('patient portal gets the same warning tiers and the form names its fixed unit', () => {
  const alert = exported(portalSource, 'portalHealthAlert', { sessionStorage: { getItem() { return null; } } });
  assert.match(alert({ readingType: 'glucose', glucoseValue: 69 }).text, /أقل من 70 mg\/dL/);
  assert.match(alert({ readingType: 'glucose', glucoseValue: 53 }).text, /أقل من 54 mg\/dL/);
  const pressureText = alert({ readingType: 'blood_pressure', systolic: 181, diastolic: 90 }).text;
  assert.match(pressureText, /أعد القياس بعد دقيقة للتأكد/);
  assert.ok(pressureText.indexOf('أعد القياس') < pressureText.indexOf('إذا بقيت'));
  assert.ok(pressureText.indexOf('إذا بقيت') < pressureText.indexOf('تواصل فورًا مع طبيبك'));
  assert.match(pressureText, /180 انقباضيًا أو 120 انبساطيًا/);
  assert.match(pressureText, /اطلب الإسعاف المحلي فورًا/);
  assert.match(portalSource, /قيمة السكر \(mg\/dL\)/);
  assert.match(portalSource, /aria-live="assertive"/);
});

// حارس إضافي مستقل: صياغة التنبيه ما تتهمش المريض ولا تشكّك في قراءته.
test('blood pressure guidance never blames or doubts the patient', () => {
  const alert = exported(portalSource, 'portalHealthAlert', { sessionStorage: { getItem() { return null; } } });
  assert.doesNotMatch(
    alert({ readingType: 'blood_pressure', systolic: 181, diastolic: 90 }).text,
    /اتهام|غش/
  );
});
