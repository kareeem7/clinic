#!/usr/bin/env bash
# يشغّل مشغّل معاينة الفيديو على المنفذ 8099 (أو أي منفذ تختاره).
#   ./media/serve.sh        → 8099
#   ./media/serve.sh 9000   → 9000
set -euo pipefail
cd "$(dirname "$0")"
exec python3 preview_server.py "${1:-8099}"
