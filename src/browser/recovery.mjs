export const BROWSER_BRIDGE_RECOVERY_CONTRACT = 'juss/browser-bridge-recovery@v1';

function isBridgeSessionFailure(error) {
  return typeof error === 'string'
    && /browser not connected|session.*not connected|connector.*not connected|resource not found/i.test(error);
}

export function decideBrowserBridgeRecovery(input) {
  const providerPageEstablished =
    input.providerPageEvidence === 'founder_reported_ready'
    || input.providerPageEvidence === 'observed_ready';

  const repeatProviderSetupInstructions = input.providerPageEvidence === 'contradicted';

  const base = {
    contract: BROWSER_BRIDGE_RECOVERY_CONTRACT,
    providerPageEvidencePreserved: true,
    executionAuthorized: false,
    repeatProviderSetupInstructions,
  };

  if (input.directCapabilitySufficient) {
    return { ...base, route: 'direct_capability', classification: 'READY', retryOperaBridge: false,
      reason: 'A narrower direct capability is sufficient, so browser routing is unnecessary.',
      nextGate: 'Use the direct capability inside the existing authority and evidence boundary.' };
  }

  if (!input.browserOnlyInteractionRequired) {
    return { ...base, route: 'unavailable', classification: 'UNAVAILABLE', retryOperaBridge: false,
      reason: 'No sufficient direct capability exists and the goal does not require browser-only interaction.',
      nextGate: 'Resolve another bounded capability rather than introducing browser automation without need.' };
  }

  if (input.operaConnectorAvailable && input.operaLiveSessionExposed) {
    return { ...base, route: 'opera', classification: 'READY', retryOperaBridge: false,
      reason: 'Opera is the preferred authenticated browser capability and exposes a live session.',
      nextGate: 'Recheck action-specific authority, then execute only the bounded browser action and capture evidence.' };
  }

  const operaBridgeBlocked = input.operaConnectorAvailable
    && !input.operaLiveSessionExposed
    && isBridgeSessionFailure(input.operaConnectorError);

  if (input.alternateAuthenticatedBridgeAvailable && input.alternateAuthenticatedBridgeLive) {
    return { ...base, route: 'authenticated_browser_bridge', classification: 'READY', retryOperaBridge: false,
      reason: operaBridgeBlocked
        ? 'Opera bridge is blocked, so the next authenticated browser bridge may be used without rewriting provider-page truth.'
        : 'Opera is unavailable or insufficient, and another authenticated browser bridge exposes a live session.',
      nextGate: 'Use the alternate authenticated bridge under the same authority, receipt, and outcome-verification rules.' };
  }

  if (input.genericBrowserAvailable && input.genericBrowserSufficient) {
    return { ...base, route: 'generic_browser_automation', classification: 'READY', retryOperaBridge: false,
      reason: 'No sufficient direct or authenticated browser bridge is available; generic browser automation is the smallest sufficient fallback.',
      nextGate: 'Use generic browser automation only for the bounded action and preserve normal authority and proof gates.' };
  }

  if (operaBridgeBlocked) {
    const retryOperaBridge = Number(input.operaRetryCount || 0) < 1;
    return { ...base, route: 'blocked_connector_bridge', classification: 'BLOCKED_CONNECTOR_BRIDGE', retryOperaBridge,
      repeatProviderSetupInstructions: providerPageEstablished ? false : repeatProviderSetupInstructions,
      reason: 'The Opera connector surface exists but no live session is exposed. This is a bridge failure, not proof that the provider page is logged out or misconfigured.',
      nextGate: retryOperaBridge
        ? 'Re-probe the Opera bridge once while preserving provider-page evidence.'
        : 'Stop at the live connector handshake gate until fresh bridge evidence exposes a session or another sufficient capability becomes available.' };
  }

  return { ...base, route: 'unavailable', classification: 'UNAVAILABLE', retryOperaBridge: false,
    reason: 'No sufficient direct capability or usable browser execution surface is currently available.',
    nextGate: 'Wait for fresh runtime capability evidence or resolve a different bounded provider path.' };
}
