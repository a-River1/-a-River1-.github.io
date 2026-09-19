"""HTTP hosting for Paralegal: local launch, protected hosting, background research."""
from collections import OrderedDict
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen
from wsgiref.simple_server import make_server, WSGIServer, WSGIRequestHandler
from socketserver import ThreadingMixIn
import argparse
import json
import os
import secrets
import socket
import threading
import time
import webbrowser
import paralegal_server as core

SERVICE = "paralegal-research-v2"
STATIC = {"/": "Paralegal.html", "/Paralegal.html": "Paralegal.html",
          "/paralegal.html": "Paralegal.html", "/paralegal.css": "paralegal.css",
          "/paralegal.js": "paralegal.js"}
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
JOB_TTL = 1800

class ResearchSite:
    def __init__(self, public_url="", port=8000):
        self.public_url = public_url.rstrip("/")
        self.port = port
        self.csrf = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.jobs = OrderedDict()
        self.running = False

    def allowed_origins(self, cfg):
        origins = {self.public_url} if self.public_url else {
            f"http://localhost:{self.port}", f"http://127.0.0.1:{self.port}"}
        for value in cfg.get("PARALEGAL_ALLOWED_ORIGINS", "").split(","):
            value = value.strip().rstrip("/")
            if value:
                parsed = urlsplit(value)
                if parsed.scheme == "https" and parsed.netloc and parsed.path == "":
                    origins.add(value)
        return origins

    def authenticated(self, env, cfg):
        access = cfg.get("PARALEGAL_ACCESS_CODE", "")
        if not access:
            return not self.public_url
        supplied = env.get("HTTP_AUTHORIZATION", "")
        return secrets.compare_digest(supplied.encode(), ("Bearer " + access).encode())

    def prune_jobs(self):
        now = time.monotonic()
        for job_id in list(self.jobs):
            job = self.jobs[job_id]
            if job["status"] != "running" and now - job["finished"] > JOB_TTL:
                del self.jobs[job_id]
        while len(self.jobs) >= 20:
            candidate = next((i for i, j in self.jobs.items() if j["status"] != "running"), None)
            if candidate is None:
                break
            del self.jobs[candidate]

    def start_job(self, data, cfg):
        with self.lock:
            if self.running:
                raise core.AppError("Another research packet is being prepared. Please try again shortly.", 429)
            self.prune_jobs()
            job_id = secrets.token_urlsafe(32)
            self.jobs[job_id] = {"status": "running"}
            self.running = True
        def work():
            try:
                result = {"status": "completed", "packet": core.research(data, cfg)}
            except core.AppError as exc:
                result = {"status": "failed", "error": str(exc)}
            except Exception:
                result = {"status": "failed", "error": "Research could not be completed. Please retry."}
            with self.lock:
                self.jobs[job_id] = {**result, "finished": time.monotonic()}
                self.running = False
        try:
            threading.Thread(target=work, daemon=True).start()
        except Exception:
            with self.lock:
                self.running = False
                del self.jobs[job_id]
            raise core.AppError("The research service is busy. Please retry.", 503) from None
        return job_id

    def __call__(self, env, start_response):
        cfg = core.config()
        method = env.get("REQUEST_METHOD", "GET")
        path = env.get("PATH_INFO", "/")
        origin = env.get("HTTP_ORIGIN", "")
        host = env.get("HTTP_HOST", "")
        allowed_hosts = {urlsplit(self.public_url).netloc} if self.public_url else {
            f"localhost:{self.port}", f"127.0.0.1:{self.port}"}
        allowed_origins = self.allowed_origins(cfg)
        # Only discovery can be read from file://. Research never accepts null origins.
        origin_parts = urlsplit(origin)
        file_discovery = not self.public_url and path == "/api/discover" and (
            origin == "null" or (origin_parts.scheme == "http" and origin_parts.hostname in ("localhost", "127.0.0.1")))
        cors = origin in allowed_origins or file_discovery

        def reply(value, status=200, content_type="application/json; charset=utf-8"):
            payload = value if isinstance(value, bytes) else json.dumps(value).encode()
            headers = [
                ("Content-Type", content_type), ("Content-Length", str(len(payload))),
                ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
                ("Referrer-Policy", "no-referrer"), ("Content-Security-Policy", CSP),
                ("Vary", "Origin")]
            if cors:
                headers.append(("Access-Control-Allow-Origin", origin))
            if method == "OPTIONS" and cors:
                headers += [("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                            ("Access-Control-Allow-Headers", "Content-Type, X-Research-Token, Authorization"),
                            ("Access-Control-Max-Age", "600")]
            if self.public_url:
                headers.append(("Strict-Transport-Security", "max-age=31536000"))
            start_response(str(status) + " " + HTTPStatus(status).phrase, headers)
            return [b"" if method == "HEAD" else payload]

        if host not in allowed_hosts:
            return reply({"error": "Unrecognized website address."}, 403)
        if origin and not cors:
            return reply({"error": "This website is not allowed to use this research service."}, 403)
        if method == "OPTIONS":
            return reply(b"", 204) if cors else reply({"error": "Origin required."}, 403)
        if path == "/api/discover" and method in ("GET", "HEAD"):
            return reply({"service": SERVICE})
        auth = self.authenticated(env, cfg)
        if path == "/api/health" and method in ("GET", "HEAD"):
            return reply({
                "service": SERVICE, "locked": not auth, "states": core.STATES,
                "csrf_token": self.csrf if auth else "",
                "providers": [{"name": name, "configured": bool(core.api_key(cfg, name)), "variable": names[0]}
                              for name, names in core.KEYS.items()] if auth else []})
        if path in STATIC and method in ("GET", "HEAD"):
            target = core.ROOT / STATIC[path]
            mime = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}[target.suffix]
            return reply(target.read_bytes(), content_type=mime + "; charset=utf-8")
        if path == "/favicon.ico":
            return reply(b"", 204)
        if path.startswith("/api/"):
            if not auth:
                return reply({"error": "Enter the website access code to use this research workspace."}, 401)
            if not secrets.compare_digest(env.get("HTTP_X_RESEARCH_TOKEN", ""), self.csrf):
                return reply({"error": "Reconnect to the research service and try again."}, 403)
        if path.startswith("/api/research/") and method == "GET":
            job_id = path.removeprefix("/api/research/")
            with self.lock:
                self.prune_jobs()
                job = self.jobs.get(job_id)
                if job:
                    return reply({key: value for key, value in job.items() if key != "finished"})
            return reply({"error": "This research session expired or the server restarted. Submit the question again."}, 404)
        if path == "/api/research" and method == "POST":
            if not env.get("CONTENT_TYPE", "").split(";")[0].strip() == "application/json":
                return reply({"error": "Send a JSON request."}, 415)
            try:
                length = int(env.get("CONTENT_LENGTH", "0") or "0")
                if not 0 < length <= 72000:
                    raise core.AppError("The research question is too large or empty.", 413)
                data = json.loads(env["wsgi.input"].read(length))
                core.validate_input(data)
                if not core.api_key(cfg, "OpenAI"):
                    raise core.AppError("The site owner needs to configure the OpenAI key on the research server.", 503)
                job_id = self.start_job(data, cfg)
                return reply({"job_id": job_id, "status": "running"}, 202)
            except (ValueError, UnicodeError):
                return reply({"error": "Invalid research request."}, 400)
            except core.AppError as exc:
                return reply({"error": str(exc)}, exc.status)
        return reply({"error": "Not found."}, 404)

class LocalServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--open", action="store_true", help="Open the website in your browser.")
    parser.add_argument("--reuse", action="store_true", help="Reuse an already running local Paralegal server.")
    parser.add_argument("--production", action="store_true", help="Use Waitress behind an HTTPS hosting proxy.")
    args = parser.parse_args()
    cfg = core.config()
    public_url = (cfg.get("PARALEGAL_PUBLIC_URL") or cfg.get("RENDER_EXTERNAL_URL") or "").rstrip("/") if args.production else ""
    if args.production:
        parsed = urlsplit(public_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.username or parsed.password:
            parser.error("Set PARALEGAL_PUBLIC_URL to the public HTTPS origin (Render sets RENDER_EXTERNAL_URL).")
        if len(cfg.get("PARALEGAL_ACCESS_CODE", "")) < 24:
            parser.error("Set PARALEGAL_ACCESS_CODE to a random secret of at least 24 characters.")
    site = ResearchSite(public_url=public_url, port=args.port)
    if args.production:
        try:
            from waitress import serve
        except ImportError:
            parser.error("Install hosting dependencies with: python -m pip install -r requirements.txt")
        serve(site, host="0.0.0.0", port=args.port, threads=6,
              max_request_body_size=72000, expose_tracebacks=False)
        return
    address = f"http://localhost:{args.port}/Paralegal.html"
    if args.open or args.reuse:
        try:
            with urlopen(f"http://localhost:{args.port}/api/discover", timeout=2) as response:
                if json.load(response).get("service") == SERVICE:
                    print("Paralegal: " + address, flush=True)
                    if args.open:
                        webbrowser.open(address)
                    return
        except Exception:
            pass
    try:
        server = make_server("127.0.0.1", args.port, site, server_class=LocalServer, handler_class=QuietHandler)
    except OSError:
        parser.error(f"Port {args.port} is occupied. Stop the older server or select another --port.")
    print("Paralegal: " + address, flush=True)
    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
