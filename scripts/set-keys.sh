#!/usr/bin/env bash
# يضبط مشروع Supabase في js/config.js مع فحص أمان للمفتاح.
#
#   ./scripts/set-keys.sh "https://xxxx.supabase.co" "sb_publishable_xxx أو eyJ..."
#
# بيرفض:
#   - URL بصيغة غلط، أو فيه /rest/v1
#   - مفتاح service_role / sb_secret_ (خطر أمني)
#   - مفتاح بصيغة غير معروفة

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

URL="${1:-}"
KEY="${2:-}"
CFG="js/config.js"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "الاستخدام: $0 \"<project-url>\" \"<anon-or-publishable-key>\"" >&2
  exit 1
fi

# ── ١) فحص الـ URL ──────────────────────────────────────────
case "$URL" in
  https://*.supabase.co) ;;
  *) echo "❌ الـ URL لازم يبدأ بـ https:// وينتهي بـ .supabase.co" >&2; exit 1 ;;
esac
case "$URL" in
  */rest/v1*|*/rest/v1) echo "❌ شيل /rest/v1 من آخر الـ URL — الكود بيضيفه لوحده" >&2; exit 1 ;;
esac
case "$URL" in
  */) echo "❌ شيل الشرطة الأخيرة من الـ URL" >&2; exit 1 ;;
esac

# ── ٢) فحص المفتاح ─────────────────────────────────────────
case "$KEY" in
  sb_secret_*)
    echo "❌ ده المفتاح السري (secret). ممنوع في كود المتصفح." >&2
    echo "   استخدم publishable أو anon." >&2
    exit 1 ;;
  sb_publishable_*)
    echo "✅ مفتاح publishable (الشكل الجديد)" ;;
  eyJ*)
    # JWT: نفك الجزء الأوسط ونقرأ role
    ROLE=$(python3 - "$KEY" <<'PY'
import sys, json, base64
k = sys.argv[1]
try:
    p = k.split('.')[1]
    p += '=' * (-len(p) % 4)
    print(json.loads(base64.urlsafe_b64decode(p)).get('role', 'unknown'))
except Exception:
    print('unreadable')
PY
)
    case "$ROLE" in
      anon)
        echo "✅ مفتاح anon (شكل JWT قديم) — الدور: anon" ;;
      service_role)
        echo "❌❌ ده مفتاح service_role — بيلف حول كل قواعد الحماية." >&2
        echo "    لو حطيته، أي زائر يقرأ كل بيانات المرضى. تم الإلغاء." >&2
        exit 1 ;;
      authenticated)
        echo "⚠️  الدور authenticated مش anon — غالبًا مش ده المفتاح الصح. تم الإلغاء." >&2
        exit 1 ;;
      *)
        echo "❌ مش عارف أقرأ دور المفتاح ($ROLE). تأكد إنه المفتاح العام." >&2
        exit 1 ;;
    esac ;;
  *)
    echo "❌ صيغة مفتاح غير معروفة. المتوقع sb_publishable_... أو eyJ..." >&2
    echo "   تأكد إنك نسخت المفتاح كاملاً بدون مسافات." >&2
    exit 1 ;;
esac

# ── ٣) الكتابة ─────────────────────────────────────────────
cp "$CFG" "$CFG.bak"

python3 - "$CFG" "$URL" "$KEY" <<'PY'
import re, sys
path, url, key = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding='utf-8').read()

# استبدال قيمتي url و anonKey داخل supabaseConfig فقط
new, n1 = re.subn(r'(url:\s*")[^"]*(")', lambda m: m.group(1) + url + m.group(2), src, count=1)
new, n2 = re.subn(r'(anonKey:\s*")[^"]*(")', lambda m: m.group(1) + key + m.group(2), new, count=1)

if n1 != 1 or n2 != 1:
    sys.exit("تعذّر إيجاد الحقلين في supabaseConfig")

open(path, 'w', encoding='utf-8').write(new)
print("تم التحديث")
PY

# ── ٤) التحقق النهائي ───────────────────────────────────────
if node --check "$CFG" 2>/dev/null; then
  echo "✅ صياغة الملف سليمة"
else
  mv "$CFG.bak" "$CFG"
  echo "❌ الملف اتكسر — تم الرجوع للنسخة القديمة" >&2
  exit 1
fi

GOT_URL=$(grep -oE 'url: "[^"]*"' "$CFG" | head -1 | sed 's/url: "//;s/"//')
GOT_KEY=$(grep -oE 'anonKey: "[^"]*"' "$CFG" | head -1 | sed 's/anonKey: "//;s/"//')

if [ "$GOT_URL" = "$URL" ] && [ "$GOT_KEY" = "$KEY" ]; then
  echo "✅ تم الربط بمشروع: $URL"
  echo "   المفتاح: ${KEY:0:22}…"
else
  echo "❌ في اختلاف بين اللي اتكتب واللي اتطلب" >&2
  exit 1
fi

rm -f "$CFG.bak"
echo
echo "الخطوة التالية: ./scripts/preflight.sh ثم ./scripts/build-dist.sh"
