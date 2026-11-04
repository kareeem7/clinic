-- =====================================================================
-- PHASE 19 (الدفعة ١): فروع العيادة — الدكتور الواحد يمتلك أكتر من فرع
-- ---------------------------------------------------------------------
-- إضافة فقط (additive): لا حذف صفوف، لا تغيير في دخول البوابة الحالي،
-- ولا تفعيل لأي كود/OTP. كل الأعمدة الجديدة nullable أثناء الانتقال حتى
-- يفضل التطبيق الحالي شغّال كما هو لحد الدفعة ٣.
--
-- القرارات المُسجّلة:
--   * الدكتور: لوج واحد لكل عياداته (ما فيش حساب لكل فرع).
--   * بادئة الفرع يختارها الدكتور بنفسها، وفريدة عالمياً عبر كل الدكاترة
--     حتى تعرّف العيادة «بالظبط» مش الدكتور بس.
--   * المريض ممكن يبقى له أكتر من لوج إن (فرع/دكتور مختلف).
--   * كود المريض دائم بلا زر تغيير (الدفعة ٢).
--
-- التطبيق: بعد كل الترحيلات السابقة، على قاعدة staging منعزلة أولاً.
-- =====================================================================
begin;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  -- البادئة: NULL حتى يختارها الدكتور. فريدة عالمياً (NULL مسموح بتكراره).
  -- حروف لاتينية كبيرة/أرقام فقط ليكتبها المريض بسهولة على لوحة الموبايل.
  code text unique,
  name text,
  phone text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, doctor_id),   -- يُمكّن قيود (clinic_id, doctor_id) المركّبة
  constraint clinics_code_format check (code is null or code ~ '^[A-Z0-9]{2,12}$')
);

alter table public.clinics enable row level security;
drop policy if exists clinics_own on public.clinics;
-- نفس شكل عزل باقي الجداول: كل الفروع مملوكة لنفس حساب الدكتور،
-- فسياسة auth.uid() = doctor_id كافية ولا تحتاج إعادة كتابة RLS.
create policy clinics_own on public.clinics
  for all using (auth.uid() = doctor_id and public.clinic_active(auth.uid()))
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid()));

create unique index if not exists clinics_one_default_per_doctor
  on public.clinics (doctor_id) where is_default and deleted_at is null;
create index if not exists clinics_live_doctor_idx
  on public.clinics (doctor_id) where deleted_at is null;

-- عمود clinic_id على كل الجداول السريرية + جلسات/محاولات البوابة.
-- الجدول اللي مش موجود لسه (ترحيلات اختيارية) يتخطّى بأمان.
do $$
declare t text;
begin
  foreach t in array array[
    'plans', 'patients', 'appointments', 'patient_records', 'patient_notes',
    'patient_labs', 'patient_health_readings',
    'patient_sessions', 'portal_login_attempts'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists clinic_id uuid', t);
    end if;
  end loop;
end $$;

-- قيد مركّب: الفرع لازم يبقى مملوك لنفس الدكتور صاحب الصف.
-- NULL في clinic_id لا يُفحص (مسموح أثناء الانتقال).
do $$
declare t text; cname text;
begin
  foreach t in array array[
    'plans', 'patients', 'appointments', 'patient_records', 'patient_notes',
    'patient_labs', 'patient_health_readings', 'patient_sessions'
  ] loop
    if to_regclass('public.' || t) is not null then
      cname := t || '_clinic_same_doctor';
      if not exists (select 1 from pg_constraint where conname = cname) then
        execute format(
          'alter table public.%I add constraint %I foreign key (clinic_id, doctor_id) references public.clinics(id, doctor_id) on delete restrict',
          t, cname);
      end if;
    end if;
  end loop;
end $$;

-- فرع افتراضي واحد لكل دكتور موجود، بلا بادئة لحد ما الدكتور يختارها.
-- البادئة تُقفل بعد إصدار أول كود مريض (الدفعة ٢) عشان الكرارت ما تبطلش.
insert into public.clinics (doctor_id, name, is_default, code)
select d.id, coalesce(nullif(btrim(d.settings->>'clinicName'), ''), 'الفرع الرئيسي'), true, null
  from public.doctors d
 where not exists (select 1 from public.clinics c where c.doctor_id = d.id)
on conflict do nothing;

-- ربط الصفوف القديمة بالفرع الافتراضي. portal_login_attempts مش له
-- doctor_id، فمفتاح قفل التخمين هيتبدّل في الدفعة ٢ بدل ما نربطه هنا.
do $$
declare t text;
begin
  foreach t in array array[
    'plans', 'patients', 'appointments', 'patient_records', 'patient_notes',
    'patient_labs', 'patient_health_readings', 'patient_sessions'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'update public.%I c set clinic_id = d.id from public.clinics d '
        || 'where c.clinic_id is null and c.doctor_id = d.doctor_id '
        || 'and d.is_default and d.deleted_at is null', t);
    end if;
  end loop;
end $$;

-- فهرسة القوائم اللي هتتفلتر بالفرع الحالي في الدفعة ٣
create index if not exists patients_clinic_live_idx
  on public.patients (doctor_id, clinic_id) where deleted_at is null;
create index if not exists appointments_clinic_live_idx
  on public.appointments (doctor_id, clinic_id, date) where deleted_at is null;

commit;
