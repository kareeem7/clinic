-- =====================================================================
-- sql/demo_seed_synthetic.sql — بيانات عرض اصطناعية 100%
-- ---------------------------------------------------------------------
-- ⚠️ استخدم هذا الملف فقط على مشروع Supabase تجريبي منعزل (staging/demo).
--    لا تنفّذه على قاعدة فيها بيانات مرضى حقيقية، ولا ترفع بيانات حقيقية
--    إلى أي لقطة أو مستودع. لا توجد هنا أسماء/أرقام/نتائج لحالات واقعية.
--
-- المتطلبات:
--   1) نفّذ SQL التأسيس (SUPABASE_SQL) أو طبّق كل الترحيلات بالترتيب.
--   2) أنشئ حساب دكتور بالبريد: demo-doctor@clinic.invalid
--      وسجّل الدخول به مرة واحدة (لإنشاء صف doctors ومكتبة الخطط).
--   3) نفّذ هذا الملف من SQL Editor على المشروع التجريبي فقط.
--
-- الأمان: كل الصفوف بمعرّفات UUID ثابتة، وكل إدخال محكوم بـ doctor_id،
--         و on conflict (id) do nothing يجعل التشغيل المتكرر آمنًا.
--         الملف يرفض العمل إذا وجد بيانات مرضى أخرى لنفس الحساب.
-- =====================================================================
begin;

do $$
declare
  v_doctor uuid;
  v_plan uuid;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select id into v_doctor
    from auth.users
   where email = 'demo-doctor@clinic.invalid'
   limit 1;

  if v_doctor is null then
    raise exception 'DEMO_SEED: أنشئ حساب الدكتور التجريبي بالبريد demo-doctor@clinic.invalid أولاً';
  end if;

  if not exists (select 1 from public.doctors where id = v_doctor) then
    raise exception 'DEMO_SEED: صف الدكتور غير موجود — سجّل الدخول بالحساب التجريبي مرة واحدة أولاً';
  end if;

  -- حاجز أمان: لا تخلط بيانات العرض بأي بيانات مرضى فعلية في نفس الحساب
  if exists (
    select 1 from public.patients
     where doctor_id = v_doctor
       and id not in (
         'd0000000-0000-4000-8000-000000000001',
         'd0000000-0000-4000-8000-000000000002',
         'd0000000-0000-4000-8000-000000000003',
         'd0000000-0000-4000-8000-000000000004'
       )
  ) then
    raise exception 'DEMO_SEED: هذا الحساب يحتوي بيانات مرضى أخرى — استخدم حسابًا تجريبيًا فارغًا';
  end if;

  -- تفعيل الأقسام الاختيارية للعرض فقط (لا يمس account/الاشتراك إطلاقًا)
  update public.doctors
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
           'clinicName', 'عيادة تجريبية — بيانات وهمية',
           'clinicalFeatures', jsonb_build_object(
             'measurements', true, 'inbody', true, 'labs', true,
             'glucoseTracking', true, 'bloodPressureTracking', true))
   where id = v_doctor;

  select id into v_plan
    from public.plans
   where doctor_id = v_doctor and deleted_at is null
   order by id limit 1;

  -- ===== 4 مرضى اصطناعيين (2 سمنة + 2 علاج طبيعي) =====
  -- أرقام الهاتف تبدأ ببادئة 19 غير مخصصة للموبايلات المصرية → غير قابلة للاتصال.
  insert into public.patients
    (id, doctor_id, name, phone, age, gender, type, status, height, target_weight,
     plan_id, plan_start, plan_end, diagnosis, notes, chronic, created_at,
     birth_date, consent_whatsapp, glucose_tracking_enabled, blood_pressure_tracking_enabled)
  values
    ('d0000000-0000-4000-8000-000000000001', v_doctor, 'تجريبي / سمنة / أ', '+201900000001', 34, 'female',
     'nutrition', 'active', 165, 72, v_plan, v_today - 30, v_today + 30,
     'زيادة وزن — متابعة تجريبية', 'بيانات عرض اصطناعية بالكامل',
     '["diabetes"]'::jsonb, v_today - 95, '1990-05-12', false, true, true),
    ('d0000000-0000-4000-8000-000000000002', v_doctor, 'تجريبي / سمنة / ب', '+201900000002', 28, 'female',
     'nutrition', 'active', 160, 62, null, null, null,
     'تثبيت وزن — متابعة تجريبية', 'بيانات عرض اصطناعية بالكامل',
     '[]'::jsonb, v_today - 40, '1996-09-03', false, false, false),
    ('d0000000-0000-4000-8000-000000000003', v_doctor, 'تجريبي / علاج طبيعي / ج', '+201900000003', 41, 'male',
     'pt', 'active', 178, null, null, null, null,
     'ألم أسفل الظهر — متابعة تجريبية', 'بيانات عرض اصطناعية بالكامل',
     '["hypertension"]'::jsonb, v_today - 60, '1983-02-20', false, false, false),
    ('d0000000-0000-4000-8000-000000000004', v_doctor, 'تجريبي / علاج طبيعي / د', '+201900000004', 23, 'male',
     'pt', 'active', 175, null, null, null, null,
     'تأهيل ركبة — متابعة تجريبية', 'بيانات عرض اصطناعية بالكامل',
     '[]'::jsonb, v_today - 12, '2001-11-08', false, false, false)
  on conflict (id) do nothing;

  -- ===== سجل قياسات: منحنى وزن + قياس من البيت + فحص InBody + جلسات ألم =====
  insert into public.patient_records
    (id, doctor_id, patient_id, date, weight, waist, hips, arm, fat, height, bmi,
     session, pain, note, source, record_type)
  values
    ('e0000000-0000-4000-8000-000000000001', v_doctor, 'd0000000-0000-4000-8000-000000000001', v_today - 90, 88.0, 98, 110, 34, 34.0, 165, 32.3, null, null, 'قياس البداية (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000002', v_doctor, 'd0000000-0000-4000-8000-000000000001', v_today - 60, 86.2, 96, 108, 33, 33.1, 165, 31.7, null, null, 'التزام جيد (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000003', v_doctor, 'd0000000-0000-4000-8000-000000000001', v_today - 30, 84.5, 94, 106, 33, 31.8, 165, 31.0, null, null, 'قياس العيادة (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000004', v_doctor, 'd0000000-0000-4000-8000-000000000001', v_today - 3, 83.1, 92, 105, 32, 30.9, 165, 30.5, null, null, 'سجّلتها من بوابتي (عرض)', 'patient', 'manual'),
    ('e0000000-0000-4000-8000-000000000005', v_doctor, 'd0000000-0000-4000-8000-000000000001', v_today - 3, 83.4, null, null, null, 30.9, null, 30.6,
     null, null, 'فحص InBody تجريبي', 'clinic', 'inbody'),
    ('e0000000-0000-4000-8000-000000000006', v_doctor, 'd0000000-0000-4000-8000-000000000002', v_today - 35, 68.0, 80, 96, 30, 27.0, 160, 26.6, null, null, 'قياس البداية (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000007', v_doctor, 'd0000000-0000-4000-8000-000000000002', v_today - 7, 66.4, 78, 95, 29, 26.2, 160, 25.9, null, null, 'قياس العيادة (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000008', v_doctor, 'd0000000-0000-4000-8000-000000000003', v_today - 45, null, null, null, null, null, null, null, 1, 8, 'جلسة أولى (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000009', v_doctor, 'd0000000-0000-4000-8000-000000000003', v_today - 20, null, null, null, null, null, null, null, 2, 6, 'تحسن طفيف (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000010', v_doctor, 'd0000000-0000-4000-8000-000000000003', v_today - 2, null, null, null, null, null, null, null, 3, 4, 'تحسن مستمر (عرض)', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000011', v_doctor, 'd0000000-0000-4000-8000-000000000004', v_today - 10, null, null, null, null, null, null, null, 1, 7, 'جلسة أولى (عرض)', 'clinic', 'manual')
  on conflict (id) do nothing;

  -- مؤشرات InBody للسجل التجريبي (أعمدة إضافية اختيارية)
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'patient_records'
                and column_name = 'body_fat_mass') then
    update public.patient_records
       set body_fat_mass = 25.7, skeletal_muscle_mass = 28.9,
           visceral_fat_level = 11, body_water_pct = 52.4
     where id = 'e0000000-0000-4000-8000-000000000005'
       and doctor_id = v_doctor;
  end if;

  -- ===== مواعيد: اليوم + قادمة + مكتملة + إلغاء من بوابة المريض =====
  insert into public.appointments
    (id, doctor_id, patient_id, patient_name, date, time, duration, type, status,
     note, cancel_reason, cancelled_at)
  values
    ('a0000000-0000-4000-8000-000000000001', v_doctor, 'd0000000-0000-4000-8000-000000000001', 'تجريبي / سمنة / أ', v_today, '17:00', 30, 'متابعة وزن', 'confirmed', 'موعد اليوم (عرض)', null, null),
    ('a0000000-0000-4000-8000-000000000002', v_doctor, 'd0000000-0000-4000-8000-000000000003', 'تجريبي / علاج طبيعي / ج', v_today, '18:00', 45, 'جلسة علاج طبيعي', 'pending', 'موعد اليوم (عرض)', null, null),
    ('a0000000-0000-4000-8000-000000000003', v_doctor, 'd0000000-0000-4000-8000-000000000002', 'تجريبي / سمنة / ب', v_today + 1, '16:00', 30, 'متابعة', 'confirmed', 'موعد قادم (عرض)', null, null),
    ('a0000000-0000-4000-8000-000000000004', v_doctor, 'd0000000-0000-4000-8000-000000000004', 'تجريبي / علاج طبيعي / د', v_today + 3, '19:00', 45, 'جلسة', 'pending', 'موعد قادم (عرض)', null, null),
    ('a0000000-0000-4000-8000-000000000005', v_doctor, 'd0000000-0000-4000-8000-000000000003', 'تجريبي / علاج طبيعي / ج', v_today - 5, '18:00', 45, 'جلسة', 'done', 'تمت (عرض)', null, null),
    ('a0000000-0000-4000-8000-000000000006', v_doctor, 'd0000000-0000-4000-8000-000000000002', 'تجريبي / سمنة / ب', v_today + 2, '15:00', 30, 'متابعة', 'cancelled', null, 'ظرف طارئ (عرض)', now() - interval '1 day')
  on conflict (id) do nothing;

  -- ===== ملاحظات زيارات + متابعة الأمراض المزمنة =====
  insert into public.patient_notes
    (id, doctor_id, patient_id, date, note, sugar, sugar_type, bp_sys, bp_dia, meds, next_visit)
  values
    ('n0000000-0000-4000-8000-000000000001', v_doctor, 'd0000000-0000-4000-8000-000000000001', v_today - 30,
     'متابعة تجريبية — الالتزام بالخطة', 104, 'صائم', null, null, 'لا توجد أدوية (عرض)', v_today + 14),
    ('n0000000-0000-4000-8000-000000000002', v_doctor, 'd0000000-0000-4000-8000-000000000003', v_today - 20,
     'متابعة ضغط تجريبية', null, null, 128, 82, 'لا توجد أدوية (عرض)', v_today + 10)
  on conflict (id) do nothing;

  -- ===== سجلات سريرية اختيارية (تظهر فقط لو الترحيلات مطبّقة) =====
  if to_regclass('public.patient_labs') is not null then
    insert into public.patient_labs
      (id, doctor_id, patient_id, test_name, tested_on, results, source)
    values
      ('c0000000-0000-4000-8000-000000000001', v_doctor, 'd0000000-0000-4000-8000-000000000001',
       'سكر صائم (عرض)', v_today - 14,
       '[{"name":"الجلوكوز الصائم","value":96,"unit":"mg/dL"}]'::jsonb, 'clinic')
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.patient_health_readings') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'patient_health_readings'
                    and column_name = 'glucose_unit') then
    insert into public.patient_health_readings
      (id, doctor_id, patient_id, reading_type, recorded_at, glucose_value, glucose_type,
       glucose_unit, systolic, diastolic, pulse, source)
    values
      ('h0000000-0000-4000-8000-000000000001', v_doctor, 'd0000000-0000-4000-8000-000000000001',
       'glucose', now() - interval '2 days', 92, 'fasting', 'mg/dL', null, null, null, 'clinic'),
      ('h0000000-0000-4000-8000-000000000002', v_doctor, 'd0000000-0000-4000-8000-000000000003',
       'blood_pressure', now() - interval '1 day', null, null, null, 126, 80, 72, 'clinic')
    on conflict (id) do nothing;
  end if;

  raise notice 'DEMO_SEED: تم إدخال/تأكيد بيانات العرض الاصطناعية للحساب %', v_doctor;
end $$;

commit;

-- =====================================================================
-- تنظيف اختياري (مُعطّل افتراضيًا — لا يُشغّل إلا على المشروع التجريبي)
-- ---------------------------------------------------------------------
-- انسخ السطرين التاليين ونفّذهما يدويًا بعد حذف "-- " من أول كل سطر.
-- حذف المرضى الأربعة يمسح كل ما ارتبط بهم عبر ON DELETE CASCADE.
--
-- begin;
-- delete from public.patients
--  where doctor_id = (select id from auth.users where email = 'demo-doctor@clinic.invalid')
--    and id in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004');
-- commit;
-- =====================================================================
