import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBrowserBridgeRecovery } from '../src/browser/recovery.mjs';

const base = {
  directCapabilitySufficient: false,
  browserOnlyInteractionRequired: true,
  operaConnectorAvailable: true,
  operaLiveSessionExposed: false,
  operaConnectorError: 'Browser not connected',
  operaRetryCount: 0,
  providerPageEvidence: 'observed_ready',
  alternateAuthenticatedBridgeAvailable: false,
  alternateAuthenticatedBridgeLive: false,
  genericBrowserAvailable: false,
  genericBrowserSufficient: false,
};

test('healthy provider setup + missing live session is a connector bridge block, not setup failure', () => {
  const d = decideBrowserBridgeRecovery(base);
  assert.equal(d.classification, 'BLOCKED_CONNECTOR_BRIDGE');
  assert.equal(d.route, 'blocked_connector_bridge');
  assert.equal(d.repeatProviderSetupInstructions, false);
  assert.equal(d.providerPageEvidencePreserved, true);
  assert.equal(d.executionAuthorized, false);
  assert.equal(d.retryOperaBridge, true);
});

test('only one Opera reprobe is allowed', () => {
  const d = decideBrowserBridgeRecovery({ ...base, operaRetryCount: 1 });
  assert.equal(d.retryOperaBridge, false);
});

test('live Opera session is preferred but still not self-authorizing', () => {
  const d = decideBrowserBridgeRecovery({ ...base, operaLiveSessionExposed: true, operaConnectorError: null });
  assert.equal(d.route, 'opera');
  assert.equal(d.classification, 'READY');
  assert.equal(d.executionAuthorized, false);
});

test('alternate authenticated bridge is preferred to generic automation when Opera attach is blocked', () => {
  const d = decideBrowserBridgeRecovery({
    ...base,
    operaRetryCount: 1,
    alternateAuthenticatedBridgeAvailable: true,
    alternateAuthenticatedBridgeLive: true,
    genericBrowserAvailable: true,
    genericBrowserSufficient: true,
  });
  assert.equal(d.route, 'authenticated_browser_bridge');
  assert.equal(d.executionAuthorized, false);
});
