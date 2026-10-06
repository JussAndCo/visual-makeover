import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 4197;
const base = `http://127.0.0.1:${PORT}`;
let child;

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

test('dual gate API issues app session then scoped browser grant', async t => {
  child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  t.after(() => child?.kill());
  await waitForServer();

  const health = await fetch(`${base}/api/health`).then(r => r.json());
  assert.equal(health.ok, true);

  const signed = await fetch(`${base}/api/auth/dev-sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
  assert.ok(signed.token);

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

  const status = await fetch(`${base}/api/browser/opera/status`).then(r => r.json());
  assert.equal(status.provider, 'opera-mcp');
  assert.deepEqual(status.capabilities.navigate, ['go_to_page']);
});
