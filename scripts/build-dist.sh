#!/usr/bin/env bash
# يبني مجلد `deploy/` فيه الموقع الجاهز للرفع فقط — بلا اختبارات ولا SQL ولا مستندات.
#   ./scripts/build-dist.sh
#
# بعد كده: اسحب مجلد deploy/ وأفلته في Cloudflare Pages → Upload assets.
#
# ليه سكربت بدل .cfignore؟ لأن مسار "Upload assets" بيرفع المجلد زي ما هو،
# مش بيقرأ .cfignore. السكربت بيضمن إن الخادم مش هيعرض ملفات داخلية.

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

OUT="deploy"
rm -rf "$OUT"
mkdir -p "$OUT"

copy() {
  if [ -e "$1" ]; then
    cp -R "$1" "$OUT/"
    echo "  + $1"
  else
    echo "  ! $1 غير موجود — تم تخطيه"
  fi
}

echo "→ نسخ ملفات الموقع:"
copy index.html
copy landing.html
copy reset.html
copy robots.txt
copy _headers
copy _redirects
copy css
copy js
# media/: فيديو الديمو + الغلاف اللي صفحة البيع بتشغّلهم.
# بننسخ الملفات المطلوبة بس — مش سكربتات الإنتاج ولا المشغّل المحلي.
mkdir -p "$OUT/media"
for f in clinic_demo_60s.mp4 poster.jpg; do
  if [ -f "media/$f" ]; then
    cp "media/$f" "$OUT/media/"
    echo "  + media/$f"
  else
    echo "  ! media/$f غير موجود — تأكد إن landing.html مش بيشاور عليه"
  fi
done

# لا يُنسخ: tests/ sql/ supabase/ docs/ scripts/ .github/ package.json wrangler.toml

echo
echo "→ فحص الناتج:"
# ملاحظة: أوامر SQL زي "grant ... to service_role" موجودة في sql/baseline.sql
# (خارج الأصول المنشورة أصلاً) — دي مش أسرار. اللي بندور عليه مفتاح فعلي.
SECRETS=$(grep -rnE 'service_role_key[[:space:]]*[:=]|eyJ[A-Za-z0-9_-]{20,}' "$OUT" 2>/dev/null \
  | grep -i "service_role" | grep -v -iE 'grant|revoke|comment|^\s*--' || true)
if [ -n "$SECRETS" ]; then
  echo "$SECRETS" | head -3
  echo "  ❌ مفتاح service_role في الحزمة — أوقف الرفع"
  exit 1
fi
echo "  ✅ مفيش أسرار"

COUNT=$(find "$OUT" -type f | wc -l)
SIZE=$(du -sh "$OUT" | cut -f1)
echo "  ✅ $COUNT ملف · $SIZE"

# تأكيد إن الملفات الحرجة وصلت
for f in index.html landing.html reset.html js/main.js js/config.js js/landing.js css/main.css css/landing.css media/clinic_demo_60s.mp4 media/poster.jpg _headers; do
  [ -f "$OUT/$f" ] || { echo "  ❌ $f مفقود من الحزمة"; exit 1; }
done
echo "  ✅ الملفات الحرجة موجودة"

echo
echo "🟢 جاهز. ارفع محتوى مجلد deploy/ (مش المجلد نفسه) على Cloudflare Pages."
echo "   بديل: من Git → Connect to Git (مش محتاج السكربت ده)."
