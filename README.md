# Clinic management system (عيادتي)

A clinic app for Arabic-speaking clinics: patients, appointments, measurements, lab results,
nutrition plans — plus a portal where a patient can follow their own readings.

**Live staging:** https://clinic-staging.kemo8298.workers.dev — the login screen has a **دخول ديمو**
button. No account, no QR code.

![dashboard](./preview.png)

## Why it looks the way it does

The first version assumed a doctor sitting at a desk with good internet. They don't sit at a
desk, and the internet isn't good. The connection drops in the middle of a patient visit, and
the visit doesn't stop — so the app keeps taking input anyway. Writes go into a local queue and
sync when the connection comes back, with rules for what happens when two devices touched the
same record.

Every table has row-level security, so a clinic can only read its own patients even if someone
calls the API directly with the public key. That key is the only credential that ships to the
browser — the schema is excluded from the published bundle. The patient portal reads through
RPCs rather than tables, so a patient never gets table access at all.

It's vanilla JavaScript, thirty modules, no framework. That was right for the first six months
and wrong after — the state syncing is manual where React would have made it boring. I'm
rebuilding the dashboard in React and TypeScript to see where the trade actually pays off.

## Demo

One button opens a seeded clinic: two branches, six patients, appointments across today / next
week / cancelled, weight trends that move, glucose and blood-pressure series, labs, a nutrition
plan and visit notes. Nothing is mocked in the templates — the numbers come back through the
same RLS-scoped queries a real clinic uses.

- `sql/demo_account_seed.sql` — the data. Fixed UUIDs, `on conflict (id) do nothing`, every row
  carries the demo `doctor_id`, and a barrier aborts the run if the account already holds
  patients outside the seed. Phones are all `+2019…`, a prefix no Egyptian carrier allocates.
- `sql/migrations/20261118_demo_account.sql` — 2FA stays mandatory for every doctor. The demo is
  exempted **by uid**, in the RLS policies and in `js/db.js` (`DEMO_UID`), so the two layers
  can't drift. A frontend-only exemption would render empty tables: the `require_mfa` policies
  are `RESTRICTIVE` and demand `aal2` on the rows themselves. `superadmins`, `admin_notes`,
  `system_settings` and `audit_logs` keep `aal2` and stay invisible to it.
- `tests/demo-account.test.cjs` — the test that matters is the negative one: a *different* uid
  must still hit the TOTP gate.

The account's subscription is `active` so the demo doesn't expire and take the data with it —
`clinic_active()` returns false for a lapsed trial, and RLS then hides every row.

## What isn't done

A clinic is not a place to be optimistic:

- Patient login is a permanent access code plus a phone number. OTP is designed and deferred.
- The MFA migration exists but hasn't been rolled out with a recovery path I'd trust.
- Alerts are in-app only. This is not an emergency notification system.
- No end-to-end suite against a real Supabase instance. The Node tests use mocks, which is not
  the same thing.

## Run it

```bash
git clone https://github.com/kareeem7/clinic.git && cd clinic
npm test        # Node test runner, no dependencies needed
npm run meta    # regenerates page meta from site.config.json
```

No build step. Cloudflare serves the repository assets directly, which is why `wrangler.toml` is
three lines and why `.assetsignore` does real work — it keeps SQL, tests and docs out of the
published bundle.

---

# التوثيق الهندسي

## الإصلاح المركزي (2026-11-06)

> هدف التعديل: **مصدر واحد** لكل حاجة كانت متكررة أو مكشوفة، بدل تعديل كل ملف لوحده.

| البند | المصدر الوحيد | الناتج |
|---|---|---|
| مخطط التأسيس | `sql/baseline.sql` | لا SQL ولا أسماء جداول في المتصفح؛ `sql/` مستبعد من النشر؛ كل اختبارات المخطط تقرأ منه |
| إعداد السيرفر | `js/config.js` | Project URL + مفتاح `anon` العام فقط + `TRIAL_DAYS` + `APP_BRAND`. ممنوع `service_role` أو أي سر في `js/` |
| هوية الواجهة | `APP_BRAND` | تُقرأ من `config.js`، وبعد الدخول تُستبدل من `State.settings` / جدول `clinics`. لا أسماء عيادات أو أرقام ثابتة |
| عناوين الصفحات | `site.config.json` + `npm run meta` | يولّد بلوك `SITE-META` في `index.html` و`reset.html` (title، وصف، OG، favicon) + `robots.txt` و`sitemap.xml`. المولّد idempotent |
| ترويسات HTTP | `_headers` | `X-Frame-Options`، `frame-ancestors 'self'` (التي **لا تصح داخل `<meta>`**)، `X-Content-Type-Options`، `Referrer-Policy`، `Permissions-Policy` |
| شاشة التعذّر | `#setupView` | «تعذّر الاتصال بالسيرفر» + زر إعادة المحاولة فقط، بلا صندوق SQL ولا طلب لصق مفاتيح |

✅ **بناء الإنتاج على `main` نجح** (Workers Builds: `clinic-staging`, رجع `success`). `compatibility_date`
مثبّت على تاريخ في الماضي لأن Cloudflare يرفض المستقبل. نجاح البناء ≠ اختبار متصفح فعلي.

## إعداد قاعدة البيانات

- SQL التأسيس في **`sql/baseline.sql`** — خارج حزمة المتصفح تماماً: `.assetsignore` يستبعد `sql/`،
  فمفيش DDL ولا سياسات RLS ولا أسماء جداول في أي ملف يصل للمتصفح. `tests/central-hardening.test.cjs`
  يمنع رجوع أي `create table`/`create policy` إلى `js/` أو `index.html`.
- الترحيلات في `sql/migrations/` بتترتيب زمني، ولازم مراجعتها واعتمادها على بيئة غير إنتاجية قبل
  التطبيق. كون بعض الأوامر idempotent لا يجعل كل ترتيب نشر آمناً — **لا تشغّل** التأسيس والترحيلات
  معاً على قاعدة قائمة.
- `20261101_require_mfa.sql` يفرض `aal2` على بيانات الأطباء: احصر الحسابات القائمة، وتأكد من TOTP
  لكل واحد، وجرّب مسار الدخول/الاستعادة في staging **قبل** الترحيل.
- السكر يُسجّل بوحدة ثابتة `mg/dL`؛ تنبيه أدنى من 70، وأشد أدنى من 54. الضغط أعلى من 180/120
  يُظهر تنبيه للطبيب. القراءات **التاريخية** بلا وحدة تبقى غير محددة ولا تُصنّف آلياً.
- `20261106_patient_photo_cleanup_queue.sql` بيضيف صور المريض المحذوف لطابور تنظيف؛ محتاج كمان
  نشر `purge-patient-photos` وجدولتها وVault.
- **حالة الجاهزية السريرية: غير جاهز لبيانات مرضى حقيقية.** تأجيل OTP يعني أن الكود الدائم المطبوع
  + رقم الموبايل يفتحان ملف المريض، والكود يُخزَّن **كما هو**؛ أضف أن MFA وتنظيف الصور محتاجين
  إعداد واختبار فعلي.

## فروع العيادة (الدفعات ١–٣)

> **قرارات مسجّلة:** الدكتور **لوج واحد** لكل عياداته؛ **بادئة الكود يختارها الدكتور** بنفسه؛
> **كود المريض دائم بلا زر تغيير**؛ والمريض ممكن يبقى له **أكتر من لوج إن** لو راح لأكتر من فرع.

- `20261111_multi_clinic_branches.sql` أضاف جدول `clinics` وعمود `clinic_id` على الجداول السريرية،
  بقيد مركّب يضمن إن الفرع تابع لنفس الدكتور. كل الفروع مملوكة لنفس الحساب، فسياسات RLS
  (`auth.uid() = doctor_id`) **ما اتغيّرتش** — السياسة الجديدة على `clinics` بس بنفس الشكل.
- `clinics.code` فريد عالمياً عشان البادئة تعرّف العيادة بالظبط. يبدأ `NULL` لحد ما الدكتور يختاره،
  ويتقفل بعد أول كود مريض عشان الكرارت المطبوعة ما تبطلش.
- `20261113_active_clinic.sql` أضاف `set_row_clinic_id()` وترايجر `BEFORE INSERT` على الجداول
  السريرية: أي صف جديد — حتى من جوّه RPC — يتوسم تلقائياً بفرع `doctors.settings->>'activeClinicId'`.
- مُبدّل «الفرع الحالي» في الشريط الجانبي بينادي `save_clinic_settings({ activeClinicId })` (RPC
  موجودة أصلاً) ويعيد تحميل القوائم. الفلترة بـ `clinic_id` **عرضية داخل نفس الحساب**، مش عزل
  أمني — العزل لسه RLS + القيد المركّب.
- `portalBirthDate()` **اتشالت نهائياً** من `js/patient-portal.js`.
- `DB.dumpAll()` بيصدّر جدول `clinics` كمان، و**ما بيصدّرش** `patient_portal_credentials`.

### إرسال الكود واتساب بدون ما يظهر في أي لينك

واتساب بيحط أي «رسالة جاهزة» بعد `?text=` **جوه الرابط**، فيبقى الكود في تاريخ المتصفح والسجلات.
لذلك الزر **مش بيستخدم `?text=` ولا `encodeURIComponent` على الكود**:

1. بينسخ رسالة كاملة للحافظة (الكود + لينك `?portal=1` + تعليمات) محلياً على جهاز الدكتور.
2. بيفتح `https://wa.me/<رقم>` فاضية بـ `noopener,noreferrer`.
3. الدكتور يلصق ويبعت.

الكود محفوظ في متغير ذاكرة أثناء عرض الملف بس: **مش في لينك، ولا `data-*`، ولا في الاستعلام**.

## دخول بوابة المريض (كود دائم — OTP مؤجّل)

> **قرار مسجّل:** الدخول بكود **دائم** تسلّمه العيادة + رقم الموبايل. الكود **لا يتغيّر أبداً ولا
> يوجد زر تغيير**. التحقق برمز SMS **مؤجّل**، وسيُفعّل في **أول تجربة فعلية** كـ **طبقة فوق الكود**،
> مش بديل عنه.

- شكل الكود بعد التقصير: `SHB1-482913` — البادئة تعرّف الفرع ويختارها الدكتور، وبعدها ستة أرقام
  من السيرفر. الشكل القديم الطويل لسه مقبول، لأن **مفيش تدوير** لأي كود اتسلّم.
- ⚠️ ستة أرقام = **مليون احتمال** فقط. التعويض: توليد متكرر حتى 12 مرة، وقفل تخمين 5 محاولات /
  15 دقيقة لكل (فرع + رقم)، والكود لوحده ما يكفيش لازم رقم المريض.
- `20261112_patient_access_codes.sql` هو **التعريف الفعّال الوحيد** للدخول: بيمسح الدالة القديمة
  ويمنح التوقيع الجديد لـ `anon`.
- **تخزين الكود كما هو** (قرار صريح) عشان يفضل ظاهر للدكتور وللمريض دائماً. ⚠️ **النتيجة:** أي جهة تقرأ الداتابيز مباشرة تقدر تدخل كأي مريض. التعويض: `patient_portal_credentials` بلا أي سياسة RLS
  (غير مرئي للمتصفح)، والوصول كله عبر RPC `security definer`، والجدول مش في `DB.dumpAll()`.
- بما إن **مفيش زر تغيير**، الكارت لو ضاع **ما لهوش استرجاع آمن**؛ المتاح زر **إيقاف** البوابة
  (`set_patient_portal_access`) اللي بيمسح الجلسات فوراً.
- **ترحيلات الدخول القديمة تاريخية الآن:** `20261103` (قفل ذري) → `20261105_patient_portal_phone_otp.sql`
  (OTP بجلسة هاتف) → `20261109` (تعطيل مؤقت) → `20261111_multi_clinic_branches.sql` (الفروع) →
  `20261112` (الكود الدائم) → `20261113_active_clinic.sql` (الحالة الحالية). و
  `20261110_fix_portal_phone_normalization.sql` مستقل ولسه مستخدم في تطبيع أرقام `+20`.
- ⚠️ `20261105` مكتوب على التوقيع القديم؛ قبل تفعيل OTP لازم **إعادة أساس** له على التوقيع الجديد
  ليبقى طبقة فوق الكود. العميل لسه ما يملكش `signInWithOtp` / `verifyOtp` ولا شاشة SMS. تطبيق
  الترحيل لوحده هيخلي `auth.uid() = null` ويمنع كل المرضى.
- لو عدّلت `20261112` في مكانه (زي ما حصل في التقصير)، **أعد تشغيل الملف** على المشروع.

### قائمة تفعيل OTP في أول تجربة فعلية

1. تفعيل Phone Auth ومزود SMS وحدود الإرسال في Supabase، واختبار الاستلام.
2. بناء مسار العميل: عميل منفصل للمرضى، إرسال، شاشة رمز، تحقق، ثم `patient_portal_login`.
3. **إعادة أساس** `20261105` على التوقيع الجديد + شرط `phone_confirmed_at` + سحب صلاحية `anon`.
4. تحديث `sql/baseline.sql` و`tests/portal-login-security.test.cjs` (اللي بيثبت **غياب** OTP حالياً).
5. اختبار staging بطلبات حقيقية وبيانات اصطناعية.
6. قبل أي بيانات حقيقية: MFA للأطباء، نشر `purge-patient-photos` وجدولتها، ومراجعة RLS/RPC على
   قاعدة فعلية.

## استعادة كلمة المرور

- الصفحة مستقلة: `reset.html` + `js/reset.js`. `DB.resetPassword` يرسل `redirectTo` مشتق من مسار
  الاستضافة الحالي، مش نطاق ثابت.
- **إعداد Supabase المطلوب:** أضف `https://<your-domain>/reset.html` إلى **Authentication → URL
  Configuration → Redirect URLs**، واضبط **Site URL**. بدونه Supabase يرفض الرابط.
- تدعم PKCE والرابط القديم، وتنتظر `PASSWORD_RECOVERY`، وتنهي جلسة الاستعادة (aal1) بعد الحفظ.
- لو **Confirm email = ON**، تسجيل طبيب جديد يفشل بـ `confirm-email` لأن `DB.register` محتاج جلسة
  فورية قبل MFA. للتجربة: عطّل التأكيد أو جهّز مسار تأكيد قبل الإطلاق.
- `tests/password-recovery.test.cjs` تغطي المسار بمحاكاة؛ **لم يُختبر** على مشروع Supabase أو بريد
  فعلي بعد.

## تجربة العرض (ديمو ببيانات اصطناعية)

> **بيانات وهمية 100%**، على **مشروع تجريبي منعزل فقط**. لا بيانات مرضى حقيقية ولا لقطة قاعدة
> حقيقية في المستودع.

- السكربت: `sql/demo_seed_synthetic.sql`. نفّذه من SQL Editor بعد التأسيس أو الترحيلات.
- ① أنشئ حساب بالبريد `demo-doctor@clinic.invalid` ② سجّل الدخول مرة واحدة (لإنشاء صف `doctors`)
  ③ نفّذ السكربت.
- يزرع 4 مرضى، منحنى قياسات، قياس من البوابة، InBody، مواعيد بحالاتها، ملاحظات، تحليل، وقراءات
  سكر/ضغط — مع تفعيل الأقسام السريرية الاختيارية للعرض.
- الهواتف تبدأ بـ `+2019` (بادئة غير مخصصة → غير قابلة للاتصال)، والأسماء تبدأ بـ «تجريبي».
  بوابة المريض تُجرّب بالأكواد الثابتة `DEMO1-000001` … `DEMO1-000004` + الرقم.
- آمن للتكرار، ويرفض العمل لو لقى بيانات مرضى أخرى، وكل الصفوف مقيدة بـ `doctor_id`. وصفة التنظيف
  في آخر الملف **معطّلة بتعليقات**.

## الأوفلاين (الدفعات ١–٤ من ٤)

> **قرارات صاحب المشروع:** الدفتر على **جهاز صاحبه فقط** — صريحاً **جهاز العيادة وموبايل المريض معاً** (لا نسخة سحابية ولا جهة ثالثة)؛ وأي تعارض بيطلع **تنبيه للدكتور** بدل ما يتصلّح أوتوماتيك.

| الطبقة | التنفيذ |
|---|---|
| `js/offline.js` | شريط حالة (بدون نت / عدد المعلّق / تنبيه المراجعة) + **الدفتر المشفّر**: `IndexedDB` فقط، `AES-GCM` بمفتاح 256 بت عشوائي على الجهاز |
| `sw.js` | نسخة من الموقع على الجهاز، فالصفحة تفتح بدون نت. 🚫 **لا يتدخل ولا يخزّن أي طلب لـ `supabase.co`** |
| مبدأ التصميم | **مفيش توكن ولا كود دخول جوه الدفتر** — بنخزّن علامة `__session` بس، والتوكن يُقرأ وقت الرفع |
| الصور | **الصور بقت جوه الدفتر** (مشفّرة، حتى 5MB)؛ لو الرفع فشل بيطلع تعارض `attachment` بدل ما تضيع بصمت |
| منع التكرار | `measurementLooksUploaded()` بيسأل البوابة قبل رفع أي قياس وزن |
| النسخة الاحتياطية | `js/offline-snapshot.js` نسخة **للقراءة فقط** بعد reload، وترفض العمل لو مفيش توكن جلسة في نفس المتصفح |
| تذاكر المراجعة | `20261114_offline_conflict_tickets.sql`: جدول + 3 دوال. التذكرة **بلا أي اسم مريض ولا قيم سريرية** |

⚠️ **قيود لازم تعرفها:** أول دخول لازم يكون بالنت (الأوفلاين معناه «أنت داخل بالفعل»)؛ حد 20 كتابة
يومياً ونافذة 7 أيام على السيرفر لسه ساريين وقت الرفع؛ **OTP/SMS لسه مؤجّل** فلما يتفعّل هيتظبط مع
عامل الرفع؛ نسخة الدكتور قراءة فقط وجزئية؛ وService Worker محتاج HTTPS وأول زيارة بالنت.

- **الاختبار:** لحد دلوقتي كل الاختبارات `node:test` بمخازن ذاكرة ومحاكاة، **مش متصفح ولا E2E**.
  المطلوب: دخول → تسجيل قياس + صورة → قفل التبويب → reload أوفلاين → إعادة النت → التأكد إن كل حاجة
  اترفعت بالترتيب ومن غير تكرار. الاختبار الفعلي على جهاز هو اللي بيحوّل الكود من «معمارياً سليم»
  لـ «مجرّب فعلاً».

## رفع صور بوابة المريض

الدالة في `supabase/functions/portal-photo-upload/` و**منشورة وACTIVE**. `verify_jwt = false` لأن
البوابة تستخدم رمز المريض لا JWT؛ التحقق الفعلي جوّه الدالة عبر RPC مقصور على `service_role`.
`standalone.ts` نسخة ملف واحد للنشر عبر Management API (ولّدها بـ `node scripts/build-edge-standalone.mjs`).
⚠️ لسه مطلوب **اختبار HTTP فعلي** بصورة اصطناعية وتوكن صحيح، بما فيه التوكن المنتهي والحجم الغلط.

## قيود معروفة قبل الإطلاق الأول

- **OTP/SMS مؤجّل** حتى أول تجربة فعلية، و`20261105` يحتاج إعادة أساس على التوقيع الجديد.
- **الكود الدائم مخزون كما هو وبلا زر تغيير:** لا استرجاع آمن عند فقدان الكارت، وأي جهة تقرأ الداتابيز مباشرة تقدر تدخل كأي مريض.
- **النسخة الاحتياطية:** `DB.dumpAll()` يصدّر `patients` و`appointments` و`patient_notes` و`plans`
  و`patient_records` و`clinics` فقط، **ولا يشمل** `patient_labs` ولا `patient_health_readings` ولا
  `patient_portal_credentials`، ومفيش مسار استيراد.
- **الصور والاحتفاظ:** الدالتان منشورتان، ويتبقى Vault + `pg_cron` + اختبار staging — وجود الدالة
  لوحدها لا يمسح شيئاً.
- **الاختبارات:** `node:test` بمحاكاة وفحوص SQL ثابتة؛ لا RLS/RPC على PostgreSQL فعلي. لازم اختبار
  عزل العيادات على قاعدة منعزلة قبل أي بيانات حقيقية.
- **تأكيد البريد واستعادة كلمة المرور:** لم يُختبرا على مشروع Supabase حقيقي.
- **ديون تقنية:** `sql/baseline.sql` ملف يدوي مش مولّد من الترحيلات؛ تنبيهات السكر/الضغط تغطي
  الحالات الشديدة فقط ولا يوجد إشعار دفع للطبيب.

## الاختبارات

```bash
npm test    # node --test tests/*.test.cjs — 42 ملف، محاكاة DOM/RPC وفحوص SQL ثابتة
```

لا توجد مجموعات `tests/pgtap/` ولا `tests/e2e/`، ولا إعداد Playwright/Cypress. اختبار
`tests/portal-login-security.test.cjs` بيتحقق إن **آخر تعريف فعّال** لدخول البوابة داخل
`sql/baseline.sql` يطابق قرار تأجيل OTP.

## سجل الحوادث

الحوادث اللي حصلت أثناء التطوير (`2026-11-06`) اتنقلت بالكامل إلى
[`docs/INCIDENTS.md`](docs/INCIDENTS.md) — بما فيها حذف مشروع Supabase القديم، ومشاكل بناء
Cloudflare، وشريط الأوفلاين اللي كان بيغطي الهيدر. القرارات الناتجة عنها موجودة فوق في الأقسام.
