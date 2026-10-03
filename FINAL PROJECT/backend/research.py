"""Research orchestration independent of HTTP routes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from providers import Providers, ProviderError, key, source

STATE_CODES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'.split()
STATE_NAMES = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Puerto Rico|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming'.split('|')
STATES = dict(zip(STATE_CODES, STATE_NAMES))


def state_name(value):
    value = value.strip()
    if not value or value.lower() in ('federal', 'unspecified'):
        return ''
    match = STATES.get(value.upper()) or next((s for s in STATES.values() if s.lower()==value.lower()), None)
    if not match:
        raise ValueError('Use a US state name, two-letter code, DC, PR, or federal.')
    return match


def validate_report(report, sources):
    """Reject dangling citations and fabricated quotes; never imply legal verification."""
    by_id = {s['id']:s for s in sources}
    findings, annotations, rejected = [], [], 0
    for finding in report.findings:
        if not finding.source_ids or any(s not in by_id for s in finding.source_ids):
            rejected += 1
            continue
        findings.append(finding.model_dump())
    for annotation in report.annotations:
        document = by_id.get(annotation.source_id)
        passage = next((p for p in document.get('passages', []) if p['id']==annotation.passage_id), None) if document else None
        if not passage or document['text'][passage['start']:passage['end']] != passage['text']:
            rejected += 1
            continue
        annotations.append({**annotation.model_dump(), 'quote':passage['text'], 'start':passage['start'],
                            'end':passage['end'], 'quote_verified':True})
    result = report.model_dump()
    result['source_analyses'] = [item.model_dump() for item in report.source_analyses if item.source_id in by_id]
    result.update(findings=findings, annotations=annotations)
    if rejected:
        result['limitations'].append(f'{rejected} unsupported findings or annotations were withheld.')
    return result


def research(intake, config, client=None):
    client = client or Providers(config)
    plan = client.plan(intake)
    sources, statuses = [], {}
    state = state_name(intake.jurisdiction.state)

    def retrieve(provider, query):
        if not key(config, provider):
            return [], {'status':'unconfigured', 'message':'Provider API key is missing.'}
        if provider == 'openstates' and not state:
            return [], {'status':'skipped', 'message':'State jurisdiction is needed.'}
        try:
            docs = getattr(client, provider)(query[:400], state)
            return docs, {'status':'ok' if docs else 'empty', 'count':len(docs)}
        except ProviderError as exc:
            return [], {'status':'failed', 'message':str(exc)}
        except Exception:
            return [], {'status':'failed', 'message':'Unexpected provider response.'}

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {name:pool.submit(retrieve, name, query) for name, query in [
            ('courtlistener',plan.court_query), ('govinfo',plan.federal_query), ('openstates',plan.state_query)]}
        for provider, future in futures.items():
            docs, statuses[provider] = future.result()
            sources.extend(docs)
    for doc in intake.documents:
        sources.append(source('user', doc.title, '', doc.text, 'user_supplied', authority_status='Unverified user-supplied material.'))
    for index, doc in enumerate(sources, 1):
        doc['id'] = f'S{index}'
        # Supply addressable original passages rather than asking a model to retype quotes.
        doc['passages'] = []
        start = 0
        while start < len(doc['text']):
            end = min(start+900, len(doc['text']))
            if end < len(doc['text']):
                boundary = doc['text'].rfind(' ', start+450, end)
                if boundary > start:
                    end = boundary+1
            doc['passages'].append({'id':f"{doc['id']}-P{len(doc['passages'])+1}",
                                   'start':start, 'end':end, 'text':doc['text'][start:end]})
            start = end
    warnings = [
        'Research aid, not legal advice. Verify authorities, jurisdiction and current legal status with an attorney.',
        'Coverage is not exhaustive. Local ordinances and current state codes are not comprehensively searched.',
        'Annotations refer to returned text using Unicode code-point offsets, not PDF page coordinates.',
        'Quote matching verifies text presence, not whether the interpretation is correct.',
    ]
    report = None
    if sources:
        try:
            report = validate_report(client.summarize(intake, sources, plan), sources)
            statuses['openai'] = {'status':'ok'}
        except ProviderError as exc:
            statuses['openai'] = {'status':'failed', 'message':str(exc)}
            warnings.append('Source retrieval completed, but the summary could not be generated.')
    else:
        statuses['openai'] = {'status':'plan_only'}
        warnings.append('No sources were retrieved; no legal conclusions were generated.')
    return {'created_at':datetime.now(timezone.utc).isoformat(), 'jurisdiction':intake.jurisdiction.model_dump(),
            'plan':plan.model_dump(), 'sources':sources, 'report':report, 'providers':statuses,
            'warnings':warnings, 'partial':report is None or any(s['status'] in ('failed','unconfigured') for s in statuses.values())}
