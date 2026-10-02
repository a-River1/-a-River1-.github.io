import io
import time
import unittest
from unittest.mock import patch
from app import create_app
from models import Intake, Plan, Report
from providers import Providers, ProviderError, fetch, source
from research import research, validate_report

TOKEN = 'test-access-token-at-least-24-characters'
CONFIG = {'BACKEND_ACCESS_TOKEN':TOKEN, 'OPENAI_API_KEY':'fake',
          'COURTLISTENER_API_KEY':'fake', 'GOVINFO_API_KEY':'fake', 'OPENSTATE_API_KEY':'fake',
          'ALLOWED_ORIGINS':'http://localhost:5173'}
INTAKE = {'question':'What authority concerns return of a security deposit?',
          'facts':'My landlord kept the full security deposit after I moved out.',
          'jurisdiction':{'state':'NY'}}
PLAN = Plan(court_query='security deposit New York', federal_query='housing', state_query='security deposit',
            issues=['deposit'], missing_information=['Dates and lease terms'])


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(CONFIG, researcher=lambda i,c:{'sources':[], 'report':None})
        self.client = self.app.test_client()
        self.auth = {'Authorization':'Bearer '+TOKEN}
    def tearDown(self):
        self.app.extensions['research_pool'].shutdown(wait=True)
    def test_health_is_public_and_minimal(self):
        r = self.client.get('/api/health')
        self.assertEqual(r.status_code,200)
        self.assertNotIn('providers',r.json)
    def test_frontend_allowlist(self):
        for path in ['/', '/index.html', '/app.js', '/styles.css']:
            with self.client.get(path) as response:
                self.assertEqual(response.status_code,200)
        for path in ['/../.env', '/frontend/../.env', '/backend/app.py']:
            self.assertNotEqual(self.client.get(path,headers=self.auth).status_code,200)
    def test_authentication_and_private_files(self):
        self.assertEqual(self.client.post('/api/research',json=INTAKE).status_code,401)
        for path in ['/.env','/app.py','/../.env']:
            self.assertEqual(self.client.get(path,headers=self.auth).status_code,404)
    def test_input_validation(self):
        for data in [[], {}, {**INTAKE,'facts':'short'}, {**INTAKE,'jurisdiction':{'country':'CA'}},
                     {**INTAKE,'jurisdiction':{'state':'Atlantis'}}, {**INTAKE,'unexpected':'value'}]:
            self.assertEqual(self.client.post('/api/research',json=data,headers=self.auth).status_code,422)
    def test_body_limits_and_json(self):
        self.assertEqual(self.client.post('/api/research',data='x',headers=self.auth).status_code,415)
        self.assertEqual(self.client.post('/api/research',data='x'*200001,
            content_type='application/json',headers=self.auth).status_code,413)
    def test_cors(self):
        self.assertEqual(self.client.post('/api/research',json=INTAKE,
            headers={**self.auth,'Origin':'https://attacker.example'}).status_code,403)
        r = self.client.options('/api/research',headers={'Origin':'http://localhost:5173'})
        self.assertEqual(r.status_code,204)
        self.assertEqual(r.headers['Access-Control-Allow-Origin'],'http://localhost:5173')
    def test_async_job_and_delete(self):
        r = self.client.post('/api/research',json=INTAKE,headers=self.auth)
        self.assertEqual(r.status_code,202)
        path = r.json['poll_url']
        for _ in range(100):
            result = self.client.get(path,headers=self.auth)
            if result.json['status']!='running': break
            time.sleep(.01)
        self.assertEqual(result.json['status'],'completed')
        self.assertEqual(self.client.delete(path,headers=self.auth).status_code,204)
        self.assertEqual(self.client.get(path,headers=self.auth).status_code,404)
    def test_global_submission_limit(self):
        for _ in range(10):
            r=self.client.post('/api/research',json=INTAKE,headers=self.auth)
            self.assertEqual(r.status_code,202)
            for _ in range(100):
                if self.client.get(r.json['poll_url'],headers=self.auth).json['status']!='running':break
                time.sleep(.01)
        self.assertEqual(self.client.post('/api/research',json=INTAKE,headers=self.auth).status_code,429)
    def test_quote_and_citation_validation(self):
        report=Report(findings=[{'statement':'Good','source_ids':['S1'],'relationship':'background'},
                               {'statement':'Invented','source_ids':['S99'],'relationship':'supporting'}],
            annotations=[{'source_id':'S1','passage_id':'S1-P1','explanation':'Relevant'},
                         {'source_id':'S1','passage_id':'S1-P999','explanation':'Invalid'}],
            missing_information=[],next_steps=[],limitations=[])
        result=validate_report(report,[{'id':'S1','text':'An exact passage here.',
            'passages':[{'id':'S1-P1','text':'exact passage','start':3,'end':16}]}])
        self.assertEqual(len(result['findings']),1)
        self.assertEqual(len(result['annotations']),1)
        self.assertEqual(result['annotations'][0]['start'],3)
    def test_partial_failure_keeps_sources(self):
        class Fake:
            def plan(self, intake):return PLAN
            def courtlistener(self,*args):return [source('courtlistener','Opinion','https://www.courtlistener.com/opinion/1/','Evidence')]
            def govinfo(self,*args):raise ProviderError('Provider returned HTTP 429.')
            def openstates(self,*args):return []
            def summarize(self,*args):raise ProviderError('OpenAI unavailable.')
        result=research(Intake.model_validate(INTAKE),CONFIG,Fake())
        self.assertEqual(len(result['sources']),1)
        self.assertTrue(result['partial'])
        self.assertIsNone(result['report'])
    def test_no_sources_no_summary(self):
        class Fake:
            def plan(self,intake):return PLAN
            def courtlistener(self,*args):return []
            def govinfo(self,*args):return []
            def openstates(self,*args):return []
            def summarize(self,*args):raise AssertionError('Must not synthesize without sources')
        self.assertIsNone(research(Intake.model_validate(INTAKE),CONFIG,Fake())['report'])
    def test_transport_blocks_arbitrary_hosts(self):
        for url in ['http://api.openai.com','https://attacker.example','https://api.openai.com:444/a']:
            with self.assertRaises(ProviderError):fetch(url)
    def test_openai_structured_contract(self):
        with patch('providers.fetch',return_value={'status':'completed','output':[{'content':[
            {'type':'output_text','text':PLAN.model_dump_json()}]}]}) as call:
            self.assertEqual(Providers(CONFIG).plan(Intake.model_validate(INTAKE)),PLAN)
            payload=call.call_args.args[2]
            self.assertFalse(payload['store'])
            self.assertTrue(payload['text']['format']['strict'])
    def test_provider_adapters(self):
        client=Providers(CONFIG)
        with patch('providers.fetch',side_effect=[{'results':[{'caseName':'Case','absolute_url':'/opinion/1/',
            'opinions':[{'id':1}]}]},{'plain_text':'Court text'}]):
            self.assertEqual(client.courtlistener('query','New York')[0]['text'],'Court text')
        with patch('providers.fetch',side_effect=[{'results':[{'title':'Code','packageId':'USCODE-2025'}]},'<p>Code text</p>']):
            self.assertEqual(client.govinfo('query','')[0]['coverage'],'document_text')
        with patch('providers.fetch',return_value={'results':[{'title':'Bill','abstracts':[{'abstract':'Bill abstract'}],
             'openstates_url':'https://openstates.org/ny/bills/2025/A1/'}]}):
            self.assertEqual(client.openstates('query','New York')[0]['coverage'],'bill_abstract')


if __name__=='__main__':
    unittest.main()
