"""Flask JSON API. Start with python app.py; no legacy app imports."""
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hmac
import os
from pathlib import Path
import secrets
import threading
import time
from dotenv import dotenv_values
from flask import Flask, jsonify, request, send_from_directory
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException
from models import Intake
from providers import KEYS, ProviderError, key
from research import research, state_name, STATES

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT.parent / 'frontend'
PUBLIC_FILES = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css'}


def settings():
    # Explicit paths only; do not search parent folders for unrelated credentials.
    return {**dotenv_values(ROOT.parent/'.env'), **dotenv_values(ROOT/'.env'), **os.environ}


def create_app(config=None, researcher=None):
    cfg = settings() if config is None else dict(config)
    token = cfg.get('BACKEND_ACCESS_TOKEN') or secrets.token_urlsafe(32)
    if len(token) < 24:
        raise ValueError('BACKEND_ACCESS_TOKEN must contain at least 24 characters.')
    app = Flask(__name__, static_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=200_000)
    app.extensions['access_token'] = token
    app.extensions['token_generated'] = not cfg.get('BACKEND_ACCESS_TOKEN')
    pool = ThreadPoolExecutor(max_workers=2)
    jobs, submissions = OrderedDict(), []
    lock = threading.Lock()
    app.extensions['research_pool'] = pool
    runner = researcher or research
    origins = {s.strip().rstrip('/') for s in cfg.get('ALLOWED_ORIGINS', '').split(',') if s.strip()}

    @app.before_request
    def protect():
        origin = request.headers.get('Origin')
        same_origin = origin == request.host_url.rstrip('/')
        if origin and origin not in origins and not same_origin:
            return jsonify(error='origin_not_allowed'), 403
        if request.method == 'OPTIONS':
            return '', 204
        if request.path == '/api/health' or (request.path in PUBLIC_FILES and request.method in ('GET', 'HEAD')):
            return None
        supplied = request.headers.get('Authorization', '')
        if not hmac.compare_digest(supplied.encode(), ('Bearer '+token).encode()):
            return jsonify(error='unauthorized', message='Provide the backend access token.'), 401

    @app.after_request
    def headers(response):
        response.headers.update({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
        origin = request.headers.get('Origin')
        if origin in origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        return response

    @app.errorhandler(HTTPException)
    def http_error(exc):
        return jsonify(error=exc.name, message=exc.description), exc.code

    @app.errorhandler(Exception)
    def unexpected_error(exc):
        # Avoid logging exception objects containing prompts or provider credentials.
        return jsonify(error='internal_error', message='The request could not be completed.'), 500

    @app.get('/api/health')
    def health():
        return jsonify(status='ok', service='paralegal-flask-v1')

    @app.get('/')
    @app.get('/index.html')
    @app.get('/app.js')
    @app.get('/styles.css')
    def frontend():
        return send_from_directory(FRONTEND, PUBLIC_FILES[request.path])

    @app.get('/api/config')
    def configuration():
        return jsonify(providers={name:bool(key(cfg,name)) for name in KEYS}, states=STATES,
                       country='US', intake_schema=Intake.model_json_schema())

    def prune(capacity=20):
        now = time.monotonic()
        for job_id in list(jobs):
            if jobs[job_id]['status'] != 'running' and now-jobs[job_id]['finished'] > 1800:
                del jobs[job_id]
        while len(jobs) > capacity:
            done = next((i for i,j in jobs.items() if j['status']!='running'), None)
            if done is None:
                break
            del jobs[done]

    @app.post('/api/research')
    def submit():
        if not request.is_json:
            return jsonify(error='json_required'), 415
        try:
            intake = Intake.model_validate(request.get_json())
            if any(len(p)>300 for p in intake.parties):
                return jsonify(error='invalid_parties', message='Each party description must be under 300 characters.'), 422
            intake.jurisdiction.state = state_name(intake.jurisdiction.state)
        except ValidationError as exc:
            return jsonify(error='invalid_intake', fields=[{'field':'.'.join(map(str,e['loc'])), 'message':e['msg']}
                                                         for e in exc.errors(include_input=False, include_context=False)]), 422
        except ValueError as exc:
            return jsonify(error='invalid_jurisdiction', message=str(exc)), 422
        if not key(cfg, 'openai'):
            return jsonify(error='not_configured', message='Set OPENAI_API_KEY on the server.'), 503
        with lock:
            prune(capacity=19)
            now = time.monotonic()
            submissions[:] = [t for t in submissions if now-t<3600]
            if sum(j['status']=='running' for j in jobs.values()) >= 2 or len(submissions)>=10:
                return jsonify(error='busy_or_rate_limited', message='Two concurrent jobs and ten submissions per hour are allowed.'), 429
            job_id = secrets.token_urlsafe(24)
            jobs[job_id] = {'status':'running'}
            submissions.append(now)

        def work():
            try:
                result = {'status':'completed', 'result':runner(intake, cfg)}
            except ProviderError as exc:
                result = {'status':'failed', 'error':str(exc)}
            except Exception:
                result = {'status':'failed', 'error':'Research failed; no conclusions were generated.'}
            with lock:
                jobs[job_id] = {**result, 'finished':time.monotonic()}
        try:
            pool.submit(work)
        except RuntimeError:
            with lock:
                jobs.pop(job_id, None)
            return jsonify(error='service_stopping'), 503
        return jsonify(job_id=job_id, status='running', poll_url=f'/api/research/{job_id}'), 202

    @app.route('/api/research/<job_id>', methods=['GET','DELETE'])
    def result(job_id):
        with lock:
            prune()
            job = jobs.get(job_id)
            if not job:
                return jsonify(error='not_found_or_expired'), 404
            if request.method == 'DELETE':
                if job['status']=='running':
                    return jsonify(error='job_still_running'), 409
                del jobs[job_id]
                return '', 204
            return jsonify({k:v for k,v in job.items() if k!='finished'})

    return app


if __name__ == '__main__':
    from waitress import serve
    config = settings()
    host = config.get('HOST', '127.0.0.1')
    if host not in ('127.0.0.1','localhost','::1') and not config.get('BACKEND_ACCESS_TOKEN'):
        raise SystemExit('Set BACKEND_ACCESS_TOKEN before exposing the server beyond localhost.')
    application = create_app(config)
    if application.extensions['token_generated']:
        print('Temporary local access token (not an API key): '+application.extensions['access_token'], flush=True)
    port = int(config.get('PORT') or 5000)
    print(f'Paralegal website: http://{host}:{port}/', flush=True)
    serve(application, host=host, port=port, threads=6)
