const $ = s => document.querySelector(s);
const state = { session: null, grant: null, signals: null, plan: null, receipts: [] };
const NOTICE_VERSION = '2026-10-06.v1';

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.session) headers.authorization = `Bearer ${state.session}`;
  if (state.grant?.token) headers['x-browser-grant'] = state.grant.token;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function addReceipt(r) {
  if (!r) return;
  state.receipts.unshift(r);
  $('#receipts').innerHTML = state.receipts.slice(0, 8).map(x => `<div class="receipt"><time>${new Date(x.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><div><b>${x.event}</b><br><span>${x.origin || x.url || ''}</span></div></div>`).join('');
}

async function ensureSession() {
  if (state.session) return;
  const data = await api('/api/auth/session', { method: 'POST', body: '{}' });
  state.session = data.token;
  $('#identityCheck').textContent = '✓';
  addReceipt(data.receipt);
}

function selectedScopes() {
  return [...document.querySelectorAll('#notice input[type=checkbox]:checked')].map(x => x.value);
}

$('#grantBtn').addEventListener('click', async () => {
  await ensureSession();
  $('#notice').showModal();
});

$('#acceptGrant').addEventListener('click', async e => {
  e.preventDefault();
  try {
    await ensureSession();
    const targetUrl = $('#url').value.trim();
    const data = await api('/api/browser/grants', { method: 'POST', body: JSON.stringify({ targetUrl, scopes: selectedScopes(), accepted: true, noticeVersion: NOTICE_VERSION }) });
    state.grant = { token: data.token, ...data.grant };
    $('#grantCheck').textContent = '✓';
    $('#authState').textContent = 'granted';
    $('#authState').classList.remove('muted');
    addReceipt(data.receipt);
    $('#notice').close();
  } catch (err) { alert(err.message); }
});

$('#startBtn').addEventListener('click', async () => {
  const button = $('#startBtn');
  try {
    button.disabled = true; button.textContent = 'Inspecting…';
    await ensureSession();
    if (!state.grant || !state.grant.scopes.includes('scrape:public') || state.grant.origin !== new URL($('#url').value).origin) {
      $('#notice input[value="scrape:public"]').checked = true;
      $('#notice').showModal();
      throw new Error('Grant public scrape access for this site, then inspect again.');
    }
    const scrape = await api('/api/scrape', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim() }) });
    state.signals = scrape.signals; addReceipt(scrape.receipt);
    $('#browserAddress').textContent = new URL(state.signals.url).hostname;
    const analyzed = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ signals: state.signals }) });
    state.plan = analyzed.plan;
    $('#analysisState').textContent = 'ready'; $('#analysisState').classList.remove('muted');
    $('#resultEmpty').classList.add('hidden'); $('#result').classList.remove('hidden');
    $('#result').innerHTML = `<h3>${escapeHtml(state.plan.summary)}</h3><p>${escapeHtml(state.plan.direction)}</p><ul>${state.plan.recommendations.map(r => `<li><b>${escapeHtml(r.area)}</b> · ${escapeHtml(r.change)}</li>`).join('')}</ul>`;
    $('#exportBtn').disabled = false;
  } catch (err) {
    if (!/Grant public scrape access/.test(err.message)) alert(err.message);
  } finally { button.disabled = false; button.textContent = 'Inspect site'; }
});

$('#exportBtn').addEventListener('click', () => {
  if (!state.plan) return;
  const bundle = { version: 1, generatedAt: new Date().toISOString(), source: state.signals, makeover: state.plan, authority: { origin: state.grant?.origin, scopes: state.grant?.scopes, grantExpiresAt: state.grant?.expiresAt }, note: 'This file is an export proposal. It does not publish changes.' };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'makeover.json'; a.click(); URL.revokeObjectURL(a.href);
});

function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

api('/api/browser/opera/status').then(s => { $('#operaStatus').textContent = s.configured ? 'Opera runtime adapter configured' : 'Opera adapter ready · live attach is separate'; }).catch(() => { $('#operaStatus').textContent = 'Opera adapter status unavailable'; });
ensureSession().catch(()=>{});
