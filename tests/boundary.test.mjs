import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 4201;
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

async function session() {
  return fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
}

test('browser grant is bound to its app session and global Opera reads are blocked', async t => {
  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  t.after(() => child?.kill());
  await waitForServer();

  const a = await session();
  const b = await session();
  const health = await fetch(`${base}/api/health`).then(r => r.json());

  const grantRes = await fetch(`${base}/api/browser/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` },
    body: JSON.stringify({
      targetUrl: 'https://example.com/account',
      scopes: ['browser:read'],
      providers: ['opera'],
      accepted: true,
      noticeVersion: health.noticeVersion
    })
  });
  assert.equal(grantRes.status, 201);
  const grant = await grantRes.json();

  const stolen = await fetch(`${base}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${b.token}`,
      'x-browser-grant': grant.token
    },
    body: JSON.stringify({ tool: 'tab_content', targetUrl: 'https://example.com/account', args: { tabId: 1 } })
  });
  assert.equal(stolen.status, 403);
  assert.match((await stolen.json()).error, /another app session/);

  const globalRead = await fetch(`${base}/api/browser/inspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${a.token}`,
      'x-browser-grant': grant.token
    },
    body: JSON.stringify({ tool: 'history', targetUrl: 'https://example.com/account', args: {} })
  });
  assert.equal(globalRead.status, 400);
  assert.match((await globalRead.json()).error, /Unsupported Opera tool/);
});
