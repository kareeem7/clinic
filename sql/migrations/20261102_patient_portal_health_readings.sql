-- Patient portal health-reading input. The browser never receives direct table
-- access: both RPCs resolve the patient from a live portal session, re-check
-- clinic status and patient-level feature flags, and keep source/time server-set.
begin;

alter table public.patient_health_readings
  add column if not exists portal_request_id uuid;
create unique index if not exists patient_health_readings_portal_request_uidx
  on public.patient_health_readings (patient_id, portal_request_id)
  where portal_request_id is not null;

create or replace function public.patient_portal_health_tracking(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s record;
  v_p record;
  v_settings jsonb;
  v_glucose boolean := false;
  v_pressure boolean := false;
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
  select settings into v_settings from public.doctors where id = v_s.doctor_id;
  v_glucose := coalesce(v_p.glucose_tracking_enabled, false)
    and coalesce(v_settings #>> '{clinicalFeatures,glucoseTracking}' = 'true', false);
  v_pressure := coalesce(v_p.blood_pressure_tracking_enabled, false)
    and coalesce(v_settings #>> '{clinicalFeatures,bloodPressureTracking}' = 'true', false);
  return jsonb_build_object('ok', true, 'glucose', v_glucose, 'bloodPressure', v_pressure);
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

  -- Time and source are always assigned by the server; clients cannot backdate
  -- a portal reading or claim it was entered by the clinic.
  insert into public.patient_health_readings (
    doctor_id, patient_id, reading_type, recorded_at, glucose_value, glucose_type,
    systolic, diastolic, pulse, source, portal_request_id
  ) values (
    v_s.doctor_id, v_s.patient_id, p_reading_type, now(), p_glucose_value, p_glucose_type,
    p_systolic, p_diastolic, p_pulse, 'patient', p_request_id
  ) on conflict (patient_id, portal_request_id) where portal_request_id is not null
    do nothing
  returning id into v_reading_id;

  if v_reading_id is null then
    select id, reading_type, glucose_value, glucose_type, systolic, diastolic, pulse
      into v_existing from public.patient_health_readings
      where doctor_id = v_s.doctor_id and patient_id = v_s.patient_id
        and portal_request_id = p_request_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'تعذّر التحقق من الطلب — ابدأ محاولة جديدة');
    end if;
    if v_existing.reading_type = p_reading_type
       and v_existing.glucose_value is not distinct from p_glucose_value
       and v_existing.glucose_type is not distinct from p_glucose_type
       and v_existing.systolic is not distinct from p_systolic
       and v_existing.diastolic is not distinct from p_diastolic
       and v_existing.pulse is not distinct from p_pulse then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'تعذّر إعادة الطلب بنفس البيانات — ابدأ محاولة جديدة');
  end if;

  -- Audit metadata is non-clinical; no reading values or type are recorded.
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-health-reading', 'patient_health_readings', v_reading_id,
            jsonb_build_object('via', 'portal'));
  return jsonb_build_object('ok', true, 'duplicate', false);
end; $$;

revoke all on function public.patient_portal_health_tracking(uuid) from public, anon, authenticated;
grant execute on function public.patient_portal_health_tracking(uuid) to anon, authenticated;
revoke all on function public.patient_portal_add_health_reading(uuid, uuid, text, numeric, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.patient_portal_add_health_reading(uuid, uuid, text, numeric, text, integer, integer, integer) to anon, authenticated;

commit;
