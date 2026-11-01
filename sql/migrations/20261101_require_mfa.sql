-- Require a verified MFA session for doctor and admin data access.
-- Run as a single transaction after reviewing the existing Supabase policies.
-- Portal RPCs use their patient session token and intentionally remain usable by anon.
-- Deploy the matching app (registration uses INSERT, not UPSERT) before this SQL.
-- Review all existing policies/functions and test JWT, MFA and portal flows before production.
begin;

-- Restrictive policies are ANDed with every permissive policy. They cover
-- existing and future permissive policies for the authenticated role.
do $$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'patient_records', 'patient_notes', 'plans',
                            'audit_logs', 'superadmins', 'admin_notes', 'system_settings'] loop
    execute format('drop policy if exists require_mfa on public.%I', t);
    execute format('create policy require_mfa on public.%I as restrictive for all to authenticated using ((auth.jwt()->>''aal'') = ''aal2'') with check ((auth.jwt()->>''aal'') = ''aal2'')', t);
  end loop;
end $$;

-- The initial registration insert occurs before TOTP enrollment. Reads,
-- updates and deletes of a doctor profile still require MFA.
drop policy if exists require_mfa_select on public.doctors;
create policy require_mfa_select on public.doctors as restrictive for select to authenticated
  using ((auth.jwt()->>'aal') = 'aal2');
drop policy if exists require_mfa_update on public.doctors;
create policy require_mfa_update on public.doctors as restrictive for update to authenticated
  using ((auth.jwt()->>'aal') = 'aal2') with check ((auth.jwt()->>'aal') = 'aal2');
drop policy if exists require_mfa_delete on public.doctors;
create policy require_mfa_delete on public.doctors as restrictive for delete to authenticated
  using ((auth.jwt()->>'aal') = 'aal2');

-- Limit only photo reads, not patient-portal uploads or unrelated buckets.
drop policy if exists require_mfa_photo_read on storage.objects;
create policy require_mfa_photo_read on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'patient-photos' or (auth.jwt()->>'aal') = 'aal2');

-- SECURITY DEFINER functions bypass table RLS, so their own checks are required.
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(auth.jwt()->>'aal' = 'aal2', false)
  and exists (select 1 from public.superadmins where id = auth.uid()) $$;

create or replace function public.save_clinic_settings(patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  update public.doctors
  set settings = coalesce(settings, '{}'::jsonb) || (coalesce(patch, '{}'::jsonb) - 'account')
  where id = auth.uid();
end; $$;

commit;
