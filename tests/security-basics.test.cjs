'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('CSP blocks inline JavaScript and the document has no inline script blocks', () => {
  const policy = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(policy, 'CSP meta policy exists');
  const scriptSrc = policy[1].split(';').map(x => x.trim()).find(x => x.startsWith('script-src '));
  assert.ok(scriptSrc);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(match[1], /\bsrc\s*=/i, 'every script block must load an external file');
    assert.equal(match[2].trim(), '', 'inline JavaScript is not allowed');
  }
});
