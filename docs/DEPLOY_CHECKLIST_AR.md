# قائمة تنفيذ النشر — علّم على كل بند بعلامة ✅

**الوقت المتوقع:** ٩٠ دقيقة · **التكلفة:** ٠ جنيه
اتبعها بالترتيب. لو بند فشل، متكمّلش — صلّحه الأول.

---

## المرحلة أ — Supabase (١٥ دقيقة)

- [ ] **أ١** حساب على [supabase.com](https://supabase.com) → **New project**
  - الاسم: `clinic-prod` · **Region:** `eu-central-1` · كلمة سر قوية محفوظة
- [ ] **أ٢** **SQL Editor** → افتح `js/config.js` وانسخ كل النص بين `` const SUPABASE_SQL = ` `` و `` `; `` → **Run**
  - الناتج المتوقع: `Success. No rows returned`
  - ⚠️ **متشغّلش** أي ملف من `sql/migrations/` فوقه
- [ ] **أ٣** **Project Settings → API** → انسخ:
  - `Project URL` → `https://xxxx.supabase.co`
  - `anon public` key
- [ ] **أ٤** **Authentication → Providers → Email** → عطّل **Confirm email** (للتجربة)
- [ ] **أ٥** **Authentication → URL Configuration**
  - `Site URL` = رابط Cloudflare (من المرحلة ب)
  - `Redirect URLs` = `https://<domain>/reset.html`
  - ⚠️ البند ده بعد المرحلة ب — ارجع له

---

## المرحلة ب — النشر (٢٠ دقيقة)

اختر **مسار واحد** فقط:

### ب-١: من Git (موصى به — نشر تلقائي)

- [ ] **ب١** ارفع المستودع على GitHub
- [ ] **ب٢** [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git**
- [ ] **ب٣** اختر المستودع، وفي إعدادات البناء:
  - **Framework preset:** `None`
  - **Build command:** *(اتركه فاضي تمامًا)*
  - **Build output directory:** `/`
- [ ] **ب٤** **Save and Deploy** → هتاخد رابط `xxx.pages.dev`

### ب-٢: رفع مباشر (بدون Git)

- [ ] **ب١** شغّل `./scripts/build-dist.sh` على جهازك
- [ ] **ب٢** Cloudflare → **Create → Pages → Upload assets**
- [ ] **ب٣** اسحب **محتوى** مجلد `deploy/` (مش المجلد نفسه)
- [ ] **ب٤** **Deploy**

> ✅ تنبيه: قبل الرفع شغّل `./scripts/preflight.sh` — لازم يطبع 🟢.

---

## المرحلة ج — الربط (١٠ دقايق)

- [ ] **ج١** افتح `js/config.js` وضع الـ URL والـ anon key من **أ٣**
- [ ] **ج٢** أعِد النشر (Git: commit + push · مباشر: `build-dist.sh` وأعد الرفع)
- [ ] **ج٣** ارجع لـ **أ٥** وحدّث الروابط بالدومين الفعلي
- [ ] **ج٤** اختبر افتتاح الموقع — لازم يظهر شاشة الدخول **بدون** كلمة «وضع تجريبي»

---

## المرحلة د — الأسرار والتشغيل الآلي (١٠ دقايق)

GitHub → **Settings → Secrets and variables → Actions**:

- [ ] **د١** `SUPABASE_DB_URL`
  - من Supabase → **Project Settings → Database → Connection string → URI**
  - الشكل: `postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres`
  - ⚠️ **مش** الـ API URL. ده أشهر غلط.
- [ ] **د٢** `SUPABASE_URL` = `https://xxxx.supabase.co`
- [ ] **د٣** `SUPABASE_ANON_KEY` = الـ anon key
- [ ] **د٤** تبويب **Actions** → **Tests** → لازم يبقى أخضر
- [ ] **د٥** **Nightly backup** → **Run workflow** → استنى → نزّل الـ artifact
- [ ] **د٦** **Keep free project awake** → **Run workflow** → لازم يطبع `project is active`

---

## المرحلة هـ — اختبار المسار الكامل (١٥ دقيقة)

افتح الموقع واعمل الآتي بالترتيب:

- [ ] **هـ١** تسجيل دكتور جديد (بريد + باسورد + اسم + تخصص)
- [ ] **هـ٢** إعداد MFA (امسح QR بـGoogle Authenticator وأدخل الكود)
- [ ] **هـ٣** الدخول للوحة التحكم
- [ ] **هـ٤** إضافة مريض جديد
- [ ] **هـ٥** إضافة قياس وزن
- [ ] **هـ٦** حجز موعد
- [ ] **هـ٧** من **الإعدادات → الفروع** → اختر بادئة للفرع (مثلاً `TST1`)
- [ ] **هـ٨** من **ملف المريض** → **كود دخول بوابة المريض** → هيظهر كود زي `TST1-123456`
- [ ] **هـ٩** افتح **بوابة المريض** → الكود + رقم المريض → لازم يفتح ملفه
- [ ] **هـ١٠** من `reset.html` → جرّب **استعادة كلمة المرور** ببريد حقيقي
- [ ] **هـ١١** خروج ودخول تاني

> لو **هـ٧** مش لاقي زر الفروع: يظهر لما يكون فيه فرع أو أكتر — الدكتور الجديد بياخد فرع افتراضي تلقائيًا.

---

## المرحلة و — الاسترجاع (٢٠ دقيقة) ⚠️ أهم مرحلة

**نسخة احتياطية ما اتجرّبتش = مفيش نسخة احتياطية.**

- [ ] **و١** نزّل ملف الـ dump من GitHub Actions artifacts
- [ ] **و٢** أنشئ مشروع Supabase تاني مجاني (staging) وشغّل عليه `SUPABASE_SQL`
- [ ] **و٣** من جهازك: `./scripts/restore.sh clinic-*.dump "<رابط قاعدة staging>"`
- [ ] **و٤** افتح staging واتأكد إن المرضى والمواعيد موجودين
- [ ] **و٥** **سجّل النتيجة في `docs/RUNBOOK.md`**: التاريخ، حجم النسخة، عدد الصفوف، هل نجح

---

## المرحلة ز — التدوين والتسليم

- [ ] **ز١** اكتب في `docs/RUNBOOK.md`: رابط المشروع، رابط الموقع، أين كلمة سر القاعدة، من يملك الحسابات
- [ ] **ز٢** لوحة Cloudflare: فعّل **Always Use HTTPS**
- [ ] **ز٣** اختبر `https://<domain>` — لازم يقفل على قفل أخضر
- [ ] **ز٤** راجع تقرير الأمان على [securityheaders.com](https://securityheaders.com) باستخدام الدومين

---

## ❌ متعملش كده

| الغلط | الصح |
| --- | --- |
| تحط الـ API URL في `SUPABASE_DB_URL` | Connection string من تبويب **Database** |
| تشغّل `SUPABASE_SQL` + الترحيلات مع بعض | واحدة منهم بس على قاعدة جديدة |
| ترفع مجلد `tests/` أو `sql/` | استخدم `build-dist.sh` |
| تضع `service_role` في أي ملف JS | الـ anon key فقط |
| تفعّل `Confirm email` قبل بناء مسار التأكيد | عطّله دلوقتي |
| تفرح بالنسخة الاحتياطية من غير تجربة استرجاع | نفّذ المرحلة **و** |

---

## لو حصلت مشكلة

| الأعراض | السبب | الحل |
| --- | --- | --- |
| الموقع يفتح في «الوضع التجريبي» | `config.js` فاضي | املأ URL + anonKey وأعد النشر |
| `Invalid API key` | مفتاح غلط أو مسافات | أعد النسخ بدون مسافات |
| التسجيل يرمي `confirm-email` | التأكيد مفعّل | عطّله (أ٥) |
| استعادة الباسورد لا يصل | Redirect URL ناقص | أضف `/reset.html` (أ٥) |
| `pg_dump: command not found` | PostgreSQL غير مثبت | ثبّت PostgreSQL client |
| `password authentication failed` | كلمة السر في الرابط غلط أو فيها `@` | أعِد نسخها من لوحة Supabase |
| الموقع `404` | رفعت مجلد `deploy` نفسه | ارفع **محتواه** |
| الـ backup حجمة صغير جدًا | اتصال بمشروع فاضي | راجع `SUPABASE_DB_URL` |
