-- =====================================================================
-- sql/demo_seed_sales.sql — بيانات عرض **للتصوير والفيديو** (اصطناعية 100%)
-- ---------------------------------------------------------------------
-- ⚠️ استخدم هذا الملف فقط على حساب تجريبي منعزل مخصص للتصوير.
--    لا تنفّذه على قاعدة فيها مرضى حقيقيون.
--
-- الفرق بينه وبين `demo_seed_synthetic.sql`:
--   • ده للتصوير التسويقي: أسماء تبدو طبيعية، منحنى وزن فيه ٨ قياسات،
--     ومواعيد اليوم متعمرة — عشان الشاشة تبان «حياتها».
--   • `demo_seed_synthetic.sql` للاختبار التقني: أسماء «تجريبي / سمنة / أ».
--
-- المتطلبات:
--   1) نفّذ التثبيت الكامل (sql/00_install_all.sql).
--   2) أنشئ حساب دكتور بالبريد: demo-doctor@clinic.invalid
--      وسجّل الدخول به مرة واحدة (لإنشاء صف doctors ومكتبة الخطط).
--   3) نفّذ هذا الملف من SQL Editor.
--
-- الأمان:
--   • كل الأرقام تبدأ بـ +2019 (بادئة غير مخصصة للموبايلات المصرية) → غير قابلة للاتصال.
--   • كل الصفوف مقيدة بـ doctor_id.
--   • on conflict (id) do nothing → التشغيل المتكرر آمن.
--   • clinic_id في الجداول الوسيطة بيتوسم تلقائياً عبر set_row_clinic_id()
--     لو الترحيل 20261113 مطبّق. لو مش مطبّق، السكربت بيتعامل بأمان.
--   • يرفض العمل لو الحساب فيه مرضى آخرون.
--   • ⚠️ الأسماء هنا **مُخترعة للعرض فقط** وليست أشخاصًا حقيقيين.
-- =====================================================================
begin;

do $$
declare
  v_doctor uuid;
  v_plan   uuid;
  v_clinic uuid;
  v_today  date := (now() at time zone 'Africa/Cairo')::date;
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

  if exists (
    select 1 from public.patients
     where doctor_id = v_doctor
       and id not in (
         'f0000000-0000-4000-8000-000000000001',
         'f0000000-0000-4000-8000-000000000002',
         'f0000000-0000-4000-8000-000000000003',
         'f0000000-0000-4000-8000-000000000004'
       )
  ) then
    raise exception 'DEMO_SEED: هذا الحساب يحتوي بيانات مرضى أخرى — استخدم حسابًا تجريبيًا فارغًا';
  end if;

  -- هوية العرض + تفعيل كل الأقسام (لا يمس الاشتراك)
  update public.doctors
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
           'doctorName',  'د. أحمد سليم',
           'clinicName',  'مركز الحركة للعلاج الطبيعي',
           'specialty',   'both',
           'clinicalFeatures', jsonb_build_object(
             'measurements', true, 'inbody', true, 'labs', true,
             'glucoseTracking', true, 'bloodPressureTracking', true))
   where id = v_doctor;

  update public.clinics
     set name = 'مركز الحركة — الفرع الرئيسي'
   where doctor_id = v_doctor and is_default;

  select id into v_clinic
    from public.clinics
   where doctor_id = v_doctor and is_default and deleted_at is null
   limit 1;

  select id into v_plan
    from public.plans
   where doctor_id = v_doctor and deleted_at is null
   order by id limit 1;

  -- ===== ٤ مرضى =====
  insert into public.patients
    (id, doctor_id, clinic_id, name, phone, age, gender, type, status, height, target_weight,
     plan_id, plan_start, plan_end, diagnosis, notes, chronic, created_at,
     birth_date, consent_whatsapp, glucose_tracking_enabled, blood_pressure_tracking_enabled)
  values
    ('f0000000-0000-4000-8000-000000000001', v_doctor, v_clinic, 'منى عبد الرحمن', '+201900000101',
     34, 'female', 'nutrition', 'active', 165, 72, v_plan, v_today - 30, v_today + 30,
     'زيادة وزن — برنامج إنقاص 12 كجم خلال 6 شهور',
     'بتشتغل موظفة، حابة تبدأ برنامج غذائي مع تمرين 3 مرات أسبوعياً.', '[]'::jsonb,
     v_today - 95, '1990-05-12', true, true, true),
    ('f0000000-0000-4000-8000-000000000002', v_doctor, v_clinic, 'هدى مصطفى', '+201900000102',
     28, 'female', 'nutrition', 'active', 160, 62, null, null, null,
     'تثبيت وزن بعد نزول 14 كجم', 'وصلت للوزن المستهدف الأسبوع اللي فات — مرحلة تثبيت.',
     '[]'::jsonb, v_today - 40, '1996-09-03', true, false, false),
    ('f0000000-0000-4000-8000-000000000003', v_doctor, v_clinic, 'محمود فتحي', '+201900000103',
     41, 'male', 'pt', 'active', 178, null, null, null, null,
     'ديسك أسفل الظهر (L4-L5) — تأهيل حركي', 'معلم، شغل قاعدي على مكتب، الألم بيزيد في آخر اليوم.',
     '["hypertension"]'::jsonb, v_today - 60, '1983-02-20', true, false, false),
    ('f0000000-0000-4000-8000-000000000004', v_doctor, v_clinic, 'سارة إبراهيم', '+201900000104',
     23, 'female', 'pt', 'active', 175, null, null, null, null,
     'تأهيل ركبة بعد جراحة ACL', 'لاعبة تنس، في جلسة 4 من 10، التزام ممتاز بالتمارين.',
     '[]'::jsonb, v_today - 12, '2001-11-08', true, false, false)
  on conflict (id) do nothing;

  -- ===== منحنى وزن حقيقي الشكل: ٨ قياسات على ٦ شهور (منى) =====
  insert into public.patient_records
    (id, doctor_id, patient_id, date, weight, waist, hips, arm, fat, height, bmi,
     session, pain, note, source, record_type)
  values
    ('e0000000-0000-4000-8000-000000000101', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 168, 92.4, 102, 114, 36, 37.1, 165, 33.9, null, null, 'قياس البداية', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000102', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 140, 90.8, 100, 112, 35, 36.2, 165, 33.4, null, null, 'التزام جيد بالأكل', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000103', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 112, 89.1, 98, 111, 35, 35.4, 165, 32.7, null, null, 'بدأت المشي 30 دقيقة يومياً', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000104', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 84, 87.6, 96, 109, 34, 34.6, 165, 32.2, null, null, '', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000105', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 56, 86.2, 95, 108, 33, 33.8, 165, 31.7, null, null, 'أسبوع صعب — سافرت', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000106', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 28, 84.9, 93, 106, 33, 32.9, 165, 31.2, null, null, 'رجعنا للنظام، فرق واضح', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000107', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 7, 83.5, 92, 105, 32, 32.1, 165, 30.7, null, null, 'سجّلتها من البوابة', 'patient', 'manual'),
    ('e0000000-0000-4000-8000-000000000108', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 6, 83.2, null, null, null, 31.9, null, 30.6, null, null, 'فحص InBody', 'clinic', 'inbody'),
    -- هدى: منحنى تثبيت (قريب من بعضه)
    ('e0000000-0000-4000-8000-000000000109', v_doctor, 'f0000000-0000-4000-8000-000000000002', v_today - 70, 62.8, 74, 94, 28, 25.1, 160, 24.5, null, null, 'بداية التثبيت', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000110', v_doctor, 'f0000000-0000-4000-8000-000000000002', v_today - 35, 62.4, 73, 93, 28, 24.9, 160, 24.4, null, null, '', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000111', v_doctor, 'f0000000-0000-4000-8000-000000000002', v_today - 5, 61.9, 73, 93, 27, 24.6, 160, 24.2, null, null, 'مستقرة جداً', 'clinic', 'manual'),
    -- محمود: جلسات علاج طبيعي (وزن فارغ، ألم بيقل)
    ('e0000000-0000-4000-8000-000000000112', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today - 45, null, null, null, null, null, null, null, 1, 8, 'جلسة أولى — تقييم', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000113', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today - 31, null, null, null, null, null, null, null, 2, 7, 'تمارين إطالة + تصحيح وضع', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000114', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today - 17, null, null, null, null, null, null, null, 3, 5, 'تحسن ملحوظ في الألم', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000115', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today - 3, null, null, null, null, null, null, null, 4, 3, 'بيقدر يقعد ساعتين متواصلين', 'clinic', 'manual'),
    -- سارة: تأهيل ركبة
    ('e0000000-0000-4000-8000-000000000116', v_doctor, 'f0000000-0000-4000-8000-000000000004', v_today - 10, null, null, null, null, null, null, null, 1, 7, 'تقييم أولي — مدى حركة محدود', 'clinic', 'manual'),
    ('e0000000-0000-4000-8000-000000000117', v_doctor, 'f0000000-0000-4000-8000-000000000004', v_today - 2, null, null, null, null, null, null, null, 2, 5, 'بدأت تمارين تقوية الرباعية', 'clinic', 'manual')
  on conflict (id) do nothing;

  -- مؤشرات InBody لسجل منى
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'patient_records'
                and column_name = 'body_fat_mass') then
    update public.patient_records
       set body_fat_mass = 27.4, skeletal_muscle_mass = 27.1,
           visceral_fat_level = 10, body_water_pct = 51.8
     where id = 'e0000000-0000-4000-8000-000000000108'
       and doctor_id = v_doctor;
  end if;

  -- ===== مواعيد: ٣ النهاردة + ٣ قدام + ١ ملغي =====
  -- ملاحظة: clinic_id بيتوسم تلقائياً عبر ترايجر set_row_clinic_id()
  insert into public.appointments
    (id, doctor_id, patient_id, date, time, status, note)
  values
    ('c0000000-0000-4000-8000-000000000101', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today, '17:00', 'confirmed', 'متابعة شهرية'),
    ('c0000000-0000-4000-8000-000000000102', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today, '18:00', 'confirmed', 'جلسة 5'),
    ('c0000000-0000-4000-8000-000000000103', v_doctor, 'f0000000-0000-4000-8000-000000000004', v_today, '19:00', 'pending', 'جلسة 3'),
    ('c0000000-0000-4000-8000-000000000104', v_doctor, 'f0000000-0000-4000-8000-000000000002', v_today + 2, '16:00', 'confirmed', ''),
    ('c0000000-0000-4000-8000-000000000105', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today + 4, '18:00', 'confirmed', 'جلسة 6'),
    ('c0000000-0000-4000-8000-000000000106', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today + 7, '17:00', 'confirmed', ''),
    ('c0000000-0000-4000-8000-000000000107', v_doctor, 'f0000000-0000-4000-8000-000000000004', v_today - 2, '19:00', 'cancelled', 'اعتذرت — سفر')
  on conflict (id) do nothing;

  -- ===== ملاحظات زيارات =====
  insert into public.patient_notes
    (id, doctor_id, patient_id, date, note)
  values
    ('a0000000-0000-4000-8000-000000000101', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 56, 'التزام بالأكل 70٪ — رفعنا البروتين قليلاً.'),
    ('a0000000-0000-4000-8000-000000000102', v_doctor, 'f0000000-0000-4000-8000-000000000003', v_today - 17, 'مدى الحركة اتتحسن 20 درجة. كمّل التمارين المنزلية.'),
    ('a0000000-0000-4000-8000-000000000103', v_doctor, 'f0000000-0000-4000-8000-000000000004', v_today - 2, 'تورم أقل، بقت تمشي من غير عكاز.')
  on conflict (id) do nothing;

  -- ===== تحاليل + قراءات =====
  -- clinic_id يتوسم تلقائياً عبر set_row_clinic_id() — لا نمرّره صراحةً
  insert into public.patient_labs
    (id, doctor_id, patient_id, tested_on, test_name, results)
  values
    ('b0000000-0000-4000-8000-000000000101', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 90, 'سكر صائم',
      '[{"name":"Glucose","value":96,"unit":"mg/dL"}]'::jsonb),
    ('b0000000-0000-4000-8000-000000000102', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 90, 'صورة دهون كاملة',
      '[{"name":"Cholesterol","value":212,"unit":"mg/dL"},{"name":"HDL","value":44,"unit":"mg/dL"},{"name":"LDL","value":141,"unit":"mg/dL"}]'::jsonb),
    ('b0000000-0000-4000-8000-000000000103', v_doctor, 'f0000000-0000-4000-8000-000000000001', v_today - 20, 'صورة دهون كاملة',
      '[{"name":"Cholesterol","value":188,"unit":"mg/dL"},{"name":"HDL","value":51,"unit":"mg/dL"},{"name":"LDL","value":118,"unit":"mg/dL"}]'::jsonb)
  on conflict (id) do nothing;

  insert into public.patient_health_readings
    (id, doctor_id, patient_id, reading_type, recorded_at, glucose_value, glucose_type,
     systolic, diastolic, pulse, source)
  values
    ('a1000000-0000-4000-8000-000000000101', v_doctor, 'f0000000-0000-4000-8000-000000000001', 'glucose',
      (v_today - 21) + time '08:10', 104, 'fasting', null, null, null, 'clinic'),
    ('a1000000-0000-4000-8000-000000000102', v_doctor, 'f0000000-0000-4000-8000-000000000001', 'glucose',
      (v_today - 7) + time '08:05', 94, 'fasting', null, null, null, 'patient'),
    ('a1000000-0000-4000-8000-000000000103', v_doctor, 'f0000000-0000-4000-8000-000000000003', 'blood_pressure',
      (v_today - 14) + time '17:40', null, null, 138, 88, 76, 'clinic'),
    ('a1000000-0000-4000-8000-000000000104', v_doctor, 'f0000000-0000-4000-8000-000000000003', 'blood_pressure',
      (v_today - 1) + time '18:20', null, null, 129, 82, 72, 'clinic')
  on conflict (id) do nothing;

  raise notice 'DEMO_SEED(sales): تم تجهيز ٤ مرضى + ١٧ قياس + ٧ مواعيد على الحساب التجريبي';
end $$;

commit;
