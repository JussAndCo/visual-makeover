import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const PORT = 4203;
const base = `http://127.0.0.1:${PORT}`;
let child;

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

test('browser recovery preserves provider-ready evidence and never self-authorizes execution', async t => {
  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), OPERA_CONNECTOR_AVAILABLE: 'true', OPERA_LIVE_SESSION_EXPOSED: 'false' },
    stdio: 'ignore'
  });
  t.after(() => child?.kill());
  await waitForServer();

  const signed = await fetch(`${base}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  }).then(r => r.json());

  const response = await fetch(`${base}/api/browser/recovery`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signed.token}`
    },
    body: JSON.stringify({
      recoveryEvidence: {
        values: {
          directCapabilitySufficient: false,
          browserOnlyInteractionRequired: true
        },
        known: {
          directCapabilitySufficient: true,
          browserOnlyInteractionRequired: true
        },
        sources: {
          directCapabilitySufficient: 'test-task',
          browserOnlyInteractionRequired: 'test-task'
        }
      },
      operaConnectorError: 'Browser not connected',
      providerPageEvidence: 'observed_ready',
      targetUrl: 'https://example.com/account'
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.decision.classification, 'BLOCKED_CONNECTOR_BRIDGE');
  assert.equal(body.decision.repeatProviderSetupInstructions, false);
  assert.equal(body.decision.retryOperaBridge, true);
  assert.equal(body.recoveryState.operaRetryCount, 0);
  assert.equal(body.decision.executionAuthorized, false);
  assert.equal(body.evidence.complete, true);
  assert.equal(body.evidence.values.operaConnectorAvailable, true);
  assert.equal(body.evidence.values.operaLiveSessionExposed, false);
  assert.equal(body.evidence.sources.operaConnectorAvailable, 'env:OPERA_CONNECTOR_AVAILABLE');
  assert.equal(body.receipt.event, 'BROWSER_ROUTE_DECIDED');

  const ledger = await readFile(new URL('../data/receipts.jsonl', import.meta.url), 'utf8');
  assert.match(ledger, /BROWSER_ROUTE_DECIDED/);
});


test('browser recovery rejects ambiguous evidence instead of inferring capability state', async t => {
  const port = 4204;
  const localBase = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  t.after(() => proc.kill());

  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${localBase}/api/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  const signed = await fetch(`${localBase}/api/auth/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }).then(r => r.json());

  const response = await fetch(`${localBase}/api/browser/recovery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signed.token}` },
    body: JSON.stringify({ targetUrl: 'https://example.com', providerPageEvidence: 'observed_ready' })
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /Browser recovery evidence incomplete/);
  assert.equal(Object.keys(body.evidence.values).length, 8);
  assert.equal(body.evidence.known.directCapabilitySufficient, false);
  assert.equal(body.evidence.known.browserOnlyInteractionRequired, false);
  assert.ok(body.evidence.missing.includes('directCapabilitySufficient'));
});


test('recovery schema publishes the eight required boolean names', async t => {
  const port = 4205;
  const localBase = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  t.after(() => proc.kill());
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${localBase}/api/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  const schema = await fetch(`${localBase}/api/browser/recovery/schema`).then(r => r.json());
  assert.equal(schema.contract, 'juss/browser-recovery-evidence@v1');
  assert.equal(schema.requiredBooleans.length, 8);
  assert.ok(schema.requiredBooleans.includes('operaLiveSessionExposed'));
  assert.ok(schema.requiredBooleans.includes('genericBrowserSufficient'));
});


test('browser inspect consumes the one Opera handshake retry server-side and the client cannot reset it', async t => {
  const port = 4206;
  const localBase = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      OPERA_CONNECTOR_AVAILABLE: 'true',
      OPERA_LIVE_SESSION_EXPOSED: 'false'
    },
    stdio: 'ignore'
  });
  t.after(() => proc.kill());

  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${localBase}/api/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }

  const health = await fetch(`${localBase}/api/health`).then(r => r.json());
  const session = await fetch(`${localBase}/api/auth/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }).then(r => r.json());

  const grant = await fetch(`${localBase}/api/browser/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      targetUrl: 'https://example.com/account',
      scopes: ['browser:read'],
      providers: ['opera'],
      accepted: true,
      noticeVersion: health.noticeVersion
    })
  }).then(r => r.json());

  const payload = {
    tool: 'tab_content',
    targetUrl: 'https://example.com/account',
    args: {},
    recoveryEvidence: {
      values: { directCapabilitySufficient: false, browserOnlyInteractionRequired: true },
      known: { directCapabilitySufficient: true, browserOnlyInteractionRequired: true },
      sources: { directCapabilitySufficient: 'test-task', browserOnlyInteractionRequired: 'test-task' }
    },
    providerPageEvidence: 'observed_ready',
    operaConnectorError: 'Browser not connected'
  };

  const first = await fetch(`${localBase}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-browser-grant': grant.token
    },
    body: JSON.stringify(payload)
  });
  assert.equal(first.status, 409);
  const firstBody = await first.json();
  assert.equal(firstBody.previousDecision.retryOperaBridge, true);
  assert.equal(firstBody.decision.retryOperaBridge, false);
  assert.equal(firstBody.recoveryState.operaRetryCount, 1);
  assert.equal(firstBody.receipts[1].event, 'OPERA_REPROBE_BUDGET_CONSUMED');

  const second = await fetch(`${localBase}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-browser-grant': grant.token
    },
    body: JSON.stringify(payload)
  });
  assert.equal(second.status, 409);
  const secondBody = await second.json();
  assert.equal(secondBody.decision.retryOperaBridge, false);
  assert.match(secondBody.error, /not executable as a browser provider/);

  const tampered = await fetch(`${localBase}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-browser-grant': grant.token
    },
    body: JSON.stringify({ ...payload, operaRetryCount: 0 })
  });
  assert.equal(tampered.status, 400);
  assert.match((await tampered.json()).error, /server-owned/);
});
