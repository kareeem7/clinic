/**
 * ========================================
 * config.js
 * الوظيفة: إعدادات Supabase (URL + anon key) + مخطط قاعدة البيانات الكامل SUPABASE_SQL (الجداول، RLS، دوال RPC، المراحل 1-18) + تتبع الأخطاء المركزي بمعرفات طلبات.
 * الدوال/الكيانات الرئيسية: supabaseConfig، SUPABASE_SQL (مخطط القاعدة كاملاً)، TRIAL_DAYS، newRequestId، logError
 * الاعتمادات: لا شيء — أول ملف يتحمل
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/config.js — إعدادات Supabase (Database + Auth)
   ------------------------------------------------------------
   للتفعيل:
   1) أنشئ مشروعاً مجانياً من https://supabase.com
   2) الصق كود الجداول (تجده جاهزاً للنسخ في الإعدادات ← حالة النظام) في SQL Editor واضغط Run
   3) من Project Settings ← API: انسخ Project URL و anon public key هنا
   طالما الحقلان فارغان يعمل النظام في "وضع تجريبي" ببيانات واقعية.
   ============================================================ */
const supabaseConfig = {
  url: "https://phmkvbszyaqagezpaduz.supabase.co", // Project URL — لا تضف /rest/v1
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBobWt2YnN6eWFxYWdlenBhZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0ODczODQsImV4cCI6MjEwOTA2MzM4NH0.AvjJeXFa6B8a9_w4o_ARuXH1Sv97thySLyqgAXqg5vo"   // ← anon public key (آمن للعرض — حماية البيانات الحقيقية بسياسات RLS)
};
const SUPABASE_READY = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
// Free trial window granted to every new signup. The super admin may change
// this later from system_settings; old clinics keep whatever rule applied then.
const TRIAL_DAYS = 14;
/* Correlation id attached to every error report and audit row.
   It contains no patient data, so it is safe to show to the user
   and to keep in logs. */
let REQUEST_SEQ = 0;
function newRequestId() {
  REQUEST_SEQ += 1;
  return 'req-' + Date.now().toString(36) + '-' + REQUEST_SEQ;
}

/* Central error reporting. PHI (names, phones, weights, diagnoses,
   notes) is never written to the console or to any log sink. */
function logError(err, context) {
  const requestId = newRequestId();
  const code = (err && (err.code || err.status)) || 'unknown';
  // Only the technical shape of the failure is logged, never the payload
  console.error('[clinic]', { requestId, context, code });
  return requestId;
}

// كود إنشاء الجداول وعزل البيانات — يُنفَّذ مرة واحدة في Supabase ← SQL Editor
const SUPABASE_SQL = `-- نظام إدارة العيادات — إنشاء الجداول + سياسات الأمان (RLS)
create table if not exists public.doctors (
  id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb default '{}'::jsonb
);
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  title text, calories int default 1500, description text,
  duration text, notes text, meals jsonb default '[]'::jsonb,
  deleted_at timestamptz, deleted_by uuid,
  unique (id, doctor_id)                      -- enables composite FKs from child tables
);
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  name text, phone text, age int, gender text,
  type text, status text default 'active',
  height numeric, target_weight numeric,
  plan_id uuid,
  plan_start date, plan_end date,
  diagnosis text, notes text,
  chronic jsonb default '[]'::jsonb,   -- chronic conditions: ["diabetes","hypertension"]
  created_at date default now(),
  deleted_at timestamptz, deleted_by uuid,     -- soft delete: clinical rows are never hard-deleted
  unique (id, doctor_id),
  -- a patient may only be linked to a plan owned by the SAME doctor
  constraint patients_plan_same_doctor foreign key (plan_id, doctor_id)
    references public.plans(id, doctor_id) on delete set null
);
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade,
  patient_name text, date date, time text,
  duration int default 30,
  type text, status text default 'pending', note text,
  deleted_at timestamptz, deleted_by uuid,
  -- cross-tenant guard: the referenced patient must belong to the same doctor
  constraint appointments_patient_same_doctor foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id) on delete cascade
);
create table if not exists public.patient_records (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  date date, weight numeric, waist numeric, hips numeric,
  fat numeric, session int, pain int, note text,
  deleted_at timestamptz, deleted_by uuid,
  constraint records_patient_same_doctor foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id) on delete cascade
);
-- ملاحظات الزيارات + متابعة الأمراض المزمنة (سكر / ضغط / أدوية)
create table if not exists public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  date date, note text,
  sugar numeric, sugar_type text,       -- قراءة السكر ونوعها (صائم / فاطر)
  bp_sys int, bp_dia int,               -- blood pressure: systolic / diastolic
  meds text, next_visit date,
  deleted_at timestamptz, deleted_by uuid,
  constraint notes_patient_same_doctor foreign key (patient_id, doctor_id)
    references public.patients(id, doctor_id) on delete cascade
);
-- Append-only audit trail. Clients may INSERT and SELECT their own rows only.
-- No UPDATE/DELETE policy exists, so rows are immutable from the browser.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,        -- view | create | edit | delete | restore | export
  entity text not null,        -- patients | appointments | patient_records | patient_notes | plans
  entity_id uuid,
  meta jsonb default '{}'::jsonb, -- non-PHI context only (counts, route, request id)
  ip text,
  created_at timestamptz default now()
);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs (actor_id, created_at desc);

-- تفعيل العزل الكامل: كل دكتور يرى بياناته فقط (لن يرى مرضى دكتور آخر)
alter table public.doctors enable row level security;
alter table public.plans enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.patient_records enable row level security;
alter table public.patient_notes enable row level security;

-- بوابة الاشتراك داخل RLS نفسها: العيادة الموقوفة / المنتهية / المحذوفة
-- تفقد الوصول لكل الجداول الطبية حتى لو نادى الـAPI مباشرة بـJWT صالح.
-- security definer حتى تستطيع قراءة صف doctors دائماً (owner يتجاوز RLS).
create or replace function public.clinic_active(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (settings->'account'->>'status') in ('active','trial')
            and coalesce((settings->'account'->>'endsAt')::date, current_date) >= current_date
     from public.doctors where id = uid), false);
$$;

-- (DROP IF EXISTS before every CREATE POLICY keeps this script safely re-runnable)
-- doctors_own مقصود أن تبقى بدون clinic_active: الدكتور الموقوف لازم يقدر يقرأ
-- صف إعداداته عشان التطبيق يعرف سبب الإيقاف ويعرضه له، وحماية خانة الاشتراك
-- نفسها موجودة في trigger اسمه guard_account (تحت في Phase 13B).
drop policy if exists doctors_own on public.doctors;
create policy doctors_own on public.doctors
  for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists plans_own on public.plans;
create policy plans_own on public.plans
  for all using (auth.uid() = doctor_id and public.clinic_active(auth.uid()))
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid()));
drop policy if exists patients_own on public.patients;
create policy patients_own on public.patients
  for all using (auth.uid() = doctor_id and public.clinic_active(auth.uid()))
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid()));
drop policy if exists appointments_own on public.appointments;
create policy appointments_own on public.appointments
  for all using (auth.uid() = doctor_id and public.clinic_active(auth.uid()))
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid()));
-- إصلاح حرج: سياسة records_own كانت مكسورة — سطر create policy كان ناقصاً
-- وجملة FOR ALL كانت ملحوقة بـDROP مباشرة (syntax error يوقف السكربت كله،
-- ولو اتنفذ جزئياً يبقى الجدول RLS بدون أي سياسة = الدكتور مش شايف أي قياس).
drop policy if exists records_own on public.patient_records;
create policy records_own on public.patient_records
  for all using (auth.uid() = doctor_id and public.clinic_active(auth.uid()))
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid()));
drop policy if exists notes_own on public.patient_notes;
create policy notes_own on public.patient_notes
  for all using (auth.uid() = doctor_id and public.clinic_active(auth.uid()))
  with check (auth.uid() = doctor_id and public.clinic_active(auth.uid()));

-- Audit log: insert + read own rows. Deliberately NO update/delete policy.
alter table public.audit_logs enable row level security;
drop policy if exists audit_insert_own on public.audit_logs;
create policy audit_insert_own on public.audit_logs
  for insert with check (auth.uid() = actor_id);
drop policy if exists audit_read_own on public.audit_logs;
create policy audit_read_own on public.audit_logs
  for select using (auth.uid() = actor_id);

-- ---------------------------------------------------------------
-- Migration for clinics created before Phase 1 (safe to re-run)
-- ---------------------------------------------------------------
alter table public.patients         add column if not exists deleted_at timestamptz;
alter table public.patients         add column if not exists deleted_by uuid;
alter table public.patients         add column if not exists chronic jsonb default '[]'::jsonb;
alter table public.appointments     add column if not exists deleted_at timestamptz;
alter table public.appointments     add column if not exists deleted_by uuid;
alter table public.patient_records  add column if not exists deleted_at timestamptz;
alter table public.patient_records  add column if not exists deleted_by uuid;
alter table public.patient_notes    add column if not exists deleted_at timestamptz;
alter table public.patient_notes    add column if not exists deleted_by uuid;
alter table public.plans            add column if not exists deleted_at timestamptz;
alter table public.plans            add column if not exists deleted_by uuid;

-- Partial indexes: list queries always filter out soft-deleted rows
create index if not exists patients_live_idx     on public.patients (doctor_id)     where deleted_at is null;
create index if not exists appointments_live_idx on public.appointments (doctor_id, date) where deleted_at is null;
create index if not exists records_live_idx      on public.patient_records (patient_id)   where deleted_at is null;
create index if not exists notes_live_idx        on public.patient_notes (patient_id)     where deleted_at is null;

-- =====================================================================
-- PHASE 10: Super Admin layer
-- =====================================================================

-- 0) Registration date, needed for the signup-growth chart
alter table public.doctors add column if not exists created_at timestamptz default now();

-- 1) Who is a super admin.
-- Rows are inserted ONLY from the Supabase dashboard SQL editor, e.g.:
--   insert into public.superadmins (id) values ('<auth-user-uuid>');
-- There is intentionally no insert/update policy: nobody can self-grant.
create table if not exists public.superadmins (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.superadmins enable row level security;
drop policy if exists superadmins_self_read on public.superadmins;
create policy superadmins_self_read on public.superadmins
  for select using (auth.uid() = id);

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.superadmins where id = auth.uid()) $$;

-- 2) Admins read clinic METADATA only. Clinical tables keep no admin policy.
drop policy if exists doctors_admin_read on public.doctors;
create policy doctors_admin_read on public.doctors
  for select using (public.is_super_admin());
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs
  for select using (public.is_super_admin());

-- 3) Aggregate overview computed server-side: patient rows never leave
-- their tenant; admins receive counts and clinic metadata only.
create or replace function public.admin_overview()
returns table (
  doctor_id uuid, email text, created_at timestamptz, settings jsonb,
  patients bigint, appointments bigint, today_appts bigint,
  records bigint, notes_cnt bigint, last_activity timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return query
    select d.id, coalesce(u.email, '')::text, d.created_at, d.settings,
      (select count(*) from patients p  where p.doctor_id = d.id and p.deleted_at is null),
      (select count(*) from appointments a where a.doctor_id = d.id and a.deleted_at is null),
      (select count(*) from appointments a2 where a2.doctor_id = d.id and a2.deleted_at is null
        and a2.date = (now() at time zone 'Africa/Cairo')::date),
      (select count(*) from patient_records r where r.doctor_id = d.id and r.deleted_at is null),
      (select count(*) from patient_notes n where n.doctor_id = d.id and n.deleted_at is null),
      (select max(l.created_at) from audit_logs l where l.actor_id = d.id)
    from doctors d left join auth.users u on u.id = d.id
    order by d.created_at desc;
end; $$;

-- 4) Subscription changes go through this audited function (no direct table edit)
create or replace function public.admin_set_doctor_status(target uuid, new_status text, ends_at date default null, note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  if new_status not in ('active', 'suspended', 'deleted', 'trial') then raise exception 'invalid status'; end if;
  update public.doctors set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('account',
    jsonb_build_object('status', new_status, 'endsAt', ends_at, 'note', note,
                       'updatedBy', auth.uid()::text, 'updatedAt', now()::text))
  where id = target;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), new_status, 'doctors', target, jsonb_build_object('byAdmin', true));
end; $$;

-- 5) Basic clinic info edits by admin (audited, clinical data untouched)
create or replace function public.admin_update_doctor(target uuid, patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  if patch ?| array['password','totp','mfa'] then raise exception 'credential change not allowed'; end if;
  update public.doctors set settings = coalesce(settings, '{}'::jsonb) || patch where id = target;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'edit', 'doctors', target, jsonb_build_object('byAdmin', true));
end; $$;

-- 6) Admin notes on a doctor account ("manual renewal" and the like)
create table if not exists public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  by_admin uuid not null references auth.users(id),
  note text not null check (char_length(note) <= 1000),
  created_at timestamptz default now()
);
alter table public.admin_notes enable row level security;
drop policy if exists admin_notes_read  on public.admin_notes;
drop policy if exists admin_notes_write on public.admin_notes;
create policy admin_notes_read  on public.admin_notes for select using (public.is_super_admin());
create policy admin_notes_write on public.admin_notes for insert
  with check (public.is_super_admin() and by_admin = auth.uid());

-- 7) Platform-wide settings singleton
create table if not exists public.system_settings (
  id int primary key default 1 check (id = 1),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.system_settings enable row level security;
drop policy if exists sys_read   on public.system_settings;
drop policy if exists sys_insert on public.system_settings;
drop policy if exists sys_update on public.system_settings;
create policy sys_read   on public.system_settings for select using (public.is_super_admin());
create policy sys_insert on public.system_settings for insert with check (public.is_super_admin());
create policy sys_update on public.system_settings for update using (public.is_super_admin()) with check (public.is_super_admin());
insert into public.system_settings (id, value) values (1, '{"trialDays": 14, "monthly": 300, "yearly": 3000, "welcomeMsg": "مرحباً بك في منظومة عيادتي"}'::jsonb)
on conflict (id) do nothing;

-- =====================================================================
-- Back-aware migration for clinics created BEFORE Phase 1:
-- adds the unique keys and swaps any single-column patient/plan FKs for
-- composite (patient_id, doctor_id) FKs. Idempotent: guard clauses skip
-- whatever already exists, so re-running this whole script is safe on
-- both fresh and older deployments.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patients_id_doctor_id_key') then
    alter table public.patients add constraint patients_id_doctor_id_key unique (id, doctor_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plans_id_doctor_id_key') then
    alter table public.plans add constraint plans_id_doctor_id_key unique (id, doctor_id);
  end if;

  -- drop the Phase-0 single-column FKs if they exist (older deployments)
  if exists (select 1 from pg_constraint where conname = 'appointments_patient_id_fkey') then
    alter table public.appointments drop constraint appointments_patient_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'patient_records_patient_id_fkey') then
    alter table public.patient_records drop constraint patient_records_patient_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'patient_notes_patient_id_fkey') then
    alter table public.patient_notes drop constraint patient_notes_patient_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'patients_plan_id_fkey') then
    alter table public.patients drop constraint patients_plan_id_fkey;
  end if;

  -- add the composite cross-tenant guards if they are not there yet
  if not exists (select 1 from pg_constraint where conname = 'appointments_patient_same_doctor') then
    alter table public.appointments add constraint appointments_patient_same_doctor
      foreign key (patient_id, doctor_id) references public.patients(id, doctor_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'records_patient_same_doctor') then
    alter table public.patient_records add constraint records_patient_same_doctor
      foreign key (patient_id, doctor_id) references public.patients(id, doctor_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_patient_same_doctor') then
    alter table public.patient_notes add constraint notes_patient_same_doctor
      foreign key (patient_id, doctor_id) references public.patients(id, doctor_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patients_plan_same_doctor') then
    alter table public.patients add constraint patients_plan_same_doctor
      foreign key (plan_id, doctor_id) references public.plans(id, doctor_id) on delete set null;
  end if;
end $$;

-- =====================================================================
-- PHASE 13: server-side validation for the message-style block
-- =====================================================================
-- The browser saves message styling inside doctors.settings.messageStyle.
-- Enums and lengths are also validated here so bad values can never
-- be stored even by a hand-crafted client.
create or replace function public.validate_doctor_settings()
returns trigger language plpgsql as $$
begin
  if new.settings ? 'messageStyle' then
    if (new.settings->'messageStyle'->>'tone') is not null
       and (new.settings->'messageStyle'->>'tone') not in ('formal','friendly','brief','motivational','custom') then
      raise exception 'invalid message tone';
    end if;
    if (new.settings->'messageStyle'->>'language') is not null
       and (new.settings->'messageStyle'->>'language') not in ('ar_formal','ar_egyptian','en','mixed') then
      raise exception 'invalid message language';
    end if;
    if char_length(coalesce(new.settings->'messageStyle'->>'signature','')) > 200 then
      raise exception 'signature too long';
    end if;
    if char_length(coalesce(new.settings->'messageStyle'->>'customToneDescription','')) > 500 then
      raise exception 'custom tone description too long';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_validate_doctor_settings on public.doctors;
create trigger trg_validate_doctor_settings
  before insert or update on public.doctors
  for each row execute function public.validate_doctor_settings();

-- Phase 13 QA notes:
-- - update public.doctors set settings = settings || '{"messageStyle":{"tone":"xray"}}'
--   Expect: ERROR invalid message tone
-- - update public.doctors set settings = settings || '{"messageStyle":{"tone":"friendly"}}'
--   Expect: 1 row updated

-- =====================================================================
-- PHASE 13B (إصلاح حرج): حالة الاشتراك admin-only + حفظ إعدادات آمن
-- =====================================================================
-- 1) guard_account: أي INSERT لصف دكتور جديد يفرض الفترة التجريبية من
--    السيرفر نفسه (trialDays من system_settings)، وأي UPDATE يغيّر
--    settings->'account' مرفوض لغير السوبر أدمن — فالدكتور مش قادر يمدّد
--    تجربته أو يفك تعليق حسابه بنفسه من الـconsole.
create or replace function public.guard_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trial int;
begin
  if tg_op = 'INSERT' then
    select coalesce((value->>'trialDays')::int, 14) into v_trial
      from public.system_settings where id = 1;
    v_trial := coalesce(v_trial, 14);
    new.settings := coalesce(new.settings, '{}'::jsonb) || jsonb_build_object(
      'account', jsonb_build_object('status', 'trial',
                                    'endsAt', (current_date + v_trial)::text));
  elsif (old.settings->'account') is distinct from (new.settings->'account')
        and not public.is_super_admin() then
    raise exception 'account is admin-only';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_account on public.doctors;
create trigger trg_guard_account before insert or update on public.doctors
  for each row execute function public.guard_account();

-- 2) حفظ إعدادات العيادة من المتصفح يمر عبر RPC: يدمج الحقول المملوكة
--    للدكتور فقط ويقصّ 'account' في السيرفر نفسه — فنسخة قديمة في الذاكرة
--    (مثلاً الدكتور فاتح التطبيق والأدمن علّق حسابه في نفس اللحظة) مستحيل
--    ترجّع الحساب نشط عند حفظ أي إعداد.
create or replace function public.save_clinic_settings(patch jsonb)
returns void language sql security definer set search_path = public as $$
  update public.doctors
  set settings = coalesce(settings, '{}'::jsonb) || (coalesce(patch, '{}'::jsonb) - 'account')
  where id = auth.uid();
$$;

-- Phase 13B QA:
-- - كدكتور (مش أدمن) من console المتصفح:
--     supabase.from('doctors').update({settings:{account:{status:'active',endsAt:'2099-12-31'}}}).eq('id', uid)
--   Expect: error 'account is admin-only'
-- - حفظ إعدادات عادي (اسم العيادة/التليفون) من الشاشة: ينجح وaccount ما يتلمسش.
-- - admin_set_doctor_status (سوبر أدمن) يغيّر الحالة عادي لأن is_super_admin() = true.

-- =====================================================================
-- PHASE 14: patient portal (phone + birthdate + token sessions)
-- =====================================================================

-- Portal login credential: the doctor records the patient's birth date,
-- the patient types it on the portal. Add the column for older installs too.
alter table public.patients add column if not exists birth_date date;

-- Normalize Egyptian phone numbers the same way the client does
create or replace function public.norm_phone_eg(t text)
returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(t,''), '\D', '', 'g') as x)
  select case
    when x like '0020%' then substring(x from 3)
    when x like '0%' and length(x) = 11 then '2' || x
    when x not like '20%' and length(x) = 12 and x not like '20%' then '20' || x
    when x not like '20%' and length(x) = 10 then '20' || x
    else x end
  from d;
$$;

-- Portal sessions: random token + 7-day expiry. No RLS policy exists at all,
-- so the table is invisible to the browser; only the security-definer functions
-- below may touch it.
create table if not exists public.patient_sessions (
  token uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);
alter table public.patient_sessions enable row level security;

-- محاولات الدخول الفاشلة للبوابة: حماية من التخمين (brute force) على
-- تليفون + تاريخ الميلاد. RLS مفعّل بدون أي سياسة → الجدول غير مرئي
-- للمتصفح تماماً، والدالة أدناه (security definer) هي الوحيدة التي تلمسه.
create table if not exists public.portal_login_attempts (
  id bigint generated always as identity primary key,
  phone_key text not null,
  tried_at timestamptz not null default now()
);
alter table public.portal_login_attempts enable row level security;
create index if not exists portal_attempts_phone_idx
  on public.portal_login_attempts (phone_key, tried_at desc);

-- Patient login: verify phone+birthdate, open a session, audit the entry.
-- The error message is generic on purpose (no user-enumeration hints).
-- تقوية: بحد أقصى 5 محاولات فاشلة لكل رقم تليفون كل 15 دقيقة، والعيادة
-- الموقوفة/المنتهية بوابتها مقفولة هي كمان (clinic_active).
create or replace function public.patient_portal_login(p_phone text, p_birth date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p record; v_tok uuid; v_settings jsonb; v_key text; v_n bigint;
begin
  v_key := public.norm_phone_eg(p_phone);

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

-- Full portal payload: only rows owned by this patient, everything else stays server-side
create or replace function public.patient_portal_data(p_token uuid)
-- (FIX: no longer declared STABLE — the function INSERTs into audit_logs,
--  and writes are not allowed in a non-volatile function)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record; v_p record; v_appt record; v_last record; v_prev record; v_first record; v_plan record; v_settings jsonb; v_sessions bigint;
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
  select * into v_p from public.patients where id = v_s.patient_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'تعذّر تحميل ملفك'); end if;

  -- nearest upcoming, not-cancelled visit (Africa/Cairo "today")
  select * into v_appt from public.appointments
    where patient_id = v_p.id and doctor_id = v_p.doctor_id and deleted_at is null
      and status <> 'cancelled' and date >= (now() at time zone 'Africa/Cairo')::date
    order by date, time limit 1;

  select * into v_last from public.patient_records
    where patient_id = v_p.id and deleted_at is null and weight is not null
    order by date desc limit 1;
  select * into v_prev from public.patient_records
    where patient_id = v_p.id and deleted_at is null and weight is not null
    order by date desc offset 1 limit 1;
  select * into v_first from public.patient_records
    where patient_id = v_p.id and deleted_at is null and weight is not null
    order by date asc limit 1;
  select count(*) into v_sessions from public.patient_records
    where patient_id = v_p.id and deleted_at is null;

  select title, calories, description, meals, duration into v_plan
    from public.plans where id = v_p.plan_id and deleted_at is null;
  select settings into v_settings from public.doctors where id = v_p.doctor_id;

  -- audit every portal read too (id + scope only, no PHI)
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_p.doctor_id, 'patient-view', 'patients', v_p.id, jsonb_build_object('via', 'portal'));

  return jsonb_build_object('ok', true,
    'patient', jsonb_build_object('id', v_p.id, 'doctorId', v_p.doctor_id, 'name', v_p.name, 'type', v_p.type, 'height', v_p.height,
      'targetWeight', v_p.target_weight, 'planStart', v_p.plan_start, 'planEnd', v_p.plan_end, 'sessions', v_sessions),
    'clinic', jsonb_build_object('doctorName', coalesce(v_settings->>'doctorName',''),
      'clinicName', coalesce(v_settings->>'clinicName',''), 'phone', coalesce(v_settings->>'phone','')),
    -- (بند 9) أعمدة صريحة فقط — to_jsonb(الصف كامل) كان بيسرّب كل الأعمدة
    -- (doctor_id, patient_id, deleted_by, أي حقل داخلي) لواجهة البوابة
    'nextAppointment', case when v_appt.id is null then null else
      jsonb_build_object('id', v_appt.id, 'date', v_appt.date, 'time', v_appt.time,
                         'type', v_appt.type, 'status', v_appt.status,
                         'duration', v_appt.duration) end,
    'lastMeasure',  case when v_last.id  is null then null else jsonb_build_object('date', v_last.date,  'weight', v_last.weight)  end,
    'prevMeasure',  case when v_prev.id  is null then null else jsonb_build_object('date', v_prev.date,  'weight', v_prev.weight)  end,
    'firstMeasure', case when v_first.id is null then null else jsonb_build_object('date', v_first.date, 'weight', v_first.weight) end,
    'plan', to_jsonb(v_plan));
end; $$;

-- إصلاح حرج: النسخ القديمة (2-arg) من patient_portal_cancel و
-- patient_portal_add_measurement كانت بتتعرّف هنا جنب النسخ الأحدث في
-- Phase 16/17، فبيتحولوا لـoverloads متوازية:
--   * الاستدعاء بـ(p_token, p_appt) يبقى ambiguous → "function is not unique"
--     (زرار الإلغاء في الصفحة الرئيسية للمريض كان ممكن يفشل بسببها).
--   * نسخة add_measurement القديمة مش بتتحقق من المحيطات/الملاحظة/التاريخ
--     وبتدرج بـsource='clinic' الافتراضي → المريض يقدر يزوّر قياس بيتي
--     كأنه قياس رسمي من العيادة.
-- التعريفات الحالية الوحيدة: Phase 16 (add_measurement بـ8 بارامترات)
-- و Phase 17 (cancel بالسبب). والـdrop هنا ينضّف أي تثبيت قديم، وهو no-op
-- في التثبيت الجديد — فالسكربت يفضل آمن إعادة التشغيل.
drop function if exists public.patient_portal_cancel(uuid, uuid);
drop function if exists public.patient_portal_add_measurement(uuid, numeric);

-- Close the session on logout
create or replace function public.patient_portal_logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.patient_sessions where token = p_token;
$$;

-- Phase 14 QA:
-- - Call patient_portal_login with wrong birthdate: {ok:false} and NO hint about which field was wrong.
-- - Grab p_token, the call patient_portal_data with a token copied from ANOTHER patient's session: not found.
-- - patient_portal_cancel on someone else's appointment id: {ok:false,'الموعد مش موجود'}.
-- - anon via PostgREST cannot select from patient_sessions at all (no policy granted).

-- =====================================================================
-- PHASE 15: full measurement history for the patient portal
-- =====================================================================
-- Returns the patient's own records (ascending). Still session-scoped:
-- the token decides WHICH patient, so cross-patient reads are impossible.
create or replace function public.patient_portal_records(p_token uuid)
-- (FIX: no longer declared STABLE — the function INSERTs into audit_logs,
--  and writes are not allowed in a non-volatile function)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record;
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

  -- audit the portal read (ids and scope only — never PHI)
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-view', 'patient_records', null, jsonb_build_object('via', 'portal', 'scope', 'progress-page'));

  return (
    select jsonb_build_object('ok', true, 'records', coalesce(jsonb_agg(to_jsonb(r) order by r.date), '[]'::jsonb))
    -- (بند 9) أعمدة صريحة، وملاحظات العيادة الداخلية ما توصلش للمريض:
    -- note تُرجع فقط لو المريض هو كاتبها بنفسه من البيت (source='patient')
    from (select date, weight, waist, hips, fat, session, pain,
                 case when source = 'patient' then note else null end as note
          from public.patient_records
          where patient_id = v_s.patient_id and deleted_at is null
          order by date asc
         ) r
  );
end; $$;

-- Phase 15 QA:
-- - patient_portal_records with a valid token: ascending order, no deleted rows.
-- - Same function called with a token of a DIFFERENT patient: returns that patient's rows only.
-- - Expired token: {ok:false}.

-- =====================================================================
-- PHASE 16: patient self-logged measurements (home logging)
-- =====================================================================

-- New columns the patient may submit from home
alter table public.patient_records add column if not exists arm numeric;
alter table public.patient_records add column if not exists source text default 'clinic';
alter table public.patient_records add column if not exists photo_path text;

-- Upgraded portal write RPC: the patient may only submit numbers within
-- safe ranges, a short note, no future dates, and source is ALWAYS 'patient'
-- (the client can never spoof it).
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

-- =====================================================================
-- PHASE 16 STORAGE: patient progress photos bucket
-- =====================================================================
-- Private bucket: 5MB, images only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('patient-photos', 'patient-photos', false, 5242880,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

-- Authorize photo uploads only through the server-side Edge Function.
-- Deploy the function first; coordinate this migration with the compatible app release.
-- Review existing policies and test the complete flow in isolation before production.

drop policy if exists portal_photo_insert on storage.objects;

create or replace function public.patient_portal_photo_authorize(p_token uuid)
returns table (doctor_id uuid, patient_id uuid)
language sql stable security definer set search_path = public as $$
  select s.doctor_id, s.patient_id
  from public.patient_sessions s
  join public.patients p on p.id = s.patient_id and p.doctor_id = s.doctor_id
  where s.token = p_token and s.expires_at > now()
    and p.deleted_at is null and public.clinic_active(s.doctor_id)
$$;
revoke all on function public.patient_portal_photo_authorize(uuid) from public, anon, authenticated;
grant execute on function public.patient_portal_photo_authorize(uuid) to service_role;


-- (بند 10) القراءة للدكتور المعالج فقط — واجهة البوابة ما بتعرضش صور أصلاً،
-- فمفيش سبب إن أي حامل توكن يقرأ من Storage. الفرع التاني للتوافق مع
-- مسارات قديمة (token/doctorId/...) لو فيه كائنات اترفعت قبل الإصلاح.
drop policy if exists portal_photo_read on storage.objects;
create policy portal_photo_read on storage.objects for select to anon, authenticated
using (
  bucket_id = 'patient-photos'
  and auth.uid() is not null
  and (auth.uid()::text = split_part(name, '/', 1)      -- الوضع الجديد: doctorId/patientId/...
       or auth.uid()::text = split_part(name, '/', 2))  -- وضع قديم: token/doctorId/...
);

-- Phase 16 QA:
-- - Try uploading WITHOUT a live token: denied.
-- - Upload with token of patient A and folder of patient B: denied (path binding).
-- - Doctor A opens a signed URL of patient under doctor B: denied.
-- - RPC rejects weight=500 and weight=5, and a date of tomorrow.

-- =====================================================================
-- PHASE 17: patient portal — appointments list + cancel with reason
-- =====================================================================
alter table public.appointments add column if not exists cancel_reason text;
alter table public.appointments add column if not exists cancelled_at timestamptz;

-- Full appointment story for the patient: upcoming (any non-cancelled state)
-- plus last 5 visits with notes. Session-bound, audited.
create or replace function public.patient_portal_appointments(p_token uuid)
-- (FIX: no longer declared STABLE — the function INSERTs into audit_logs,
--  and writes are not allowed in a non-volatile function)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record;
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

  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-view', 'appointments', null, jsonb_build_object('via', 'portal', 'scope', 'appointments-page'));

  return jsonb_build_object('ok', true,
    'upcoming', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.date, t.time) from (
        -- (بند 9) note محذوفة من المواعيد القادمة — حقل داخلي للدكتور
        select id, type, date, time, duration, status
        from public.appointments
        where patient_id = v_s.patient_id and doctor_id = v_s.doctor_id and deleted_at is null
          and date >= (now() at time zone 'Africa/Cairo')::date
        order by date, time limit 20
      ) t
    ), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.date desc) from (
        -- (بند 9) note للزيارات السابقة معروضة للمريض عمداً (الواجهة بتعرضها
        -- كملخص زيارة) — الملاحظات الداخلية مكانها patient_notes مش هنا.
        -- cancel_reason المريض هو كاتبها بنفسه فآمنة.
        select id, type, date, time, duration, status, note, cancel_reason
        from public.appointments
        where patient_id = v_s.patient_id and doctor_id = v_s.doctor_id and deleted_at is null
          and date < (now() at time zone 'Africa/Cairo')::date
        order by date desc limit 5
      ) t
    ), '[]'::jsonb));
end; $$;

-- Cancel with reason. The 'patient_id IS session' guard means a patient can only
-- ever cancel their own upcoming visit, and the reason column is trimmed server-side.
create or replace function public.patient_portal_cancel(p_token uuid, p_appt uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record;
begin
  select * into v_s from public.patient_sessions where token = p_token and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'انتهت جلستك'); end if;
  -- Existing tokens must not bypass a suspended clinic or a soft-deleted patient.
  if not public.clinic_active(v_s.doctor_id) or not exists (
    select 1 from public.patients p
    where p.id = v_s.patient_id and p.doctor_id = v_s.doctor_id and p.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;
  update public.appointments
     set status = 'cancelled',
         cancel_reason = nullif(left(coalesce(p_reason, ''), 200), ''),
         cancelled_at = now()
   where id = p_appt and patient_id = v_s.patient_id and doctor_id = v_s.doctor_id
     and deleted_at is null and status <> 'done'
     and date >= (now() at time zone 'Africa/Cairo')::date;
  if not found then return jsonb_build_object('ok', false, 'error', 'الموعد مش موجود أو مكتمل أو تاريخه فات'); end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-cancel', 'appointments', p_appt, jsonb_build_object('via', 'portal'));
  return jsonb_build_object('ok', true);
end; $$;

-- =====================================================================
-- PHASE 18 (إصلاحات عالية الخطورة 11-14): أعمدة جديدة + مسح مؤجل حقيقي
--           + إضافة مريض ذرّية في معاملة واحدة
-- =====================================================================

-- 18A) انتقالات أعمدة: موافقة واتساب الموثقة + موانع استعمال الخطط
alter table public.patients add column if not exists consent_whatsapp boolean default false;
alter table public.plans    add column if not exists contraindications text;
-- فهرس يساعد فحص uniqueness في دخول البوابة (بند 8)
create index if not exists patients_birth_live_idx
  on public.patients (birth_date) where deleted_at is null;

-- 18B) (بند 11) المسح المؤجل الحقيقي — نصوص الواجهة بتوعد إن المحذوف
-- يُمحى بعد 30 يوماً؛ دلوقتي فيه فعل ينفذ الوعد فعلاً:
--   * صفوف soft-deleted عدّت فترة الاحتفاظ → hard delete
--   * عيادات حالتها 'deleted' من أكتر من المدة → محو بياناتها الطبية
-- بيشتغل يومياً 3ص عبر pg_cron (لو مفعّل)، أو يدوياً من سوبر أدمن.
create or replace function public.purge_deleted_rows(p_retention_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_retention_days, 30), 0));
  v_gone uuid[];
  n_rec bigint := 0; n_notes bigint := 0; n_appt bigint := 0;
  n_plans bigint := 0; n_pat bigint := 0; n_clinic bigint := 0;
begin
  -- cron (بدون JWT) أو سوبر أدمن فقط — anon مقفول بالـREVOKE تحت
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'forbidden';
  end if;

  -- 1) الصفوف المحذوفة ناعماً اللي عدّت فترة الاحتفاظ (الفروع قبل الأصول)
  delete from public.patient_records where deleted_at is not null and deleted_at < cutoff; get diagnostics n_rec = row_count;
  delete from public.patient_notes   where deleted_at is not null and deleted_at < cutoff; get diagnostics n_notes = row_count;
  delete from public.appointments    where deleted_at is not null and deleted_at < cutoff; get diagnostics n_appt = row_count;
  delete from public.plans           where deleted_at is not null and deleted_at < cutoff; get diagnostics n_plans = row_count;
  delete from public.patients        where deleted_at is not null and deleted_at < cutoff; get diagnostics n_pat = row_count;

  -- 2) عيادات بحالة 'deleted' وعدّت مهلتها: محو كامل لبياناتها الطبية.
  --    لو updatedAt مش موجودة (حساب قديم) ما نمسحش — الشك يُفسر لصالح الاحتفاظ.
  select coalesce(array_agg(id), '{}') into v_gone
    from public.doctors
   where settings->'account'->>'status' = 'deleted'
     and (settings->'account'->>'updatedAt') is not null
     and (settings->'account'->>'updatedAt')::timestamptz < cutoff;
  if array_length(v_gone, 1) is not null then
    delete from public.patient_records where doctor_id = any (v_gone);
    delete from public.patient_notes   where doctor_id = any (v_gone);
    delete from public.appointments    where doctor_id = any (v_gone);
    delete from public.plans           where doctor_id = any (v_gone);
    delete from public.patients        where doctor_id = any (v_gone); get diagnostics n_clinic = row_count;
    insert into public.audit_logs (actor_id, action, entity, meta)
      select g, 'purge', 'doctors', jsonb_build_object('scope', 'deleted-clinic', 'retentionDays', p_retention_days)
      from unnest(v_gone) g;
  end if;

  return jsonb_build_object('records', n_rec, 'notes', n_notes, 'appointments', n_appt,
                            'plans', n_plans, 'patients', n_pat, 'deletedClinicPatients', n_clinic);
end; $$;

-- منع النداء المجهول: cron بيشتغل كـowner (مش محتاج grant)، والسوبر أدمن
-- مسموح له بالفحص جوه الدالة، وanon ممنوع صراحةً
revoke execute on function public.purge_deleted_rows(int) from public, anon;

-- جدولة يومية 3:00ص — لو pg_cron مش مفعّل على المشروع يتخطى بصمت؛
-- وقتها فعّله من Database ← Extensions أو شغّل الدالة يدوياً دورياً
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('purge-deleted-clinical-rows');
    exception when others then null;
    end;
    perform cron.schedule('purge-deleted-clinical-rows', '0 3 * * *',
      $cron$select public.purge_deleted_rows(30)$cron$);
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end; $$;

-- 18C) (بند 12) إضافة مريض + قياساته الأولى في معاملة واحدة ذرّية:
-- يا إما كله ينجح يا إما مفيش حاجة بتحصل — مفيش مريض يتيم من غير قياساته،
-- ولا تسجيل مكرر عند فشل الشبكة في نص الـloop القديم.
-- security invoker (الافتراضي) فـRLS بتُطبق زي أي insert من المتصفح.
create or replace function public.create_patient_with_measurements(p_patient jsonb, p_measurements jsonb default '[]'::jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare v_pid uuid; m jsonb; v_ret jsonb; v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;

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

  for m in select jsonb_array_elements(coalesce(p_measurements, '[]'::jsonb)) loop
    insert into public.patient_records (doctor_id, patient_id, date, weight, session, pain, note)
    values (auth.uid(), v_pid,
            coalesce(nullif(m->>'date', '')::date, (now() at time zone 'Africa/Cairo')::date),
            nullif(m->>'weight', '')::numeric,
            nullif(m->>'session', '')::int,
            nullif(m->>'pain', '')::int,
            coalesce(m->>'note', ''))
    returning jsonb_build_object('id', id, 'date', date) into v_ret;
    v_out := v_out || v_ret;
  end loop;

  return jsonb_build_object('ok', true, 'patientId', v_pid, 'records', v_out);
end; $$;

-- =====================================================================
-- PHASE 1 + 10 QA RUNBOOK (run manually after deployment)
-- =====================================================================
-- QA-1 Tenant isolation: sign in as doctor A, then run:
--      select * from public.patients;
--    Expect: only doctor A's rows. Cross-tenant ids return zero rows, and
--    any direct UPDATE with another doctor's uuid writes zero rows.
-- QA-2 Composite FK proof: try to insert an appointment pointing at a
--    patient owned by another doctor:
--    insert into public.appointments (doctor_id, patient_id, patient_name, date, time)
--      values ('<doctor-B-uuid>', '<patient-of-A-uuid>', 'x', '2026-01-01', '10:00');
--    Expect: ERROR 23503 violates foreign key "appointments_patient_same_doctor".
-- QA-3 Audit immutability from the client:
--      update public.audit_logs set action = 'x';
--      delete from public.audit_logs;
--    Expect: permission denied / zero rows affected (no update policy exists).
-- QA-4 Admin RPC guard as a non-admin:
--      select public.admin_overview();
--    Expect: ERROR forbidden.
-- QA-5 Soft delete: delete a patient from the UI, then:
--      select id, name, deleted_at from public.patients where deleted_at is not null;
--    Expect: the row exists with a timestamp, and it is invisible in the app.
-- QA-6 Subscription guard: as a doctor (non-admin) try in the browser console:
--      update public.doctors set settings = settings || '{"account":{"status":"active","endsAt":"2099-12-31"}}' where id = auth.uid();
--    Expect: ERROR "account is admin-only" (trigger trg_guard_account).
-- QA-7 Suspended clinic lockout: admin_set_doctor_status(doctor,'suspended') then
--    with that doctor's JWT run: select * from public.patients;
--    Expect: 0 rows (clinic_active is part of the RLS policies now).
-- QA-8 Portal brute-force lockout: call patient_portal_login 5 times with a wrong
--    birthdate, then once with the CORRECT credentials within 15 minutes.
--    Expect: the 6th call still returns 'محاولات دخول كتير فشلت' until the window passes.
-- QA-9 No legacy overloads: select pronargs from pg_proc where proname='patient_portal_add_measurement';
--    Expect: a single row with pronargs = 8 (the 2-arg legacy version is gone).
-- QA-10 Duplicate portal match: سجّل مريضين بنفس التليفون وتاريخ الميلاد عند دكتورين
--    ثم نادِ patient_portal_login بالبيانات دي. Expect: نفس الرسالة العامة (مفيش
--    enumeration) + سطر audit باسم 'patient-login-denied' وissue='duplicate-match'.
-- QA-11 Purge: احذف مريضاً (soft) ثم نفّذ select public.purge_deleted_rows(0);
--    Expect: الصف يُمحى فعلياً والعدّادات في الناتج > 0. (0 للاختبار فقط —
--    الإنتاج 30 يوماً عبر cron)
-- QA-12 Anon purge blocked: نداء purge_deleted_rows بمفتاح anon عبر REST.
--    Expect: permission denied for function (REVOKE execute).
-- QA-13 Photo path: ارفع صورة من البوابة → المسار doctorId/patientId/uuid.jpg
--    من غير أي توكن، و photo_path المتخزن في patient_records مافيهوش سر.

-- Require a verified MFA session for doctor and admin data access.
-- Run as a single transaction after reviewing the existing Supabase policies.
-- Portal RPCs use their patient session token and intentionally remain usable by anon.
-- Deploy the matching app (registration uses INSERT, not UPSERT) before this SQL.
-- Review all existing policies/functions and test JWT, MFA and portal flows before production.

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
`;
