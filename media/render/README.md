# سكربتات توليد فيديو الديمو

مش لازم تشغّلها — الفيديو النهائي موجود في `media/clinic_demo_60s.mp4`.

## الملفات
| ملف | وظيفته |
|---|---|
| `artext.py` | تشكيل وترتيب العربي (uharfbuzz + freetype-py) |
| `render.py` | المشاهد الثمانية + الانتقالات |
| `encode.py` | يبني MP4 بـ ffmpeg مع الصوت |

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
