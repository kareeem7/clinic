#!/usr/bin/env bash
# تشغيل معاينة الديمو — قابل لإعادة التنفيذ في أي وقت.
#   bash demo/serve.sh            → 0.0.0.0:8081
#   PORT=8090 bash demo/serve.sh  → بورت تاني
# ملاحظات الإعداد المهمة للبريفيو:
#   * --bind 0.0.0.0  (مش 127.0.0.1) عشان البروكسي يوصل له
#   * --protocol HTTP/1.1 مع Content-Length (بدل HTTP/1.0)
#   * ThreadingHTTPServer (افتراضي في Python >= 3.7) عشان keep-alive ما يعلّقش الطلبات
#   * مفيش X-Frame-Options ولا CSP → يقبل الإيمبد في iframe
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8081}"
cd "$DIR"
printf 'الديمو: http://0.0.0.0:%s/  (المجلد: %s)\n' "$PORT" "$DIR"
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --protocol HTTP/1.1 --directory "$DIR"
