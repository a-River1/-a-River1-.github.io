'use strict';
const $ = (selector) => document.querySelector(selector);
const form = $('#intake-form');
const field = (name) => form.elements.namedItem(name);
const fields = ['legal_area', 'question', 'facts', 'desired_outcome', 'procedural_status', 'additional_context'];
const groups = ['timeline', 'deadlines', 'documents'];
let database, packets = new Map(), active, accessToken = '', connectedOrigin = '', saveTimer;
const polling = new Set();
let storageAvailable = false;

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}
function message(text) { $('#packet-status').textContent = text; }
function storageError() {
  storageAvailable = false;
  $('#storage-status').textContent = 'Local saving is unavailable or full. Changes remain in this tab only. Export your packet before closing.';
}
function openStorage() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('paralegal-workspace-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('packets', { keyPath: 'id' });
    req.onsuccess = () => {
      database = req.result;
      database.onversionchange = () => { database.close(); storageError(); };
      resolve();
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked'));
  });
}
function storage(action, data) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('packets', action === 'getAll' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('packets');
    const req = data === undefined ? store[action]() : store[action](data);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
async function persist(packet) {
  packets.set(packet.id, packet);
  renderHistory();
  if (!storageAvailable) return false;
  try {
    await storage('put', structuredClone(packet));
    $('#storage-status').textContent = 'Saved in this browser. ' + new Date().toLocaleTimeString();
    return true;
  } catch { storageError(); return false; }
}
function readIntake() {
  const intake = Object.fromEntries(fields.map(name => [name, field(name).value.trim()]));
  intake.jurisdiction = { country: 'US', ...Object.fromEntries(['state', 'city', 'county', 'court'].map(name => [name, field(name).value.trim()])) };
  intake.parties = field('parties').value.split('\n').map(s => s.trim()).filter(Boolean);
  intake.pro_bono = field('pro_bono').checked;
  for (const group of groups) {
    intake[group] = [...$(`#${group}`).children].map(row => Object.fromEntries(
      [...row.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value.trim()])
    ));
  }
  return intake;
}
function addRow(group, data = {}) {
  const container = $(`#${group}`);
  const max = { timeline: 30, deadlines: 20, documents: 5 }[group];
  if (container.children.length >= max) { message(`Maximum ${max} entries in ${group}.`); return; }
  const row = element('fieldset', undefined, container);
  element('legend', group === 'documents' ? 'Document' : 'Event', row);
  const keys = group === 'documents' ? ['title', 'text'] : ['date', 'description'];
  for (const key of keys) {
    const label = element('label', key === 'date' ? 'Date (or “unknown”)' : key[0].toUpperCase() + key.slice(1), row);
    const input = element(key === 'text' || key === 'description' ? 'textarea' : 'input', undefined, label);
    input.dataset.key = key;
    input.maxLength = { title: 200, text: 24000, date: 80, description: 2000 }[key];
    input.required = key !== 'date';
    input.value = data[key] || '';
  }
  const remove = element('button', 'Remove entry', row);
  remove.type = 'button';
  remove.onclick = () => { row.remove(); saveCurrent(); };
}
async function saveCurrent() {
  clearTimeout(saveTimer);
  if (!active) return;
  active.intake = readIntake();
  active.title = field('title').value.trim() || active.intake.question.slice(0, 80) || 'Untitled packet';
  active.updated = new Date().toISOString();
  await persist(active);
}
function freshPacket() {
  return { id: crypto.randomUUID(), title: 'Untitled packet', status: 'draft', updated: new Date().toISOString(), intake: { jurisdiction: {} } };
}
function selectPacket(packet) {
  active = packet;
  form.reset();
  field('title').value = packet.title === 'Untitled packet' ? '' : packet.title;
  const intake = packet.intake;
  for (const name of fields) field(name).value = intake[name] || '';
  for (const name of ['state', 'city', 'county', 'court']) field(name).value = intake.jurisdiction?.[name] || '';
  field('parties').value = (intake.parties || []).join('\n');
  field('pro_bono').checked = Boolean(intake.pro_bono);
  for (const group of groups) {
    $(`#${group}`).replaceChildren();
    for (const row of intake[group] || []) addRow(group, row);
  }
  renderResults(); renderHistory();
  message(packet.error || (packet.status === 'running' ? 'Research is pending. Connect to the same backend to check progress.' : `Packet: ${packet.status}.`));
}
function renderHistory() {
  const list = $('#history'); list.replaceChildren();
  const sorted = [...packets.values()].sort((a, b) => b.updated.localeCompare(a.updated));
  if (!sorted.length) element('li', 'No saved packets yet.', list);
  for (const packet of sorted) {
    const li = element('li', undefined, list);
    const open = element('button', `${packet.title} — ${packet.status}`, li);
    if (active?.id === packet.id) open.setAttribute('aria-current', 'true');
    open.onclick = async () => { await saveCurrent(); selectPacket(packet); if (accessToken && packet.status === 'running') poll(packet); };
    element('small', new Date(packet.updated).toLocaleString() + ' ', li);
    const remove = element('button', 'Delete', li);
    remove.onclick = async () => {
      if (!confirm(`Delete “${packet.title}” from this browser? A running server job will not be cancelled.`)) return;
      clearTimeout(saveTimer);
      if (storageAvailable) {
        try { await storage('delete', packet.id); } catch { storageError(); message('Deletion could not be confirmed.'); return; }
      }
      packets.delete(packet.id);
      if (active?.id === packet.id) selectPacket(freshPacket());
      renderHistory();
    };
  }
}
function listSection(parent, title, values) {
  if (!values?.length) return;
  element('h3', title, parent);
  const ul = element('ul', undefined, parent);
  values.forEach(value => element('li', value, ul));
}
function safeLink(parent, url, title) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return;
    const link = element('a', title, parent);
    link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  } catch { /* Metadata without a URL is still displayed as text. */ }
}
function renderResults() {
  const parent = $('#results'); parent.replaceChildren();
  $('#resume').hidden = active?.status !== 'running';
  const result = active?.result;
  if (!result) { element('p', 'No research results saved for this packet yet.', parent); return; }
  if (result.partial) element('p', 'Partial results: some sources or the summary were unavailable.', parent);
  if (active.submittedIntake) {
    const details = element('details', undefined, parent);
    element('summary', 'Original submitted intake for these results', details);
    element('pre', JSON.stringify(active.submittedIntake, null, 2), details);
  }
  listSection(parent, 'Research notes', result.warnings);
  listSection(parent, 'Issues identified', result.plan?.issues);
  listSection(parent, 'Missing information', [...new Set([...(result.plan?.missing_information || []), ...(result.report?.missing_information || [])])]);
  element('h3', 'Findings', parent);
  if (!result.report) element('p', 'No summary was produced. Available sources are listed below.', parent);
  for (const finding of result.report?.findings || []) {
    const article = element('article', undefined, parent);
    element('p', `${finding.relationship}: ${finding.statement}`, article);
    for (const id of finding.source_ids) {
      const link = element('a', id + ' ', article); link.href = '#source-' + encodeURIComponent(id);
    }
  }
  element('h3', 'Documents and annotations', parent);
  if (!result.sources?.length) element('p', 'No sources retrieved.', parent);
  for (const source of result.sources || []) {
    const article = element('article', undefined, parent);
    article.id = 'source-' + source.id;
    element('h4', `${source.id}: ${source.title}`, article);
    element('p', `${source.provider} · ${source.coverage}${source.truncated ? ' · text truncated' : ''}`, article);
    safeLink(article, source.url, 'Open original document');
    const annotations = (result.report?.annotations || []).filter(a => a.source_id === source.id);
    for (const annotation of annotations) {
      element('blockquote', annotation.quote, article);
      element('p', annotation.explanation, article);
      element('small', 'Original passage; AI interpretation requires verification.', article);
    }
    if (!annotations.length) element('p', 'No verified annotations for this source.', article);
    const text = element('details', undefined, article);
    element('summary', 'Retrieved text and metadata', text);
    element('pre', source.text || 'Document text was not available.', text);
    element('pre', JSON.stringify(source.metadata || {}, null, 2), text);
  }
  listSection(parent, 'Next research steps', result.report?.next_steps);
  listSection(parent, 'Limitations', result.report?.limitations);
  listSection(parent, 'Provider status', Object.entries(result.providers || {}).map(([name, status]) => `${name}: ${status.status}${status.message ? ' — ' + status.message : ''}`));
}
function backendOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter an HTTPS backend origin, or http://127.0.0.1:5000 locally, without a path.');
  }
  return url.origin;
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(connectedOrigin + path, { ...options, headers: { 'Authorization': 'Bearer ' + accessToken, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('Cannot reach the backend. Check that Python is running and this frontend origin is allowed.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.fields?.map(f => `${f.field}: ${f.message}`).join('; ') || data.message || data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
async function poll(packet) {
  if (polling.has(packet.id) || !accessToken || packet.backend !== connectedOrigin || packet.status !== 'running') return;
  polling.add(packet.id);
  const expectedOrigin = connectedOrigin;
  try {
    while (packets.has(packet.id) && accessToken && connectedOrigin === expectedOrigin) {
      const data = await api('/api/research/' + encodeURIComponent(packet.jobId));
      if (!packets.has(packet.id)) break;
      if (data.status !== 'running') {
        packet.status = data.status;
        packet.result = data.result || null;
        packet.error = data.error || '';
        packet.updated = new Date().toISOString();
        await persist(packet);
        if (active?.id === packet.id) { renderResults(); message(packet.error || 'Research completed.'); }
        break;
      }
      if (active?.id === packet.id) message('Research is running. You can work on another packet; progress is checked automatically.');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (error) {
    if (!packets.has(packet.id)) return;
    if (error.status === 404) {
      packet.status = 'expired';
      packet.error = 'The server no longer has this job. Your intake is saved; submit it again to create new research.';
      await persist(packet);
    }
    if (active?.id === packet.id) { message(packet.error || error.message + ' Reconnect or use “Check pending research”.'); renderResults(); }
  } finally { polling.delete(packet.id); }
}

$('#connection-form').onsubmit = async event => {
  event.preventDefault();
  accessToken = ''; connectedOrigin = '';
  try {
    const token = $('#token').value.trim();
    if (token.startsWith('sk-')) throw new Error('That looks like a provider API key. Use the workspace access token from the Python terminal.');
    connectedOrigin = backendOrigin($('#backend-url').value.trim());
    accessToken = token;
    const config = await api('/api/config');
    if (!config.providers || !config.states) throw new Error('This address is not the expected research backend.');
    $('#token').value = '';
    $('#connection-status').textContent = 'Connected. ' + Object.entries(config.providers).map(([p, ready]) => `${p}: ${ready ? 'configured' : 'missing key'}`).join('; ');
    for (const packet of packets.values()) if (packet.status === 'running') poll(packet);
  } catch (error) { accessToken = ''; $('#connection-status').textContent = error.message; }
};
$('#disconnect').onclick = () => { accessToken = ''; $('#token').value = ''; $('#connection-status').textContent = 'Disconnected. Saved packets remain available.'; };
form.oninput = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrent, 350); };
form.onchange = saveCurrent;
document.querySelectorAll('[data-add]').forEach(button => { button.onclick = () => { addRow(button.dataset.add); saveCurrent(); }; });
$('#save-draft').onclick = async () => { await saveCurrent(); message(storageAvailable ? 'Draft saved.' : 'Draft kept in this tab. Export it before closing.'); };
$('#new-packet').onclick = async () => { await saveCurrent(); selectPacket(freshPacket()); await saveCurrent(); };
$('#resume').onclick = () => {
  if (!accessToken || active.backend !== connectedOrigin) { message('Connect to the backend used for this packet: ' + active.backend); return; }
  poll(active);
};
$('#clear-history').onclick = async () => {
  if (!confirm('Delete all local packets and drafts? Export anything you want to keep first. Server jobs are not cancelled.')) return;
  clearTimeout(saveTimer);
  if (storageAvailable) {
    try { await storage('clear'); } catch { storageError(); message('Deletion could not be confirmed.'); return; }
  }
  packets.clear(); selectPacket(freshPacket()); renderHistory(); message('Local history deleted.');
};
$('#export-packet').onclick = async () => {
  await saveCurrent();
  const url = URL.createObjectURL(new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = 'research-packet-' + active.id + '.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
form.onsubmit = async event => {
  event.preventDefault();
  if (!accessToken) { message('Connect to the research service first. You can save a draft without connecting.'); return; }
  if (['running', 'submitting'].includes(active.status)) { message('This packet already has a running job. Create a new packet for another question.'); return; }
  $('#research').disabled = true;
  try {
    await saveCurrent();
    const intake = readIntake();
    if (intake.parties.length > 20 || intake.parties.some(p => p.length > 300)) throw new Error('Use at most 20 party descriptions, each under 300 characters.');
    if (active.jobId || active.result) {
      const copy = { ...freshPacket(), title: active.title, intake: structuredClone(intake) };
      selectPacket(copy); await persist(copy);
    }
    const packet = active;
    packet.submittedIntake = structuredClone(intake);
    packet.backend = connectedOrigin;
    packet.status = 'submitting';
    await persist(packet);
    message('Submitting research…');
    let data;
    try { data = await api('/api/research', { method: 'POST', body: JSON.stringify(intake) }); }
    catch (error) {
      packet.status = error.status ? 'failed' : 'submission_unknown';
      packet.error = error.message + (error.status ? '' : ' Submission may have reached the server; retrying could start another paid job.');
      await persist(packet); throw error;
    }
    packet.jobId = data.job_id; packet.status = 'running'; packet.error = '';
    if (!packets.has(packet.id)) return;
    await persist(packet);
    if (active.id === packet.id) renderResults();
    poll(packet);
  } catch (error) { message(error.message); }
  finally { $('#research').disabled = false; }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCurrent(); });

async function init() {
  // Static options work before authentication or when the backend is offline.
  const names = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Puerto Rico|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming'.split('|');
  for (const name of names) { const option = element('option', name, field('state')); option.value = name; }
  $('#backend-url').value = location.protocol === 'file:' ? 'http://127.0.0.1:5000' : location.origin;
  try {
    await openStorage(); storageAvailable = true;
    for (const packet of await storage('getAll')) {
      if (!packet.id || !packet.intake) continue;
      if (packet.status === 'submitting') { packet.status = 'submission_unknown'; packet.error = 'The page closed during submission. Check before retrying to avoid a duplicate paid job.'; }
      packets.set(packet.id, packet);
    }
    $('#storage-status').textContent = 'Local packet storage is ready.';
  } catch { storageError(); }
  selectPacket([...packets.values()].sort((a, b) => b.updated.localeCompare(a.updated))[0] || freshPacket());
  if (location.protocol === 'file:') $('#connection-status').textContent = 'Start the Flask backend and open http://127.0.0.1:5000 to use this app. Opening the HTML as a file is not supported for API requests.';
}
init();
