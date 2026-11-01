-- Preserve the patient's height in each dated body-measurement record and
-- atomically persist new-patient baseline measurements. Additive and safe to
-- re-run; existing records receive NULL and remain unchanged.
begin;

alter table public.patient_records add column if not exists height numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.patient_records'::regclass
      and conname = 'patient_records_height_range'
  ) then
    alter table public.patient_records add constraint patient_records_height_range
      check (height is null or height between 80 and 230);
  end if;
end $$;

create or replace function public.create_patient_with_measurements(
  p_patient jsonb,
  p_measurements jsonb default '[]'::jsonb
)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_pid uuid;
  m jsonb;
  v_ret jsonb;
  v_out jsonb := '[]'::jsonb;
  v_date date;
  v_height numeric;
  v_weight numeric;
  v_waist numeric;
  v_hips numeric;
  v_arm numeric;
  v_bmi numeric;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if jsonb_typeof(coalesce(p_measurements, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'invalid measurements' using errcode = '22023';
  end if;

  insert into public.patients (
    doctor_id, name, phone, age, gender, type, status, height, target_weight,
    plan_id, plan_start, plan_end, diagnosis, notes, chronic, birth_date, consent_whatsapp
  ) values (
    auth.uid(),
    p_patient->>'name', p_patient->>'phone',
    nullif(p_patient->>'age', '')::int, p_patient->>'gender', p_patient->>'type',
    coalesce(nullif(p_patient->>'status', ''), 'active'),
    nullif(p_patient->>'height', '')::numeric,
    nullif(p_patient->>'targetWeight', '')::numeric,
    nullif(p_patient->>'planId', '')::uuid,
    nullif(p_patient->>'planStart', '')::date,
    nullif(p_patient->>'planEnd', '')::date,
    p_patient->>'diagnosis', p_patient->>'notes',
    coalesce(p_patient->'chronic', '[]'::jsonb),
    nullif(p_patient->>'birthDate', '')::date,
    coalesce(nullif(p_patient->>'consentWa', '')::boolean, false)
  ) returning id into v_pid;

  for m in select value from jsonb_array_elements(coalesce(p_measurements, '[]'::jsonb)) loop
    v_date := coalesce(nullif(m->>'date', '')::date, (now() at time zone 'Africa/Cairo')::date);
    v_height := nullif(m->>'height', '')::numeric;
    v_weight := nullif(m->>'weight', '')::numeric;
    v_waist := nullif(m->>'waist', '')::numeric;
    v_hips := nullif(m->>'hips', '')::numeric;
    v_arm := nullif(m->>'arm', '')::numeric;

    if v_date > (now() at time zone 'Africa/Cairo')::date
       or (v_height is not null and v_height not between 80 and 230)
       or (v_weight is not null and v_weight not between 20 and 350)
       or (v_waist is not null and v_waist not between 40 and 200)
       or (v_hips is not null and v_hips not between 50 and 220)
       or (v_arm is not null and v_arm not between 20 and 120) then
      raise exception 'invalid baseline measurements' using errcode = '22023';
    end if;

    -- Never trust a client-supplied/stale BMI; calculate the persisted value
    -- from the weight and height in this same dated record.
    v_bmi := case when v_weight is not null and v_height is not null
      then round(v_weight / power(v_height / 100, 2), 1) else null end;

    insert into public.patient_records (
      doctor_id, patient_id, date, height, weight, waist, hips, arm, bmi,
      session, pain, note, source, record_type
    ) values (
      auth.uid(), v_pid, v_date, v_height, v_weight, v_waist, v_hips, v_arm, v_bmi,
      nullif(m->>'session', '')::int, nullif(m->>'pain', '')::int,
      coalesce(m->>'note', ''), 'clinic', 'manual'
    ) returning jsonb_build_object('id', id, 'date', date) into v_ret;
    v_out := v_out || v_ret;
  end loop;

  return jsonb_build_object('ok', true, 'patientId', v_pid, 'records', v_out);
end; $$;

commit;
