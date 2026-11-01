-- Authorize photo uploads only through the server-side Edge Function.
-- Deploy the function first; coordinate this migration with the compatible app release.
-- Review existing policies and test the complete flow in isolation before production.
begin;

drop policy if exists portal_photo_insert on storage.objects;

create or replace function public.patient_portal_photo_authorize(p_token uuid)
returns table (doctor_id uuid, patient_id uuid)
language sql stable security definer set search_path = public as $$
  select s.doctor_id, s.patient_id
  from public.patient_sessions s
  join public.patients p on p.id = s.patient_id and p.doctor_id = s.doctor_id
  where s.token = p_token and s.expires_at > now()
    and p.deleted_at is null and public.clinic_active(s.doctor_id)
$$;
revoke all on function public.patient_portal_photo_authorize(uuid) from public, anon, authenticated;
grant execute on function public.patient_portal_photo_authorize(uuid) to service_role;

commit;
