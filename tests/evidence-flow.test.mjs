import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 4230;
const BRIDGE_PORT = 4231;
const base = `http://127.0.0.1:${PORT}`;
let child;
let bridge;

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

async function newSession() {
  return fetch(`${base}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  }).then(r => r.json());
}

test('browser capture -> analysis -> PromptOS handoff preserves evidence and authority boundaries', async t => {
  bridge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

    let data;
    if (body.tool === 'screenshot') {
      data = {
        finalUrl: 'https://example.com/account',
        imageBase64: Buffer.from('fake-screenshot-bytes').toString('base64')
      };
    } else {
      data = {
        finalUrl: 'https://example.com/account',
        role: 'document',
        name: 'Account overview',
        children: [{ role: 'heading', name: 'Welcome' }],
        sessionToken: 'do-not-leak'
      };
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ origin: 'https://example.com', data }));
  });
  await new Promise(resolve => bridge.listen(BRIDGE_PORT, '127.0.0.1', resolve));
  t.after(() => bridge?.close());

  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      OPERA_BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
      OPERA_LIVE_SESSION_EXPOSED: 'true'
    },
    stdio: 'ignore'
  });
  t.after(() => child?.kill());
  await waitForServer();

  const health = await fetch(`${base}/api/health`).then(r => r.json());
  const session = await newSession();

  const grant = await fetch(`${base}/api/browser/grants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      targetUrl: 'https://example.com/account',
      scopes: ['browser:read', 'scrape:public'],
      providers: ['opera'],
      accepted: true,
      noticeVersion: health.noticeVersion
    })
  }).then(r => r.json());

  const recoveryEvidence = {
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
  };

  async function inspect(tool) {
    const response = await fetch(`${base}/api/browser/inspect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
        'x-browser-grant': grant.token
      },
      body: JSON.stringify({
        tool,
        targetUrl: 'https://example.com/account',
        args: {},
        recoveryEvidence,
        providerPageEvidence: 'observed_ready'
      })
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  const dom = await inspect('tab_content');
  const screenshot = await inspect('screenshot');

  assert.equal(dom.result.captured, true);
  assert.equal(screenshot.result.captured, true);
  assert.equal(dom.capture.contractId, 'juss/browser-reality@v1');
  assert.equal(screenshot.capture.contractId, 'juss/browser-reality@v1');
  assert.match(dom.capture.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(screenshot.capture.screenshotSha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(dom.capture.receipt).includes('do-not-leak'));
  assert.ok(!JSON.stringify(screenshot).includes('fake-screenshot-bytes'));

  const signals = {
    url: 'https://example.com/account',
    title: 'Example account',
    headings: ['Account'],
    text: 'Public scrape text',
    colors: ['#111111'],
    hasViewport: true
  };
  const captureIds = [dom.capture.id, screenshot.capture.id];

  const analyzedRes = await fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ signals, captureIds })
  });
  assert.equal(analyzedRes.status, 200);
  const analyzed = await analyzedRes.json();

  assert.equal(analyzed.plan.evidence.browserRealityCaptureCount, 2);
  assert.equal(analyzed.plan.evidence.screenshotCount, 1);
  assert.equal(analyzed.plan.evidence.screenshotPixelsAnalyzed, false);
  assert.equal(analyzed.evidence.length, 2);
  assert.equal(analyzed.receipt.event, 'MAKEOVER_ANALYZED');

  const handoffRes = await fetch(`${base}/api/handoff/promptos`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ signals, captureIds })
  });
  assert.equal(handoffRes.status, 200);
  const handoff = await handoffRes.json();

  assert.equal(handoff.artifact.contractId, 'visual-makeover/promptos-handoff@v1');
  assert.equal(handoff.artifact.status, 'draft');
  assert.equal(handoff.artifact.authority, 'advisory-only');
  assert.equal(handoff.artifact.executionAuthorized, false);
  assert.equal(handoff.artifact.registrationAuthority, false);
  assert.equal(handoff.artifact.browserRealityContract, 'juss/browser-reality@v1');
  assert.equal(handoff.artifact.evidence.length, 2);
  assert.equal(handoff.receipt.event, 'PROMPTOS_HANDOFF_DRAFTED');

  const serializedHandoff = JSON.stringify(handoff.artifact);
  assert.ok(!serializedHandoff.includes(grant.token));
  assert.ok(!serializedHandoff.includes('do-not-leak'));
  assert.ok(!serializedHandoff.includes('fake-screenshot-bytes'));

  const otherSession = await newSession();
  const denied = await fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${otherSession.token}`
    },
    body: JSON.stringify({ signals, captureIds: [dom.capture.id] })
  });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /another app session/);
});
