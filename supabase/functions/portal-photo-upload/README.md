# Patient portal photo upload

This function validates the patient portal session through the service-role-only
`patient_portal_photo_authorize` RPC, reads at most 5 MiB, checks the image MIME
type and its signature, rechecks the session, and uploads to a server-generated
`doctorId/patientId/randomUUID.ext` path. It does not issue a signed upload URL.
The signature check is not full image decoding or malware scanning.

The browser sends the portal token in the `x-patient-token` header over HTTPS.
Never log this header, request bodies, the service-role key, or photo data; redact
it in gateway, edge, proxy and observability logs. The function's service-role key
is supplied by the Supabase Edge runtime, never by the browser or this repository.
The function intentionally uses `--no-verify-jwt` because portal patients have
portal tokens, not Supabase Auth JWTs. The session RPC is the authorization gate;
verify that the function is deployed with it and that no other policy grants
anonymous writes to `patient-photos`. Do not rely on CORS as authorization.

## Deployment (after approval and review)

1. Review the existing database functions and Storage policies. Test first in an
   isolated project with synthetic data. Confirm the private bucket exists and
   has the expected size and MIME restrictions. Review rate limits and quotas.
2. Deploy this function to that project with Supabase CLI, e.g. after linking the
   intended project: `supabase functions deploy portal-photo-upload --no-verify-jwt`.
   The CLI bundles `index.ts` and `handler.mjs`; Supabase supplies `SUPABASE_URL`
   and `SUPABASE_SERVICE_ROLE_KEY` inside the function runtime.
3. Apply `sql/migrations/20261101_portal_photo_upload.sql` transactionally. It
   removes the previous direct upload policy and creates the authorization RPC.
   This migration does not remove unrelated permissive policies: audit them too.
4. Deploy the compatible web client. In a staging project test successful upload,
   invalid/expired/revoked tokens, RLS, session changes, doctor photo reads and
   measurement saves using real HTTP requests and synthetic images. Keep a
   rollback plan for the app, function and database before changing production.

The function checks the session twice, but the second check and Storage write
are not atomic: session revocation immediately after the check can race a write.
Uploads can also become orphaned if measurement saving fails or the user changes
session; a retention/cleanup design is separate work. Until real deployment and
end-to-end tests are completed, this code is not proof that uploads work in the
actual project. Existing portal login/OTP and rate-limiting risks are unchanged.
