# ربط مشروع Supabase الجديد + تحديث GitHub

**الهدف:** الموقع المنشور على `clinic-staging.kemo8298.workers.dev` يرجع يشتغل على قاعدة جديدة.
**الوقت:** ~٤٠ دقيقة · **التكلفة:** ٠

> السياق: مشروع Supabase القديم (`phmkvbszyaqagezpaduz`) اتحذف نهائيًا ولا يمكن استرجاعه.
> القاعدة الجديدة تتبني من الصفر — الكود كله موجود في المستودع.

---

# المرحلة ١ — بناء القاعدة الجديدة (١٥ دقيقة)

## ١.١ — إنشاء المشروع
- [ ] Supabase → **New project**
- **Name:** `clinic-prod` · **Region:** `Central EU (Frankfurt)` · **Plan:** Free
- [ ] انسخ **Database Password** واحفظه

## ١.٢ — التثبيت الأساسي

- [ ] **SQL Editor** → **+ New query**
- [ ] افتح `sql/00_install_all.sql` → انسخ **كل** الملف (٢٣٠٥ سطر)
- [ ] الصقه → **Run**

**المتوقع:** `Success. No rows returned`

> ⚠️ **متشغّلش** أي ملف من `sql/migrations/` في الخطوة دي.

## ١.٣ — ترحيل واحد ناقص

`sql/migrations/20261101_portal_photo_upload.sql` — **لازم يتنفذ**. السبب:
دالة `portal-photo-upload` **منشورة فعلًا على Supabase** وبتستدعي `patient_portal_photo_authorize`،
وأمر `create or replace function` مش بيحدّث صلاحيات دالة موجودة. الملف ده بيعمل الـrevoke/grant الصح.

- [ ] افتح `sql/migrations/20261101_portal_photo_upload.sql` → انسخه → **Run**

**المتوقع:** `Success. No rows returned`

> **مش محتاج** تطبّق الـ١٩ ترحيل التانية: التثبيت في ١.٢ بيحتوي نفس التعريفات
> (تحققت: `patient_access_codes` و`active_clinic` و`multi_clinic_branches` كلهم جواه).

## ١.٤ — إضافتان اختياريتان (اتركهم لو مش محتاجهم)

| الملف | إيه | محتاجه؟ |
| --- | --- | --- |
| `20261106_patient_photo_cleanup_queue.sql` | طابور حذف الصور بعد ٣٠ يوم | لاحقًا |
| `20261114_offline_conflict_tickets.sql` | تذاكر تعارض الأوفلاين عبر الأجهزة | لاحقًا |

> التطبيق بيتجاهل غيابهم بأمان — مش هيكسر.

---

# المرحلة ٢ — المفاتيح في الكود (٥ دقايق)

من جهازك، في مجلد المشروع:

```bash
./scripts/set-keys.sh "https://xxxx.supabase.co" "sb_publishable_xxxxx"
```

**الأداة بتعمل إيه:**
1. تفحص الـURL (ترفض `/rest/v1` أو شرطة زيادة)
2. **تفك المفتاح وتقرأ دوره** — لو `service_role` ترفض فورًا وتمنع الكتابة
3. تكتب في `js/config.js` مع نسخة احتياطية
4. تتحقق بـ`node --check` — ولو الملف اتكسر ترجّع النسخة القديمة

**المتوقع:**
```
✅ مفتاح publishable (الشكل الجديد)
تم التحديث
✅ صياغة الملف سليمة
✅ تم الربط بمشروع: https://xxxx.supabase.co
```

### لو على ويندوز بدون bash
افتح `js/config.js` بـNotepad وعدّل **السطرين ٢٢ و٢٣** يدويًا — بنفس الطريقة اللي عملتها قبل كده.

⚠️ **لكن متنساش فحص jwt.io**: لو المفتاح شكله `eyJ...` الصقه في [jwt.io](https://jwt.io) وتأكد `"role": "anon"` مش `service_role`.

---

# المرحلة ٣ — GitHub (١٠ دقايق)

الـPR شغّال على: **https://github.com/kareeem7/clinic/pull/26**

## ٣.١ — راجع الفرق
- [ ] افتح الـPR → تبويب **Files changed**
- [ ] اتأكد إن `js/config.js` فيه مفاتيحك الجديدة
- [ ] اتأكد إن **مفيش** `js/config.js.bak` متتبّع

## ٣.٢ — دمج

**الطريقة الأسهل — من جهازك:**
```bash
git push
```
لو الـPR مش مدموج، ادمجه من الواجهة:
- [ ] **Merge pull request** → **Confirm merge**

**أو من هنا (أنا أعملها):** قولّي «ادمج الـPR» وأنا أنفّذها بالأمر.

## ٣.٣ — إعداد Cloudflare

الـWorker مربوط بمستودعك وبيتحدّث تلقائيًا عند أي push على `main`. بعد الدمج:

- [ ] افتح [Workers & Pages → clinic-staging](https://dash.cloudflare.com)
- [ ] راقب آخر deployment → لازم يبقى **Success**
- [ ] لو فشل: افتح **Build log** وابعتلي الخطأ

> ⚠️ **مهم:** اتأكد إن **Build command** فاضي. المشروع ثابت، وأي أمر build قديم على `dist` هيفشل. الإعداد الصح موجود في `wrangler.toml` (`[assets] directory = "./"`).

---

# المرحلة ٤ — إعدادات Supabase للدومين (٣ دقايق)

- [ ] **Authentication** → **URL Configuration**
- [ ] **Site URL:** `https://clinic-staging.kemo8298.workers.dev`
- [ ] **Redirect URLs** → Add: `https://clinic-staging.kemo8298.workers.dev/reset.html`
- [ ] **Authentication** → **Providers** → **Email** → **Confirm email** = **OFF**

> بدون Redirect URL، زرار «نسيت كلمة المرور» هيفشل بصمت.

---

# المرحلة ٥ — الاختبار (٧ دقايق)

| # | اعمل | المتوقع |
| --- | --- | --- |
| ١ | افتح الموقع | شاشة دخول، **مش** «وضع تجريبي» |
| ٢ | حساب جديد (اسم/تخصص/عيادة/إيميل/باسورد) | يظهر QR |
| ٣ | امسح QR بـGoogle Authenticator | كود ٦ أرقام |
| ٤ | اكتب الكود | تدخل لوحة التحكم |
| ٥ | أضف مريض | يظهر في القائمة |
| ٦ | أضف وزن | يتحفظ |
| ٧ | احجز موعد | يظهر |
| ٨ | **الإعدادات → الفروع** → بادئة `TST1` | يتقبل |
| 9 | `reset.html` → استعادة باسورد | البريد يصل |

**⛔ متدوسش** على زر «إصدار كود بوابة المريض» — البوابة لسه مؤجلة بقرار.

---

# لو حصلت مشكلة

| اللي بتشوفه | السبب | الحل |
| --- | --- | --- |
| «وضع تجريبي» | المفاتيح فاضية | أعد المرحلة ٢ |
| `Invalid API key` | مفتاح ناقص/مسافة | أعد النسخ في سطر واحد |
| Deployment failed | build command قديم | امسحه من لوحة Cloudflare |
| `patient_portal_photo_authorize does not exist` | الترحيل ١.٣ ماتنفذش | نفّذه |
| الموقع 404 | مفيش `index.html` في الأصول | راجع `.assetsignore` |

---

# ✅ قائمة التأكيد النهائية

- [ ] `sql/00_install_all.sql` نُفّذ بنجاح
- [ ] `20261101_portal_photo_upload.sql` نُفّذ
- [ ] `js/config.js` فيه URL ومفتاح المشروع **الجديد**
- [ ] فحص jwt.io → `anon` مش `service_role`
- [ ] PR #26 مدموج في `main`
- [ ] Cloudflare deployment ناجح
- [ ] Site URL + Redirect URL مضبوطين
- [ ] Confirm email = OFF
- [ ] التسجيل + MFA + مريض + موعد شغالين
