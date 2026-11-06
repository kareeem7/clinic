'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261106_patient_photo_cleanup_queue.sql'), 'utf8');
const config = fs.readFileSync(path.join(root, 'sql/baseline.sql'), 'utf8');
const configToml = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const handlerModule = import(pathToFileURL(path.join(root, 'supabase/functions/purge-patient-photos/handler.mjs')).href);

const doctorId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const objectPath = `${doctorId}/${patientId}/${photoId}.jpg`;

test('hard-deleted or replaced record photos enter a private cleanup queue, not direct Storage metadata deletion', async () => {
  assert.match(migration, /create table if not exists public\.patient_photo_cleanup_queue/);
  assert.match(migration, /alter table public\.patient_photo_cleanup_queue enable row level security/);
  assert.match(migration, /revoke all on public\.patient_photo_cleanup_queue from public, anon, authenticated/);
  assert.match(migration, /after delete on public\.patient_records/);
  assert.match(migration, /after update of photo_path on public\.patient_records/);
  assert.match(migration, /insert into public\.patient_photo_cleanup_queue \(storage_path\)/);
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
  const embedded = migration.replace(/^(?:--[^\n]*\n)*begin;\n/, '').replace(/\ncommit;\n?$/, '');
  assert.ok(config.includes(embedded));
  assert.match(configToml, /\[functions\.purge-patient-photos\]\s*verify_jwt = true/);
});

test('worker verifies the service role, removes Storage objects, then acknowledges only successful paths', async () => {
  const { createPhotoCleanupHandler } = await handlerModule;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/rest/v1/patient_photo_cleanup_queue?select=')) return Response.json([{ storage_path: objectPath }]);
    if (url.includes('/storage/v1/object/patient-photos')) return new Response('{}', { status: 200 });
    if (url.includes('/rest/v1/patient_photo_cleanup_queue?storage_path=')) return new Response(null, { status: 204 });
    throw new Error('unexpected request');
  };
  const handler = createPhotoCleanupHandler({ supabaseUrl: 'https://clinic.example', serviceKey: 'synthetic-service-key', fetchImpl });
  const denied = await handler(new Request('https://function.example/', { method: 'POST' }));
  assert.equal(denied.status, 401);
  const response = await handler(new Request('https://function.example/', { method: 'POST', headers: { authorization: 'Bearer synthetic-service-key' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1 });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[1].init.body), { prefixes: [objectPath] });
  assert.equal(calls[2].init.method, 'DELETE');
});

test('failed Storage removal preserves the cleanup queue for a later retry', async () => {
  const { createPhotoCleanupHandler } = await handlerModule;
  const calls = [];
  const handler = createPhotoCleanupHandler({
    supabaseUrl: 'https://clinic.example', serviceKey: 'synthetic-service-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/rest/v1/patient_photo_cleanup_queue?select=')) return Response.json([{ storage_path: objectPath }]);
      return new Response(null, { status: 503 });
    }
  });
  const response = await handler(new Request('https://function.example/', { method: 'POST', headers: { authorization: 'Bearer synthetic-service-key' } }));
  assert.equal(response.status, 502);
  assert.equal(calls.length, 2);
  assert.ok(!calls.some(call => call.url.includes('storage_path=in.')));
});
