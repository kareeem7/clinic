'use strict';

// Edge handler tests use mocked fetch and do not upload real files.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const handlerModule = import(pathToFileURL(path.join(root, 'supabase/functions/portal-photo-upload/handler.mjs')).href);
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const doctor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const patient = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const fileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);

async function makeHandler({ responses = [[{ doctor_id: doctor, patient_id: patient }], [{ doctor_id: doctor, patient_id: patient }]], uploadStatus = 200 } = {}) {
  const { createPhotoHandler } = await handlerModule;
  const calls = []; let index = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    if (url.includes('/rest/v1/rpc/')) {
      const value = responses[index++];
      if (value instanceof Error) throw value;
      return Response.json(value);
    }
    return new Response('', { status: uploadStatus });
  };
  return { calls, handler: createPhotoHandler({ supabaseUrl: 'https://demo.supabase.co', serviceKey: 'test-service-key', fetchImpl, randomUUID: () => fileId }) };
}
function request(bytes = png, headers = {}) {
  return new Request('https://example.test/upload', { method: 'POST', headers: { 'x-patient-token': token, 'content-type': 'image/png', ...headers }, body: bytes });
}

test('valid session is checked twice before a private server-derived upload', async () => {
  const { handler, calls } = await makeHandler();
  const response = await handler(request());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.path, `${doctor}/${patient}/${fileId}.png`);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/patient_portal_photo_authorize'));
  assert.equal(JSON.parse(calls[0].body).p_token, token);
  assert.ok(calls[2].url.endsWith('/storage/v1/object/patient-photos/' + data.path));
  assert.equal(calls[2].headers['x-upsert'], 'false');
  assert.equal(calls[2].headers['Content-Type'], 'image/png');
  assert.doesNotMatch(JSON.stringify(data), /test-service-key|aaaaaaaa/);
});

test('invalid, expired, or revoked sessions cannot upload', async () => {
  const invalid = await makeHandler();
  assert.equal((await invalid.handler(request(png, { 'x-patient-token': 'not-a-token' }))).status, 401);
  assert.equal(invalid.calls.length, 0);
  const expired = await makeHandler({ responses: [[]] });
  assert.equal((await expired.handler(request())).status, 401);
  assert.equal(expired.calls.length, 1);
  const revoked = await makeHandler({ responses: [[{ doctor_id: doctor, patient_id: patient }], []] });
  assert.equal((await revoked.handler(request())).status, 401);
  assert.equal(revoked.calls.length, 2);
  const changed = await makeHandler({ responses: [[{ doctor_id: doctor, patient_id: patient }], [{ doctor_id: doctor, patient_id: fileId }]] });
  assert.equal((await changed.handler(request())).status, 401);
  assert.equal(changed.calls.length, 2);
});

test('unsupported types, invalid image signatures and oversized streams are rejected', async () => {
  const unsupported = await makeHandler();
  assert.equal((await unsupported.handler(request(png, { 'content-type': 'text/html' }))).status, 415);
  assert.equal(unsupported.calls.length, 0);
  const fake = await makeHandler();
  assert.equal((await fake.handler(request(Uint8Array.from([1, 2, 3])))).status, 415);
  assert.equal(fake.calls.length, 1);
  const oversized = await makeHandler();
  const bytes = new Uint8Array(5 * 1024 * 1024 + 1); bytes.set(png);
  assert.equal((await oversized.handler(request(bytes))).status, 413);
  assert.equal(oversized.calls.length, 1);
});

test('CORS preflight works and service failures do not disclose secrets', async () => {
  const { handler } = await makeHandler({ responses: [new Error('test-service-key')] });
  const options = await handler(new Request('https://example.test/upload', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  assert.match(options.headers.get('access-control-allow-headers'), /x-patient-token/);
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /test-service-key|aaaaaaaa/);
});

test('setup and migration remove direct upload and restrict the session RPC to service role', () => {
  const migration = fs.readFileSync(path.join(root, 'sql/migrations/20261101_portal_photo_upload.sql'), 'utf8').trim();
  const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  assert.ok(config.includes(migration.replace('\nbegin;\n', '\n').replace(/\ncommit;$/, '')));
  assert.match(migration, /drop policy if exists portal_photo_insert on storage\.objects/);
  assert.doesNotMatch(config, /create policy portal_photo_insert/);
  assert.match(migration, /s\.token = p_token and s\.expires_at > now\(\)/);
  assert.match(migration, /p\.deleted_at is null and public\.clinic_active\(s\.doctor_id\)/);
  assert.match(migration, /revoke all on function public\.patient_portal_photo_authorize\(uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.patient_portal_photo_authorize\(uuid\) to service_role/);
});

test('JPEG and WebP signatures are accepted only with matching MIME types', async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
  const webp = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  for (const [bytes, type, extension] of [[jpeg, 'image/jpeg', 'jpg'], [webp, 'image/webp', 'webp']]) {
    const { handler, calls } = await makeHandler();
    const response = await handler(request(bytes, { 'content-type': type }));
    assert.equal(response.status, 200);
    assert.ok((await response.json()).path.endsWith('.' + extension));
    assert.equal(calls.length, 3);
  }
  const mismatched = await makeHandler();
  assert.equal((await mismatched.handler(request(jpeg, { 'content-type': 'image/png' }))).status, 415);
  assert.equal(mismatched.calls.length, 1);
});

test('Storage errors are not treated as successful uploads', async () => {
  const { handler, calls } = await makeHandler({ uploadStatus: 500 });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(await response.text(), /test-service-key|aaaaaaaa/);
});
