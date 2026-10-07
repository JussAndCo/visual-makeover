import { normalizeBrowserRecoveryEvidence } from './evidence.mjs';

export const OPERA_HOST_EVIDENCE_CONTRACT = 'juss/opera-host-evidence@v1';

export function classifyOperaHostProbe({
  toolSurfaceAvailable,
  liveSessionExposed,
  source = 'opera-host-probe',
  observedAt = new Date().toISOString()
} = {}) {
  if (typeof toolSurfaceAvailable !== 'boolean') throw new Error('toolSurfaceAvailable must be boolean.');
  if (liveSessionExposed != null && typeof liveSessionExposed !== 'boolean') throw new Error('liveSessionExposed must be boolean when supplied.');
  if (!toolSurfaceAvailable && liveSessionExposed === true) throw new Error('Live Opera session cannot be exposed without the connector surface.');

  const values = { operaConnectorAvailable: toolSurfaceAvailable };
  const known = { operaConnectorAvailable: true };
  const sources = { operaConnectorAvailable: `host:${String(source).slice(0, 100)}` };

  if (typeof liveSessionExposed === 'boolean') {
    values.operaLiveSessionExposed = liveSessionExposed;
    known.operaLiveSessionExposed = true;
    sources.operaLiveSessionExposed = `host:${String(source).slice(0, 100)}`;
  } else if (!toolSurfaceAvailable) {
    values.operaLiveSessionExposed = false;
    known.operaLiveSessionExposed = true;
    sources.operaLiveSessionExposed = `host:${String(source).slice(0, 100)}:derived`;
  }

  return {
    contract: OPERA_HOST_EVIDENCE_CONTRACT,
    observedAt,
    evidence: normalizeBrowserRecoveryEvidence({ values, known, sources })
  };
}
