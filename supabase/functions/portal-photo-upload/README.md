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

## Deployment status (verified 2026-11-05)

**Already applied to the real project `clinicv2` — do not repeat.**
1. ✅ The function is deployed `ACTIVE` (v1, `verify_jwt = false`) through the
   Supabase Management API as the single-file `standalone.ts`; the CLI path uses
   `index.ts` + `handler.mjs`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   come from the Edge runtime, never from this repository.
2. ✅ `sql/migrations/20261101_portal_photo_upload.sql` is applied:
   `patient_portal_photo_authorize` is `service_role`-only and the permissive
   `anon` INSERT policy `portal_photo_insert` was removed. **Do not re-apply.**
3. ✅ The database schema, RPC grants and Storage policies were inspected via
   Management API. A fake token returned `{ok:false}` and wrote no rows.
4. ⬜ **Still pending:** real HTTP requests with synthetic images (success,
   invalid/expired/revoked token, >5 MiB, wrong MIME/signature), RLS with two
   synthetic clinics, doctor photo reads, session changes and measurement saves.
   Keep a rollback plan for the app, function and database before production.

The function checks the session twice, but the second check and Storage write
are not atomic: session revocation immediately after the check can race a write.
Uploads can also become orphaned if measurement saving fails or the user changes
session; a retention/cleanup design is separate work. Deployment alone is **not**
proof that uploads work end to end: `pg_cron`/Vault scheduling and a real HTTP
test with synthetic images are still required. Existing portal login/OTP and
rate-limiting risks are unchanged.
