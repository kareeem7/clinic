"""مشغّل معاينة الفيديو — يخدم media/ مباشرة (الملف الأصلي، بدون نسخة مكررة).

المشاكل اللي بيحلها:
  • HTTP/1.1 + Range + keep-alive  → السحب والتنقل في الفيديو يشتغل بسلاسة.
  • يخدم من media/ نفسها           → نسخة واحدة بس، مفيش نسخة قديمة تبان بالغلط.
  • CORS + nosniff                 → المعاينة المضمّنة ما تكسرش.
  • لا كاش للمتصفح في التطوير      → أي نسخة جديدة تظهر فورًا.

التشغيل:  python3 media/preview_server.py [port]
"""
import os
import re
import sys
import urllib.parse
import socketserver
import http.server

ROOT = os.path.dirname(os.path.abspath(__file__))   # مجلد media/
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099

MIME = {
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".html": "text/html; charset=utf-8",
}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # عشان keep-alive والـ Range
    server_version = "ClinicPreview/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ── أدوات ──────────────────────────────────────────────

    def _resolve(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path in ("", "/"):
            path = "/index.html"
        safe = os.path.normpath(path).lstrip("/")
        full = os.path.join(ROOT, safe)
        if not os.path.abspath(full).startswith(ROOT):
            return None
        return full

    def _headers(self, status, ctype, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _stream(self, fh, start, end):
        """يبعت المقاطع بـ chunked-safe loop بدل copyfile الافتراضي."""
        remaining = end - start + 1
        fh.seek(start)
        while remaining > 0:
            chunk = fh.read(min(65536, remaining))
            if not chunk:
                break
            try:
                self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                return
            remaining -= len(chunk)

    # ── GET / HEAD ─────────────────────────────────────────

    def do_HEAD(self):
        self._serve(send_body=False)

    def do_GET(self):
        self._serve(send_body=True)

    def _wants_download(self):
        """?dl=1 أو ?download=1 → نبعته كـ attachment عشان المتصفح ينزّله غصب عنه.

        ده بيحل مشكلة إن خاصية download بتتجاهَل لما الملف من دومين تاني
        أو لما الصفحة شغّالة جوه iframe.
        """
        q = urllib.parse.urlparse(self.path).query
        vals = urllib.parse.parse_qs(q)
        return any(k in vals for k in ("dl", "download"))

    def _serve(self, send_body):
        full = self._resolve()
        if full is None:
            self._headers(403, "text/plain; charset=utf-8", 9)
            if send_body:
                self.wfile.write(b"Forbidden")
            return

        if os.path.isdir(full):
            full = os.path.join(full, "index.html")

        if not os.path.isfile(full):
            msg = "Not found".encode()
            self._headers(404, "text/plain; charset=utf-8", len(msg))
            if send_body:
                self.wfile.write(msg)
            return

        size = os.path.getsize(full)
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")

        extra = {}
        if self._wants_download():
            # اسم لاتيني مضمون (بعض المتصفحات بترفض أسماء عربي غير مكوّدة)
            base = os.path.basename(full)
            ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "-", base) or "download"
            pretty = urllib.parse.quote("عيادتي-ديمو" + ext)
            extra["Content-Disposition"] = (
                "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, pretty))

        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if not m:
                msg = b"Bad range"
                self._headers(400, "text/plain; charset=utf-8", len(msg))
                if send_body:
                    self.wfile.write(msg)
                return
            a, b = m.group(1), m.group(2)
            if a:
                start = int(a)
                end = int(b) if b else size - 1
            else:                                  # bytes=-N  (آخر N بايت)
                start = max(0, size - int(b or 0))
                end = size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                self._headers(416, "text/plain; charset=utf-8", 0,
                              {"Content-Range": "bytes */%d" % size})
                return
            hdrs = {"Content-Range": "bytes %d-%d/%d" % (start, end, size)}
            hdrs.update(extra)
            self._headers(206, ctype, end - start + 1, hdrs)
            if send_body:
                with open(full, "rb") as fh:
                    self._stream(fh, start, end)
            return

        self._headers(200, ctype, size, extra)
        if send_body:
            with open(full, "rb") as fh:
                self._stream(fh, 0, size - 1)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    print("serving %s on http://0.0.0.0:%d" % (ROOT, PORT), flush=True)
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
