#!/usr/bin/env bash
# فحص ما قبل النشر — شغّله قبل أي رفع، وشغّله تاني بعد أي تعديل.
#   ./scripts/preflight.sh
#
# بيرفض الرفع لو فيه ملف ناقص، أو سر مسرّب، أو اختبار فاشل.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

FAIL=0
ok()   { echo "  ✅ $1"; }
bad()  { echo "  ❌ $1"; FAIL=1; }
warn() { echo "  ⚠️  $1"; }

echo "═══ ١) الملفات الأساسية ═══"
for f in index.html reset.html robots.txt _headers _redirects wrangler.toml; do
  [ -f "$f" ] && ok "$f" || bad "$f مفقود"
done
[ -d js ]  && ok "js/ ($(ls js/*.js 2>/dev/null | wc -l) ملف)"  || bad "js/ مفقود"
[ -d css ] && ok "css/ ($(ls css/*.css 2>/dev/null | wc -l) ملف)" || bad "css/ مفقود"

echo "═══ ٢) المسارات المحلية في HTML ═══"
MISSING=0
while IFS= read -r p; do
  case "$p" in
    http*|data:*|"#"*|"") continue ;;
  esac
  target="${p%%#*}"
  if [ ! -e "$target" ]; then
    bad "$p — المشار إليه غير موجود"
    MISSING=1
  fi
done < <(grep -ohE '(src|href)="[^"]*"' index.html reset.html 2>/dev/null | sed 's/.*="//;s/"$//' | sort -u)
[ "$MISSING" -eq 0 ] && ok "كل الـ src/href المحلية موجودة"

echo "═══ ٣) صياغة JavaScript ═══"
JSFAIL=0
for f in js/*.js; do
  node --check "$f" 2>/dev/null || { bad "$f — خطأ صياغة"; JSFAIL=1; }
done
[ "$JSFAIL" -eq 0 ] && ok "$(ls js/*.js | wc -l) ملف JS سليم"

echo "═══ ٤) فحص الأسرار ═══"
# المطلوب نمسكه: مفتاح فعلي، مش أمر SQL زي "grant ... to service_role".
# أي JWT فيه دور service_role، أو متغير اسمه service_role_key بقيمة.
SECRETS=$(grep -rnE 'service_role_key[[:space:]]*[:=]|eyJ[A-Za-z0-9_-]{20,}' --include="*.js" --include="*.html" . 2>/dev/null \
  | grep -i "service_role" | grep -v -iE 'grant|revoke|comment|^\s*--' || true)
if [ -n "$SECRETS" ]; then
  echo "$SECRETS" | head -3
  bad "مفتاح service_role مسرّب في كود العميل"
else
  ok "مفيش مفتاح service_role في كود العميل"
fi

echo "═══ ٥) إعداد Supabase ═══"
URL=$(grep -oE 'url: "[^"]*"' js/config.js | head -1 | sed 's/url: "//;s/"//')
KEY=$(grep -oE 'anonKey: "[^"]*"' js/config.js | head -1 | sed 's/anonKey: "//;s/"//')
if [ -z "$URL" ] || [ -z "$KEY" ]; then
  warn "الـ URL أو الـ anonKey فاضي ⇒ الموقع هيشتغل في الوضع التجريبي (بيانات وهمية فقط)"
else
  ok "مشروع Supabase مضبوط: ${URL:0:32}…"
  case "$URL" in
    *eyJ*service_role*) bad "المفتاح شكله service_role — ده خطر أمني" ;;
  esac
fi

echo "═══ ٦) قيود المجلد المنشور ═══"
for banned in tests sql supabase docs scripts .github; do
  if grep -q "^/$banned" .cfignore 2>/dev/null; then
    ok "$banned مستبعد من النشر"
  else
    warn "$banned مش مستبعد في .cfignore"
  fi
done

echo "═══ ٧) الاختبارات ═══"
if npm test --silent > /tmp/preflight-test.log 2>&1; then
  PASS=$(grep -E "^# pass" /tmp/preflight-test.log | awk '{print $3}')
  ok "الاختبارات: $PASS ناجح"
else
  bad "الاختبارات فشلت — شوف /tmp/preflight-test.log"
fi

echo "═══ ٨) حجم الحزمة ═══"
SIZE=$(du -sh --exclude=.git --exclude=node_modules --exclude=deploy . 2>/dev/null | cut -f1)
FILES=$(find . -type f -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./deploy/*" | wc -l)
ok "الحجم: $SIZE · عدد الملفات: $FILES (حد Cloudflare: ٢٥ ميجا/ملف · ٢٠٠٠٠ ملف)"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "🟢 جاهز للنشر. الخطوة التالية: ./scripts/build-dist.sh"
  exit 0
else
  echo "🔴 فيه مشاكل فوق — صلّحها قبل الرفع."
  exit 1
fi
