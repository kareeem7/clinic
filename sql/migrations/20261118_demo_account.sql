-- =====================================================================
-- PHASE 24: الحساب التجريبي العام — إعفاء 2FA محصور في حساب واحد بالمعرّف
-- ---------------------------------------------------------------------
-- المشكلة: 2FA إجباري على كل الأطباء (20261101_require_mfa.sql) وسياسات
-- RLS بتشترط aal2. فحتى لو الواجهة عدّت شاشة الـ QR، الجداول نفسها بترجع
-- فاضية لأي جلسة aal1. يعني «زر ديمو» بدون التعديل ده = شاشة فاضية.
--
-- الحل: نفس شرط aal2 + استثناء واحد بالمعرّف:
--   ((auth.jwt()->>'aal') = 'aal2') or (auth.uid() = '<demo uid>'::uuid)
--
-- ليه بالمعرّف مش بالإيميل: الإيميل قابل للتغيير من لوحة Supabase، والـ uid
-- ثابت. ونفس الـ uid مثبّت في js/db.js (DEMO_UID) — الطبقتين بيتكلموا بنفس
-- المفتاح، فمستحيل يختلفوا ويبقى فيه حساب بيدخل الواجهة وبيلاقي بيانات فاضية.
--
-- اللي ما اتلمسش عن قصد: superadmins، admin_notes، system_settings،
-- audit_logs، و storage.objects — الحساب التجريبي مالوش أي وصول ليهم،
-- وفضلوا على aal2 بالكامل. وكذلك require_mfa_delete على doctors.
--
-- السياسات الأصلية ما اتلغتش ولا اتحولت permissive — ده ALTER على نفس
-- السياسة RESTRICTIVE، وبرضه RESTRICTIVE. الإعفاء لصف واحد بس.
-- =====================================================================
begin;

do $$
declare
  v_demo uuid;
  v_pred text;
  t text;
begin
  select id into v_demo from auth.users where email = 'demo@clinic.dev' limit 1;

  if v_demo is null then
    raise notice 'DEMO_ACCOUNT: الحساب demo@clinic.dev مش موجود — نفّذ sql/demo_account_seed.sql الأول، وبعدها الملف ده تاني';
    return;
  end if;

  v_pred := format(
    '((auth.jwt() ->> ''aal''::text) = ''aal2''::text) or (auth.uid() = %L::uuid)',
    v_demo
  );

  -- جداول بيانات العيادة: كل صف بيتقرأ/يتكتب بـ doctor_id = auth.uid()
  -- فالإضافة دي ما بتوسّعش نطاق أي حساب تاني.
  foreach t in array array[
    'patients', 'appointments', 'patient_records', 'patient_notes',
    'patient_labs', 'patient_health_readings', 'plans'
  ] loop
    execute format('alter policy require_mfa on public.%I using (%s) with check (%s)', t, v_pred, v_pred);
  end loop;

  -- صف الطبيب نفسه: الواجهة بتقرأ منه settings (اسم العيادة، الفروع، الميزات)
  execute format('alter policy require_mfa_select on public.doctors using (%s)', v_pred);
  execute format('alter policy require_mfa_update on public.doctors using (%s) with check (%s)', v_pred, v_pred);

  -- الجدولان دول عندهم شرط aal2 مكرّر جوّه السياسة المسموحة كمان
  execute format(
    'alter policy patient_health_readings_own on public.patient_health_readings '
    'using ((auth.uid() = doctor_id) and clinic_active(auth.uid()) and (%s)) '
    'with check ((auth.uid() = doctor_id) and clinic_active(auth.uid()) and (%s))', v_pred, v_pred);
  execute format(
    'alter policy patient_labs_own on public.patient_labs '
    'using ((auth.uid() = doctor_id) and clinic_active(auth.uid()) and (%s)) '
    'with check ((auth.uid() = doctor_id) and clinic_active(auth.uid()) and (%s))', v_pred, v_pred);

  raise notice 'DEMO_ACCOUNT: الإعفاء اتظبط للحساب % (كل حساب تاني فاضل عليه aal2)', v_demo;
end $$;

commit;
