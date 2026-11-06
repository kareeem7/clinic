#!/usr/bin/env bash
# يولّد sql/00_install_all.sql من sql/baseline.sql (مصدر الحقيقة الوحيد).
#   ./scripts/extract-sql.sh          # توليد
#   ./scripts/extract-sql.sh --check  # فحص التزامن فقط (يُستخدم في الـCI)
#
# ⚠️ لم يعد هناك SUPABASE_SQL داخل js/config.js: أي زائر كان يقدر يقرأ
# مخطط القاعدة كاملاً من حزمة المتصفح. عدّل sql/baseline.sql فقط.

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

SRC="sql/baseline.sql"
OUT="sql/00_install_all.sql"

[ -f "$SRC" ] || { echo "❌ $SRC مفقود" >&2; exit 1; }

HEADER='-- ============================================================
-- تثبيت كامل من الصفر — نظام إدارة العيادات (عيادتي)
-- مولّد حرفياً من sql/baseline.sql (مصدر الحقيقة الوحيد).
-- شغّله مرة واحدة على مشروع Supabase جديد فارغ فقط.
-- ⚠️ متشغّلش معه أي ملف من sql/migrations/
-- مولّد: scripts/extract-sql.sh — عدّل sql/baseline.sql مش الملف ده
-- ============================================================'

TABLES=$(grep -c "create table" "$SRC")
if [ "$TABLES" -lt 17 ]; then
  echo "❌ عدد الجداول $TABLES أقل من المتوقع 17 — $SRC ناقص" >&2
  exit 1
fi

TMP=$(mktemp)
{ printf '%s\n\n' "$HEADER"; cat "$SRC"; } > "$TMP"

if [ "${1:-}" = "--check" ]; then
  if diff -q "$OUT" "$TMP" > /dev/null 2>&1; then
    echo "✅ $OUT متزامن مع $SRC ($TABLES جدول)"
    rm -f "$TMP"; exit 0
  else
    echo "❌ $OUT قديم — شغّل ./scripts/extract-sql.sh" >&2
    rm -f "$TMP"; exit 1
  fi
fi

mv "$TMP" "$OUT"
echo "✅ تم التوليد: $OUT ($(wc -l < "$OUT") سطر · $TABLES جدول)"
