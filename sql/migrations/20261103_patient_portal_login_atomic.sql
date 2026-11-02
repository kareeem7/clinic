-- Serialize portal login attempts by normalized phone so concurrent failures
-- cannot race past the per-phone lockout. This intermediate function is
-- intentionally not executable until the verified-OTP migration is applied.
begin;

create or replace function public.patient_portal_login(p_phone text, p_birth date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p record; v_tok uuid; v_settings jsonb; v_key text; v_n bigint;
begin
  v_key := public.norm_phone_eg(p_phone);
  if v_key is null or btrim(v_key) = '' then
    return jsonb_build_object('ok', false, 'error', 'رقم التليفون أو تاريخ الميلاد غير صحيحين — تأكد منهم أو اسأل عيادتك تشغّل حسابك');
  end if;

  -- Serialize checks and writes for this normalized phone for the duration
  -- of this RPC transaction, so concurrent failures cannot pass the limit.
  perform pg_advisory_xact_lock(hashtextextended('patient-portal-login:' || v_key, 0));

  -- قفل التخمين: 5 محاولات فاشلة خلال 15 دقيقة = رفض مؤقت
  if (select count(*) from public.portal_login_attempts
       where phone_key = v_key
         and tried_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'محاولات دخول كتير فشلت — استنى 15 دقيقة ثم حاول تاني');
  end if;
  -- housekeeping: forget attempts older than a day
  delete from public.portal_login_attempts where tried_at < now() - interval '1 day';

  -- (بند 8) المطابقة لازم تكون فريدة: نفس التليفون + تاريخ الميلاد ممكن
  -- يتكرر لأكثر من مريض (رقم عائلي، أو تسجيل بنفس البيانات في عيادتين).
  -- ما نختارش صفاً عشوائياً ونفتح ملف غلط — نرفض بنفس الرسالة العامة
  -- (صفر تلميحات enumeration)، نسجّل الواقعة في audit، وتُحسب محاولة فاشلة.
  select count(*) into v_n from public.patients
   where birth_date = p_birth
     and public.norm_phone_eg(phone) = v_key
     and deleted_at is null;
  if v_n > 1 then
    insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
      select doctor_id, 'patient-login-denied', 'patients', null,
             jsonb_build_object('via', 'portal', 'issue', 'duplicate-match')
      from public.patients
      where birth_date = p_birth and public.norm_phone_eg(phone) = v_key and deleted_at is null
      order by doctor_id limit 1;
    insert into public.portal_login_attempts (phone_key) values (v_key);
    return jsonb_build_object('ok', false, 'error', 'رقم التليفون أو تاريخ الميلاد غير صحيحين — تأكد منهم أو اسأل عيادتك تشغّل حسابك');
  end if;

  select * into v_p from public.patients
   where birth_date = p_birth
     and public.norm_phone_eg(phone) = v_key
     and deleted_at is null;
  if not found then
    -- سجّل المحاولة الفاشلة ثم ارجع نفس الرسالة العامة (بدون تلميحات)
    insert into public.portal_login_attempts (phone_key) values (v_key);
    return jsonb_build_object('ok', false, 'error', 'رقم التليفون أو تاريخ الميلاد غير صحيحين — تأكد منهم أو اسأل عيادتك تشغّل حسابك');
  end if;
  -- عيادة موقوفة أو اشتراكها منتهي → البوابة مقفولة (البيانات صح لكن الخدمة لا)
  if not public.clinic_active(v_p.doctor_id) then
    return jsonb_build_object('ok', false, 'error', 'العيادة مش متاحة حالياً — تواصل مع عيادتك للمتابعة');
  end if;

  -- نجاح: امسح المحاولات الفاشلة السابقة لهذا الرقم
  delete from public.portal_login_attempts where phone_key = v_key;
  -- housekeeping: drop expired tokens
  delete from public.patient_sessions where expires_at < now();
  insert into public.patient_sessions (patient_id, doctor_id) values (v_p.id, v_p.doctor_id)
    returning token into v_tok;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_p.doctor_id, 'patient-login', 'patients', v_p.id, jsonb_build_object('via', 'portal'));
  select settings into v_settings from public.doctors where id = v_p.doctor_id;
  return jsonb_build_object('ok', true, 'token', v_tok,
    'patient', jsonb_build_object('id', v_p.id, 'doctorId', v_p.doctor_id, 'name', v_p.name, 'type', v_p.type, 'height', v_p.height,
      'targetWeight', v_p.target_weight, 'planStart', v_p.plan_start, 'planEnd', v_p.plan_end, 'planId', v_p.plan_id),
    'clinic', jsonb_build_object('doctorName', coalesce(v_settings->>'doctorName',''),
      'clinicName', coalesce(v_settings->>'clinicName',''), 'phone', coalesce(v_settings->>'phone','')));
end; $$;

revoke all on function public.patient_portal_login(text, date) from public, anon, authenticated;
-- No EXECUTE grant here: only 20261105_patient_portal_phone_otp.sql re-enables login.

commit;
