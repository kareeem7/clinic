#!/usr/bin/env bash
# استرجاع نسخة احتياطية إلى مشروع Supabase (عادةً مشروع staging/جديد).
#
# الاستخدام:
#   ./scripts/restore.sh <dump-file> "<postgres-connection-uri>"
#
# مثال:
#   ./scripts/restore.sh clinic-20261105-010000.dump "postgresql://postgres:...@db.xxx.supabase.co:5432/postgres"
#
# ⚠️ سكربت الاسترجاع ده لازم يتجرّب فعليًا مرة على الأقل قبل الاعتماد عليه.
#    نسخة احتياطية ما اتجرّبتش = ما فيهاش نسخة احتياطية.

set -euo pipefail

DUMP="${1:-}"
DB_URL="${2:-}"

if [ -z "$DUMP" ] || [ -z "$DB_URL" ]; then
  echo "الاستخدام: $0 <dump-file> \"<postgres-connection-uri>\"" >&2
  exit 1
fi

if [ ! -f "$DUMP" ]; then
  echo "الملف غير موجود: $DUMP" >&2
  exit 1
fi

case "$DB_URL" in
  *"db."*supabase.co*|*localhost*|*127.0.0.1*)
    ;;
  *)
    echo "⚠️  الرابط لا يبدو قاعدة Supabase أو محلية." >&2
    echo "   لو ده مشروع إنتاج، أوقف الآن وتأكد إنك مش بتكتب فوق بيانات حقيقية." >&2
    read -r -p "اكتب RESTORE للمتابعة: " CONFIRM
    [ "$CONFIRM" = "RESTORE" ] || { echo "أُلغِي."; exit 1; }
    ;;
esac

echo "→ فحص محتوى النسخة..."
pg_restore --list "$DUMP" | head -20

echo "→ استرجاع..."
# --clean --if-exists موجودة داخل النسخة نفسها (pg_dump -c)
pg_restore --dbname "$DB_URL" --no-owner --no-privileges --verbose "$DUMP" 2>&1 | tail -40

echo "→ تحقق سريع..."
psql "$DB_URL" -c "select 'doctors' t, count(*) from public.doctors
  union all select 'patients', count(*) from public.patients
  union all select 'appointments', count(*) from public.appointments
  union all select 'patient_records', count(*) from public.patient_records;"

echo "✅ تم. راجع الأعداد أعلاه مقابل النسخة الأصلية."
