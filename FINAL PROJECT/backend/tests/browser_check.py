"""Optional Chrome integration test. Requires Playwright, not needed by the app."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app
from werkzeug.serving import make_server
from playwright.sync_api import sync_playwright, expect

release = threading.Event()
calls = []

def researcher(intake, config):
    calls.append(intake.model_dump())
    release.wait(15)
    return {'sources':[{'id':'S1','title':'Test opinion <script>bad()</script>', 'provider':'courtlistener',
             'url':'https://www.courtlistener.com/', 'coverage':'opinion_text', 'text':'Original source passage.', 'metadata':{}}],
        'report':{'source_analyses':[{'source_id':'S1','summary':'Test source summary','potential_use':'May inform the argument, subject to verification.','limitations':'Confirm jurisdiction.'}],
                  'findings':[{'statement':'Test finding','source_ids':['S1'],'relationship':'background'}],
                  'annotations':[{'source_id':'S1','quote':'Original source passage.','explanation':'Test explanation'}],
                  'next_steps':['Verify jurisdiction'], 'limitations':['Synthetic test only']},
        'plan':{'issues':['Test issue'], 'missing_information':['Dates']}, 'providers':{'courtlistener':{'status':'ok'}}, 'warnings':[]}

app = create_app({'OPENAI_API_KEY':'fake'}, researcher=researcher,
                 chat_responder=lambda chat: 'A helpful answer to '+chat.message+' <script>bad()</script>')
server = make_server('127.0.0.1', 0, app, threaded=True)
threading.Thread(target=server.serve_forever,daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
try:
    with tempfile.TemporaryDirectory(prefix='paralegal-browser-') as profile, sync_playwright() as pw:
        options = dict(channel='chrome', headless=True)
        context = pw.chromium.launch_persistent_context(profile, **options)
        page = context.pages[0]
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url)
        expect(page.locator('#storage-status')).to_contain_text('ready')
        page.locator('#chat-toggle').click()
        expect(page.locator('#chat-panel')).to_be_visible()
        page.locator('#chat-question').fill('What is mediation?')
        page.locator('#chat-send').click()
        expect(page.locator('#chat-status')).to_contain_text('Answer ready')
        expect(page.locator('#chat-messages')).to_contain_text('A helpful answer')
        assert page.locator('#chat-messages script').count()==0
        page.locator('#chat-question').fill('How does it differ from arbitration?')
        page.locator('#chat-send').click()
        expect(page.locator('#chat-messages .assistant')).to_have_count(2)
        page.locator('#chat-clear').click()
        expect(page.locator('#chat-messages .assistant')).to_have_count(0)
        page.locator('#chat-close').click()
        expect(page.locator('#chat-panel')).to_be_hidden()
        page.locator('[name=title]').fill('Saved housing research')
        page.locator('[name=question]').fill('What legal authorities apply to a withheld housing deposit?')
        page.locator('[name=facts]').fill('The landlord retained the deposit without giving any explanation after moving out.')
        page.locator('[name=state]').select_option('New York')
        page.locator('.extra-details > summary').click()
        page.locator('[data-add=documents]').click()
        page.locator('[data-key=title]').fill('Lease')
        page.locator('[data-key=text]').fill('Example lease text')
        page.locator('#save-draft').click()
        expect(page.locator('#packet-status')).to_contain_text('Draft saved')
        context.close()
        context = pw.chromium.launch_persistent_context(profile, **options)
        page = context.pages[0]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url)
        expect(page.locator('[name=title]')).to_have_value('Saved housing research')
        expect(page.locator('[data-key=text]')).to_have_value('Example lease text')
        expect(page.locator('#connection-status')).to_contain_text('Connected.')
        page.locator('#research').click()
        expect(page.locator('#packet-status')).to_contain_text('Research is running')
        assert page.locator('#resume').count() == 0
        page.reload()
        expect(page.locator('#packet-status')).to_contain_text('pending')
        assert page.locator('#token').count() == 0
        release.set()
        expect(page.locator('#packet-status')).to_contain_text('Research completed', timeout=10000)
        expect(page.locator('#results blockquote')).to_have_text('Original source passage.')
        assert calls[0]['jurisdiction']['state']=='New York'
        assert not page.locator('#results script').count()
        with page.expect_download() as download:
            page.locator('#export-packet').click()
        content=Path(download.value.path()).read_text()
        assert 'accessToken' not in content
        assert download.value.suggested_filename.endswith('.html')
        assert '<mark' in content and 'Original source passage.' in content
        assert '<script>bad()</script>' not in content
        assert 'Potential use in this matter' in content
        assert 'https://www.courtlistener.com/' in content
        assert 'Test explanation' in content
        assert 'jobId' not in content
        assert 'Test source summary' in content
        with page.expect_popup() as popup:
            page.locator('#print-packet').click()
        printable = popup.value
        expect(printable.locator('mark')).to_have_text('Original source passage.')
        expect(printable.locator('aside')).to_contain_text('Test explanation')
        assert printable.locator('script').count() == 0
        printable.close()
        edge_html = page.evaluate('''() => buildResearchReport({title:'Unicode test',result:{sources:[{id:'S1',title:'Case',text:'A😀BCDE',url:'javascript:alert(1)'}],report:{annotations:[
            {source_id:'S1',quote:'😀BC',start:1,end:4,explanation:'First'},
            {source_id:'S1',quote:'CDE',start:3,end:6,explanation:'Second'},
            {source_id:'S1',quote:'Not present',explanation:'Fabricated'}]}}})''')
        inspection=context.new_page()
        inspection.set_content(edge_html)
        assert inspection.locator('aside').count()==2
        assert inspection.locator('.source-text mark').all_text_contents()==['😀B','C','DE']
        assert inspection.locator('a[href^="javascript:"]').count()==0
        inspection.close()
        context.close()
        context = pw.chromium.launch_persistent_context(profile, **options)
        page = context.pages[0]
        page.goto(url)
        expect(page.locator('#results blockquote')).to_have_text('Original source passage.')
        expect(page.locator('#connection-status')).to_contain_text('Connected.')
        page.on('dialog',lambda dialog:dialog.accept())
        page.locator('[data-open=history-dialog]').click()
        page.locator('#clear-history').click()
        expect(page.locator('#history')).to_contain_text('No saved packets')
        page.reload()
        expect(page.locator('#history')).to_contain_text('No saved packets')
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#chat-toggle').click()
        expect(page.locator('#chat-panel')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        context.close()
        blocked = pw.chromium.launch(**options)
        page=blocked.new_page()
        page.add_init_script("Object.defineProperty(window, 'indexedDB', {get(){throw new Error('blocked')}})")
        page.goto(url)
        expect(page.locator('#storage-status')).to_contain_text('unavailable')
        blocked.close()
        assert not errors,errors
        print('PASS: drafts and results survive browser restart, pending job resumes, annotations render safely, JSON exports omit tokens, deletion persists, blocked storage is reported.')
finally:
    release.set()
    server.shutdown()
    app.extensions['research_pool'].shutdown(wait=True)
