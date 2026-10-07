import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callScopedBrowserBridge } from '../src/browser/scoped-bridge.mjs';

test('scoped bridge requires returned origin proof to match the granted origin', async t => {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ origin: 'https://example.com', data: { body } }));
  });
  await new Promise(resolve => server.listen(4210, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await callScopedBrowserBridge({
    bridgeUrl: 'http://127.0.0.1:4210',
    provider: 'authenticated_browser_bridge',
    tool: 'tab_content',
    args: {},
    expectedOrigin: 'https://example.com'
  });
  assert.equal(result.body.provider, 'authenticated_browser_bridge');
  assert.equal(result.body.expectedOrigin, 'https://example.com');
});

test('scoped bridge rejects mismatched origin proof', async t => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ origin: 'https://wrong.example', data: {} }));
  });
  await new Promise(resolve => server.listen(4211, '127.0.0.1', resolve));
  t.after(() => server.close());

  await assert.rejects(() => callScopedBrowserBridge({
    bridgeUrl: 'http://127.0.0.1:4211',
    provider: 'generic_browser_automation',
    tool: 'screenshot',
    args: {},
    expectedOrigin: 'https://example.com'
  }), /origin proof missing or mismatched/);
});
