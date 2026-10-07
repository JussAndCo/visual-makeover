import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildCapturedBrowserEvidence, extractRenderedText } from '../src/browser/captured-evidence.mjs';

test('captured rendered text excludes sensitive-key values', () => {
  const text = extractRenderedText({
    role: 'document',
    name: 'Pricing page',
    children: [{ name: 'Buy now' }],
    sessionToken: 'do-not-leak',
    cookie: 'also-private'
  });
  assert.match(text, /Pricing page/);
  assert.match(text, /Buy now/);
  assert.doesNotMatch(text, /do-not-leak|also-private/);
});

test('tab content produces a PromptOS-compatible browser reality fingerprint', () => {
  const capture = buildCapturedBrowserEvidence({
    authorizedInputUrl: 'https://example.com/account?utm_source=test&token=secret',
    finalUrl: 'https://example.com/account?token=other-secret',
    tool: 'tab_content',
    result: { role: 'document', name: 'Account overview' },
    observedAt: '2026-10-07T16:00:00.000Z'
  });
  assert.equal(capture.contractId, 'juss/browser-reality@v1');
  assert.match(capture.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(capture.receipt.authorizedInputUrl, 'https://example.com/account?token=REDACTED');
  assert.equal(capture.receipt.finalUrl, 'https://example.com/account?token=REDACTED');
  assert.match(capture.renderedText, /Account overview/);
});

test('screenshot bytes are reduced to SHA-256 and not embedded in the receipt', () => {
  const bytes = Buffer.from('fake-image-bytes');
  const base64 = bytes.toString('base64');
  const capture = buildCapturedBrowserEvidence({
    authorizedInputUrl: 'https://example.com',
    finalUrl: 'https://example.com',
    tool: 'screenshot',
    result: { imageBase64: base64 },
    observedAt: '2026-10-07T16:00:00.000Z'
  });
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(capture.screenshotSha256, expected);
  assert.equal(capture.receipt.screenshotSha256, expected);
  assert.ok(!JSON.stringify(capture.receipt).includes(base64));
});
