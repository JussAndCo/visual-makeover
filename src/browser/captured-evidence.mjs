import { createHash } from 'node:crypto';
import {
  BROWSER_REALITY_CONTRACT_ID,
  fingerprintBrowserRealityEvidence
} from './browser-reality-receipt.mjs';

const MAX_RENDERED_TEXT = 12000;
const SENSITIVE_KEY = /cookie|token|secret|password|authorization|credential|session(id)?|jwt/i;

function collectText(value, out, depth = 0) {
  if (out.length >= MAX_RENDERED_TEXT || depth > 8 || value == null) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      collectText(item, out, depth + 1);
    }
  }
}

export function extractRenderedText(result) {
  const parts = [];
  collectText(result, parts);
  return parts.join(' ').normalize('NFC').replace(/\s+/gu, ' ').trim().slice(0, MAX_RENDERED_TEXT);
}

function decodeScreenshot(result) {
  if (!result || typeof result !== 'object') return null;
  const candidate = result.imageBase64 ?? result.screenshotBase64 ?? null;
  if (typeof candidate !== 'string' || !candidate) return null;
  const raw = candidate.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) return null;
  try {
    const bytes = Buffer.from(raw, 'base64');
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

export function buildCapturedBrowserEvidence({
  authorizedInputUrl,
  finalUrl,
  tool,
  result,
  observedAt = new Date().toISOString()
}) {
  const renderedText = tool === 'tab_content' ? extractRenderedText(result) : '';
  const screenshotBytes = tool === 'screenshot' ? decodeScreenshot(result) : null;
  const screenshotSha256 = screenshotBytes
    ? createHash('sha256').update(screenshotBytes).digest('hex')
    : undefined;

  const observations = [];
  if (tool === 'tab_content') {
    observations.push({
      state: 'VERIFIED',
      statement: renderedText
        ? `Rendered browser content captured for the authorized target. Evidence text length: ${renderedText.length} characters.`
        : 'Rendered browser content call completed, but no safe text excerpt was extracted.'
    });
  } else if (tool === 'screenshot') {
    observations.push({
      state: screenshotSha256 ? 'VERIFIED' : 'UNKNOWN',
      statement: screenshotSha256
        ? 'Screenshot bytes were captured and bound by SHA-256.'
        : 'Screenshot result did not expose supported image bytes for hashing.'
    });
  } else if (tool === 'go_to_page') {
    observations.push({
      state: 'VERIFIED',
      statement: 'Authorized same-origin browser navigation completed.'
    });
  } else {
    observations.push({ state: 'UNKNOWN', statement: 'Browser tool result was not recognized for evidence extraction.' });
  }

  const fingerprint = fingerprintBrowserRealityEvidence({
    contractId: BROWSER_REALITY_CONTRACT_ID,
    authorizedInputUrl,
    finalUrl,
    observedAt,
    scope: 'user-authorized target only',
    observations,
    ...(screenshotSha256 ? { screenshotSha256 } : {})
  });

  return {
    contractId: BROWSER_REALITY_CONTRACT_ID,
    evidenceFingerprintSha256: fingerprint.sha256,
    receipt: fingerprint.receipt,
    renderedText,
    screenshotSha256: screenshotSha256 ?? null
  };
}
