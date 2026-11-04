// Rebuild supabase/functions/portal-photo-upload/standalone.ts from the two
// canonical sources. The Supabase Management API accepts a single source file
// per Edge Function, while the CLI deployment bundles index.ts + handler.mjs.
// Run: node scripts/build-edge-standalone.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const base = new URL('../supabase/functions/portal-photo-upload/', import.meta.url);
const handler = readFileSync(new URL('handler.mjs', base), 'utf8')
  .replace('export function createPhotoHandler(', 'function createPhotoHandler(');
const index = readFileSync(new URL('index.ts', base), 'utf8')
  .split('\n').filter(l => !l.startsWith('import ')).join('\n')
  .replace('// Supabase injects these variables into Edge Functions; never expose the key to clients.\n', '');
const header =
  '// single-file deployment variant — generated from handler.mjs + index.ts\n' +
  '// because the Supabase Management API accepts one source file per function.\n' +
  '// Keep in sync: scripts/build-edge-standalone.mjs ; verified by tests/edge-standalone.test.cjs\n' +
  '// Runtime: Deno (Supabase Edge Functions). verify_jwt = false (portal token gate).\n';
writeFileSync(new URL('standalone.ts', base), header + handler.trimEnd() + '\n\n' + index.replace(/^\n+/, ''));
console.log('standalone.ts rebuilt');
