# Paralegal website

The new app consists of `frontend` (plain HTML, minimal CSS, JavaScript) and `backend` (Flask). The older `Paralegal Prototype` is separate.

## Open the website

From the repository root:

```powershell
cd "FINAL PROJECT/backend"
.\.venv\Scripts\python.exe app.py
```

For first-time setup, follow `backend/README.md` to create the virtual environment and install dependencies.

Open **http://127.0.0.1:5000** in a browser. The research service connects automatically, with no token or account required. Provider API keys stay on the server. The backend serves the frontend directly, so a separate static server is unnecessary. Do not double-click the HTML file to make API requests.

Enter the question, facts and location, then choose **Create research packet**. More fields cover legal services needed, desired outcome, parties, procedural stage, timeline, known deadlines, additional context, and up to five pasted documents. Results show cited findings, original-document links, verified passage quotations, missing information and provider errors.

## Deploy on Render

The public website/backend address is https://a-river1-github-io-4.onrender.com. The portfolio links directly to it. The frontend defaults to this backend for hosted use and keeps the current origin for localhost development. This URL alone does not deploy local changes: push the updated files and redeploy the Render service. Its public health endpoint is `/api/health`.

Use the website on Render to keep frontend and backend on the same origin. If you instead serve the frontend on GitHub Pages, add `https://a-river1.github.io` to Render's `ALLOWED_ORIGINS` environment variable. Opening the HTML as a local file cannot call the API; use the hosted website or the local Flask server.

The dependency file is `requirements.txt` (plural). The project-level file includes `backend/requirements.txt` so both local and hosted installs use the same dependencies.

For an existing Render Python Web Service, use these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `FINAL PROJECT` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `python backend/app.py` |
| Health Check Path | `/api/health` |

Keep the root at `FINAL PROJECT`, not `backend`, so Render includes the frontend too. Set `HOST=0.0.0.0`. Add the four provider keys as private environment variables: `OPENAI_API_KEY`, `COURTLISTENER_API_KEY`, `GOVINFO_API_KEY`, `OPENSTATE_API_KEY` (or its supported alias `OPENSTATES_API_KEY`). Render supplies `PORT`. Do not upload or commit `.env`.

For a new Blueprint, select `FINAL PROJECT/render.yaml` as the Blueprint Path. It sets these commands for public, token-free access. For an existing manually configured service, update its settings explicitly; adding this YAML alone does not update that service. Push these files to GitHub before deploying. Do not use the old prototype's deployment configuration.

After deployment, open the Render HTTPS address. Visitors need only a browser. No workspace token is required. Visitor accounts have not been implemented. Public requests use the owner?s API credits, limited to two concurrent jobs and ten submissions per hour per server process. These limits reset on restart and are not a guaranteed spending cap. The free service may sleep; in-memory pending jobs are not durable across restarts. Saved completed packets remain in the visitor's browser.

## Saved research

Drafts save automatically after typing pauses and when fields change. Packets and results are stored in IndexedDB in the user's browser on the same device and web origin. Reopening the website restores the most recently edited packet and the history list. Saved results can be read without connecting to the API. A new research run from an existing result creates a separate packet; the original submitted intake stays attached to each result.

- Storage includes legal facts, pasted document text and research results. It is not encrypted or an account-based service. Anyone using the same browser profile may access it.
- API keys are never sent to the browser. Reopening automatically reconnects to the research service.
- Clearing browser data, using private browsing, changing browsers/devices or changing the website origin may remove or separate history. `localhost` and `127.0.0.1` are different origins; use one consistently.
- **Export current packet** downloads JSON for backup. Import/sync is not implemented yet.
- Delete one packet or all local history with the provided buttons. Local deletion does not cancel a server job or delete third-party provider data.
- Jobs already accepted by the server can be checked after reconnecting to the same backend. Server jobs expire after 30 minutes or disappear on restart. A closed browser cannot download a completed result; reconnect before expiry to save it locally.
- If storage fills or is blocked, the website displays a warning and keeps the packet in memory; export before closing. If submission is interrupted, its acceptance may be unknown. Avoid immediately resubmitting a potentially paid job.

The future public website should serve this frontend and backend together. For a separately hosted frontend, enter the backend's HTTPS origin in the connection form and add the frontend origin to the backend's ALLOWED_ORIGINS. Local browser storage does not provide user accounts or multi-device persistence.

## Files

- `frontend/index.html`: intake, history, connection and results interface.
- `frontend/app.js`: API integration, background polling, IndexedDB storage and rendering.
- `frontend/styles.css`: minimal readable layout.
- `backend/app.py`: Flask endpoints and explicit frontend file serving.
- `backend/README.md`: backend API contract and setup.

## Verification

Run the backend tests with `.venv\Scripts\python.exe -m unittest discover -s tests -v` from `backend`. The optional `tests/browser_check.py` requires Playwright (`.venv\Scripts\python.exe -m pip install playwright`) and installed Chrome. It starts a temporary local Flask service with simulated research and verifies full browser restart persistence, job resumption, annotations, export, deletion and blocked-storage handling without spending API credits.
