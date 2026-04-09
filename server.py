import http.server
import os
import sys
import mimetypes
import socket
from urllib.parse import urlparse

# PORT can be overridden via environment variable IINA_CAST_PORT
PORT = int(os.environ.get("IINA_CAST_PORT", 19421))
FILE = sys.argv[1] if len(sys.argv) > 1 else ""
PAGE = sys.argv[2] if len(sys.argv) > 2 else ""


class Server(http.server.HTTPServer):
    allow_reuse_address = True


class Handler(http.server.BaseHTTPRequestHandler):
    # HTTP/1.1 keeps connections alive for sustained streaming
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path == "/video" and FILE:
            size = os.path.getsize(FILE)
            mime = mimetypes.guess_type(FILE)[0] or "video/mp4"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", "0")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/video" and FILE:
            self._serve_file()
        else:
            self._serve_page()

    def _serve_page(self):
        if not PAGE or not os.path.exists(PAGE):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        with open(PAGE, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(data)

    def _serve_file(self):
        if not FILE or not os.path.exists(FILE):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        size = os.path.getsize(FILE)
        mime = mimetypes.guess_type(FILE)[0] or "video/mp4"
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes="):
            parts = rng[6:].split("-")
            start = int(parts[0])
            end = int(parts[1]) if parts[1] else size - 1
            code = 206
        else:
            start, end, code = 0, size - 1, 200
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "keep-alive")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(FILE, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, socket.error):
            pass  # Client disconnected — not an error


Server(("0.0.0.0", PORT), Handler).serve_forever()
