const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('resetClinicalState clears all account-scoped clinical data', () => {
  const context = vm.createContext({ todayISO: () => '2026-11-02' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/state.js'), 'utf8') + '\nglobalThis.__State = State; globalThis.__reset = resetClinicalState;', context);
  const state = context.__State;
  state.patients.push({ id: 'synthetic-patient-a' });
  state.appointments.push({ id: 'synthetic-appointment-a' });
  state.plans.push({ id: 'synthetic-plan-a' });
  state.notes.push({ id: 'synthetic-note-a' });
  state.patientIndex['synthetic-patient-a'] = { id: 'synthetic-patient-a' };
  state.settings.doctorName = 'Synthetic doctor';
  state.stats.visits.push({ date: '2026-01-01', count: 1 });
  state.loaded = true;
  state.isAdmin = true;
  state.route = 'patient';
  state.param = 'synthetic-patient-a';
  state.pSearch = 'synthetic';
  state.pPage = 8;

  context.__reset();

  for (const key of ['patients', 'appointments', 'plans', 'notes']) assert.equal(state[key].length, 0, key);
  assert.deepEqual(Object.keys(state.patientIndex), []);
  assert.equal(state.pTotal, 0);
  assert.deepEqual(Object.keys(state.settings), []);
  assert.equal(state.stats.visits.length, 0);
  assert.equal(state.loaded, false);
  assert.equal(state.isAdmin, false);
  assert.equal(state.route, 'dashboard');
  assert.equal(state.param, null);
  assert.equal(state.pSearch, '');
  assert.equal(state.pPage, 1);
});

test('auth routing resets account-scoped state before fetching the next account', () => {
  const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const route = source.slice(source.indexOf('async function routeAfterAuth'), source.indexOf('// The rest is inside the boot'));
  assert.match(route, /resetClinicalState\(\);[\s\S]*?await DB\.loadSettingsRow\(\)/);
  const db = fs.readFileSync(path.join(root, 'js/db.js'), 'utf8');
  assert.match(db, /async signOut\(\)\s*\{[\s\S]*?resetClinicalState\(\);/);
});
