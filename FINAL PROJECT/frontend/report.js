'use strict';
// Self-contained, offline-readable report; source text is escaped before markup.
window.buildResearchReport = function buildResearchReport(packet) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const p = value => `<p>${esc(value)}</p>`;
  const list = values => values?.length ? `<ul>${values.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : '';
  const result = packet.result || {};
  const report = result.report || {};
  const intake = packet.submittedIntake || packet.intake || {};
  const sources = result.sources || [];
  const citation = source => {
    const m = source.metadata || {};
    const cites = Array.isArray(m.citations) ? m.citations.join('; ') : m.citations;
    return [source.title, cites, m.court, m.date, m.identifier, m.session, m.package_id].filter(Boolean).join(' — ');
  };
  const original = source => {
    try {
      const u = new URL(source.url);
      if (u.protocol !== 'https:' || u.username || u.password) return '';
      return `<p class="original"><a href="${esc(u.href)}" rel="noopener noreferrer">Original source</a><br>${esc(u.href)}</p>`;
    } catch { return p('No original-source URL was provided.'); }
  };
  const refs = ids => (ids || []).filter(id => sources.some(s => s.id === id)).map(id => `<a href="#${esc(id)}">[${esc(id)}]</a>`).join(' ');
  const findings = (report.findings || []).map(f => `<li><strong>${esc(f.relationship)}.</strong> ${esc(f.statement)} ${refs(f.source_ids)}</li>`).join('');
  const documents = sources.map(source => {
    const analysis = (report.source_analyses || []).find(a => a.source_id === source.id);
    const relevant = (report.findings || []).filter(f => f.source_ids?.includes(source.id));
    const text = String(source.text || '');
    const points = Array.from(text); // Backend positions are Unicode code points.
    const notes = [];
    for (const a of report.annotations || []) {
      if (a.source_id !== source.id || !a.quote) continue;
      let start = a.start, end = a.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || points.slice(start, end).join('') !== a.quote) {
        const offset = text.indexOf(a.quote);
        if (offset < 0) continue;
        start = Array.from(text.slice(0, offset)).length;
        end = start + Array.from(a.quote).length;
      }
      notes.push({start, end, quote:a.quote, explanation:a.explanation, number:notes.length+1});
    }
    // Boundary segmentation supports overlapping annotations without duplicating text.
    const boundaries = [...new Set([0, points.length, ...notes.flatMap(n => [n.start, n.end])])].sort((a,b) => a-b);
    let highlighted = '';
    for (let i=0; i<boundaries.length-1; i++) {
      const start=boundaries[i], end=boundaries[i+1];
      const matching=notes.filter(n => n.start <= start && n.end >= end);
      const chunk=esc(points.slice(start,end).join(''));
      highlighted += matching.length ? `<mark title="Notes ${matching.map(n=>n.number).join(', ')}">${chunk}</mark>` : chunk;
      const ending=notes.filter(n=>n.end===end);
      highlighted += ending.map(n=>`<sup><a href="#${esc(source.id)}-note-${n.number}">[${n.number}]</a></sup>`).join('');
    }
    const coverage = ({opinion_text:'Retrieved opinion text',document_text:'Retrieved document text',search_excerpt:'Search excerpt only',metadata:'Metadata only',bill_abstract:'Bill abstract only',user_supplied:'User-supplied text; not verified authority'})[source.coverage] || source.coverage || 'Retrieval coverage not specified';
    return `<section class="document" id="${esc(source.id)}">
      <p class="eyebrow">SOURCE ${esc(source.id)} · ${esc(source.provider)}</p>
      <h2>${esc(source.title)}</h2><p class="citation">${esc(citation(source))}</p>${original(source)}
      <p class="notice">${esc(coverage)}${source.truncated ? ' — truncated to the retrieval limit' : ''}. This is a retrieved-text reproduction, not a certified copy of the original document.</p>
      <h3>Summary</h3>${analysis ? p(analysis.summary) : relevant.length ? list(relevant.map(f=>f.statement)) : p('No source-specific summary was generated for this packet.')}
      <h3>Potential use in this matter</h3>${analysis ? p(analysis.potential_use) : p('No separate application analysis was generated. Review the cited findings and annotation notes below; regenerate this research to request an attorney-focused source analysis.')}
      <h3>Distinctions and verification</h3>${p(analysis?.limitations || source.metadata?.authority_status || 'Confirm current validity, jurisdiction, procedural posture, and factual fit before relying on this source.')}
      <h3>Annotation notes</h3>${notes.length ? notes.map(n=>`<aside id="${esc(source.id)}-note-${n.number}"><strong>Note ${n.number}</strong><blockquote>${esc(n.quote)}</blockquote>${p(n.explanation)}</aside>`).join('') : p('No source-matched annotations were available. No highlights have been invented.')}
      <h3>Retrieved text with highlights</h3><div class="source-text">${highlighted || 'Full text was not available. Follow the original-source link.'}</div>
    </section>`;
  }).join('');
  const date = result.created_at ? new Date(result.created_at) : null;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(packet.title || 'Legal research memorandum')}</title>
  <style>
    *{box-sizing:border-box}body{max-width:900px;margin:40px auto;padding:0 28px;color:#202923;font:16px/1.65 Georgia,serif}h1{font-size:34px;line-height:1.2}h2{font-size:24px;line-height:1.3}h3{font-size:18px;margin-top:26px}a{color:#23583c;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}.eyebrow,.notice,.instruction{font:13px/1.6 system-ui,sans-serif}.eyebrow{letter-spacing:.1em}.notice{background:#f1f3ed;padding:14px;border-left:3px solid #748773}.citation{font-weight:bold}.document{border-top:2px solid #405547;margin-top:50px;padding-top:24px}.source-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.8}mark{background:#fff0a5;color:#111;print-color-adjust:exact;-webkit-print-color-adjust:exact}sup{font:10px system-ui}aside{border-left:3px solid #819987;padding:8px 20px;margin:18px 0}blockquote{margin:8px 0;white-space:pre-wrap;font-size:14px}h2,h3{break-after:avoid}.original{font-size:13px}@page{size:auto;margin:20mm}@media print{body{margin:0;padding:0;max-width:none;font-size:11pt}.instruction{display:none}.document{break-before:page}.source-text{font-size:10pt}a{color:inherit;text-decoration:underline}}
  </style></head><body>
    <p class="instruction">Standalone annotated report. To create a PDF, choose Print in your browser, then Save as PDF.</p>
    <p class="eyebrow">PARALEGAL · RESEARCH MEMORANDUM</p><h1>${esc(packet.title || 'Legal research memorandum')}</h1>
    ${p(date && !Number.isNaN(date.valueOf()) ? 'Research generated: '+date.toLocaleString() : 'Research date not recorded')}
    ${p('Jurisdiction: '+Object.values(intake.jurisdiction || {}).filter(Boolean).join(', '))}
    <p class="notice">AI-assisted research prepared for attorney review. Quoted text is reproduced from retrieved sources; summaries and application notes are AI analysis. Citations, precedential weight and current legal status require independent verification. This report does not replace review of the original authorities.${result.partial ? ' Retrieval or synthesis was incomplete; see limitations below.' : ''}</p>
    <h2>Question presented</h2>${p(intake.question)}<h2>Facts supplied</h2>${p(intake.facts)}${intake.desired_outcome ? '<h3>Requested outcome</h3>'+p(intake.desired_outcome) : ''}
    <h2>Research findings</h2>${findings ? '<ol>'+findings+'</ol>' : p('No cited findings were generated. Available documents follow.')}
    <h2>Index of sources</h2><ol>${sources.map(s=>`<li><a href="#${esc(s.id)}">[${esc(s.id)}] ${esc(citation(s))}</a></li>`).join('')}</ol>
    <h2>Outstanding facts and research</h2>${list([...new Set([...(result.plan?.missing_information || []), ...(report.missing_information || [])])])}${list(report.next_steps)}
    <h2>Scope and limitations</h2>${list(result.warnings)}${list(report.limitations)}
    ${list(Object.entries(result.providers || {}).filter(([,v])=>v.status!=='ok').map(([name,v])=>`${name}: ${v.status}${v.message ? ' — '+v.message : ''}`))}
    ${documents}
  </body></html>`;
};
