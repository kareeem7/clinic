-- =====================================================================
-- sql/demo_account_seed.sql — بيانات عرض اصطناعية 100% للحساب التجريبي العام
-- ---------------------------------------------------------------------
-- ⚠️ ملف ديمو فقط. مشروع Supabase تجريبي منعزل (staging/demo).
--    مفيش هنا أي اسم أو رقم أو نتيجة تخص مريض حقيقي. الأرقام كلها
--    +2019000000xx وهي بادئة غير مخصصة لأي مشغّل — عشان أي حد يقرأ
--    الملف يعرف من أول نظرة إنها بيانات مصنوعة.
--
-- الفرق بينه وبين sql/demo_seed_synthetic.sql:
--   * ده بيبني عيادة «كاملة» تقدر تعرضها لزائر: فرعين، 6 مرضى، مواعيد
--     بكل الحالات، زيارات بقياسات متغيرة، سكر وضغط، تحاليل، خطة، وملاحظات.
--   * الحساب بتاعه عام ومكتوب في الواجهة (زر «دخول ديمو») ومش بيتقفل،
--     فمحتاج اشتراك دائم — وده اللي قسم (٥) بيعمله.
--
-- المتطلبات:
--   1) sql/baseline.sql (أو كل الترحيلات بالترتيب) مطبّق.
--   2) حساب بالبريد demo@clinic.dev متسجّل، ودخل مرة واحدة عشان صف
--      doctors يتعمل (أو يتعمل بـ insert مباشر زي ما عملناه).
--   3) نفّذ الملف ده، وبعده 20261118_demo_account.sql.
--
-- الأمان: كل صف بيتحكم فيه doctor_id، وكل المعرّفات UUID ثابتة،
--         و on conflict (id) do nothing يخلي إعادة التشغيل آمنة تماماً.
-- =====================================================================
begin;

-- (٠) التحقق وحاجز الأمان ------------------------------------------------
do $$
declare
  v_doctor uuid;
begin
  select id into v_doctor from auth.users where email = 'demo@clinic.dev' limit 1;

  if v_doctor is null then
    raise exception 'DEMO_SEED: أنشئ الحساب التجريبي بالبريد demo@clinic.dev أولاً';
  end if;

  if not exists (select 1 from public.doctors where id = v_doctor) then
    raise exception 'DEMO_SEED: صف الدكتور غير موجود — سجّل الدخول بالحساب التجريبي مرة واحدة أولاً';
  end if;

  -- حاجز: ما تخلطش بيانات الديمو بمرضى حقيقيين على نفس الحساب.
  -- الصفوف اللي بيزرعها الملف بادئتها d0d0d0d0-، فأي مريض غيرها = توقف.
  if exists (
    select 1 from public.patients
     where doctor_id = v_doctor and id::text not like 'd0d0d0d0-%'
  ) then
    raise exception 'DEMO_SEED: هذا الحساب يحتوي بيانات مرضى أخرى — استخدم مشروع تجريبي منعزل';
  end if;
end $$;

-- (١) الطبيب: الاسم والعيادة والميزات -------------------------------------
-- ملاحظة: trg_guard_account بيفرض account=trial ١٤ يوم على أي INSERT جديد،
-- فقسم (٥) تحت هو اللي بيمدّ الاشتراك. هنا باقي الإعدادات بس.
update public.doctors d
   set settings = d.settings || jsonb_build_object(
     'doctorName',  'د. سلمى عبد الرحمن',
     'clinicName',  'عيادة سلمى للتغذية والعلاج الطبيعي',
     'specialty',   'علاج طبيعي وسمنة ونحافة',
     'phone',       '+201900000000',
     'price',       250,
     'address',     '٢٧ ش مصطفى النحاس، مدينة نصر، القاهرة',
     'activeClinicId', 'd0d0d0d0-0000-4000-8000-0000000000c1',
     'clinicalFeatures', jsonb_build_object(
       'labs', true, 'inbody', true, 'measurements', true,
       'glucoseTracking', true, 'bloodPressureTracking', true))
 where d.id = (select id from auth.users where email = 'demo@clinic.dev');

-- (٢) فرعين — عشان شريط تبديل الفروع يبان وله معنى ------------------------
insert into public.clinics (id, doctor_id, code, name, phone, is_default, active) values
  ('d0d0d0d0-0000-4000-8000-0000000000c1', (select id from auth.users where email='demo@clinic.dev'), 'DEMONS1', 'عيادة سلمى — مدينة نصر', '+201900000000', true,  true),
  ('d0d0d0d0-0000-4000-8000-0000000000c2', (select id from auth.users where email='demo@clinic.dev'), 'DEMOMHD1', 'عيادة سلمى — المهندسين', '+201900000000', false, true)
on conflict (id) do nothing;

-- (٣) ستة مرضى: تغذية + علاج طبيعي، راجعين وجديد --------------------------
insert into public.patients
  (id, doctor_id, clinic_id, name, phone, age, gender, type, status, height,
   target_weight, plan_start, diagnosis, notes, chronic, created_at,
   glucose_tracking_enabled, blood_pressure_tracking_enabled)
select v.id, u.doc, v.clinic, v.name, v.phone, v.age, v.gender, v.type, 'active',
       v.height, v.target, (now() at time zone 'Africa/Cairo')::date - v.days,
       v.diag, v.notes, v.chronic, (now() at time zone 'Africa/Cairo')::date - v.days,
       v.glucose, v.bp
  from (values
    ('d0d0d0d0-0000-4000-8000-000000000001'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid,
     'منى سعيد إبراهيم', '+201900000001', 34, 'أنثى', 'nutrition', 162, 68, 60,
     'سمنة من الدرجة الأولى', 'بتحس بتعب بعد الأكل وبترغب في السكريات بالليل.', '[]'::jsonb, false, false),
    ('d0d0d0d0-0000-4000-8000-000000000002'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid,
     'أحمد محمود عبد الله', '+201900000002', 41, 'ذكر', 'nutrition', 178, 85, 90,
     'سكري نوع 2 + سمنة بطنية', 'HbA1c لسه عالي، محتاج متابعة سكر أسبوعية.', '["سكري نوع 2"]'::jsonb, true, true),
    ('d0d0d0d0-0000-4000-8000-000000000003'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c2'::uuid,
     'هالة مصطفى كامل', '+201900000003', 28, 'أنثى', 'nutrition', 158, 60, 30,
     'نقص وزن واكتئاب شهية', 'شهيتها ضعيفة في الصبح، بتاكل مرة واحدة في اليوم.', '[]'::jsonb, false, false),
    ('d0d0d0d0-0000-4000-8000-000000000004'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid,
     'يوسف إبراهيم حسن', '+201900000004', 52, 'ذكر', 'pt', 172, null, 45,
     'خشونة ركبة يمين — درجة 2', 'برنامج 12 جلسة علاج طبيعي + تمارين منزلية.', '["خشونة ركبة"]'::jsonb, false, false),
    ('d0d0d0d0-0000-4000-8000-000000000005'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c2'::uuid,
     'سارة عادل فؤاد', '+201900000005', 23, 'أنثى', 'pt', 165, null, 14,
     'ألم أسفل الظهر بسبب الجلوس الطويل', '٦ جلسات، آخر جلستين تحسّن ملحوظ.', '[]'::jsonb, false, false),
    ('d0d0d0d0-0000-4000-8000-000000000006'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid,
     'محمود سمير رشاد', '+201900000006', 37, 'ذكر', 'nutrition', 180, 95, 21,
     'سمنة من الدرجة الثانية', 'شغل مكتبي 10 ساعات، مفيش نشاط بدني.', '[]'::jsonb, false, false)
  ) as v(id, clinic, name, phone, age, gender, type, height, target, days, diag, notes, chronic, glucose, bp)
 cross join (select id from auth.users where email = 'demo@clinic.dev') as u(doc)
on conflict (id) do nothing;

-- (٤) المواعيد: النهاردة، بكرة، الأسبوع الجاي، وفاتت -----------------------
insert into public.appointments
  (id, doctor_id, clinic_id, patient_id, patient_name, date, time, duration, type, status, note)
select v.id, (select id from auth.users where email='demo@clinic.dev'), v.clinic, v.pid, v.pname,
       (now() at time zone 'Africa/Cairo')::date + v.offset, v.time, v.dur, v.type, v.status, v.note
  from (values
    ('d0d0d0d0-0000-4000-8000-0000000001a1'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid, 'd0d0d0d0-0000-4000-8000-000000000001'::uuid, 'منى سعيد إبراهيم', 0,  '10:30', 30, 'كشف جديد',         'confirmed', 'متابعة شهرين'),
    ('d0d0d0d0-0000-4000-8000-0000000001a2'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid, 'd0d0d0d0-0000-4000-8000-000000000004'::uuid, 'يوسف إبراهيم حسن', 0,  '12:00', 45, 'جلسة علاج طبيعي', 'confirmed', 'الجلسة 9 من 12'),
    ('d0d0d0d0-0000-4000-8000-0000000001a3'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid, 'd0d0d0d0-0000-4000-8000-000000000002'::uuid, 'أحمد محمود عبد الله', 1, '11:00', 30, 'كشف جديد',        'confirmed', 'يراجع نتايج التحاليل'),
    ('d0d0d0d0-0000-4000-8000-0000000001a4'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c2'::uuid, 'd0d0d0d0-0000-4000-8000-000000000005'::uuid, 'سارة عادل فؤاد',   2, '15:30', 45, 'جلسة علاج طبيعي', 'confirmed', 'الجلسة 5 من 6'),
    ('d0d0d0d0-0000-4000-8000-0000000001a5'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid, 'd0d0d0d0-0000-4000-8000-000000000001'::uuid, 'منى سعيد إبراهيم', -3, '09:30', 30, 'كشف جديد',        'done',      'نزلت 3.3 كجم'),
    ('d0d0d0d0-0000-4000-8000-0000000001a6'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c2'::uuid, 'd0d0d0d0-0000-4000-8000-000000000003'::uuid, 'هالة مصطفى كامل',  -7, '14:00', 30, 'كشف جديد',        'done',      'خطة 1800 سعرة'),
    ('d0d0d0d0-0000-4000-8000-0000000001a7'::uuid, 'd0d0d0d0-0000-4000-8000-0000000000c1'::uuid, 'd0d0d0d0-0000-4000-8000-000000000006'::uuid, 'محمود سمير رشاد',  -1, '17:00', 30, 'كشف جديد',        'cancelled', 'ظروف شغل')
  ) as v(id, clinic, pid, pname, offset, time, dur, type, status, note)
on conflict (id) do nothing;

-- (٥) زيارات وقياسات — منحنيات بتنزل/بتطلع فعلاً في الشاشة -----------------
insert into public.patient_records
  (id, doctor_id, clinic_id, patient_id, date, weight, height, bmi, waist, hips, fat,
   session, note, source, record_type, created_at)
select v.id, (select id from auth.users where email='demo@clinic.dev'), v.clinic, v.pid,
       (now() at time zone 'Africa/Cairo')::date - v.days, v.weight, v.height, v.bmi,
       v.waist, v.hips, v.fat, v.session, v.note, 'clinic', 'manual',
       now() - (v.days || ' days')::interval
  from (values
    ('d0d0d0d0-0000-4000-8000-0000000002a1'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000001'::uuid,60,82.4,162,31.4,96,112,41.2,1,'خطة البدء'),
    ('d0d0d0d0-0000-4000-8000-0000000002a2'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000001'::uuid,30,79.1,162,30.1,92,109,39.8,2,'التزام كويس'),
    ('d0d0d0d0-0000-4000-8000-0000000002a3'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000001'::uuid, 3,76.8,162,29.3,88,106,38.1,3,'نزلت 5.6 كجم'),
    ('d0d0d0d0-0000-4000-8000-0000000002a4'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,90,104.2,178,32.9,114,118,36.4,1,'بداية المتابعة'),
    ('d0d0d0d0-0000-4000-8000-0000000002a5'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,45,99.6,178,31.4,110,115,34.9,2,'السكر اتحسن'),
    ('d0d0d0d0-0000-4000-8000-0000000002a6'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,10,96.1,178,30.3,107,113,33.7,3,'مكمل زي ما هو'),
    ('d0d0d0d0-0000-4000-8000-0000000002a7'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c2'::uuid,'d0d0d0d0-0000-4000-8000-000000000003'::uuid,30,48.9,158,19.6,68,92,26.1,1,'نقص وزن'),
    ('d0d0d0d0-0000-4000-8000-0000000002a8'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c2'::uuid,'d0d0d0d0-0000-4000-8000-000000000003'::uuid, 7,51.3,158,20.6,70,93,27.4,2,'بدأت تاكل 3 وجبات'),
    ('d0d0d0d0-0000-4000-8000-0000000002a9'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000006'::uuid,21,112.5,180,34.7,120,124,38.9,1,'بداية'),
    ('d0d0d0d0-0000-4000-8000-0000000002aa'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000006'::uuid, 5,109.8,180,33.9,117,122,37.6,2,'التزام متوسط')
  ) as v(id, clinic, pid, days, weight, height, bmi, waist, hips, fat, session, note)
on conflict (id) do nothing;

-- (٦) قراءات سكر (صائم/بعد الأكل) وضغط ------------------------------------
-- القيود patient_health_readings_shape بتمنع خلط السكر بالضغط في نفس الصف،
-- فالإدخالين منفصلين عن قصد.
insert into public.patient_health_readings
  (id, doctor_id, clinic_id, patient_id, reading_type, recorded_at,
   glucose_value, glucose_type, glucose_unit, source, created_at)
select v.id, (select id from auth.users where email='demo@clinic.dev'), v.clinic, v.pid,
       'glucose', now() - (v.days || ' days')::interval,
       v.val, v.gtype, 'mg/dL', 'clinic', now() - (v.days || ' days')::interval
  from (values
    ('d0d0d0d0-0000-4000-8000-0000000003a1'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,40,168,'fasting'),
    ('d0d0d0d0-0000-4000-8000-0000000003a2'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,33,214,'post_meal'),
    ('d0d0d0d0-0000-4000-8000-0000000003a3'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,26,151,'fasting'),
    ('d0d0d0d0-0000-4000-8000-0000000003a4'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,19,196,'post_meal'),
    ('d0d0d0d0-0000-4000-8000-0000000003a5'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,12,139,'fasting'),
    ('d0d0d0d0-0000-4000-8000-0000000003a6'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid, 4,181,'post_meal'),
    ('d0d0d0d0-0000-4000-8000-0000000003a7'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000001'::uuid,20,104,'fasting'),
    ('d0d0d0d0-0000-4000-8000-0000000003a8'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000001'::uuid, 6,112,'fasting')
  ) as v(id, clinic, pid, days, val, gtype)
on conflict (id) do nothing;

insert into public.patient_health_readings
  (id, doctor_id, clinic_id, patient_id, reading_type, recorded_at,
   systolic, diastolic, pulse, source, created_at)
select v.id, (select id from auth.users where email='demo@clinic.dev'), v.clinic, v.pid,
       'blood_pressure', now() - (v.days || ' days')::interval,
       v.sys, v.dia, v.pulse, 'clinic', now() - (v.days || ' days')::interval
  from (values
    ('d0d0d0d0-0000-4000-8000-0000000003b1'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,40,148,94,88),
    ('d0d0d0d0-0000-4000-8000-0000000003b2'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,26,138,88,82),
    ('d0d0d0d0-0000-4000-8000-0000000003b3'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,12,131,84,78),
    ('d0d0d0d0-0000-4000-8000-0000000003b4'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid, 4,126,81,74)
  ) as v(id, clinic, pid, days, sys, dia, pulse)
on conflict (id) do nothing;

-- (٧) تحاليل + خطة + ملاحظات ---------------------------------------------
-- الشكل اللي patient_lab_results_valid بتقبله: [{name, value, unit?}]
insert into public.patient_labs
  (id, doctor_id, clinic_id, patient_id, test_name, tested_on, results, source, created_at)
select v.id, (select id from auth.users where email='demo@clinic.dev'), v.clinic, v.pid,
       v.test, (now() at time zone 'Africa/Cairo')::date - v.days, v.results, 'clinic',
       now() - (v.days || ' days')::interval
  from (values
    ('d0d0d0d0-0000-4000-8000-0000000004a1'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,'HbA1c',20,'[{"name":"HbA1c","value":7.4,"unit":"%"}]'::jsonb),
    ('d0d0d0d0-0000-4000-8000-0000000004a2'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,'وظائف كبد',20,'[{"name":"ALT","value":38,"unit":"U/L"},{"name":"AST","value":31,"unit":"U/L"},{"name":"Albumin","value":4.1,"unit":"g/dL"}]'::jsonb),
    ('d0d0d0d0-0000-4000-8000-0000000004a3'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c2'::uuid,'d0d0d0d0-0000-4000-8000-000000000003'::uuid,'صورة دم كاملة',25,'[{"name":"Hemoglobin","value":10.8,"unit":"g/dL"},{"name":"Ferritin","value":12,"unit":"ng/mL"}]'::jsonb)
  ) as v(id, clinic, pid, test, days, results)
on conflict (id) do nothing;

insert into public.plans (id, doctor_id, clinic_id, title, calories, description, duration, notes, meals)
values ('d0d0d0d0-0000-4000-8000-0000000005a1',
        (select id from auth.users where email='demo@clinic.dev'),
        'd0d0d0d0-0000-4000-8000-0000000000c1',
        'خطة إنقاص وزن — 1600 سعرة', 1600,
        'ثلاث وجبات + سناك واحد، بروتين في كل وجبة، ونشويات كاملة بدل المكررة. ممنوع العصير المحلّى والمقليات.',
        '8 أسابيع', 'متابعة كل أسبوعين — قياس وزن ومحيط بطن.', '[]'::jsonb)
on conflict (id) do nothing;

insert into public.patient_notes
  (id, doctor_id, clinic_id, patient_id, date, note, sugar, sugar_type, bp_sys, bp_dia, meds, next_visit)
select v.id, (select id from auth.users where email='demo@clinic.dev'), v.clinic, v.pid,
       (now() at time zone 'Africa/Cairo')::date - v.days, v.note, v.sugar, 'fasting',
       v.sys, v.dia, v.meds, (now() at time zone 'Africa/Cairo')::date + v.next_in
  from (values
    ('d0d0d0d0-0000-4000-8000-0000000006a1'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000001'::uuid, 3,'نزلت 5.6 كجم في شهرين. الطاقة أعلى والعشاء اتظبط.',112,118,76,null::text, 7),
    ('d0d0d0d0-0000-4000-8000-0000000006a2'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c1'::uuid,'d0d0d0d0-0000-4000-8000-000000000002'::uuid,10,'السكر الصايم نزل من 168 لـ 139. نكمل نفس الدوا ونزود المشي لـ 30 دقيقة.',139,131,84,'ميتفورمين 1000 مجم مرتين', 1),
    ('d0d0d0d0-0000-4000-8000-0000000006a3'::uuid,'d0d0d0d0-0000-4000-8000-0000000000c2'::uuid,'d0d0d0d0-0000-4000-8000-000000000003'::uuid, 7,'زوّدنا الحديد والبروتين. الوزن زاد 2.4 كجم في 3 أسابيع — كويس.', 95,105,70,'حديد + فيتامين د',14)
  ) as v(id, clinic, pid, days, note, sugar, sys, dia, meds, next_in)
on conflict (id) do nothing;

-- (٨) اشتراك دائم للحساب التجريبي -----------------------------------------
-- لازم لأن:
--   * clinic_active() بترجّع false لو endsAt فاتت، وساعتها RLS بتخفي كل
--     الجداول (coalesce(settings->account->status in (active,trial))).
--   * trg_guard_account بيفرض trial ١٤ يوم على أي INSERT، وبيمنع تعديل
--     account إلا من super_admin. فبنعطّله لحظة واحدة داخل نفس المعاملة
--     ونرجّعه فوراً — العملية كلها ذرّية، ومفيش لحظة الـ trigger فيها
--     معطّل بعد الـ commit.
-- الحساب ده حساب عرض عام بالتصميم، فمشكلة «عمر الاشتراك» مش قائمة.
alter table public.doctors disable trigger trg_guard_account;
update public.doctors
   set settings = jsonb_set(settings, '{account}',
                            '{"status":"active","endsAt":"2099-12-31"}'::jsonb, true)
 where id = (select id from auth.users where email = 'demo@clinic.dev');
alter table public.doctors enable trigger trg_guard_account;

-- (٩) وصفة التنظيف — معطّلة عن قصد، شغّلها بإيدك لو عايز تمسح الديمو ----
-- (كل الصفوف مربوطة بـ doctor_id، و on delete cascade بيمسح التابع)
-- delete from public.patients
--  where doctor_id = (select id from auth.users where email = 'demo@clinic.dev');
-- delete from public.plans
--  where doctor_id = (select id from auth.users where email = 'demo@clinic.dev');
-- delete from public.clinics
--  where doctor_id = (select id from auth.users where email = 'demo@clinic.dev');
-- (حذف حساب Auth نفسه من Authentication → Users في لوحة Supabase)

commit;
