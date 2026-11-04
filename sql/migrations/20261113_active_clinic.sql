-- =====================================================================
-- PHASE 21 (الدفعة ٣): الفرع الحالي + وسم الصفوف الجديدة تلقائياً
-- ---------------------------------------------------------------------
-- * الدكتور يبدّل الفرع من الشريط الجانبي؛ الاختيار يُحفظ في
--   doctors.settings->>'activeClinicId' عبر RPC الموجودة save_clinic_settings
--   (ما لمسناش account ولا أضفنا RPC جديدة).
-- * ترايجر BEFORE INSERT يملأ clinic_id لأي صف جديد ما لهوش فرع صريح،
--   حتى الصفوف اللي بتتعمل من داخل RPC create_patient_with_measurements.
-- * ده تنظيم/عرض داخل نفس حساب الدكتور فقط؛ العزل الأمني الحقيقي لسه RLS
--   على doctor_id + القيد المركّب (clinic_id, doctor_id) من 20261111.
-- =====================================================================
begin;

create or replace function public.set_row_clinic_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_active uuid;
begin
  if new.clinic_id is not null then return new; end if;
  -- مقارنة نصية بدل ::uuid عشان أي قيمة قديمة/غريبة في settings ما توقعش الإدراج
  select c.id into v_active
    from public.doctors d
    join public.clinics c on c.doctor_id = d.id and c.deleted_at is null
   where d.id = new.doctor_id
     and d.settings->>'activeClinicId' = c.id::text
   limit 1;
  if v_active is not null then new.clinic_id := v_active; end if;
  return new;
end; $$;

do $$
declare t text; trg text;
begin
  foreach t in array array[
    'plans', 'patients', 'appointments', 'patient_records', 'patient_notes',
    'patient_labs', 'patient_health_readings'
  ] loop
    if to_regclass('public.' || t) is not null then
      trg := 'trg_' || t || '_clinic';
      execute format('drop trigger if exists %I on public.%I', trg, t);
      execute format(
        'create trigger %I before insert on public.%I for each row execute function public.set_row_clinic_id()',
        trg, t);
    end if;
  end loop;
end $$;

-- لكل دكتور عنده فروع: لو ما اختارش فرع حالي، الفرع الافتراضي هو النشط
update public.doctors d
   set settings = coalesce(d.settings, '{}'::jsonb) || jsonb_build_object('activeClinicId', c.id::text)
  from public.clinics c
 where c.doctor_id = d.id and c.is_default and c.deleted_at is null
   and coalesce(d.settings->>'activeClinicId', '') = '';

commit;
