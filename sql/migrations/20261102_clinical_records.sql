-- Additive clinical-record storage for measurements, InBody, lab panels and
-- home glucose/blood-pressure readings. Safe to re-run; preserves all rows.
-- Apply only after reviewing against the target Supabase schema. No patient
-- portal RPC is added here: anonymous access remains closed in this phase.
begin;

-- Keep the existing patient_records table as the canonical dated measurement
-- history. fat remains the existing body-fat percentage field.
alter table public.patient_records
  add column if not exists bmi numeric,
  add column if not exists body_fat_mass numeric,
  add column if not exists skeletal_muscle_mass numeric,
  add column if not exists visceral_fat_level numeric,
  add column if not exists body_water_pct numeric,
  add column if not exists record_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_records_bmi_range') then
    alter table public.patient_records add constraint patient_records_bmi_range
      check (bmi is null or bmi between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_records_body_fat_mass_nonnegative') then
    alter table public.patient_records add constraint patient_records_body_fat_mass_nonnegative
      check (body_fat_mass is null or body_fat_mass between 0 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_records_skeletal_muscle_nonnegative') then
    alter table public.patient_records add constraint patient_records_skeletal_muscle_nonnegative
      check (skeletal_muscle_mass is null or skeletal_muscle_mass between 0 and 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_records_visceral_fat_nonnegative') then
    alter table public.patient_records add constraint patient_records_visceral_fat_nonnegative
      check (visceral_fat_level is null or visceral_fat_level between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_records_body_water_pct_range') then
    alter table public.patient_records add constraint patient_records_body_water_pct_range
      check (body_water_pct is null or body_water_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_records_record_type_valid') then
    alter table public.patient_records add constraint patient_records_record_type_valid
      check (record_type is null or record_type in ('manual', 'inbody', 'physio'));
  end if;
end $$;

-- A lab panel is one dated record with one or more named components in JSONB.
-- Each component is {name, value, unit?}; value may be numeric or text.
create or replace function public.patient_lab_results_valid(p_results jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare c jsonb;
begin
  if p_results is null or jsonb_typeof(p_results) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_results) < 1 or jsonb_array_length(p_results) > 100 then
    return false;
  end if;
  for c in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(c) is distinct from 'object'
       or c->>'name' is null
       or char_length(btrim(c->>'name')) not between 1 and 100
       or c->'value' is null
       or jsonb_typeof(c->'value') not in ('number', 'string')
       or (jsonb_typeof(c->'value') = 'string' and char_length(c->>'value') > 500)
       or (c ? 'unit' and (jsonb_typeof(c->'unit') is distinct from 'string'
                           or char_length(c->>'unit') > 40)) then
      return false;
    end if;
  end loop;
  return true;
end $$;
revoke all on function public.patient_lab_results_valid(jsonb) from public, anon;
grant execute on function public.patient_lab_results_valid(jsonb) to authenticated;

create table if not exists public.patient_labs (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  test_name text not null check (char_length(btrim(test_name)) between 1 and 160),
  tested_on date not null default (now() at time zone 'Africa/Cairo')::date,
  results jsonb not null default '[]'::jsonb,
  source text not null default 'clinic' check (source in ('clinic', 'patient')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint patient_labs_patient_same_doctor foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id) on delete cascade,
  constraint patient_labs_results_valid check (public.patient_lab_results_valid(results))
);

-- Independent, timestamped readings support multiple readings per day and
-- explicitly distinguish clinic-entered from patient-portal-entered records.
create table if not exists public.patient_health_readings (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  reading_type text not null check (reading_type in ('glucose', 'blood_pressure')),
  recorded_at timestamptz not null default now(),
  glucose_value numeric,
  glucose_type text check (glucose_type is null or glucose_type in ('fasting', 'post_meal', 'random')),
  systolic integer,
  diastolic integer,
  pulse integer,
  source text not null default 'clinic' check (source in ('clinic', 'patient')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint patient_health_readings_patient_same_doctor foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id) on delete cascade,
  constraint patient_health_readings_shape check (
    (reading_type = 'glucose'
      and glucose_value is not null
      and glucose_value between 1 and 2000
      and glucose_type is not null
      and systolic is null and diastolic is null and pulse is null)
    or
    (reading_type = 'blood_pressure'
      and systolic is not null
      and systolic between 1 and 400
      and diastolic is not null
      and diastolic between 1 and 300
      and (pulse is null or pulse between 1 and 400)
      and glucose_value is null and glucose_type is null)
  )
);

create index if not exists patient_labs_live_patient_date_idx
  on public.patient_labs (doctor_id, patient_id, tested_on desc, id)
  where deleted_at is null;
create index if not exists patient_health_readings_live_patient_time_idx
  on public.patient_health_readings (doctor_id, patient_id, recorded_at desc, id)
  where deleted_at is null;

alter table public.patient_labs enable row level security;
alter table public.patient_health_readings enable row level security;

-- Authenticated doctors with a verified MFA session may access only rows for
-- their own active clinic. No direct anon table access is granted; a later
-- portal phase must use narrowly scoped token-validated SECURITY DEFINER RPCs.
revoke all on public.patient_labs from anon, public;
revoke all on public.patient_health_readings from anon, public;
grant select, insert, update, delete on public.patient_labs to authenticated;
grant select, insert, update, delete on public.patient_health_readings to authenticated;

drop policy if exists patient_labs_own on public.patient_labs;
create policy patient_labs_own on public.patient_labs
  for all to authenticated
  using (auth.uid() = doctor_id and public.clinic_active(auth.uid())
         and (auth.jwt()->>'aal') = 'aal2')
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid())
              and (auth.jwt()->>'aal') = 'aal2');
drop policy if exists patient_health_readings_own on public.patient_health_readings;
create policy patient_health_readings_own on public.patient_health_readings
  for all to authenticated
  using (auth.uid() = doctor_id and public.clinic_active(auth.uid())
         and (auth.jwt()->>'aal') = 'aal2')
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid())
              and (auth.jwt()->>'aal') = 'aal2');

-- A separate restrictive MFA policy prevents a later permissive policy from
-- accidentally bypassing MFA for either newly introduced medical table.
drop policy if exists require_mfa on public.patient_labs;
create policy require_mfa on public.patient_labs as restrictive for all to authenticated
  using ((auth.jwt()->>'aal') = 'aal2')
  with check ((auth.jwt()->>'aal') = 'aal2');
drop policy if exists require_mfa on public.patient_health_readings;
create policy require_mfa on public.patient_health_readings as restrictive for all to authenticated
  using ((auth.jwt()->>'aal') = 'aal2')
  with check ((auth.jwt()->>'aal') = 'aal2');

commit;
