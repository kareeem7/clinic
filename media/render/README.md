# سكربتات توليد فيديو الديمو

مش لازم تشغّلها — الفيديو النهائي موجود في `media/clinic_demo_60s.mp4`.

## الملفات
| ملف | وظيفته |
|---|---|
| `artext.py` | تشكيل وترتيب العربي (uharfbuzz + freetype-py) |
| `ui.py` | **إعادة بناء شاشات التطبيق** (Cairo + ألوان css/variables.css) |
| `music.py` | موسيقى خلفية متولّدة (128 BPM، Am–F–C–G) |
| `render2.py` | المشاهد + حركة الكاميرا + الكابشنات + **إطارات بوابة المريض** |
| `encode2.py` | يبني MP4 مع الصوت الميكس (`mix.wav`) |
| `render.py` / `encode.py` | النسخة الأولى (بدون لقطات ولا موسيقى) — محفوظة للمرجع |

## المتطلبات
```
pip install uharfbuzz freetype-py pillow imageio-ffmpeg
```
+ ملفات خط Cairo بأسامي `/tmp/CairoFull-Black.ttf` و `/tmp/CairoFull-Bold.ttf`
(بتتحوّل من woff2 بـ fontTools، وتُدمج العربي+اللاتيني بـ `fontTools.merge.Merger`).

## التشغيل
```bash
cd media/render
python3 ui.py         # يتأكد إن الـ 8 شاشات بتترسم (اختياري)
python3 music.py      # → music.wav
# ادمج الصوت: vocal 0dB + موسيقى −10dB + loudnorm I=-14
python3 encode2.py    # → clinic_demo_v3.mp4  (42.6s)
```

## ملاحظات فنية (اتعبتنا)
- `arabic_reshaper` + `python-bidi` + Pillow = حروف مقطّعة ومتباعدة → **متستخدمهاش**.
  Pillow محتاج libraqm لمحاذاة RTL وهو مش متاح. الصح: uharfbuzz → freetype-py → Pillow.
- أرقام `٠١٢٣` بتطلع مربعات فاضية في الخط ده → استخدم الأرقام اللاتينية `0-9`.
- داخل نص RTL، HarfBuzz بيرصّف الأرقام لاتيني LTR فبتطلع معكوسة → `artext._fix_digits()`.
  لكن لو النص كله أرقام (`"250"`) لازم مايتعكشش → `_has_rtl()` بتتحقق الأول.
- قيم `hbf.scale` = 26.6 fixed point → اقسم على 64، **مش** على upem.


## بوابة المريض في الفيديو (v4)

الشاشات دي **توضيح للمنتج**، مش لقطات من نسخة منشورة — بوابة المريض في المنتج نفسه
مقفولة للجمهور دلوقتي. الشاشات الأربعة موجودة في `ui.py`:
`screen_portal_home` / `screen_portal_log` / `screen_portal_progress` /
`screen_portal_appointments`، وبتتعرض في الفيديو بإطار `frame_portal()`
(شاشة كاملة + شارة «من موبايل المريض») عشان تبقى مقروءة.

## ليه مفيش سكرين شوت حقيقي؟
البيئة فيها `@sparticuz/chromium` و PySide6 WebEngine، بس **الاتنين بيفشلوا**:
- كروميوم: `libnspr4/libnss3` ناقصة → اتبنت بدائل، وبعدها segfault عند الـ GPU process.
- Qt WebEngine: نفس مشكلة NSS، وبعد حلّها segfault في التحميل.

مفيش `Xvfb`، ومفيش `apt` network. فالحل: **إعادة بناء الواجهة بالكود** من نفس الـ CSS.
لو شغّلت المشروع على جهازك، تقدر تصوّر سكرين شوت حقيقي بـ
`npx playwright screenshot --viewport-size=1280,720 <url> shot.png` وتستبدله.

## معاينة الفيديو

```bash
./media/serve.sh          # → http://localhost:8099
./media/serve.sh 9000     # منفذ تاني
```

`media/preview_server.py` بيخدم `media/` مباشرة (الملف الأصلي، بدون نسخة مكررة)،
بـ HTTP/1.1 + Range + keep-alive عشان السحب والتنقل في الفيديو يشتغل بسلاسة.
الصفحة `media/index.html` فيها المشغّل + أزرار التحميل + الـ poster.

## تنزيل الفيديو

المشغّل بيعرض الفيديو من نفس السيرفر، وزرار **«نزّل الفيديو»**:

1. بيجيب الملف بـ `fetch` ويحوّله `blob` وينزّله بـ `a.download` — الطريقة دي بتشتغل
   حتى لو الصفحة جوه iframe أو الملف من دومين تاني.
2. لو فشلت، بيروح لـ `clinic_demo_60s.mp4?dl=1` والسيرفر نفسه بيبعته
   `Content-Disposition: attachment` → المتصفح بينزّله غصب عنه.

> ليه كل ده؟ خاصية `download` في HTML **بتتجاهَل** لما الصفحة تبقى جوه iframe
> أو لما الملف يبقى من دومين مختلف عن الصفحة — وده بالظبط حالة المعاينة،
> فالزرار كان بيفتح الفيديو بدل ما ينزّله.

### لو التنزيل مقفول تمامًا (اسمه: iframe sandbox)

نافذة المعاينة جوه Arena بتشغّل الصفحة في `iframe` عليه `sandbox` من غير
`allow-downloads` و`allow-popups`. في الحالة دي **أي** تنزيل وأي تاب جديد بيتمنعوا —
سواء بـ `download` أو `blob` أو `window.open`. الحلول الثلاثة في `media/index.html`:

1. **blob + a.download** — بيشتغل في iframe عادي، وبيفشل في sandbox.
2. **انسخ رابط التنزيل** — الرابط المطلق لنفس الملف، يتلصق في شريط العنوان (برة الـ iframe).
3. **رابط GitHub الخام** — `.../raw/arena/9fc38eb7-clinic/media/clinic_demo_60s.mp4`
   ملف مباشر، مضمون، ومش بيمر بأي iframe خالص.

الصفحة كمان بتكشف بنفسها إنها جوه iframe (`window.self !== window.top`) وتنبّه المستخدم.
