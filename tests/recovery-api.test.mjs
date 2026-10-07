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
    env: { ...process.env, PORT: String(PORT) },
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
      directCapabilitySufficient: false,
      browserOnlyInteractionRequired: true,
      operaConnectorAvailable: true,
      operaLiveSessionExposed: false,
      operaConnectorError: 'Browser not connected',
      operaRetryCount: 1,
      providerPageEvidence: 'observed_ready',
      alternateAuthenticatedBridgeAvailable: false,
      alternateAuthenticatedBridgeLive: false,
      genericBrowserAvailable: false,
      genericBrowserSufficient: false
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.decision.classification, 'BLOCKED_CONNECTOR_BRIDGE');
  assert.equal(body.decision.repeatProviderSetupInstructions, false);
  assert.equal(body.decision.retryOperaBridge, false);
  assert.equal(body.decision.executionAuthorized, false);
  assert.equal(body.receipt.event, 'BROWSER_ROUTE_DECIDED');

  const ledger = await readFile(new URL('../data/receipts.jsonl', import.meta.url), 'utf8');
  assert.match(ledger, /BROWSER_ROUTE_DECIDED/);
});
