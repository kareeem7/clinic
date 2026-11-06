#!/usr/bin/env bash
# يولّد sql/00_install_all.sql من SUPABASE_SQL الموجود في js/config.js.
#   ./scripts/extract-sql.sh          # توليد
#   ./scripts/extract-sql.sh --check  # فحص التزامن فقط (يُستخدم في الـCI)
#
# مصدر الحقيقة الوحيد هو js/config.js. متعدّلش sql/00_install_all.sql بإيدك.

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

SRC="js/config.js"
OUT="sql/00_install_all.sql"

START=$(grep -n 'const SUPABASE_SQL = `' "$SRC" | head -1 | cut -d: -f1)
END=$(awk -v s="$START" 'NR > s && /^`;$/ { print NR; exit }' "$SRC")

if [ -z "${START:-}" ] || [ -z "${END:-}" ]; then
  echo "❌ لم أجد بداية أو نهاية SUPABASE_SQL في $SRC" >&2
  exit 1
fi

# أي backtick مهرّب أو ${} داخل النص هيكسر الاستخراج
if sed -n "$((START + 1)),$((END - 1))p" "$SRC" | grep -qE '\\`|\$\{'; then
  echo "❌ النص فيه backtick مهرّب أو \${} — يحتاج معالجة" >&2
  exit 1
fi

TMP=$(mktemp)
{
  echo "-- ============================================================"
  echo "-- تثبيت كامل من الصفر — نظام إدارة العيادات (عيادتي)"
  echo "-- مستخرج حرفياً من SUPABASE_SQL في js/config.js"
  echo "-- شغّله مرة واحدة على مشروع Supabase جديد فارغ فقط."
  echo "-- ⚠️ متشغّلش معه أي ملف من sql/migrations/"
  echo "-- مولّد: scripts/extract-sql.sh — عدّل js/config.js مش الملف ده"
  echo "-- ============================================================"
  echo
  # السطر الأول بيحتوي "const SUPABASE_SQL = \`" في أولها — نشيلها
  sed -n "$((START + 1)),$((END - 1))p" "$SRC"
} > "$TMP"

TABLES=$(grep -c "create table" "$TMP")
if [ "$TABLES" -lt 17 ]; then
  echo "❌ عدد الجداول $TABLES أقل من المتوقع 17 — الاستخراج ناقص" >&2
  rm -f "$TMP"; exit 1
fi

if [ "${1:-}" = "--check" ]; then
  if diff -q "$OUT" "$TMP" > /dev/null 2>&1; then
    echo "✅ sql/00_install_all.sql متزامن مع js/config.js ($TABLES جدول)"
    rm -f "$TMP"; exit 0
  else
    echo "❌ sql/00_install_all.sql قديم — شغّل ./scripts/extract-sql.sh" >&2
    rm -f "$TMP"; exit 1
  fi
fi

mv "$TMP" "$OUT"
echo "✅ تم التوليد: $OUT ($(wc -l < "$OUT") سطر · $TABLES جدول)"
