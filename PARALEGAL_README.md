# Paralegal website

## Open it on this computer

In VS Code, select **Paralegal website** in Run and Debug, then choose **Run Without Debugging** (Ctrl+F5). The launch task starts the Python backend on port 8000 and waits for it before opening Chrome. The task reuses an existing Paralegal server if one is already running.

Double-click **Start Paralegal.cmd**. It starts the research server and opens your browser. Leave its terminal window open while using the app. Close the window or press Ctrl+C to stop it.

You can also run:

    python paralegal_server.py --open

The local website is http://localhost:8000/Paralegal.html. Once the server is running, opening Paralegal.html directly connects to it automatically. An HTML file cannot start Python on its own; if the server is stopped, the page tells you to use the launcher and checks again automatically.

The existing .env contains your API credentials. Keep it out of Git and browser code. The backend rereads it without a restart. The required names are:

    OPENAI_API_KEY=
    COURTLISTENER_API_KEY=
    GOVINFO_API_KEY=
    OPENSTATES_API_KEY=

Optional: OPENAI_MODEL overrides the default gpt-5.5. “Configured” only confirms a nonempty key, not provider account access.

## Publish one website address

Railway deployment is also prepared in railway.json. Connect the Railway integration to let the assistant deploy to your hosting account. The deployment needs the four provider keys and a separately generated PARALEGAL_ACCESS_CODE stored as private server variables. Generate a public HTTPS domain and set PARALEGAL_PUBLIC_URL to that origin before starting the production service. Use one server instance because research jobs are held in process memory. Railway's healthcheck hostname is permitted only for its read-only discovery endpoint.

No public deployment has been completed merely by creating these configuration files. After a successful deployment, update the portfolio's Paralegal link to the actual public URL, or configure the static frontend's backend origin as described below.

The repository includes render.yaml for hosting the page and Python service together on Render. This is prepared but is not deployed automatically by editing these files.

1. Push the app files to your GitHub repository. Never commit .env.
2. Sign in at https://dashboard.render.com and create a **Blueprint** connected to the repository.
3. Render reads render.yaml. Enter the four API key values in its private environment-variable setup.
4. Deploy the service. Open the HTTPS website address Render supplies.
5. In the service's Environment settings, copy the generated PARALEGAL_ACCESS_CODE. On the website, choose **Unlock workspace** and enter that code. This is a separate website access code, not an API key.

The website code prevents unauthenticated visitors from running paid research on a hosted server. Share the website access code only with people authorized to use your API accounts. It is held only in the current browser tab; refreshing the page requires reentry. Do not put the access code into HTML or commit it.

Hosting uses Waitress; local use needs only Python 3.11+. The deployment installs requirements.txt. For another host, install that file and run:

    python paralegal_host.py --production

Set PORT, PARALEGAL_PUBLIC_URL to the public HTTPS origin, PARALEGAL_ACCESS_CODE to a random secret of at least 24 characters, and the four API credentials as server environment variables. Terminate HTTPS at the host's proxy. Render supplies its external URL automatically.

Research runs as a background job with short browser polling requests to avoid long HTTP request timeouts. This initial workspace supports one active research job at a time and one server process/instance. Results live in memory for up to 30 minutes (at most 20 recent jobs); restarting or redeploying the server clears them. Save a completed packet if you need to retain it.

## If you keep GitHub Pages

GitHub Pages can show the frontend, but cannot run Python. Deploy the backend as above, then set the content of the paralegal-api-base meta tag in Paralegal.html to the hosted HTTPS origin. Set PARALEGAL_ALLOWED_ORIGINS on the backend to the exact Pages origin, for example https://a-river1.github.io (no repository path). Separate multiple permitted origins with commas.

Alternatively, select **Connect research service** on the page and enter the hosted origin. The backend must allow that frontend's origin. The website address and access code entered in this dialog are not persisted to browser storage. Hosting both together avoids this configuration.

## Research and privacy

CourtListener provides published opinions; GovInfo provides federal materials; Open States provides state bill records; OpenAI plans queries, supplements sources with web research, and summarizes evidence. State bills are not automatically current codified law. No citator or good-law guarantee is provided. A qualified attorney should verify applicability and current legal status.

Annotations are accepted only when quoted text exactly matches retrieved source text. This checks text presence, not interpretation. Full opinion/document retrieval can fail; cards disclose metadata-only, excerpts, and text truncated at 24,000 characters. Web research notes are labeled as model output and retain clickable citations.

Research may use three OpenAI calls plus searches and document retrievals from the legal providers. Prompts go to OpenAI; search queries go to the other providers. Remove confidential details first. The app writes no research to disk and uses no browser storage. Completed packets are temporarily retained in server memory for retrieval. Provider retention policies still apply; OpenAI requests use store:false.

The server serves only an explicit frontend allowlist. It does not expose .env, Python source, .git, or arbitrary files. .gitignore does not encrypt secrets or prevent OneDrive synchronization.

## Files

- Paralegal.html, paralegal.css, paralegal.js: website interface.
- paralegal_server.py: research and provider integrations.
- paralegal_host.py: local/hosted HTTP server, access checks, background jobs.
- Start Paralegal.cmd: Windows launcher.
- requirements.txt and render.yaml: production hosting configuration.

## Documentation

- OpenAI: https://developers.openai.com/api/docs/guides/tools-web-search
- CourtListener: https://wiki.free.law/c/courtlistener/help/api/rest/v4/search
- GovInfo: https://github.com/usgpo/api
- Open States: https://docs.openstates.org/api-v3/
- Waitress: https://docs.pylonsproject.org/projects/waitress/en/stable/usage.html
- Render: https://render.com/docs/blueprint-spec
