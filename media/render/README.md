# سكربتات توليد فيديو الديمو

مش لازم تشغّلها — الفيديو النهائي موجود في `media/clinic_demo_60s.mp4`.

## الملفات
| ملف | وظيفته |
|---|---|
| `artext.py` | تشكيل وترتيب العربي (uharfbuzz + freetype-py) |
| `ui.py` | **إعادة بناء شاشات التطبيق** (Cairo + ألوان css/variables.css) |
| `music.py` | موسيقى خلفية متولّدة (128 BPM، Am–F–C–G) |
| `render2.py` | المشاهد + حركة الكاميرا + الكابشنات |
| `encode2.py` | يبني MP4 مع الصوت الميكس |
| `render.py` / `encode.py` | النسخة الأولى (بدون لقطات ولا موسيقى) — محفوظة للمرجع |

## المتطلبات
```
pip install uharfbuzz freetype-py pillow imageio-ffmpeg
```
+ ملفات خط Cairo بأسامي `/tmp/CairoFull-Black.ttf` و `/tmp/CairoFull-Bold.ttf`
(بتتحوّل من woff2 بـ fontTools، وتُدمج العربي+اللاتيني بـ `fontTools.merge.Merger`).

## التشغيل
```
cd media/render
python3 encode.py     # → clinic_demo.mp4
```

## ملاحظات فنية (اتعبتنا)
- `arabic_reshaper` + `python-bidi` + Pillow = حروف مقطّعة ومتباعدة → **متستخدمهاش**.
  Pillow محتاج libraqm لمحاذاة RTL وهو مش متاح. الصح: uharfbuzz → freetype-py → Pillow.
- أرقام `٠١٢٣` بتطلع مربعات فاضية في الخط ده → استخدم الأرقام اللاتينية `0-9`.
- داخل نص RTL، HarfBuzz بيرصّف الأرقام لاتيني LTR فبتطلع معكوسة → `artext._fix_digits()`.
  لكن لو النص كله أرقام (`"250"`) لازم مايتعكشش → `_has_rtl()` بتتحقق الأول.
- قيم `hbf.scale` = 26.6 fixed point → اقسم على 64، **مش** على upem.


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
