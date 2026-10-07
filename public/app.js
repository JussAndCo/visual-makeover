const $ = s => document.querySelector(s);
const RECOVERY_BOOLEAN_KEYS = [
  'directCapabilitySufficient',
  'browserOnlyInteractionRequired',
  'operaConnectorAvailable',
  'operaLiveSessionExposed',
  'alternateAuthenticatedBridgeAvailable',
  'alternateAuthenticatedBridgeLive',
  'genericBrowserAvailable',
  'genericBrowserSufficient'
];
const state = {
  session: null,
  grant: null,
  signals: null,
  plan: null,
  receipts: [],
  runtimeEvidence: null,
  browserRoute: null,
  captureIds: [],
  analysisEvidence: [],
  promptOsHandoff: null
};
const NOTICE_VERSION = '2026-10-07.v2';

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.session) headers.authorization = `Bearer ${state.session}`;
  if (state.grant?.token) headers['x-browser-grant'] = state.grant.token;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || `Request failed: ${res.status}`);
    error.data = data;
    error.status = res.status;
    throw error;
  }
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

function selectedProviders() {
  const scopes = selectedScopes();
  return scopes.includes('browser:read') || scopes.includes('browser:navigate') ? ['opera'] : [];
}

function taskRecoveryEvidence() {
  const scopes = state.grant?.scopes ?? selectedScopes();
  const browserOnlyInteractionRequired = scopes.includes('browser:read') || scopes.includes('browser:navigate');
  const directCapabilitySufficient = !browserOnlyInteractionRequired && scopes.includes('scrape:public');
  return {
    values: { directCapabilitySufficient, browserOnlyInteractionRequired },
    known: { directCapabilitySufficient: true, browserOnlyInteractionRequired: true },
    sources: {
      directCapabilitySufficient: 'ui:granted-task-scope',
      browserOnlyInteractionRequired: 'ui:granted-task-scope'
    }
  };
}

function rememberCapture(capture) {
  if (!capture?.id) return;
  if (!state.captureIds.includes(capture.id)) state.captureIds.push(capture.id);
}

function browserInspectBody(tool) {
  return {
    tool,
    targetUrl: $('#url').value.trim(),
    args: {},
    recoveryEvidence: taskRecoveryEvidence(),
    providerPageEvidence: 'unknown'
  };
}

function renderEvidence(evidence = state.runtimeEvidence) {
  if (!evidence) return;
  const known = RECOVERY_BOOLEAN_KEYS.filter(key => evidence.known?.[key]).length;
  $('#evidenceState').textContent = `${known}/8 recovery booleans known`;
  $('#routeState').textContent = state.browserRoute ?? (evidence.complete ? 'route evidence complete' : 'route evidence pending');
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
    const data = await api('/api/browser/grants', { method: 'POST', body: JSON.stringify({ targetUrl, scopes: selectedScopes(), providers: selectedProviders(), accepted: true, noticeVersion: NOTICE_VERSION }) });
    state.grant = { token: data.token, ...data.grant };
    renderEvidence(state.runtimeEvidence);
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
    state.captureIds = [];
    if (state.grant.scopes.includes('browser:read')) {
      try {
        const captured = await api('/api/browser/inspect', {
          method: 'POST',
          body: JSON.stringify(browserInspectBody('tab_content'))
        });
        state.browserRoute = captured.decision.route;
        rememberCapture(captured.capture);
        captured.receipts?.forEach(addReceipt);
        renderEvidence(captured.evidence);

        try {
          const screenshot = await api('/api/browser/inspect', {
            method: 'POST',
            body: JSON.stringify(browserInspectBody('screenshot'))
          });
          rememberCapture(screenshot.capture);
          screenshot.receipts?.forEach(addReceipt);
        } catch (screenshotError) {
          if (Array.isArray(screenshotError.data?.receipts)) screenshotError.data.receipts.forEach(addReceipt);
          else addReceipt(screenshotError.data?.receipt);
        }
      } catch (browserError) {
        state.browserRoute = browserError.data?.decision?.route
          ?? (browserError.data?.evidence?.complete ? 'blocked' : 'evidence pending');
        if (Array.isArray(browserError.data?.receipts)) browserError.data.receipts.forEach(addReceipt);
        else addReceipt(browserError.data?.receipt);
        renderEvidence(browserError.data?.evidence ?? state.runtimeEvidence);
      }
    }
    const analyzed = await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ signals: state.signals, captureIds: state.captureIds })
    });
    state.plan = analyzed.plan;
    state.analysisEvidence = analyzed.evidence ?? [];
    addReceipt(analyzed.receipt);

    const handoff = await api('/api/handoff/promptos', {
      method: 'POST',
      body: JSON.stringify({ signals: state.signals, captureIds: state.captureIds })
    });
    state.promptOsHandoff = handoff.artifact;
    addReceipt(handoff.receipt);

    $('#analysisState').textContent = state.captureIds.length ? `ready · ${state.captureIds.length} browser proof` : 'ready · scrape evidence';
    $('#analysisState').classList.remove('muted');
    $('#resultEmpty').classList.add('hidden'); $('#result').classList.remove('hidden');
    $('#result').innerHTML = `<h3>${escapeHtml(state.plan.summary)}</h3><p>${escapeHtml(state.plan.direction)}</p><ul>${state.plan.recommendations.map(r => `<li><b>${escapeHtml(r.area)}</b> · ${escapeHtml(r.change)}</li>`).join('')}</ul>`;
    $('#exportBtn').disabled = false;
  } catch (err) {
    if (!/Grant public scrape access/.test(err.message)) alert(err.message);
  } finally { button.disabled = false; button.textContent = 'Inspect site'; }
});

$('#exportBtn').addEventListener('click', () => {
  if (!state.plan) return;
  const bundle = { version: 2, generatedAt: new Date().toISOString(), source: state.signals, browserEvidence: state.analysisEvidence, makeover: state.plan, promptOsHandoff: state.promptOsHandoff, authority: { origin: state.grant?.origin, scopes: state.grant?.scopes, providers: state.grant?.providers, grantExpiresAt: state.grant?.expiresAt }, note: 'This file is an evidence-bound proposal. It does not publish changes or transfer browser authority.' };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'makeover.json'; a.click(); URL.revokeObjectURL(a.href);
});

function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

api('/api/browser/opera/status').then(s => {
  state.runtimeEvidence = s.runtimeEvidence;
  $('#operaStatus').textContent = s.configured ? 'Opera runtime adapter configured' : 'Opera adapter ready · live attach is separate';
  renderEvidence(s.runtimeEvidence);
}).catch(() => {
  $('#operaStatus').textContent = 'Opera adapter status unavailable';
});
ensureSession().catch(()=>{});
