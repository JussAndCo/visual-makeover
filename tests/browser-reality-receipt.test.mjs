import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_REALITY_CONTRACT_ID,
  fingerprintBrowserRealityEvidence
} from '../src/browser/browser-reality-receipt.mjs';

test('Visual Makeover matches PromptOS browser-reality conformance digest', () => {
  const input = {
    contractId: BROWSER_REALITY_CONTRACT_ID,
    authorizedInputUrl: 'HTTPS://viewer:drop-me@Example.COM:443/share/item?utm_source=chat&mibextid=track&token=drop-me&b=two&a=one#private-fragment',
    finalUrl: 'https://www.Facebook.com:443/marketplace/item/2144661676265222/?sessionid=drop-me&rdid=track&b=two&a=one#details',
    observedAt: '2026-08-29T01:02:03-04:00',
    scope: '  user-authorized target only  ',
    observations: [
      { state: 'BLOCKED', statement: 'Login required.' },
      { state: 'VERIFIED', statement: 'Marketplace redirect rendered.' },
      { state: 'INFERRED', statement: 'Target appears to be a listing.' },
      { state: 'VERIFIED', statement: 'Marketplace redirect rendered.' }
    ],
    screenshotSha256: 'A'.repeat(64)
  };

  const result = fingerprintBrowserRealityEvidence(input);
  assert.equal(
    result.canonicalJson,
    '{"authorizedInputUrl":"https://example.com/share/item?a=one&b=two&token=REDACTED","contractId":"juss/browser-reality@v1","finalUrl":"https://www.facebook.com/marketplace/item/2144661676265222/?a=one&b=two&sessionid=REDACTED","observations":[{"state":"VERIFIED","statement":"Marketplace redirect rendered."},{"state":"INFERRED","statement":"Target appears to be a listing."},{"state":"BLOCKED","statement":"Login required."}],"observedAt":"2026-08-29T05:02:03.000Z","scope":"user-authorized target only","screenshotSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
  );
  assert.equal(result.sha256, 'b638320661652bab6398f45e2b35bc343ac963bb0eb8b926462db6aea8cb1ab4');
});

test('browser-reality receipt rejects extra authority-like fields', () => {
  assert.throws(() => fingerprintBrowserRealityEvidence({
    contractId: BROWSER_REALITY_CONTRACT_ID,
    authorizedInputUrl: 'https://example.com',
    finalUrl: 'https://example.com',
    observedAt: new Date().toISOString(),
    scope: 'authorized target only',
    observations: [{ state: 'VERIFIED', statement: 'Page rendered.' }],
    browserGrant: 'not-allowed'
  }), /not allowed/);
});
