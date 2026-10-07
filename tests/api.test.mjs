import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = 4197;
const BRIDGE_PORT = 4198;
const base = `http://127.0.0.1:${PORT}`;
let child;
let bridge;

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

test('dual gate API issues app session, scoped browser grant, and allow-listed Opera bridge call', async t => {
  bridge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ origin: 'https://example.com', data: { ok: true, echo: body } }));
  });
  await new Promise(resolve => bridge.listen(BRIDGE_PORT, '127.0.0.1', resolve));
  t.after(() => bridge?.close());

  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), OPERA_BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}` },
    stdio: 'ignore'
  });
  t.after(() => child?.kill());
  await waitForServer();

  const health = await fetch(`${base}/api/health`).then(r => r.json());
  assert.equal(health.ok, true);

  const signed = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
  assert.ok(signed.token);
  const ledger = await readFile(new URL('../data/receipts.jsonl', import.meta.url), 'utf8');
  assert.match(ledger, /APP_SESSION_CREATED/);

  const grantRes = await fetch(`${base}/api/browser/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signed.token}` },
    body: JSON.stringify({ targetUrl: 'https://example.com/account', scopes: ['scrape:public','browser:read'], accepted: true, noticeVersion: health.noticeVersion })
  });
  assert.equal(grantRes.status, 201);
  const granted = await grantRes.json();
  assert.equal(granted.grant.origin, 'https://example.com');
  assert.deepEqual(granted.grant.scopes, ['scrape:public','browser:read']);
  assert.ok(granted.token);


  const operaRes = await fetch(`${base}/api/browser/opera/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signed.token}`,
      'x-browser-grant': granted.token
    },
    body: JSON.stringify({ tool: 'tab_content', targetUrl: 'https://example.com/account', args: { tabId: 1 } })
  });
  assert.equal(operaRes.status, 200);
  const opera = await operaRes.json();
  assert.equal(opera.result.ok, true);
  assert.equal(opera.result.echo.tool, 'tab_content');
  assert.deepEqual(opera.result.echo.args, { tabId: 1 });
  assert.equal(opera.result.echo.expectedOrigin, 'https://example.com');
  assert.equal(opera.receipt.event, 'OPERA_CALL_COMPLETED');

  const status = await fetch(`${base}/api/browser/opera/status`).then(r => r.json());
  assert.equal(status.provider, 'opera-mcp');
  assert.deepEqual(status.capabilities.navigate, ['go_to_page']);
});
