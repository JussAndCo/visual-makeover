import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BROWSER_RECOVERY_BOOLEAN_KEYS,
  normalizeBrowserRecoveryEvidence,
  mergeBrowserRecoveryEvidence,
  browserRuntimeEvidenceFromEnv
} from '../src/browser/evidence.mjs';

test('all recovery booleans are always materialized without pretending unknown is false', () => {
  const evidence = normalizeBrowserRecoveryEvidence({
    values: { operaConnectorAvailable: true },
    known: { operaConnectorAvailable: true },
    sources: { operaConnectorAvailable: 'plugin-registry' }
  });

  assert.deepEqual(Object.keys(evidence.values), [...BROWSER_RECOVERY_BOOLEAN_KEYS]);
  assert.equal(evidence.values.operaConnectorAvailable, true);
  assert.equal(evidence.known.operaConnectorAvailable, true);
  assert.equal(evidence.values.operaLiveSessionExposed, false);
  assert.equal(evidence.known.operaLiveSessionExposed, false);
  assert.ok(evidence.missing.includes('operaLiveSessionExposed'));
  assert.equal(evidence.complete, false);
});

test('flat explicit booleans remain backward compatible and complete', () => {
  const input = Object.fromEntries(BROWSER_RECOVERY_BOOLEAN_KEYS.map(key => [key, false]));
  const evidence = normalizeBrowserRecoveryEvidence(input);
  assert.equal(evidence.complete, true);
  assert.deepEqual(evidence.missing, []);
});

test('known flags cannot claim a non-boolean value is proven', () => {
  const evidence = normalizeBrowserRecoveryEvidence({
    values: { operaConnectorAvailable: 'yes' },
    known: { operaConnectorAvailable: true }
  });
  assert.equal(evidence.values.operaConnectorAvailable, false);
  assert.equal(evidence.known.operaConnectorAvailable, false);
});

test('merge only promotes proven values and later proven facts win', () => {
  const merged = mergeBrowserRecoveryEvidence(
    {
      values: { directCapabilitySufficient: false, operaConnectorAvailable: true },
      known: { directCapabilitySufficient: true, operaConnectorAvailable: true },
      sources: { directCapabilitySufficient: 'task', operaConnectorAvailable: 'caller' }
    },
    {
      values: { operaConnectorAvailable: false },
      known: { operaConnectorAvailable: true },
      sources: { operaConnectorAvailable: 'server-runtime' }
    }
  );
  assert.equal(merged.values.directCapabilitySufficient, false);
  assert.equal(merged.values.operaConnectorAvailable, false);
  assert.equal(merged.sources.operaConnectorAvailable, 'server-runtime');
  assert.equal(merged.known.browserOnlyInteractionRequired, false);
});

test('runtime evidence fills unavailable provider booleans without claiming a live probe', () => {
  const evidence = browserRuntimeEvidenceFromEnv({});
  assert.equal(evidence.values.operaConnectorAvailable, false);
  assert.equal(evidence.known.operaConnectorAvailable, true);
  assert.equal(evidence.values.operaLiveSessionExposed, false);
  assert.equal(evidence.known.operaLiveSessionExposed, true);
  assert.equal(evidence.values.alternateAuthenticatedBridgeAvailable, false);
  assert.equal(evidence.values.alternateAuthenticatedBridgeLive, false);
  assert.equal(evidence.values.genericBrowserAvailable, false);
  assert.equal(evidence.values.genericBrowserSufficient, false);
  assert.equal(evidence.known.directCapabilitySufficient, false);
  assert.equal(evidence.known.browserOnlyInteractionRequired, false);
});

test('configured Opera keeps live-session state unknown until separately proven', () => {
  const evidence = browserRuntimeEvidenceFromEnv({ OPERA_BRIDGE_URL: 'https://bridge.example' });
  assert.equal(evidence.values.operaConnectorAvailable, true);
  assert.equal(evidence.known.operaConnectorAvailable, true);
  assert.equal(evidence.known.operaLiveSessionExposed, false);
});


test('fresh Opera host snapshot overrides env fallback without deciding authority', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-makeover-host-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'opera-host-evidence.json');
  await writeFile(file, JSON.stringify({
    toolSurfaceAvailable: true,
    liveSessionExposed: false,
    source: 'test-opera-host',
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  }));

  const evidence = browserRuntimeEvidenceFromEnv({
    OPERA_HOST_EVIDENCE_FILE: file,
    OPERA_CONNECTOR_AVAILABLE: 'false',
    OPERA_LIVE_SESSION_EXPOSED: 'true'
  });

  assert.equal(evidence.values.operaConnectorAvailable, true);
  assert.equal(evidence.values.operaLiveSessionExposed, false);
  assert.equal(evidence.sources.operaConnectorAvailable, 'host:test-opera-host');
  assert.equal(evidence.sources.operaLiveSessionExposed, 'host:test-opera-host');
  assert.equal(evidence.known.directCapabilitySufficient, false);
});
