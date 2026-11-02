// Deletes Storage objects queued by the patient_records hard-delete trigger.
// It is an internal maintenance endpoint: the service-role key is both checked
// here and verified by the Supabase Edge gateway (verify_jwt = true).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PHOTO_PATH = new RegExp('^' + UUID + '/' + UUID + '/' + UUID + '\\.(?:jpg|png|webp)$', 'i');
const BATCH_SIZE = 100;

export function createPhotoCleanupHandler({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const base = (supabaseUrl || '').replace(/\/+$/, '');
  const headers = { apikey: serviceKey || '', Authorization: 'Bearer ' + (serviceKey || '') };
  return async request => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!base || !serviceKey || request.headers.get('authorization') !== 'Bearer ' + serviceKey) {
      return new Response(null, { status: 401 });
    }
    try {
      const queued = await fetchImpl(base + '/rest/v1/patient_photo_cleanup_queue?select=storage_path&order=queued_at.asc&limit=' + BATCH_SIZE, {
        method: 'GET', headers: { ...headers, Accept: 'application/json' }
      });
      if (!queued.ok) return new Response(null, { status: 503 });
      const rows = await queued.json();
      if (!Array.isArray(rows)) return new Response(null, { status: 503 });
      const paths = [...new Set(rows.map(row => row && row.storage_path).filter(path => typeof path === 'string' && PHOTO_PATH.test(path)))];
      if (!paths.length) return Response.json({ processed: 0 });

      const removed = await fetchImpl(base + '/storage/v1/object/patient-photos', {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths })
      });
      if (!removed.ok) return new Response(null, { status: 502 });

      const filter = 'in.(' + paths.map(path => '"' + path + '"').join(',') + ')';
      const cleared = await fetchImpl(base + '/rest/v1/patient_photo_cleanup_queue?storage_path=' + encodeURIComponent(filter), {
        method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' }
      });
      if (!cleared.ok) return new Response(null, { status: 503 });
      return Response.json({ processed: paths.length });
    } catch (_) {
      // Never log paths, patient identifiers, object metadata, or credentials.
      return new Response(null, { status: 503 });
    }
  };
}
