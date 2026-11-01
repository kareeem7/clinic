-- Validate new patient photo references against the session and storage metadata.
-- Review the existing function and test the portal before deploying to production.
-- This does not change upload policies or repair a blocked upload.
begin;

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
declare v_s record; v_date date;
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

  insert into public.patient_records (doctor_id, patient_id, date, weight, waist, hips, arm, note, photo_path, source)
    values (v_s.doctor_id, v_s.patient_id, v_date, p_weight, p_waist, p_hips, p_arm,
            left(p_note, 500), nullif(p_photo_path, ''), 'patient');   -- source forced here

  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-measure', 'patient_records', null,
            jsonb_build_object('via', 'portal', 'submitted', 'full'));

  return jsonb_build_object('ok', true);
end; $$;

commit;
