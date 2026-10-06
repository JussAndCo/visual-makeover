import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, originOf } from '../src/security.mjs';
import { requiredScopeForOperaTool } from '../src/browser/opera-provider.mjs';

test('private IPv4 ranges are blocked', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','192.168.1.10','172.16.2.2','169.254.10.2']) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('origin scoping ignores paths', () => {
  assert.equal(originOf('https://example.com/a?b=1'), 'https://example.com');
});

test('Opera tool scopes are capability-specific', () => {
  assert.equal(requiredScopeForOperaTool('tab_content'), 'browser:read');
  assert.equal(requiredScopeForOperaTool('screenshot'), 'browser:read');
  assert.equal(requiredScopeForOperaTool('go_to_page'), 'browser:navigate');
  assert.throws(() => requiredScopeForOperaTool('type_password'));
});
