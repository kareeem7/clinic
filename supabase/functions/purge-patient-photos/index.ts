import { createPhotoCleanupHandler } from './handler.mjs';

const handler = createPhotoCleanupHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
});

Deno.serve(handler);
