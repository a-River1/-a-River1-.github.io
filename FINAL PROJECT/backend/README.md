# Paralegal Flask backend

Fresh backend implementation; no imports from the previous Paralegal prototype. The basic frontend is in `../frontend` and is served at `/` by this backend. US research only: CourtListener opinions, GovInfo federal documents, Open States legislation, and OpenAI query planning and source-based synthesis. This cannot cover every legal issue or guarantee current law.

## Run locally

From the repository root in PowerShell:

```powershell
cd "FINAL PROJECT/backend"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

On macOS/Linux use `python3` and `.venv/bin/python`. Open the new website at http://127.0.0.1:5000; the health endpoint is `/api/health`. The frontend connects automatically. No access token is needed.

Credentials are read from `FINAL PROJECT/.env`, then `backend/.env`, then environment variables (last wins). Existing credentials were copied privately from the prototype; neither implementation depends on the other's code. `.gitignore` excludes both files. Restart after changing configuration. Do not copy blank provider values over working parent values.

Supported names: OPENAI_API_KEY, COURTLISTENER_API_KEY, GOVINFO_API_KEY, OPENSTATES_API_KEY. The existing OPENSTATE_API_KEY alias is also supported. OPENAI_MODEL defaults to gpt-4.1-mini and can be changed to an accessible Responses model supporting structured output. Missing provider credentials appear in the result; OpenAI is required to begin research.

## API contract

The API is public and requires no access token. Provider keys remain server-side. Research job IDs are unguessable bearer references: anyone with a job ID can read or delete that job. There is no endpoint listing jobs. Keep packet exports private because they include job IDs and research content. This is not an account-based privacy system.

| Method | Route | Result |
| --- | --- | --- |
| GET | /api/health | Public readiness response, no keys or provider status |
| GET | /api/config | Provider configuration booleans, US states, JSON intake schema |
| POST | /api/research | JSON intake; 202 with job_id and poll_url |
| GET | /api/research/{job_id} | running, completed with result, or failed with error |
| DELETE | /api/research/{job_id} | Delete a completed/failed research packet |

The website constructs this input automatically; a minimal API example is below. Required: question (12–4,000 characters), facts (20–16,000), jurisdiction object. Optional: state/city/county/court, legal area, desired outcome, parties, timeline, deadlines, procedural status, additional context, pro bono flag, and up to five pasted documents. Country must be US. State can be a full name or two-letter code. Unknown fields are rejected to catch frontend mistakes. Missing state is allowed for federal or uncertain jurisdiction and skips Open States. Uploaded PDFs/OCR are not implemented; documents currently contain a title and plain text.

PowerShell example:

```powershell
@{
    question = "What authorities apply to a withheld security deposit?"
    facts = "The landlord retained the deposit after the lease ended without an explanation."
    jurisdiction = @{ country = "US"; state = "NY" }
} | ConvertTo-Json | Set-Variable -Name researchBody
$job = Invoke-RestMethod http://127.0.0.1:5000/api/research -Method Post -ContentType application/json -Body $researchBody
Invoke-RestMethod ("http://127.0.0.1:5000" + $job.poll_url)
```

Poll again until status is completed or failed. Input errors return 422; rejected browser origins 403; excessive payload 413; non-JSON input 415; busy/rate limit 429; missing OpenAI configuration 503. Worker failures return status=failed in the polling response. Health success does not prove API credit or provider availability.

## Research results and annotations

The result contains a research plan, source documents, per-provider status, a report, warnings, and a partial flag. Source metadata includes provider, title, original URL, available text, coverage, truncation, and jurisdiction/date metadata when supplied. Up to four documents per provider are retrieved. Text is capped at 24,000 characters per source. Provider errors do not discard successful results from other providers.

Findings link to source IDs and distinguish supporting, adverse, background, or uncertain material. Findings with absent/unknown citations are withheld. The model selects numbered passages; the server attaches their original text. Annotations contain a verbatim quote, source ID, passage ID, tentative explanation, and start/end offsets into returned source text. Offsets use Python Unicode code points (end exclusive), not JavaScript UTF-16 indices or PDF page positions. Frontends can use `Array.from(text)` when applying offsets. Quotes not found in source text are withheld. Render all text as text, never untrusted HTML.

These are annotated text excerpts linked to original documents, not modified PDF downloads. Exact quote matching does not establish that an interpretation is legally correct. Court opinions are not citator-checked; binding/persuasive status must be reviewed. Bill abstracts are not enacted state codes. User-supplied documents are unverified evidence, not precedents. Local ordinances and current state codes are coverage gaps. Dates are intake context; this backend does not calculate legal deadlines. It does not fabricate a report if retrieval returns nothing.

## Privacy, cost, and hosting

Intake and retrieved text are sent to OpenAI; derived search keywords go to the legal providers. Remove unnecessary confidential identifiers. The app requests `store:false` and does not log or save intake/results to disk, but provider policies still apply. Research normally uses two paid OpenAI calls. Jobs/results live in process memory and expire after 30 minutes; at most 20 packets are retained. Restarting loses them. Two jobs may run concurrently, with ten submissions per hour across this workspace.

For hosting, set HOST=0.0.0.0 and PORT. BACKEND_ACCESS_TOKEN is no longer used and can be removed from hosting settings. Use HTTPS at the hosting proxy, one process/instance, `pip install -r requirements.txt`, and `python app.py`. Do not use Flask's debug server publicly. ALLOWED_ORIGINS accepts comma-separated exact frontend origins, with no wildcard. The service allows anonymous research under a shared process-local limit of two concurrent jobs and ten submissions per hour. These limits reset on restart and are not a guaranteed spending cap. Account-based privacy, durable jobs and distributed quotas are not implemented.

## Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Tests use synthetic provider responses, spend no API credits, and cover HTTP contracts, validation, access control, CORS, jobs, partial failures, provider adapters and quote verification. A separate live check on October 2, 2026 successfully contacted all four providers and retrieved 12 sources, seven cited findings, and five verified passage annotations for the fictional housing example. This verifies that request, not exhaustive coverage or continued provider availability.

## API references

- Flask: https://flask.palletsprojects.com/en/stable/quickstart/
- OpenAI structured output: https://developers.openai.com/api/docs/guides/structured-outputs
- CourtListener: https://wiki.free.law/c/courtlistener/help/api/rest/v4/search/
- GovInfo: https://github.com/usgpo/api
- Open States: https://docs.openstates.org/api-v3/
