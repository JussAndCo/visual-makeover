import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyCloudflareAccessJwt } from '../src/auth-cloudflare-access.mjs';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fixture({ aud = 'visual-aud', expOffset = 300 } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const payload = encode({
    iss: 'https://ray-test.cloudflareaccess.com',
    aud,
    sub: 'user-1',
    email: 'owner@example.com',
    iat: now,
    exp: now + expOffset
  });
  const body = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
  return { token: `${body}.${signature}`, jwk };
}

test('valid Cloudflare Access JWT verifies signature, issuer and audience', async () => {
  const { token, jwk } = fixture();
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const identity = await verifyCloudflareAccessJwt(token, {
    teamDomain: 'ray-test.cloudflareaccess.com',
    audience: 'visual-aud',
    fetchImpl
  });
  assert.equal(identity.sub, 'user-1');
  assert.equal(identity.email, 'owner@example.com');
});

test('Cloudflare Access JWT rejects wrong audience', async () => {
  const { token, jwk } = fixture({ aud: 'wrong-aud' });
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => verifyCloudflareAccessJwt(token, {
    teamDomain: 'ray-test.cloudflareaccess.com',
    audience: 'visual-aud',
    fetchImpl
  }), /audience mismatch/);
});
