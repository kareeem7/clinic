-- Add a patient-token-scoped read RPC for clinic-entered lab results and
-- glucose / blood-pressure history. The portal has no direct table grants.
begin;

create or replace function public.patient_portal_clinical_history(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s record;
  v_patient record;
  v_settings jsonb;
  v_glucose_enabled boolean := false;
  v_pressure_enabled boolean := false;
  v_labs jsonb := '[]'::jsonb;
  v_readings jsonb := '[]'::jsonb;
begin
  select * into v_s
    from public.patient_sessions
    where token = p_token and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'انتهت جلستك — سجّل دخولك من جديد');
  end if;

  if not public.clinic_active(v_s.doctor_id) then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;

  select p.* into v_patient
    from public.patients p
    where p.id = v_s.patient_id
      and p.doctor_id = v_s.doctor_id
      and p.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;

  select d.settings into v_settings
    from public.doctors d
    where d.id = v_s.doctor_id;
  v_glucose_enabled := coalesce(v_patient.glucose_tracking_enabled, false)
    and coalesce(v_settings #>> '{clinicalFeatures,glucoseTracking}' = 'true', false);
  v_pressure_enabled := coalesce(v_patient.blood_pressure_tracking_enabled, false)
    and coalesce(v_settings #>> '{clinicalFeatures,bloodPressureTracking}' = 'true', false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'testName', l.test_name,
    'testedOn', l.tested_on,
    'results', l.results,
    'source', l.source
  ) order by l.tested_on desc, l.created_at desc, l.id), '[]'::jsonb)
    into v_labs
    from public.patient_labs l
    where l.patient_id = v_s.patient_id
      and l.doctor_id = v_s.doctor_id
      and l.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'readingType', h.reading_type,
    'recordedAt', h.recorded_at,
    'glucoseValue', h.glucose_value,
    'glucoseType', h.glucose_type,
    'glucoseUnit', h.glucose_unit,
    'systolic', h.systolic,
    'diastolic', h.diastolic,
    'pulse', h.pulse,
    'source', h.source
  ) order by h.recorded_at desc, h.id), '[]'::jsonb)
    into v_readings
    from public.patient_health_readings h
    where h.patient_id = v_s.patient_id
      and h.doctor_id = v_s.doctor_id
      and h.deleted_at is null
      and ((h.reading_type = 'glucose' and v_glucose_enabled)
        or (h.reading_type = 'blood_pressure' and v_pressure_enabled));

  -- Audit only the scope; never copy lab names or measurement values to logs.
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-view', 'patient_records', null,
            jsonb_build_object('via', 'portal', 'scope', 'clinical-history'));

  return jsonb_build_object('ok', true, 'labs', v_labs, 'readings', v_readings);
end; $$;

revoke all on function public.patient_portal_clinical_history(uuid) from public, anon, authenticated;
grant execute on function public.patient_portal_clinical_history(uuid) to anon, authenticated;

commit;
