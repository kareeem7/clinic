// Patient portal upload endpoint. The patient token is checked server-side and
// never used in the object path, returned to the client, or logged here.
const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-patient-token',
  'Cache-Control': 'no-store'
};

function reply(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function imageMatchesType(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  return type === 'image/webp' && bytes.length >= 12 &&
    [82, 73, 70, 70].every((n, i) => bytes[i] === n) &&
    [87, 69, 66, 80].every((n, i) => bytes[i + 8] === n);
}

async function readLimitedBody(request) {
  const reader = request.body && request.body.getReader();
  if (!reader) return null;
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return null;
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createPhotoHandler({ supabaseUrl, serviceKey, fetchImpl = fetch, randomUUID = () => crypto.randomUUID() }) {
  const base = (supabaseUrl || '').replace(/\/+$/, '');
  const headers = { apikey: serviceKey || '', Authorization: 'Bearer ' + (serviceKey || '') };
  async function authorize(token) {
    const res = await fetchImpl(base + '/rest/v1/rpc/patient_portal_photo_authorize', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token })
    });
    if (!res.ok) throw new Error('authorization service failed');
    const data = await res.json();
    if (!Array.isArray(data) || data.length !== 1) return null;
    const { doctor_id: doctorId, patient_id: patientId } = data[0];
    if (!UUID.test(doctorId || '') || !UUID.test(patientId || '')) return null;
    return { doctorId, patientId };
  }

  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    const token = request.headers.get('x-patient-token') || '';
    const type = (request.headers.get('content-type') || '').toLowerCase();
    const contentLength = request.headers.get('content-length');
    if (!UUID.test(token)) return reply(401, { error: 'Invalid patient session' });
    if (!Object.prototype.hasOwnProperty.call(EXTENSIONS, type)) return reply(415, { error: 'Unsupported image type' });
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES)) return reply(413, { error: 'Image too large' });
    if (!base || !serviceKey) return reply(500, { error: 'Upload service unavailable' });
    try {
      const session = await authorize(token);
      if (!session) return reply(401, { error: 'Invalid patient session' });
      const bytes = await readLimitedBody(request);
      if (!bytes) return reply(413, { error: 'Image missing or too large' });
      if (!imageMatchesType(bytes, type)) return reply(415, { error: 'Invalid image content' });
      // A logout, expiry or suspension while the image was being read must be
      // rechecked before the privileged Storage write.
      const current = await authorize(token);
      if (!current || current.doctorId !== session.doctorId || current.patientId !== session.patientId) {
        return reply(401, { error: 'Invalid patient session' });
      }
      const id = randomUUID();
      if (!UUID.test(id)) throw new Error('unable to create object id');
      const path = session.doctorId + '/' + session.patientId + '/' + id + '.' + EXTENSIONS[type];
      const uploaded = await fetchImpl(base + '/storage/v1/object/patient-photos/' + path, {
        method: 'POST', headers: { ...headers, 'Content-Type': type, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' }, body: bytes
      });
      if (!uploaded.ok) return reply(502, { error: 'Unable to upload image' });
      return reply(200, { path });
    } catch (_) {
      // Avoid logging patient tokens, images, identifiers or credentials.
      return reply(503, { error: 'Upload service unavailable' });
    }
  };
}
