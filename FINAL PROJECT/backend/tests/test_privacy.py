import threading
import time
import unittest
from app import create_app
from test_backend import INTAKE


class PrivacyTests(unittest.TestCase):
    def setUp(self):
        self.release = threading.Event()
        def research(intake, config):
            self.release.wait(5)
            return {'private_facts': intake.facts}
        self.app = create_app({'OPENAI_API_KEY': 'fake'}, researcher=research)
        self.owner, self.other = self.app.test_client(), self.app.test_client()
        for client in (self.owner, self.other):
            client.environ_base['HTTP_X_CSRF_TOKEN'] = client.get('/api/config').json['csrf_token']

    def tearDown(self):
        self.release.set()
        self.app.extensions['research_pool'].shutdown(wait=True)

    def test_other_browser_cannot_read_or_delete_running_or_completed_job(self):
        path = self.owner.post('/api/research', json=INTAKE).json['poll_url']
        self.assertEqual(self.owner.get(path).json, {'status': 'running'})
        for client in (self.other, self.app.test_client()):
            self.assertEqual(client.get(path).status_code, 404)
        self.assertEqual(self.other.delete(path).status_code, 404)
        self.release.set()
        for _ in range(100):
            response = self.owner.get(path)
            if response.json['status'] == 'completed':
                break
            time.sleep(.01)
        self.assertEqual(response.json['result']['private_facts'], INTAKE['facts'])
        self.assertNotIn('owner', response.json)
        self.assertEqual(self.other.get(path).status_code, 404)
        self.assertEqual(self.other.delete(path).status_code, 404)
        self.assertEqual(self.other.get(path).json, self.other.get('/api/research/nonexistent').json)
        self.assertEqual(self.owner.delete(path).status_code, 204)

    def test_missing_wrong_and_other_session_csrf_rejected(self):
        for token in ('', 'incorrect', self.other.environ_base['HTTP_X_CSRF_TOKEN']):
            for endpoint in ('/api/research', '/api/chat'):
                self.assertEqual(self.owner.post(endpoint, json=INTAKE,
                    headers={'X-CSRF-Token': token}).status_code, 403)

    def test_tampered_cookie_cannot_access_job(self):
        path = self.owner.post('/api/research', json=INTAKE).json['poll_url']
        self.other.set_cookie('paralegal_session', self.owner.get_cookie('paralegal_session').value + 'tampered')
        self.assertEqual(self.other.get(path).status_code, 404)

    def test_cookie_and_response_protection(self):
        app = create_app({'RENDER': 'true'})
        try:
            response = app.test_client().get('/api/config', base_url='https://example.com')
            cookie = response.headers['Set-Cookie']
            for attribute in ('Secure', 'HttpOnly', 'SameSite=Lax'):
                self.assertIn(attribute, cookie)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertEqual(response.headers['Referrer-Policy'], 'no-referrer')
            self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
        finally:
            app.extensions['research_pool'].shutdown(wait=True)
