import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 4220;
const BRIDGE_PORT = 4221;
const base = `http://127.0.0.1:${PORT}`;
let child;
let bridge;

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

async function createGrant(sessionToken, noticeVersion, providers) {
  const response = await fetch(`${base}/api/browser/grants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`
    },
    body: JSON.stringify({
      targetUrl: 'https://example.com/private',
      scopes: ['browser:read'],
      providers,
      accepted: true,
      noticeVersion
    })
  });
  assert.equal(response.status, 201);
  return response.json();
}

function genericRecoveryBody() {
  return {
    tool: 'tab_content',
    targetUrl: 'https://example.com/private',
    args: {},
    recoveryEvidence: {
      values: {
        directCapabilitySufficient: false,
        browserOnlyInteractionRequired: true,
        genericBrowserSufficient: true
      },
      known: {
        directCapabilitySufficient: true,
        browserOnlyInteractionRequired: true,
        genericBrowserSufficient: true
      },
      sources: {
        directCapabilitySufficient: 'test-task',
        browserOnlyInteractionRequired: 'test-task',
        genericBrowserSufficient: 'test-task'
      }
    },
    providerPageEvidence: 'observed_ready',
    operaRetryCount: 1
  };
}

test('fallback browser provider requires its own explicit provider grant', async t => {
  bridge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      origin: 'https://example.com',
      data: { ok: true, echo: body }
    }));
  });
  await new Promise(resolve => bridge.listen(BRIDGE_PORT, '127.0.0.1', resolve));
  t.after(() => bridge?.close());

  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      OPERA_CONNECTOR_AVAILABLE: 'false',
      GENERIC_BROWSER_AVAILABLE: 'true',
      GENERIC_BROWSER_BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`
    },
    stdio: 'ignore'
  });
  t.after(() => child?.kill());
  await waitForServer();

  const health = await fetch(`${base}/api/health`).then(r => r.json());
  const session = await fetch(`${base}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  }).then(r => r.json());

  const operaOnlyGrant = await createGrant(session.token, health.noticeVersion, ['opera']);
  const denied = await fetch(`${base}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-browser-grant': operaOnlyGrant.token
    },
    body: JSON.stringify(genericRecoveryBody())
  });
  assert.equal(denied.status, 403);
  const deniedBody = await denied.json();
  assert.match(deniedBody.error, /does not authorize provider generic_browser_automation/);
  assert.equal(deniedBody.decision.route, 'generic_browser_automation');
  assert.equal(deniedBody.evidence.complete, true);
  assert.equal(deniedBody.receipt.event, 'BROWSER_ROUTE_DECIDED');

  const genericGrant = await createGrant(session.token, health.noticeVersion, ['generic_browser_automation']);
  const allowed = await fetch(`${base}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-browser-grant': genericGrant.token
    },
    body: JSON.stringify(genericRecoveryBody())
  });
  assert.equal(allowed.status, 200);
  const result = await allowed.json();
  assert.equal(result.provider, 'generic_browser_automation');
  assert.equal(result.authority.provider, 'generic_browser_automation');
  assert.equal(result.result.ok, true);
  assert.equal(result.result.echo.provider, 'generic_browser_automation');
  assert.equal(result.result.echo.expectedOrigin, 'https://example.com');
});
