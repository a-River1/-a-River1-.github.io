'use strict';
(() => {
  const panel = document.getElementById('chat-panel');
  const toggle = document.getElementById('chat-toggle');
  const question = document.getElementById('chat-question');
  const log = document.getElementById('chat-messages');
  const status = document.getElementById('chat-status');
  const send = document.getElementById('chat-send');
  const clear = document.getElementById('chat-clear');
  let history = [], busy = false;
  function show(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('chat-open', open);
    if (open) question.focus(); else toggle.focus();
  }
  toggle.onclick = () => show(panel.hidden);
  document.getElementById('chat-close').onclick = () => show(false);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); show(false); } });
  function bubble(role, text) {
    const container = document.createElement('div'); container.className = 'chat-message ' + role;
    const heading = document.createElement('strong'); heading.textContent = role === 'user' ? 'You' : 'Assistant';
    const body = document.createElement('p'); body.textContent = text;
    container.append(heading, body); log.append(container); log.scrollTop = log.scrollHeight;
  }
  clear.onclick = () => {
    if (busy) return;
    history = []; log.replaceChildren(); status.textContent = ''; question.value = ''; question.focus();
  };
  document.getElementById('chat-form').onsubmit = async event => {
    event.preventDefault();
    const text = question.value.trim();
    if (busy || !text) return;
    busy = true; send.disabled = clear.disabled = true; question.readOnly = true;
    status.textContent = 'Thinking…'; panel.setAttribute('aria-busy', 'true');
    // Only successful turns enter context. A failed request leaves the draft for retry.
    try {
      if (location.protocol === 'file:') throw new Error('Open the hosted website to use the assistant.');
      const base = backendOrigin(document.getElementById('backend-url').value.trim());
      const response = await fetch(base + '/api/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:text, history:history.slice(-10), location:document.getElementById('chat-location').value.trim()}),
        signal:AbortSignal.timeout(130000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'The assistant is unavailable. Please try again shortly.');
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('No answer was returned. Please try again.');
      bubble('user', text); bubble('assistant', data.answer);
      history.push({role:'user',content:text}, {role:'assistant',content:data.answer});
      history = history.slice(-10);
      question.value = ''; status.textContent = 'Answer ready. You can ask a follow-up.';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'The answer took too long. Your question is still here; you can retry.' : error.name === 'TypeError' ? 'Cannot reach the assistant. Check your connection and try again.' : error.message;
    } finally {
      busy = false; send.disabled = clear.disabled = false; question.readOnly = false; panel.removeAttribute('aria-busy');
      if (!panel.hidden) question.focus();
    }
  };
})();
