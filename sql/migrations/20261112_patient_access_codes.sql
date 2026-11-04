-- =====================================================================
-- PHASE 20 (الدفعة ٢): كود الدخول الدائم لكل مريض
-- ---------------------------------------------------------------------
-- القرارات المُسجّلة:
--   * الكود **دائم**: المريض يدخل بيه كل مرة، و**لا يوجد زر تغيير إطلاقاً**.
--   * البادئة (clinics.code) يختارها الدكتور، فريدة عالمياً، وتُقفل بعد
--     إصدار أول كود عشان الكرارت المطبوعة ما تبطلش.
--   * الدكتور لوج واحد لكل فروعه؛ المريض ممكن يبقى له أكتر من لوج إن.
--   * الكود يُخزَّن كما هو (قرار صريح من صاحب المشروع) عشان يظهر للدكتور
--     في ملف المريض وللمريض دائماً داخل البوابة «عشان يفضل فاكره».
--     ⚠️ النتيجة: أي جهة تقرأ الداتابيز مباشرة تقدر تدخل كأي مريض.
--     الحماية هنا هي: الجدول بلا أي سياسة RLS + كل الوصول عبر RPC
--     security definer مُقيّدة بالجلسة/بحساب الدكتور + قفل تخمين + تدقيق.
--
-- هذا الترحيل يُلغي مسار «رقم + تاريخ ميلاد» نهائياً: الدالة القديمة
-- تُحذف، والدالة الجديدة (text, text) هي الوحيدة الممنوحة لـ anon.
-- ترحيلات 20261103 / 20261105 / 20261109 تبقى ملفات تاريخية (انظر README).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) اختيار بادئة الفرع: الدكتور فقط، صيغة ثابتة، فريدة عالمياً،
--    قابلة للتصحيح لحد ما أول كود مريض يصدر، وبعدها تُقفل.
-- ---------------------------------------------------------------------
create or replace function public.set_clinic_prefix(p_clinic_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text; v_old text; v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'لازم تسجل دخولك كدكتور أولاً');
  end if;
  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code !~ '^[A-Z0-9]{2,12}$' then
    return jsonb_build_object('ok', false, 'error', 'البادئة لازم تكون من 2 إلى 12 حرف إنجليزي كبير أو رقم، بدون مسافات');
  end if;
  select c.code into v_old from public.clinics c
   where c.id = p_clinic_id and c.doctor_id = v_uid and c.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'الفرع غير موجود أو مش تابع لحسابك');
  end if;
  if exists (select 1 from public.clinics where code = v_code and id <> p_clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'البادئة دي مستخدمة في عيادة تانية — اختار غيرها');
  end if;
  if v_old is not null and v_old <> v_code
     and exists (select 1 from public.patient_portal_credentials where clinic_id = p_clinic_id) then
    return jsonb_build_object('ok', false, 'error', 'البادئة اتقفلت بعد إصدار أول كود مريض');
  end if;
  update public.clinics set code = v_code where id = p_clinic_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (v_uid, 'clinic-prefix-set', 'clinics', p_clinic_id,
          jsonb_build_object('via', 'clinic', 'prefix', v_code));
  return jsonb_build_object('ok', true, 'code', v_code);
end; $$;

revoke all on function public.set_clinic_prefix(uuid, text) from public, anon, authenticated;
grant execute on function public.set_clinic_prefix(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) جدول الكودات: RLS مفعّل بلا أي سياسة → غير مرئي للمتصفح إطلاقاً.
--    كل قراءة تمر عبر RPC أدناه فقط. لا يُضاف أبداً إلى DB.dumpAll().
-- ---------------------------------------------------------------------
create table if not exists public.patient_portal_credentials (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  doctor_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null,
  code text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  disabled_at timestamptz,
  constraint credentials_patient_same_doctor foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id) on delete cascade,
  constraint credentials_clinic_same_doctor foreign key (clinic_id, doctor_id)
    references public.clinics(id, doctor_id) on delete restrict
);
alter table public.patient_portal_credentials enable row level security;
create index if not exists credentials_clinic_idx
  on public.patient_portal_credentials (clinic_id) where disabled_at is null;

-- ---------------------------------------------------------------------
-- 3) إصدار الكود: مرة واحدة لكل مريض (idempotent). لا توجد دالة تغيير.
--    الكود = PREFIX-XXXX-XXXX-XXXX (12 خانة عشوائية من السيرفر).
-- ---------------------------------------------------------------------
create or replace function public.issue_patient_code(p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_p record; v_prefix text; v_secret text; v_code text; v_existing text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'لازم تسجل دخولك كدكتور أولاً');
  end if;
  select p.id, p.doctor_id,
         coalesce(p.clinic_id, d.id) as clinic_id
    into v_p
    from public.patients p
    left join public.clinics d on d.doctor_id = p.doctor_id and d.is_default and d.deleted_at is null
   where p.id = p_patient_id and p.doctor_id = v_uid and p.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'المريض غير موجود أو مش تابع لحسابك');
  end if;
  if v_p.clinic_id is null then
    return jsonb_build_object('ok', false, 'error', 'حدّد فرع المريض الأول');
  end if;
  select c.code into v_prefix from public.clinics c where c.id = v_p.clinic_id;
  if v_prefix is null or v_prefix = '' then
    return jsonb_build_object('ok', false, 'error', 'اختار بادئة الفرع من الإعدادات قبل إصدار الكود');
  end if;
  select c.code into v_existing from public.patient_portal_credentials c where c.patient_id = p_patient_id;
  if found then
    return jsonb_build_object('ok', true, 'code', v_existing, 'alreadyIssued', true);
  end if;

  v_secret := upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 12));
  v_code := v_prefix || '-' || substr(v_secret, 1, 4) || '-' || substr(v_secret, 5, 4) || '-' || substr(v_secret, 9, 4);
  insert into public.patient_portal_credentials (patient_id, doctor_id, clinic_id, code)
  values (p_patient_id, v_p.doctor_id, v_p.clinic_id, v_code);
  update public.patients set clinic_id = v_p.clinic_id
   where id = p_patient_id and doctor_id = v_uid and clinic_id is null;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (v_uid, 'patient-code-issued', 'patients', p_patient_id,
          jsonb_build_object('via', 'clinic', 'clinicId', v_p.clinic_id::text));
  return jsonb_build_object('ok', true, 'code', v_code, 'alreadyIssued', false);
end; $$;

revoke all on function public.issue_patient_code(uuid) from public, anon, authenticated;
grant execute on function public.issue_patient_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) صمّام طوارئ: إيقاف/تشغيل بوابة مريض (مش «تغيير كود»).
--    لو الكارت اتسرق، الدكتور يوقف الوصول فوراً ويمسح جلساته.
--    الكود نفسه يفضل كما هو؛ الاسترجاع الوحيد هو ملف/كود جديد.
-- ---------------------------------------------------------------------
create or replace function public.set_patient_portal_access(p_patient_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'لازم تسجل دخولك كدكتور أولاً');
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and doctor_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'المريض غير موجود أو مش تابع لحسابك');
  end if;
  update public.patient_portal_credentials
     set disabled_at = case when coalesce(p_enabled, false) then null else now() end
   where patient_id = p_patient_id and doctor_id = v_uid;
  if not coalesce(p_enabled, false) then
    delete from public.patient_sessions where patient_id = p_patient_id;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (v_uid, 'patient-portal-access', 'patients', p_patient_id,
          jsonb_build_object('via', 'clinic', 'enabled', coalesce(p_enabled, false)));
  return jsonb_build_object('ok', true, 'enabled', coalesce(p_enabled, false));
end; $$;

revoke all on function public.set_patient_portal_access(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_patient_portal_access(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5) الدخول الجديد: (الكود الكامل + رقم التليفون).
--    البادئة جوّه الكود بتحدد الفرع → المطابقة محصورة في الفرع ده،
--    فلا يوجد فخ duplicate-match ولا تلميحات عن مريض/دكتور تاني.
-- ---------------------------------------------------------------------
drop function if exists public.patient_portal_login(text, date);

create or replace function public.patient_portal_login(p_code text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_input text; v_parts text[]; v_prefix text; v_err text;
  v_clinic record; v_p record; v_settings jsonb; v_tok uuid; v_key text; v_lock_key text;
begin
  v_err := 'رقم التليفون أو الكود غير صحيحين — تأكد منهم أو اسأل عيادتك';
  v_input := upper(btrim(coalesce(p_code, '')));
  v_parts := string_to_array(v_input, '-');
  if array_length(v_parts, 1) <> 4 then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  v_prefix := v_parts[1];

  select * into v_clinic from public.clinics
   where code = v_prefix and deleted_at is null and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;

  v_key := public.norm_phone_eg(p_phone);
  if v_key is null or btrim(v_key) = '' then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;

  -- قفل التخمين: 5 محاولات فاشلة / 15 دقيقة لكل (فرع + رقم)
  v_lock_key := v_clinic.id::text || ':' || v_key;
  perform pg_advisory_xact_lock(hashtextextended('patient-portal-login:' || v_lock_key, 0));
  if (select count(*) from public.portal_login_attempts
       where clinic_id = v_clinic.id and phone_key = v_key
         and tried_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'محاولات دخول كتير فشلت — استنى 15 دقيقة ثم حاول تاني');
  end if;
  delete from public.portal_login_attempts where tried_at < now() - interval '1 day';

  -- المطابقة محصورة في الفرع اللي البادئة عرّفته
  select c.patient_id, c.doctor_id, c.clinic_id,
         p.name, p.type, p.height, p.target_weight, p.plan_start, p.plan_end, p.plan_id
    into v_p
    from public.patient_portal_credentials c
    join public.patients p on p.id = c.patient_id and p.deleted_at is null
   where c.code = v_input
     and c.clinic_id = v_clinic.id
     and c.disabled_at is null
     and public.norm_phone_eg(p.phone) = v_key;
  if not found then
    insert into public.portal_login_attempts (clinic_id, phone_key) values (v_clinic.id, v_key);
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;

  if not public.clinic_active(v_p.doctor_id) then
    return jsonb_build_object('ok', false, 'error', 'العيادة مش متاحة حالياً — تواصل مع عيادتك للمتابعة');
  end if;

  delete from public.portal_login_attempts where clinic_id = v_clinic.id and phone_key = v_key;
  delete from public.patient_sessions where expires_at < now();
  insert into public.patient_sessions (patient_id, doctor_id, clinic_id)
  values (v_p.patient_id, v_p.doctor_id, v_clinic.id)
  returning token into v_tok;
  update public.patient_portal_credentials set last_login_at = now() where patient_id = v_p.patient_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (v_p.doctor_id, 'patient-login', 'patients', v_p.patient_id,
          jsonb_build_object('via', 'portal', 'clinicId', v_clinic.id::text));
  select settings into v_settings from public.doctors where id = v_p.doctor_id;

  return jsonb_build_object('ok', true, 'token', v_tok,
    'patient', jsonb_build_object('id', v_p.patient_id, 'doctorId', v_p.doctor_id,
      'name', v_p.name, 'type', v_p.type, 'height', v_p.height,
      'targetWeight', v_p.target_weight, 'planStart', v_p.plan_start,
      'planEnd', v_p.plan_end, 'planId', v_p.plan_id),
    'clinic', jsonb_build_object('doctorName', coalesce(v_settings->>'doctorName',''),
      'clinicName', coalesce(v_clinic.name,''), 'phone', coalesce(v_clinic.phone,''),
      'code', v_clinic.code, 'clinicId', v_clinic.id));
end; $$;

revoke all on function public.patient_portal_login(text, text) from public, anon, authenticated;
grant execute on function public.patient_portal_login(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) الكود يظهر للمريض دائماً داخل البوابة + اسم/تليفون الفرع الصحيح.
--    RPC منفصلة عشان ما نعيدش كتابة patient_portal_data الكبيرة.
-- ---------------------------------------------------------------------
create or replace function public.patient_portal_access_code(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record; v_cred record; v_clinic record; v_settings jsonb;
begin
  select * into v_s from public.patient_sessions where token = p_token and expires_at > now();
  if not found then return jsonb_build_object('ok', false); end if;
  select * into v_cred from public.patient_portal_credentials
   where patient_id = v_s.patient_id and clinic_id = v_s.clinic_id and disabled_at is null;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into v_clinic from public.clinics where id = v_cred.clinic_id;
  select settings into v_settings from public.doctors where id = v_s.doctor_id;
  return jsonb_build_object('ok', true, 'code', v_cred.code,
    'clinicName', coalesce(v_clinic.name,''), 'clinicPhone', coalesce(v_clinic.phone,''),
    'clinicCode', coalesce(v_clinic.code,''), 'doctorName', coalesce(v_settings->>'doctorName',''));
end; $$;

revoke all on function public.patient_portal_access_code(uuid) from public, anon, authenticated;
grant execute on function public.patient_portal_access_code(uuid) to anon, authenticated;

commit;
