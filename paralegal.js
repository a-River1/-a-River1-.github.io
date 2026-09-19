"use strict";
const $ = id => document.getElementById(id);
let csrfToken = "";
let lastPacket = null;
let busy = false;
let currentFilter = "all";
const kindNames = {case:"Court opinion", federal:"Federal material", bill:"State bill", web:"Web research"};
const examples = {
  housing: {state:"NY", location:"Queens County, New York City", prompt:"A low-income tenant faces eviction after reporting unsafe housing conditions. Research potentially relevant tenant defenses, retaliation precedent, local law, and pro bono representation.", context:"Identify facts needed to assess applicability. No hearing date or notice type has been provided.", pro_bono:true},
  employment: {state:"CA", location:"California", prompt:"An employee says their hours were reduced after reporting unpaid overtime. Find relevant retaliation precedent, federal and state law, and possible distinctions that could weaken the claim.", context:"The employer's size, employee classification, and dates still need to be confirmed.", pro_bono:false},
  counsel: {state:"", location:"U.S. federal court; district unspecified", prompt:"Research the standards for requesting appointment of pro bono counsel in a federal civil case brought by a person who cannot afford representation. Identify relevant precedent and facts a court would need.", context:"The underlying claim, district, and procedural stage have not yet been specified.", pro_bono:true}
};

function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function link(text, raw, cls="") {
  const url = safeUrl(raw);
  if (!url) return node("span", cls, text);
  const a = node("a", cls, text);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
let websiteAccessCode = "";
let serviceLocked = false;
let connectionPending = false;
let reconnectTimer = null;
const LOCAL_SERVICE = "http://localhost:8000";
function normalizeService(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Enter only the website origin, such as https://research.example.com.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Hosted research requires an HTTPS website address.");
  }
  return url.origin;
}
let apiBase;
try {
  apiBase = normalizeService(document.querySelector('meta[name="paralegal-api-base"]').content || (location.protocol === "file:" ? LOCAL_SERVICE : location.origin));
} catch { apiBase = LOCAL_SERVICE; }
function apiHeaders(extra={}) {
  return {...extra, "X-Research-Token":csrfToken, ...(websiteAccessCode ? {"Authorization":"Bearer " + websiteAccessCode} : {})};
}
async function apiFetch(path, options={}) {
  try {
    return await fetch(apiBase + path, {...options, signal:AbortSignal.timeout(30000)});
  } catch {
    throw new Error("The research service could not be reached. Check the website address or start Start Paralegal.cmd for local use.");
  }
}
function showConnection() {
  if (busy) return;
  $("service-url").value = apiBase;
  $("connection-error").hidden = true;
  $("connection-dialog").showModal();
}
async function readJson(response) {
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("This address serves the page but not its research service. Open Research connection to select your hosted workspace, or use Start Paralegal.cmd locally.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed. Please retry.");
  return data;
}
async function discoverLocal() {
  const response = await fetch(LOCAL_SERVICE + "/api/discover", {signal:AbortSignal.timeout(2500), cache:"no-store"});
  const data = await response.json();
  if (data.service !== "paralegal-research-v2") throw new Error("Service not ready.");
  location.replace(LOCAL_SERVICE + "/Paralegal.html");
}
async function configuration() {
  if (connectionPending || busy) return false;
  connectionPending = true;
  clearTimeout(reconnectTimer);
  $("refresh-config").disabled = true;
  $("service-button").textContent = "Connecting…";
  try {
    if (location.protocol === "file:") {
      if (apiBase !== LOCAL_SERVICE) {
        location.assign(apiBase + "/Paralegal.html");
        return true;
      }
      await discoverLocal();
      return true;
    }
    const data = await readJson(await apiFetch("/api/health", {cache:"no-store", headers:websiteAccessCode ? {"Authorization":"Bearer " + websiteAccessCode} : {}}));
    if (data.service !== "paralegal-research-v2") throw new Error("Restart the research server to load the updated website.");
    serviceLocked = data.locked;
    csrfToken = data.csrf_token;
    $("provider-list").replaceChildren();
    const selected = $("state").value;
    $("state").replaceChildren(new Option("Federal / state unspecified", ""));
    for (const [code, name] of Object.entries(data.states)) $("state").add(new Option(name, code));
    $("state").value = selected;
    if (serviceLocked) {
      $("provider-list").append(node("p", "muted", "Workspace access required"));
      $("service-button").textContent = "Unlock workspace";
      $("setup").hidden = false;
      $("setup").textContent = "This research workspace requires an access code. Select Unlock workspace to enter the code supplied by the site owner.";
      return false;
    }
    for (const provider of data.providers) {
      const row = node("div", "provider-item");
      row.append(node("span", "dot" + (provider.configured ? " ready" : "")), node("span", "", provider.name),
        node("small", "", provider.configured ? "Configured" : "Missing"));
      $("provider-list").append(row);
    }
    const missing = data.providers.filter(p => !p.configured);
    $("setup").hidden = !missing.length;
    $("setup").textContent = missing.length
      ? "Research service connected. The site owner still needs to configure: " + missing.map(p => p.variable).join(", ") + ". Available sources can be used once OpenAI is configured."
      : "";
    $("service-button").textContent = "Research service connected";
    return true;
  } catch (error) {
    csrfToken = "";
    serviceLocked = false;
    $("setup").hidden = false;
    $("setup").textContent = location.protocol === "file:"
      ? "To start local research, double-click Start Paralegal.cmd in this folder. This page will connect automatically once the service starts. To use a hosted workspace, select Connect research service."
      : error.message;
    $("provider-list").replaceChildren(node("p", "muted", "Research service offline"));
    $("service-button").textContent = "Connect research service";
    if (location.protocol === "file:") reconnectTimer = setTimeout(configuration, 4000);
    else if (["localhost", "127.0.0.1"].includes(location.hostname) && location.origin !== LOCAL_SERVICE) {
      try { await discoverLocal(); } catch { /* The connection panel remains available. */ }
    }
    return false;
  } finally {
    connectionPending = false;
    $("refresh-config").disabled = false;
  }
}
async function collectPacket(data) {
  const response = await apiFetch("/api/research", {
    method:"POST", headers:apiHeaders({"Content-Type":"application/json"}), body:JSON.stringify(data)
  });
  const started = await readJson(response);
  if (!started.job_id) throw new Error("The service returned an invalid research session.");
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const job = await readJson(await apiFetch("/api/research/" + encodeURIComponent(started.job_id),
      {cache:"no-store", headers:apiHeaders()}));
    if (job.status === "completed") return job.packet;
    if (job.status === "failed") throw new Error(job.error || "Research failed.");
  }
  throw new Error("Research is taking longer than expected. Wait before starting another request.");
}
$("service-button").addEventListener("click", showConnection);
$("close-connection").addEventListener("click", () => $("connection-dialog").close());
$("connection-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  $("connect-submit").disabled = true;
  $("connection-error").hidden = true;
  try {
    const nextService = normalizeService($("service-url").value.trim());
    if (nextService !== apiBase) {
      // Don't send a previously entered access code to a different workspace.
      websiteAccessCode = "";
      csrfToken = "";
    }
    apiBase = nextService;
    const enteredCode = $("access-code").value.trim();
    if (enteredCode.startsWith("sk-")) throw new Error("This field takes a website access code, not an OpenAI API key. Keep API keys on the server.");
    websiteAccessCode = enteredCode;
    const connected = await configuration();
    if (!connected) throw new Error(serviceLocked ? "The access code was not accepted. Check the code supplied by the site owner." : $("setup").textContent);
    $("access-code").value = "";
    $("connection-dialog").close();
  } catch (error) {
    $("connection-error").hidden = false;
    $("connection-error").textContent = error.message;
  } finally { $("connect-submit").disabled = false; }
});


function addCitations(parent, ids, sources) {
  for (const id of ids) {
    const src = sources.find(s => s.id === id);
    if (!src) continue;
    const cite = link("[" + id + "]", src.url, "cite");
    cite.title = src.title + " — open original source";
    parent.append(cite);
  }
}
function renderClaims(parent, claims, sources) {
  for (const claim of claims) {
    const p = node("p", "claim", claim.text + " ");
    addCitations(p, claim.source_ids, sources);
    parent.append(p);
  }
}
function addSection(parent, heading, content, cls="") {
  if (!content) return;
  parent.append(node("h4", "", heading), node("p", cls, content));
}
function markedText(text, annotations) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  const characters = Array.from(text);
  const sorted = [...annotations].sort((a,b) => a.start - b.start);
  for (const ann of sorted) {
    if (ann.start < cursor || ann.end > characters.length || ann.end <= ann.start) continue;
    fragment.append(document.createTextNode(characters.slice(cursor, ann.start).join("")));
    const mark = node("mark", "", characters.slice(ann.start, ann.end).join(""));
    mark.title = ann.note;
    fragment.append(mark);
    cursor = ann.end;
  }
  fragment.append(document.createTextNode(characters.slice(cursor).join("")));
  return fragment;
}
function sourceCard(src, analysis) {
  const card = node("article", "panel source-card");
  card.id = "source-" + src.id;
  card.dataset.kind = src.kind;
  const top = node("div", "source-top");
  top.append(node("span", "source-id", src.id), node("span", "kind-badge", kindNames[src.kind] || src.kind), node("span", "", src.provider));
  if (analysis) top.append(node("span", "relationship" + (analysis.relationship === "Adverse" ? " adverse" : ""), analysis.relationship));
  const title = node("h3");
  title.append(link(src.title + " ↗", src.url));
  card.append(top, title, node("div", "source-meta", [src.citation, src.court, src.date].filter(Boolean).join(" · ")));
  if (src.kind === "bill") card.append(node("p", "caution", "Legislative record • Latest action: " + (src.latest_action || "Not available") + ". Verify enactment and effective date before treating this as law."));
  if (analysis) {
    addSection(card, "Summary", analysis.summary);
    addSection(card, "Why it matters", analysis.relevance);
    addSection(card, "Jurisdiction & authority", analysis.jurisdiction_note);
    addSection(card, "Read with care", analysis.cautions, "caution");
  } else card.append(node("p", "muted", "Retrieved source. No individual AI analysis was returned for this document."));
  card.append(node("p", "coverage", "Evidence available: " + src.coverage));
  if (src.document_note) card.append(node("p", "coverage", src.document_note));
  for (const ann of analysis?.annotations || []) {
    const row = node("div", "annotation");
    const quoteSide = node("div");
    const quoteBlock = node("blockquote");
    quoteBlock.append(node("mark", "", ann.quote));
    quoteSide.append(node("span", "quote-label", "Exact retrieved passage"), quoteBlock);
    const noteSide = node("div", "note");
    noteSide.append(node("span", "quote-label", "AI annotation"), node("p", "", ann.note));
    row.append(quoteSide, noteSide);
    card.append(row);
  }
  if (src.text) {
    const details = node("details", "document-details");
    details.append(node("summary", "", src.provider === "OpenAI web search" ? "Read the AI research note" : "Read retrieved text with highlights"));
    const pre = node("div", "document-text");
    pre.append(markedText(src.text, analysis?.annotations || []));
    details.append(pre);
    card.append(details);
  }
  return card;
}
function listPanel(title, items) {
  const panel = node("section", "panel");
  panel.append(node("h3", "", title));
  const list = node("ul");
  for (const item of items) list.append(node("li", "", item));
  panel.append(list);
  return panel;
}
function renderWeb(parts) {
  $("web-notes").hidden = !parts.length;
  $("web-notes-body").replaceChildren();
  for (const part of parts) {
    const block = node("div", "web-part");
    const chars = Array.from(part.text);
    let cursor = 0;
    for (const ann of [...(part.annotations || [])].sort((a,b) => a.start_index - b.start_index)) {
      if (ann.type !== "url_citation" || !Number.isInteger(ann.start_index) || !Number.isInteger(ann.end_index) ||
          ann.start_index < cursor || ann.end_index > chars.length || ann.end_index <= ann.start_index) continue;
      block.append(document.createTextNode(chars.slice(cursor, ann.start_index).join("")));
      block.append(link("[" + (ann.title || "Source") + "]", ann.url));
      cursor = ann.end_index;
    }
    block.append(document.createTextNode(chars.slice(cursor).join("")));
    $("web-notes-body").append(block);
  }
}
function filterSources(filter) {
  currentFilter = filter;
  let count = 0;
  for (const card of $("source-cards").children) {
    card.hidden = filter !== "all" && card.dataset.kind !== filter;
    if (!card.hidden) count++;
  }
  $("source-count").textContent = count + " source" + (count === 1 ? "" : "s");
  for (const button of document.querySelectorAll(".filter")) {
    const active = button.dataset.filter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}
function renderPacket(packet) {
  $("empty").hidden = true;
  $("packet").hidden = false;
  $("packet-date").textContent = "Researched " + new Date(packet.generated_at).toLocaleString();
  $("packet-location").textContent = [packet.matter.state_name, packet.matter.location].filter(Boolean).join(" / ");
  $("provider-results").replaceChildren();
  for (const provider of packet.providers) {
    const badge = node("span", "provider-result" + (provider.state !== "ok" ? " problem" : ""), provider.name + ": " + provider.detail);
    $("provider-results").append(badge);
  }
  $("report-overview").replaceChildren();
  $("source-cards").replaceChildren();
  $("follow-up").replaceChildren();
  const report = packet.report;
  if (!report) {
    $("report-overview").append(node("h3", "", packet.sources.length ? "Sources retrieved; summary unavailable" : "No sources retrieved"), node("p", "", packet.synthesis_error || "No legal conclusions were generated. Check provider messages, broaden the question, or add a jurisdiction and try again."));
  } else {
    $("report-overview").append(node("h3", "", report.title));
    renderClaims($("report-overview"), report.summary, packet.sources);
    if (report.issues.length) {
      $("report-overview").append(node("h4", "", "Issues to examine"));
      renderClaims($("report-overview"), report.issues, packet.sources);
    }
    for (const [title, items] of [["Suggested next steps", report.next_steps], ["Facts still needed", report.missing_facts], ["Research limitations", report.limitations]]) {
      if (items.length) $("follow-up").append(listPanel(title, items));
    }
    $("follow-up").append(listPanel("Before relying on this packet", [packet.notice, "Exact-match highlights verify that words occur in retrieved text. They do not verify the AI interpretation or current legal status."]));
  }
  for (const src of packet.sources) {
    const analysis = report?.documents.find(d => d.source_id === src.id);
    $("source-cards").append(sourceCard(src, analysis));
  }
  filterSources("all");
  renderWeb(packet.web_research || []);
  $("download").disabled = false;
  $("print").disabled = false;
}

$("research-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  if (!csrfToken) {
    $("error").hidden = false;
    $("error").textContent = "Connect or unlock the research service using the button at the top of this page.";
    return;
  }
  busy = true;
  $("service-button").disabled = true;
  $("submit").disabled = true;
  $("submit").textContent = "Researching…";
  $("progress").hidden = false;
  $("empty").hidden = true;
  $("packet").hidden = true;
  $("error").hidden = true;
  $("download").disabled = true;
  $("print").disabled = true;
  $("results").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
  const started = Date.now();
  const ticker = setInterval(() => {
    $("progress-message").textContent = "Searching and analyzing evidence — " + Math.floor((Date.now() - started) / 1000) + " seconds elapsed. Source availability affects completion time.";
  }, 1000);
  try {
    const data = {
      prompt:$("prompt").value, state:$("state").value, location:$("location").value,
      context:$("context").value, pro_bono:$("pro-bono").checked
    };
    lastPacket = await collectPacket(data);
    renderPacket(lastPacket);
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent = error.message + (lastPacket ? " The packet below is from your previous successful request." : "");
    if (lastPacket) renderPacket(lastPacket);
    else $("empty").hidden = false;
  } finally {
    clearInterval(ticker);
    busy = false;
    $("service-button").disabled = false;
    $("progress").hidden = true;
    $("submit").disabled = false;
    $("submit").replaceChildren(document.createTextNode("Build research packet "), node("span", "", "↗"));
  }
});
document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => {
  const example = examples[button.dataset.example];
  for (const key of ["prompt","state","location","context"]) $(key).value = example[key];
  $("pro-bono").checked = example.pro_bono;
  $("prompt").focus();
}));
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => filterSources(button.dataset.filter)));
$("refresh-config").addEventListener("click", configuration);
$("download").addEventListener("click", () => {
  if (!lastPacket) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastPacket, null, 2)], {type:"application/json"}));
  const a = document.createElement("a");
  a.href = url;
  a.download = "paralegal-research-" + lastPacket.generated_at.slice(0,10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let printState = [];
window.addEventListener("beforeprint", () => {
  printState = [...document.querySelectorAll(".document-details")].map(el => [el, el.open]);
  for (const [el] of printState) el.open = true;
});
window.addEventListener("afterprint", () => {
  for (const [el, open] of printState) el.open = open;
  printState = [];
});
$("print").addEventListener("click", () => window.print());
configuration();
