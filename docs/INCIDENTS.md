# سجل الحوادث (2026-11-06)

> ده الأرشيف الكامل للحوادث اللي كانت متفرقة جوّه `README.md`. اتشالت من الـ README
> لأنه بقى صفحة تعريف بالمشروع، ومينفعش زائر يعدّي على ٢٠٠ سطر عن مشاكل اتحلّت.
> القرارات الهندسية اللي اتاخدت منها موجودة في الـ README؛ التفاصيل هنا للرجوع.

### حادثة 2026-11-06 — «غير متصل بالخادم» عند تسجيل الدخول

| البند | الحقيقة |
|---|---|
| المشروع القديم `clinicv2` / `phmkvbszyaqagezpaduz` | ❌ محذوف نهائياً من Supabase (Management API يرد `Resource has been removed`؛ النطاق لا يُحل DNS) |
| المشروع الحالي `clinicv3` / `xfppempsztxidjmlwrza` | ✅ `ACTIVE_HEALTHY` لكافة الخدمات (auth/db/rest/storage/pooler)، `/auth/v1/health` يستجيب |
| الجداول والدوال وسياسات RLS | ✅ 17 جدول + 17 دالة RPC + 33 سياسة RLS + bucket واحد — المخطط سليم |
| **البيانات** | ⚠️ **صفر**: 0 مستخدمي Auth، 0 أطباء، 0 عيادات، 0 مرضى. الحسابات القديمة لا يمكن استعادتها تلقائياً؛ أنشئ حساباً جديداً من شاشة «حساب جديد» أو استعد نسخة احتياطية إن وُجدت |

**أسباب ظهور الرسالة (مترابطة):**
1. أي طلب لمشروع محذوف يفشل بـ `Failed to fetch`، فيُترجم في `js/utils.js` إلى «تعذّر الاتصال بالخادم — تحقق من الإنترنت وأعد المحاولة».
2. الـ Service Worker القديم `clinic-shell-v2` كان يخزّن `./js/config.js` بسياسة cache-first، فظلّ يقدّم **عنوان المشروع المحذوف** من كاش المتصفح حتى بعد تعديل الملف على الخادم. لهذا رُفع `CACHE_NAME` إلى `clinic-shell-v4` كي يمسح الكاش القديم عند التفعيل.
3. النسخة المنشورة استخدمت مفتاح `sb_publishable_...` بينما مكتبة `supabase-js@2.118.0` مثبّتة بـ SRI؛ استُخدم بدلاً منه مفتاح `anon` (JWT) الخاص بنفس المشروع لضمان التوافق.

### حادثة 2026-11-06 (٢) — خطأ تسجيل الدخول بعد إنشاء حساب جديد

| البند | الحقيقة |
|---|---|
| `auth.signUp` | ✅ أنشأ المستخدم وأكّد بريده (`kemo8298@gmail.com`) وسجّل عاملاً TOTP |
| `public.doctors` / `public.clinics` | ❌ كانوا **صفر صفوف** |
| النتيجة | `loadSettingsRow()` يرمي `clinic_profile_missing` → «تعذّر العثور على ملف العيادة…» |

**السبب:** «Confirm email» مفعّل في Supabase، فـ `signUp()` بيرجع **بدون session**، و`DB.register()` كان يرمي `confirm-email` **قبل** إدراج صفّي `doctors`/`clinics` (الإدراج محتاج `auth.uid()` تحت RLS). بعد تأكيد البريد ونجاح الدخول + MFA، mفيش صف دكتور فيسقط التحميل.

**الإصلاح (مركزي + آمن):**
- `DB.readDoctorSettings()` → عند غياب الصف يستدعي `ensureDoctorProfile()` مرة واحدة، يعيد القراءة، ثم يكمّل.
- `ensureDoctorProfile()` → `upsert(..., { onConflict:'id', ignoreDuplicates:true })` من بيانات المستخدم (`doctor_name` / `specialty` / `clinic_name`) + فرع افتراضي واحد، بفترة تجربة 14 يوماً. **لا يكتب فوق صف موجود** فلا يُعاد ضبط اشتراك موقوف أبداً.
- `register()` بقى يحفظ `clinic_name` في `user_metadata` عشان الإصلاح يرجّع اسم العيادة الأصلي.
- نسخة الكاش `clinic-shell-v8`، و9 اختبارات جديدة في `tests/profile-self-heal.test.cjs`، و10 في `tests/mfa-login-errors.test.cjs` (303/303).

كمان اتعمل إصلاح فوري لبيانات الحساب الحالي على السيرفر (INSERT فقط، بدون حذف أو تعديل أي بيانات موجودة) ⇒ الدخول يشتغل دلوقتي حتى قبل نشر الكود.

> حل فوري دون انتظار نشر: افتح الموقع في **نافذة خاصة (Incognito)** — لا يوجد Service Worker مسجّل فيها — أو اعمل Unregister للـ Service Worker ثم Hard Reload. بعدها سيتصل بالمشروع الحي، وستحتاج إلى إنشاء حساب جديد لأن قاعدة البيانات فارغة.
>
> تغييرات الفرع لا تظهر على `clinic-staging.kemo8298.workers.dev` إلا بعد رفعها ونشرها.

| البند | الحالة |
|---|---|
| الجداول الأساسية (17 جدول) + `patient-photos` | ✅ موجودة |
| `20261111` / `20261112` / `20261113` (الفروع، الكود الدائم، الفرع النشط) | ✅ **مطبّقة** على المشروع (اتطبّقت يدوياً من SQL Editor، فمش ظاهرة في `supabase_migrations.schema_migrations`). `clinics` و`patient_portal_credentials` و`patients.clinic_id` و`set_row_clinic_id()` و`patient_portal_login(text,text)` كلهم موجودين. **لا تُعد تطبيقها**. |
| `20261107` (الحد اليومي) + `20261108` + `20261110` | ✅ موجودة في سجل الترحيلات |
| `20261114_offline_conflict_tickets.sql` | ✅ اتطبّق في 2026-11-05: الجدول + 3 دوال + سياسة RLS + الصلاحيات. فحص بتوكن غير صالح رجع `{ok:false}` من غير ما يسجّل أي صف. |
| `20261101_portal_photo_upload.sql` | ✅ اتطبّق في 2026-11-05: اتنشأت `patient_portal_photo_authorize` (service_role فقط) و**اتشالت سياسة `portal_photo_insert`** اللي كانت بتسمح بـ INSERT مباشر من `anon` على Storage. |
| Edge Function `portal-photo-upload` | ✅ اتنشرت `ACTIVE` و`verify_jwt = false` (مطابق لـ `supabase/config.toml`). نُشرت كملف واحد `supabase/functions/portal-photo-upload/standalone.ts` لأن الـ Management API بيقبل ملف مصدر واحد؛ نشر الـ CLI يفضل يستخدم `index.ts` + `handler.mjs`. `scripts/build-edge-standalone.mjs` بيولّد النسخة و`tests/edge-standalone.test.cjs` بيمنع أي انحراف. |
| Edge Function `purge-patient-photos` | ✅ `ACTIVE` و`verify_jwt = true` (كانت منشورة قبل كده). ⚠️ **الجدولة و`pg_cron`/Vault لسه مش متظبطة** — وجود الدالة لوحده ما بيمسحش صور. |
| صلاحيات RPC | ✅ فحص `has_function_privilege`: دوال البوابة `anon`، دوال الدكتور `authenticated`، و`patient_portal_photo_authorize` و`offline_ack/list` مقصورة على الأدوار الصحيحة. |
| `portal_photo_read` (SELECT) | ✅ مقصورة على الجلسة المعالِجة (`auth.uid()`), والبوابة أصلاً ما بتعرضش صور. |

**⚠️ نتيجة مهمة:** تشخيص «حدث خطأ غير متوقع = ترحيلات ناقصة» **ما عادش صح** على المشروع ده. الترحيلات والـ RPCs والصلاحيات متطابقة مع الكود. لو الخطأ لسه بيظهر، سببه حاجة تانية (جلسة MFA، الشبكة، أو خطأ في المتصفح) ولازم يتفحص بـ F12 Console + Network + سطر `[clinic] {requestId,...}` — مش يتطبّق SQL تاني.

### حادثة 2026-11-06 (٣) — «حدث خطأ غير متوقع» بعد كتابة كود TOTP

| البند | الحقيقة |
|---|---|
| بيانات الحساب | ✅ سليمة بعد الحادثة (٢): دكتور + فرع + `clinic_active()=true` + تجربة حتى 2026-11-20 |
| Supabase | ✅ 3 جلسات جديدة و3 تحدّيات MFA ناجحة؛ `plans=0` و`audit_logs=0` ⇒ `loadAll()` **لم يُستدعى إطلاقاً** |
| موضع الفشل | داخل `DB.mfaVerify()` نفسها، قبل `routeAfterAuth('ready')` |
| الرسالة | `explainError()` → `authErrorAr(null)` = الرسالة العامة |

**السبب:** `authErrorAr()` كان يعرف `invalid_totp` و`mfa_no_factor` فقط، بينما GoTrue يُصدر أكواداً حقيقية مثل `mfa_verification_failed`، `mfa_challenge_expired`، `mfa_ip_address_mismatch`، `mfa_verification_rejected`، `insufficient_aal`، `session_not_found`. ولا `AuthSessionMissingError` (بلا `code`، رسالته `Auth session missing!`) كان مُترجماً. فوق ذلك `mfaVerify` كان يقرأ `ch.data.id` مباشرة: لو `data:null` بلا `error` يرمي `TypeError`. كل هذه الحالات كانت تسقط في الرسالة العامة، فلا يعرف الدكتور هل الكود غلط، انتهى، اتغيرت الشبكة، أو انتهت الجلسة.

**الإصلاح (مركزي، بلا أي تغيير في Supabase أو SQL أو البيانات):**
- `js/utils.js` → ترجمة 14 كود MFA/جلسة إلى رسائل عربية **تقول إيه المطلوب عمله**، وشبكة أنماط للرسائل التي تصل بلا `error_code`؛ أي خطأ غير معروف يبقى آمناً لكنه يحمل **رقم مرجع** `req-…` يربطه بسطر الـ Console.
- `js/db.js` → `mfaVerify()` يتحقق من `data.totp` و`ch.data.id` قبل الاستخدام، ويرمي `mfa_no_factor` / `session_not_found` بدل `TypeError`.
- `js/main.js` → عند أخطاء الجلسة/انتهاء الرمز يظهر زر **«سجّل الدخول من جديد»** بدل تكرار الكود على شاشة خطأ.
- `js/config.js` → `logError()` يسجّل `code` / `name` / `status` / تصنيفاً محدوداً `shape` (مثل `mfa-challenge-expired`) **بدون نص الرسالة ولا أي بيانات مرضى**.
- `sw.js` → `clinic-shell-v8` لضمان تحميل النسخة الجديدة؛ 10 اختبارات في `tests/mfa-login-errors.test.cjs` تمنع عودة التعمية.

> لم يُغيّر أي إعداد Auth، ولم تُطبّق ترحيلات، ولم تُعد بيانات، ولم تُنشر Edge Functions.


### حادثة 2026-11-06 (٤) — التحقق من الربط بعد حذف المشروع القديم

| الفحص | النتيجة |
|---|---|
| المشاريع المتبقية | `clinicv3` (`xfppempsztxidjmlwrza`, eu-west-1, ACTIVE_HEALTHY) + `teaching-wep` ( unrelated )؛ المشروع القديم محذوف نهائياً ✅ |
| `js/config.js` في المستودع | `https://xfppempsztxidjmlwrza.supabase.co` + anon JWT بـ `ref = xfppempsztxidjmlwrza` ✅ |
| `list_api_keys` | مفتاح `anon` **مطابق حرفياً** لما في الكود ✅ |
| الموقع المنشور `/js/config.js` | مطابق للمستودع، وبلا أي إشارة للمشروع القديم ✅ |
| `/auth/v1/health?apikey=…` | `GoTrue v2.197.0` ⇒ المفتاح يعمل فعلاً على السيرفر ✅ |
| صحة الخدمات | 8/8 `ACTIVE_HEALTHY` · `validate_credential` ناجح ✅ |
| `site_url` / redirect | `https://clinic-staging.kemo8298.workers.dev` (+ `/reset.html`) ✅ |
| البيانات | 1 مستخدم · 1 عامل TOTP مُ.verify · 1 دكتور · 1 فرع · `clinic_active() = true` ✅ |

**إذن الربط سليم تماماً.** سبب استمرار «خطأ غير متوقع» هو إعداد Auth على المشروع الجديد:
`mfa_totp_enroll_enabled = false`، `mfa_totp_verify_enabled = false`، `mfa_allow_low_aal = false`.
كود GoTrue (`internal/api/mfa.go`, `ChallengeFactor`) يرفض إنشاء التحدّي قبل تسجيله برسالة
`MFA verification is disabled for TOTP` / كود `mfa_totp_verify_not_enabled`؛ الدليل على السيرفر:
جلسة جديدة في `13:19` بلا أي `mfa_challenge` بعد `11:53`، و`plans = 0` / `audit_logs = 0`.
بما أن كل سياسات RLS الطبية `RESTRICTIVE` وتشترط `aal2`، فلا يوجد مسار آمن داخل التطبيق لتجاوز ذلك.

**الحل:** تفعيل TOTP/MFA من لوحة Supabase (Authentication ← Sign In / Providers) ثم Hard Reload.
هذا تغيير في إعدادات Auth **لم ينفّذه الوكيل**؛ التغيير الوحيد في الكود هو جعل الرسالة توجّه إلى
صفحة الإعداد بدل «تواصل مع إدارة النظام»، ورفع الكاش إلى `clinic-shell-v8`، مع اختبارين إضافيين (303/303).


### حادثة 2026-11-06 (٥) — مُبدّل الفروع «أبيض على أبيض»

عند إضافة فرع ثانٍ يظهر `<select id="activeClinic">` في الشريط الجانبي (كان مخفياً بـ `.hide`
طالما `clinics.length < 2`). العنصر يحمل class `input` الذي يفرض `background:#fbfdfd`
من `css/components.css`، بينما `#sidebar` يورّث `color:#d8f3ef`. النتيجة: **نص فاتح على
خلفية بيضاء** (تباين < 4.5:1) وغير مقروء.

**الإصلاح:**
- إزالة الـ inline style من `index.html` حتى لا يغطّي ألوان/أحجام ورقة الأنماط.
- قاعدة مخصّصة في `css/layout.css` (`#sidebar`/`.side-brand select#activeClinic`، مُحمّلة بعد
  `components.css`): خلفية داكنة شفافة + نص `#e8fbf8` + حدود فاتحة + سهم SVG بلون `#a7e8df`،
  مع `hover` / `focus` واضحين، و`option` بنص داكن على أبيض، و`.hide` صريح.
- `css/settings.css`: اسم الفرع في قائمة الإعدادات بـ `--ink` والكود كـ chip تركوازي بدل أن
  يرثا `muted` الباهت.
- `tests/branch-switcher-contrast.test.cjs`: 8 اختبارات تحسب تباين WCAG فعلياً من ألوان
  الملفات (≥ 7:1 AAA لكل الحالات)، وتثبت أن التباين القديم كان < 4.5:1، وتحمي ترتيب
  الـ cascade وإخفاء الفرع الواحد.
- `sw.js` → `clinic-shell-v8` · 303/303 اختبار.

لا تغيير في أي منطق JS أو SQL أو بيانات.

### حادثة 2026-11-06 (٦) — الهاتف هو الجهاز الأساسي: تحسين السلاسة والوضوح

الاستخدام الفعلي هيكون من الموبايل في المقام الأول، بينما قواعد `css/responsive.css`
وصُغت أساساً للكمبيوتر. مراجعة الأوراق كشفت سبع نقاط ملموسة:

| المشكلة | الأثر على الهاتف |
| --- | --- |
| حقول `.input` بـ `font-size:14.5px` | Safari على iOS يكبّر الصفحة تلقائياً عند التركيز → قفزة وفقدان موضع المؤشر |
| `.icon-btn.sm` 32px، `.btn.sm` ≈36px، أزرار التنقل ≈48px بخط 10.5px | ضغطات خاطئة ونص غير مقروء |
| `env(safe-area-inset-bottom)` بلا fallback | لو المتصفح لا يدعمه يسقط `calc()` كله؛ الأزرار تلتصق بحافة الآيفون، والـ notch يغطي الشريط العلوي |
| لا `touch-action` ولا `-webkit-tap-highlight-color` | تأخير ~300ms وميضة زرقا مع كل لمسة |
| زر «مريض جديد» يتحوّل لأيقونة بلا `aria-label` (`hide-sm`) | هدف صغير بلا اسم لقارئ الشاشة |
| الحالة النشطة في الشريط السفلي = لون نص فقط | صعوبة معرفة القسم الحالي بسرعة |
| شاشة الدخول: بانر `padding:30px` + `h1:34px` قبل الفورم | حقل البريد يبقى تحت الطية على هاتف صغير |

**الإصلاح** — ملف واحد جديد `css/mobile.css` يُستورد **أخيراً** في `main.css`، فلا يُعدّل أي ورقة قائمة:

- `font-size:16px` لكل `input/select/textarea` على ≤768px — القاعدة الوحيدة التي تمنع zoom iOS.
- أهداف لمس ≥44px لكل عنصر تفاعلي، و54px لأزرار التنقل مع خلفية `--teal-50` وشارة علوية
  (تباين 5.06:1 ≥ AA).
- `env(safe-area-inset-*)` مع `, 0px` fallback في الشريط العلوي، المحتوى، القائمة الجانبية،
  المودال، التنبيهات والشريط السفلي؛ وتصحيح القاعدتين الناقصتين في `overlays.css` و `portal.css`.
- `touch-action:manipulation` + `-webkit-tap-highlight-color:transparent` + رد فعل `:active`
  على شاشات اللمس + `@media (prefers-reduced-motion:reduce)`.
- `overflow-x:clip` داخل `@supports` (لا يُنشئ scroll container، فلا يكسر `position:sticky`).
- Bottom sheet بمقبض بصري + `overscroll-behavior:contain` + مساحة الأمان، على ≤768px فقط.
- `index.html`: `aria-label` لزر «+» وللـ `<nav>`، و`type="search"` / `inputmode` /
  `autocomplete` لحقول البحث وإعادة التعيين.
- `tests/mobile-ux.test.cjs`: 10 اختبارات تستخرج أهداف اللمس من CSS، تحسب تباين WCAG،
  تتحقق من كل `env()`, وتمنع regress في فتح القائمة الجانبية.
- `tests/mobile-ux-preview.html`: معاينة ثابتة قبل/بعد بمقاس 340px (داخل `tests/`، مستبعدة من النشر).
- `sw.js` → `clinic-shell-v9` مع إضافة `./css/mobile.css` إلى `SHELL` · **313/313 اختبار**.

لا تغيير في أي منطق JS أو SQL أو إعدادات Auth أو بيانات أو صلاحيات. الاختبارات هنا ثابتة؛
**التحقق على جهاز/iOS Safari وأندرويد حقيقي ما زال مطلوباً** قبل اعتبار التحسين مؤكداً بصرياً.

### حادثة 2026-11-06 (٧) — شريط «النت مقطوع» كان بيغطي الشريط العلوي

الشريط في `index.html` كان يحمل inline style:
`position:fixed;top:0;left:0;right:0;z-index:9999` مع `flex-wrap:wrap`،
و`#offlineLabel` بـ `flex:1;min-width:200px`، و`#offlinePanel` بـ `flex-basis:100%`.
على هاتف 320–390px النص الطويل بيلفّ ٣ أسطر، ومع الـ chip والزرين واللوحة
يبقى الشريط **٣–٤ صفوف (~146px)**، و**بما إنه `fixed` فوق كل حاجة (`z-index:9999`)
فبيغطي `#topbar` بالكامل، ومن ضمنه زر «إضافة مريض جديد`** — لا يزيح المحتوى ولا
يحترم `safe-area-inset-top`. المشكلة كانت على الكمبيوتر كمان، بس أثرها أكبر على الموبايل.

**الإصلاح** — ورقة مستقلة `css/offline-bar.css` تُستورد أخيراً، والـ inline styles اتنقلت
إليها (نفس نهج إصلاح مُبدّل الفروع):

- `position:sticky` بدل `fixed` ⇒ الشريط بقى **في تدفّق الصفحة**، فبيزيح المحتوى
  لأسفل تلقائياً بدل ما يغطيه؛ `z-index:70` بدل `9999`.
- **سطر واحد**: `flex-wrap:nowrap` + `#offlineLabel{min-width:0;white-space:nowrap;
  text-overflow:ellipsis}` + ارتفاع ثابت `--offline-bar-h` = `calc(46px + env(safe-area-inset-top,0px))`.
- النص التحذيري الكامل (بما فيه «مشفّرة» و«هتترفع أول ما النت يرجع») **ما اتغيّرش**،
  واتحط كمان في `label.title` و`aria-label` على الشريط + `role="status" aria-live="polite"`.
- `#offlinePanel` بقت **طبقة مستقلة** `position:fixed;bottom:0;max-height:70dvh;
  overflow-y:auto`، فالشريط يفضل رفيع مهما كترت التعارضات. ولسه جوّه `#offlineBar`
  في الـ DOM عشان تفويض النقر في `Offline.bindUI` ما ينكسرش.
- `Offline.render()` بيضيف `body.offline-bar-visible`، و`body.offline-bar-visible #topbar
  {top:var(--offline-bar-h)}` بيزاح بيه الـ topbar الـ sticky عند السكرول.
- `#offlineBar[hidden]{display:none!important}` يغلب الـ inline `display` اللي `render()`
  بيضبطه، فالإخفاء ما اتأثرش.
- `tests/offline-bar-layout.test.cjs`: 10 اختبارات تمنع عودة `fixed`/`z-index:9999`/
  `min-width:200px`/`flex-wrap:wrap`، وتتحقق من الإزاحة والـ safe-area والبانل
  ومن **عدم تغيّر ثوابت الأوفلاين** (`assertSafe`، AES-GCM، bypass لـ `supabase.co`، عدم اعتراض الكتابات).
- `tests/offline-bar-preview.html`: معاينة ثابتة قبل/بعد على 320px (داخل `tests/`).
- `sw.js` → `clinic-shell-v10` مع إضافة `./css/offline-bar.css` إلى `SHELL` · **323/323 اختبار**.

لا تغيير في منطق الرفع، التعارضات، التشفير، SQL، Auth، البيانات أو الصلاحيات.
التأكيد البصري على جهاز حقيقي (بعد Hard Reload واحدة) لسه مطلوب.

### حادثة 2026-11-06 (٨) — إرسال لينك صفحة المريض مع الكود

المطلوب: لما الدكتور يبعت كود دخول البوابة للمريض، يتبعت معاه **لينك الصفحة**،
واللينك يفتح **صفحة المريض مباشرة** بدل ما يفتح شاشة دخول الدكتور ويضطر المريض
يدوّر على رابط «أنت مريض؟».

**القيد اللي ما اتكسرش:** من حادثة تقصير الكود، زر الواتساب ممنوع يستخدم `?text=`
لأن الكود الدائم هيبقى مكتوب في تاريخ المتصفح والسجلات. فالحل **ما حطّش الكود في أي URL**،
بل حطّه في **نص الرسالة المنسوخة للحافظة**:

- `js/patient.js`:
  - `portalShareLink()` → `?portal=1` مشتقّ من `location.href` (يمسح query/hash قديم،
    بلا نطاق مثبّت، بلا كود/توكن/بيانات).
  - `patientCodeMessage()` → رسالة جاهزة: تحية + اللينك + الكود + تعليمات الدخول.
  - `sendPatientCodeWA()` بينسخ الرسالة كاملة ويفتح `wa.me/<رقم>` **فاضية** زي ما هي.
  - `copyPortalLink()` + زر `pt-link-copy` + عرض اللينك في كارت الكود (بديل لو الحافظة اتبلّكت).
  - زر «نسخ الكود» (`pt-code-copy`) لسه بينسخ الكود لوحده، ما اتغيّرش.
- `js/main.js`: عند الإقلاع، `?portal=1` (أو `#portal`) → `switchAuthTab('patient')`
  فبيفتح تبويب دخول بوابة المرضى مباشرة. بعد `Portal.login(phone, code)` بيدخل صفحته.
- `tests/patient-code-share.test.cjs`: اتعدّلت لضمان إن الرسالة فيها الكود **واللينك**،
  مع بقاء كل ضمانات «الكود مش في URL / ما فيش `?text=` / `noopener,noreferrer`».
- `tests/patient-portal-link.test.cjs`: 10 اختبارات جديدة للـ deep link، اشتقاق النطاق
  (staging/إنتاج/محلي)، مسح query/hash القديم، غياب الكود من اللينك، graceful degradation
  لو `location` مش متاح، و**عدم تغيّر SQL/Auth/منطق الدخول**.
- `tests/patient-share-preview.html`: معاينة ثابتة لشكل الرسالة ومسار المريض (داخل `tests/`).
- `sw.js` → `clinic-shell-v11` · **333/333 اختبار**.

⚠️ مفيش «دخول تلقائي باللينك» عن قصد: اللينك لو حمل الكود هيبقى ثغرة دائمة
(الكود لا يتغيّر)، فالدخول لسه بيحتاج رقم الموبايل + الكود يتأكدوا على السيرفر.
لا تغيير في أي SQL، ترحيل، RLS، Auth، بيانات أو صلاحيات. التحقق على جهاز/واتساب حقيقي لسه مطلوب.

### حادثة 2026-11-06 (٩) — فشل عابر لوحدة اختبارات `main` بعد دمج #35

**المؤكد:** بعد دمج #35، وحدة `npm test + syntax check` على `main` (`6c5d85f`) طلعت
`failure` في خطوة «Unit tests» خلال ٨ ثوانٍ، رغم أن **نفس الشجرة بالضبط**
(`git diff 5be57cd 6c5d85f` فارغ) نجحت على الفرع مرتين ومحلياً 333/333،
و`Workers Builds: clinic-staging` على `main` نجح، والملفات الحيّة (`sw.js` v11،
`js/patient.js`، `js/main.js`) متأكد منها. سجلات الـ job **غير متاحة** من بيئة الوكيل
(`results-receiver.actions.githubusercontent.com` خارج النطاق المسموح)،
و`gh run rerun` اترفض (`workflow file may be broken`) و`workflow_dispatch` رجع 403
(صلاحيات Actions)، ف**سبب ذلك الفشل بعينه لم يتأكد بشكل قاطع**.

**الاستنتاج المدعوم بالكود:** فحص الاختبارات كشف **race حقيقي بالتصميم**:
`tests/central-hardening.test.cjs` و`tests/edge-standalone.test.cjs` يشغّلان `execFileSync`
لسكربتات **تكتب فعلياً** `index.html` / `reset.html` / `robots.txt` / `standalone.ts`،
بينما `node --test` يشغّل ملفات الاختبار في عمليات **متوازية** → أي اختبار آخر يقرأ
`index.html` في لحظة الكتابة قد يقرأ ملفاً ناقصاً. هذا تفسير معقول لفشل يظهر مرة ويختفي،
ولكنه **استنتاج وليس إثباتاً** لفشل `6c5d85f`.

**الإصلاح الوقائي:** `package.json` → `node --test --test-concurrency=1 tests/*.test.cjs`
(تسلسل ملفات الاختبار، بلا تغيير في أي اختبار ولا في ملفات واجهة منشورة،
لذلك **لم يُرفع `CACHE_NAME`**، و`README` ما زال يشير إلى `clinic-shell-v11`).
`preflight.sh` و CI يستخدمان `npm test` نفسه فيسري عليهما التسلسل.
`tests/test-runner-safety.test.cjs`: 3 اختبارات تثبت الإعداد وتوثّق الملفات التي تكتب.
**336/336 اختبار**، والزمن ما زال ~2.4 ثانية.

> ⚠️ الـ check-run الأحمر على `6c5d85f` سجل تاريخي لا يمكن تعديله بدون صلاحيات Actions؛
> المرجع هو نتيجة أحدث commit على `main`. لا يوجد أي تغيير في SQL أو Auth أو بيانات.
