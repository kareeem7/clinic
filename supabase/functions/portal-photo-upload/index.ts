import { createPhotoHandler } from './handler.mjs';

// Supabase injects these variables into Edge Functions; never expose the key to clients.
Deno.serve(createPhotoHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}));
