'use strict';

// Simulated CSS cascade and DOM handlers; no browser or clinical data required.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css/responsive.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

// Compute the cascade for the sidebar's simple selectors within the mobile
// media query, including the formerly problematic html[dir="rtl"] rule.
function sidebarTransform(source, open) {
  const start = source.indexOf('@media (max-width:992px)');
  assert.notEqual(start, -1);
  const begin = source.indexOf('{', start);
  let depth = 1, end = begin + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  const rules = source.slice(begin + 1, end - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g);
  let winner = null;
  for (const match of rules) {
    const declarations = match[2].match(/(?:^|;)\s*transform\s*:\s*([^;]+)/);
    if (!declarations) continue;
    for (const selector of match[1].split(',').map(s => s.trim())) {
      if (!/^(?:html\[dir=["']rtl["']\]\s+)?#sidebar(?:\.open)?$/.test(selector)) continue;
      if (selector.includes('.open') && !open) continue;
      // CSS specificity: ID, then classes/attributes, then type selectors.
      const score = [1, (selector.match(/\.open/g) || []).length + (selector.includes('[dir=') ? 1 : 0), selector.startsWith('html') ? 1 : 0];
      const stronger = !winner || score.some((n, i) => n !== winner.score[i] && n > winner.score[i] && score.slice(0, i).every((v, j) => v === winner.score[j]));
      const equal = winner && score.every((n, i) => n === winner.score[i]);
      if (stronger || equal) winner = { score, value: declarations[1].trim() };
    }
  }
  return winner && winner.value;
}

test('mobile RTL sidebar is offscreen when closed and visible when opened', () => {
  assert.match(html, /<html\s+[^>]*dir="rtl"/);
  assert.equal(sidebarTransform(css, false), 'translateX(100%)');
  assert.equal(sidebarTransform(css, true), 'none');
  assert.match(css, /@media\s*\(min-width:993px\)\s*\{\s*\.only-mobile\s*\{\s*display:none/);
});

test('cascade test detects a more specific RTL rule that hides the open sidebar', () => {
  const broken = css.replace('#sidebar.open{transform:none}', 'html[dir="rtl"] #sidebar{transform:translateX(100%)}\n  #sidebar.open{transform:none}');
  assert.equal(sidebarTransform(broken, true), 'translateX(100%)');
});

function uiContext() {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      classList: {
        add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); },
        toggle(c, on) { if (on === undefined) on = !classes.has(c); on ? classes.add(c) : classes.delete(c); }
      },
      style: {}, dataset: {}, value: '', textContent: '',
      addEventListener() {}, querySelector() { return element(); }, focus() {}
    };
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const noop = () => {};
  const context = vm.createContext({
    document: { addEventListener() {}, querySelector: $, body: element() }, window: { scrollTo() {} }, $,
    $$: () => [], DB: { async init() { return true; }, sb: { auth: { onAuthStateChange() {} } } },
    Portal: { token: null }, State: { isAdmin: false }, Cal: {}, Charts: {},
    sessionStorage: { getItem() { return null; } }, longDate: () => '',
    renderDashboard: noop, renderPatients: noop, renderPatientDetail: noop,
    renderAppointments: noop, renderPlans: noop, renderSettings: noop,
    Admin: {}, setTimeout, clearTimeout, console
  });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  vm.runInContext(mainSource, context, { filename: 'main.js' });
  return { $, boot: () => vm.runInContext('boot()', context), go: () => vm.runInContext("go('patients')", context) };
}

test('menu button opens sidebar, overlay closes it, and navigation closes it', async () => {
  const ui = uiContext();
  await ui.boot();
  const sidebar = ui.$('#sidebar'), overlay = ui.$('#sidebarOverlay');
  ui.$('#menuBtn').onclick();
  assert.equal(sidebar.classList.contains('open'), true);
  assert.equal(overlay.classList.contains('show'), true);
  ui.$('#sidebarOverlay').onclick();
  assert.equal(sidebar.classList.contains('open'), false);
  assert.equal(overlay.classList.contains('show'), false);
  ui.$('#menuBtn').onclick();
  ui.go();
  assert.equal(sidebar.classList.contains('open'), false);
  assert.equal(overlay.classList.contains('show'), false);
});
