# ملاحظات المستخدم — لا تحذف

> ملف صغير في المستودع عشان المعلومات اللي محتاجها المستخدم تفضل موجودة
> لو مساحة العمل أُعيد تحميلها. آمن تمامًا ولا يحتوي أي مفاتيح.

## إصدار حزمة النشر

آخر بناء: `1` — يُعاد بناؤه بالأمر:

```bash
./scripts/build-dist.sh
python3 - <<'PY'
import re
p = "deploy/js/config.js"
s = open(p, encoding="utf-8").read()
s = re.sub(r'url: "[^"]*"', 'url: ""', s, count=1)
s = re.sub(r'anonKey: "[^"]*"(?=\s)', 'anonKey: ""', s, count=1)
open(p, "w", encoding="utf-8").write(s)
PY
cd deploy && zip -qr ../clinic-deploy.zip . -x '.*' '*.bak'
```

ثم أعِد نسخ `clinic-deploy.zip` للمستخدم.

## أين يعدّل المستخدم المفاتيح

ملف: `js/config.js` داخل الحزمة — **الأسطر ٢٢ و٢٣**:

```js
const supabaseConfig = {
  url: "",        // ← السطر ٢٢: هنا رابط المشروع
  anonKey: ""     // ← السطر ٢٣: هنا المفتاح العام
};
```

القيم فاضية بقصد: لو نسي التعديل يظهر «الوضع التجريبي» بدل الاتصال بمشروع قديم بصمت.

## حالة خطة يوم ١

- [x] حساب Supabase + مشروع + تشغيل `sql/00_install_all.sql`
- [x] المستخدم جاب `Project URL` + المفتاح العام
- [ ] تعديل `js/config.js` بالمفاتيح
- [ ] النشر على Cloudflare Pages
- [ ] إعداد Site URL + Redirect URLs في Supabase
- [ ] اختبار المسار الكامل
- [ ] يوم ٢: نسخة احتياطية + تجربة استرجاع
