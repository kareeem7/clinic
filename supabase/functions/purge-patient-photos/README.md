# Purge permanently deleted patient photos

`sql/migrations/20261106_patient_photo_cleanup_queue.sql` installs a database
trigger that queues an object's Storage path when its `patient_records` row is
hard-deleted or the photo is replaced. Soft-deleted/archived rows do not lose
their images. The existing 30-day database purge hard-deletes old records; the
trigger catches those deletes (including patient-row cascades). The worker then
uses the Storage API to remove the binary object and acknowledges the queue.
It never deletes rows from `storage.objects` directly.

The worker is idempotent and processes up to 100 paths per request. It accepts
only `POST`, requires the service-role JWT both at the Edge gateway and in the
handler, validates the server-generated UUID path shape, and returns counts
only. It does not log file paths, patient IDs, or credentials.

## Required deployment sequence (staging first)

1. Apply the database migration in an isolated Supabase project with synthetic
   records and images. Verify that a soft delete leaves the object in place and
   that a hard delete creates one queue row per attached image. Verify cascade
   deletion and photo replacement too.
2. Deploy the worker: `supabase functions deploy purge-patient-photos`.
   Keep `[functions.purge-patient-photos].verify_jwt = true` in
   `supabase/config.toml`. The runtime reads the service-role key only from the
   Edge Function environment.
3. Configure protected scheduling. Enable `pg_cron`, `pg_net`, and Vault; store
   the project URL as Vault secret `clinic_project_url` and the service-role JWT
   as Vault secret `clinic_service_role_key`. Never put the key in Git, app
   JavaScript, cron command text, logs, or chat.
4. Schedule a POST every 15 minutes (or after the 3:00 AM database purge) using
   the following SQL. The cron command reads the secrets at runtime, rather than
   embedding their values in `cron.job.command`:

   ```sql
   select cron.schedule(
     'purge-patient-photo-storage',
     '*/15 * * * *',
     $job$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'clinic_project_url')
              || '/functions/v1/purge-patient-photos',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'clinic_service_role_key'),
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'clinic_service_role_key')
       ),
       body := '{}'::jsonb
     );
     $job$
   );
   ```

5. Test a real HTTP invocation in staging and verify the Storage object is gone,
   its queue entry is cleared, and a rejected/failed Storage request leaves the
   queue entry for retry. Monitor aggregate processed/failure counts only.

Until the migration, worker, secrets, schedule and staging checks are completed
in the actual project, this repository change alone does not mean photos are
being removed from deployed Storage.
