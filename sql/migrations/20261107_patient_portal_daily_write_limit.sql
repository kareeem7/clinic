-- Enforce an atomic per-patient daily portal-write ceiling across home
-- measurements and glucose/blood-pressure readings (Cairo calendar day).
begin;

-- Older clinic schemas may not have a record creation timestamp. Keep legacy
-- rows NULL rather than backdating them or counting them as today's writes;
-- the portal RPC below stamps every new patient-submitted measurement.
alter table public.patient_records
  add column if not exists created_at timestamptz;

create index if not exists patient_records_portal_daily_limit_idx
  on public.patient_records (patient_id, created_at) where source = 'patient';
create index if not exists patient_health_readings_portal_daily_limit_idx
  on public.patient_health_readings (patient_id, created_at) where source = 'patient';

create or replace function public.patient_portal_add_measurement(
  p_token uuid,
  p_weight numeric,
  p_waist numeric default null,
  p_hips numeric default null,
  p_arm numeric default null,
  p_note text default '',
  p_date date default null,
  p_photo_path text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record; v_date date; v_today date; v_daily_count bigint;
begin
  select * into v_s from public.patient_sessions where token = p_token and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'انتهت جلستك — سجّل دخولك من جديد'); end if;
  -- Existing tokens must not bypass a suspended clinic or a soft-deleted patient.
  if not public.clinic_active(v_s.doctor_id) or not exists (
    select 1 from public.patients p
    where p.id = v_s.patient_id and p.doctor_id = v_s.doctor_id and p.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;

  -- server-side validation (matches the phase rules)
  if p_weight is null or p_weight < 30 or p_weight > 250 then
    return jsonb_build_object('ok', false, 'error', 'اكتب وزن بين 30 و 250 كجم');
  end if;
  if (p_waist is not null and (p_waist < 30 or p_waist > 200))
   or (p_hips is not null and (p_hips < 30 or p_hips > 200))
   or (p_arm  is not null and (p_arm  < 30 or p_arm  > 200)) then
    return jsonb_build_object('ok', false, 'error', 'اكتب محيط بين 30 و 200 سم');
  end if;
  if char_length(p_note) > 500 then
    return jsonb_build_object('ok', false, 'error', 'الملاحظة طويلة قوي — اختصرها');
  end if;

  -- date must be today or within the last 7 days (Cairo), never the future
  v_date := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  if v_date > (now() at time zone 'Africa/Cairo')::date
     or v_date < (now() at time zone 'Africa/Cairo')::date - interval '7 days' then
    return jsonb_build_object('ok', false, 'error', 'التاريخ لازم يكون النهارده أو خلال آخر أسبوع');
  end if;

  v_today := (now() at time zone 'Africa/Cairo')::date;
  perform pg_advisory_xact_lock(hashtextextended(
    'patient-portal-daily-writes:' || v_s.patient_id::text || ':' || v_today::text, 0));
  select
    (select count(*) from public.patient_records r
      where r.patient_id = v_s.patient_id and r.doctor_id = v_s.doctor_id
        and r.source = 'patient' and (r.created_at at time zone 'Africa/Cairo')::date = v_today)
    +
    (select count(*) from public.patient_health_readings h
      where h.patient_id = v_s.patient_id and h.doctor_id = v_s.doctor_id
        and h.source = 'patient' and (h.created_at at time zone 'Africa/Cairo')::date = v_today)
    into v_daily_count;
  if v_daily_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'وصلت للحد اليومي المسموح به وهو 20 قراءة؛ حاول غدًا أو تواصل مع العيادة.');
  end if;

  -- The reference must point to an existing object under this session's
  -- doctor and patient, not an arbitrary path supplied by the client.
  if coalesce(p_photo_path, '') <> '' and (
       split_part(p_photo_path, '/', 1) <> v_s.doctor_id::text
    or split_part(p_photo_path, '/', 2) <> v_s.patient_id::text
    or split_part(p_photo_path, '/', 3) = ''
    or not exists (select 1 from storage.objects o
                   where o.bucket_id = 'patient-photos' and o.name = p_photo_path)
  ) then
    return jsonb_build_object('ok', false, 'error', 'تعذّر التحقق من الصورة — حاول رفعها مجدداً');
  end if;

  insert into public.patient_records (doctor_id, patient_id, date, weight, waist, hips, arm, note, photo_path, source, created_at)
    values (v_s.doctor_id, v_s.patient_id, v_date, p_weight, p_waist, p_hips, p_arm,
            left(p_note, 500), nullif(p_photo_path, ''), 'patient', now());   -- source and creation time are server-assigned

  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-measure', 'patient_records', null,
            jsonb_build_object('via', 'portal', 'submitted', 'full'));

  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.patient_portal_add_health_reading(
  p_token uuid,
  p_request_id uuid,
  p_reading_type text,
  p_glucose_value numeric,
  p_glucose_type text,
  p_systolic integer,
  p_diastolic integer,
  p_pulse integer
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s record;
  v_p record;
  v_settings jsonb;
  v_reading_id uuid;
  v_existing record;
  v_allowed boolean := false;
  v_alert text;
  v_today date;
  v_daily_count bigint;
begin
  select * into v_s from public.patient_sessions
    where token = p_token and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'انتهت جلستك — سجّل دخولك من جديد');
  end if;
  if not public.clinic_active(v_s.doctor_id) then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;
  select * into v_p from public.patients
    where id = v_s.patient_id and doctor_id = v_s.doctor_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;
  if p_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'تعذّر التحقق من الطلب — أعد المحاولة');
  end if;
  select settings into v_settings from public.doctors where id = v_s.doctor_id;

  if p_reading_type = 'glucose' then
    v_allowed := coalesce(v_p.glucose_tracking_enabled, false)
      and coalesce(v_settings #>> '{clinicalFeatures,glucoseTracking}' = 'true', false);
    if not v_allowed then
      return jsonb_build_object('ok', false, 'error', 'هذا النوع من المتابعة غير مفعّل لهذا الملف');
    end if;
    if p_glucose_value is null or p_glucose_value < 1 or p_glucose_value > 2000
       or p_glucose_type is null or p_glucose_type not in ('fasting', 'post_meal', 'random')
       or p_systolic is not null or p_diastolic is not null or p_pulse is not null then
      return jsonb_build_object('ok', false, 'error', 'تحقق من قيمة السكر ونوع القراءة');
    end if;
  elsif p_reading_type = 'blood_pressure' then
    v_allowed := coalesce(v_p.blood_pressure_tracking_enabled, false)
      and coalesce(v_settings #>> '{clinicalFeatures,bloodPressureTracking}' = 'true', false);
    if not v_allowed then
      return jsonb_build_object('ok', false, 'error', 'هذا النوع من المتابعة غير مفعّل لهذا الملف');
    end if;
    if p_systolic is null or p_systolic < 1 or p_systolic > 400
       or p_diastolic is null or p_diastolic < 1 or p_diastolic > 300
       or (p_pulse is not null and (p_pulse < 1 or p_pulse > 400))
       or p_glucose_value is not null or p_glucose_type is not null then
      return jsonb_build_object('ok', false, 'error', 'تحقق من قيم الضغط والنبض');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'نوع القراءة غير صالح');
  end if;

  v_today := (now() at time zone 'Africa/Cairo')::date;
  perform pg_advisory_xact_lock(hashtextextended(
    'patient-portal-daily-writes:' || v_s.patient_id::text || ':' || v_today::text, 0));
  select
    (select count(*) from public.patient_records r
      where r.patient_id = v_s.patient_id and r.doctor_id = v_s.doctor_id
        and r.source = 'patient' and (r.created_at at time zone 'Africa/Cairo')::date = v_today)
    +
    (select count(*) from public.patient_health_readings h
      where h.patient_id = v_s.patient_id and h.doctor_id = v_s.doctor_id
        and h.source = 'patient' and (h.created_at at time zone 'Africa/Cairo')::date = v_today
        and h.portal_request_id is distinct from p_request_id)
    into v_daily_count;
  if v_daily_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'وصلت للحد اليومي المسموح به وهو 20 قراءة؛ حاول غدًا أو تواصل مع العيادة.');
  end if;

  if p_reading_type = 'glucose' then
    if p_glucose_value < 54 then v_alert := 'glucose_critical_low';
    elsif p_glucose_value < 70 then v_alert := 'glucose_low'; end if;
  elsif p_systolic > 180 or p_diastolic > 120 then
    v_alert := 'blood_pressure_very_high';
  end if;

  -- Time and source are always assigned by the server; clients cannot backdate
  -- a portal reading or claim it was entered by the clinic.
  insert into public.patient_health_readings (
    doctor_id, patient_id, reading_type, recorded_at, glucose_value, glucose_type, glucose_unit,
    systolic, diastolic, pulse, source, portal_request_id
  ) values (
    v_s.doctor_id, v_s.patient_id, p_reading_type, now(), p_glucose_value, p_glucose_type,
    case when p_reading_type = 'glucose' then 'mg/dL' else null end,
    p_systolic, p_diastolic, p_pulse, 'patient', p_request_id
  ) on conflict (patient_id, portal_request_id) where portal_request_id is not null
    do nothing
  returning id into v_reading_id;

  if v_reading_id is null then
    select id, reading_type, glucose_value, glucose_type, glucose_unit, systolic, diastolic, pulse
      into v_existing from public.patient_health_readings
      where doctor_id = v_s.doctor_id and patient_id = v_s.patient_id
        and portal_request_id = p_request_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'تعذّر التحقق من الطلب — ابدأ محاولة جديدة');
    end if;
    if v_existing.reading_type = p_reading_type
       and v_existing.glucose_value is not distinct from p_glucose_value
       and v_existing.glucose_type is not distinct from p_glucose_type
       and v_existing.glucose_unit is not distinct from (case when p_reading_type = 'glucose' then 'mg/dL' else null end)
       and v_existing.systolic is not distinct from p_systolic
       and v_existing.diastolic is not distinct from p_diastolic
       and v_existing.pulse is not distinct from p_pulse then
      return jsonb_build_object('ok', true, 'duplicate', true, 'alert', v_alert);
    end if;
    return jsonb_build_object('ok', false, 'error', 'تعذّر إعادة الطلب بنفس البيانات — ابدأ محاولة جديدة');
  end if;

  -- Audit metadata is non-clinical; no reading values or type are recorded.
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-health-reading', 'patient_health_readings', v_reading_id,
            jsonb_build_object('via', 'portal'));
  return jsonb_build_object('ok', true, 'duplicate', false, 'alert', v_alert);
end; $$;

commit;
