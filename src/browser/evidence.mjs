import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BROWSER_RECOVERY_BOOLEAN_KEYS = Object.freeze([
  'directCapabilitySufficient',
  'browserOnlyInteractionRequired',
  'operaConnectorAvailable',
  'operaLiveSessionExposed',
  'alternateAuthenticatedBridgeAvailable',
  'alternateAuthenticatedBridgeLive',
  'genericBrowserAvailable',
  'genericBrowserSufficient'
]);

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

export function normalizeBrowserRecoveryEvidence(input = {}) {
  const nestedValues = input.values && typeof input.values === 'object' ? input.values : null;
  const nestedKnown = input.known && typeof input.known === 'object' ? input.known : {};
  const nestedSources = input.sources && typeof input.sources === 'object' ? input.sources : {};

  const values = {};
  const known = {};
  const sources = {};

  for (const key of BROWSER_RECOVERY_BOOLEAN_KEYS) {
    const hasNested = Boolean(nestedValues && own(nestedValues, key));
    const hasFlat = own(input, key);
    const supplied = hasNested || hasFlat;
    const raw = hasNested ? nestedValues[key] : hasFlat ? input[key] : false;
    const rawIsBoolean = supplied && typeof raw === 'boolean';

    if (own(nestedKnown, key) && typeof nestedKnown[key] !== 'boolean') {
      throw new Error(`Recovery evidence known.${key} must be boolean.`);
    }

    const explicitlyKnown = own(nestedKnown, key) ? nestedKnown[key] : rawIsBoolean;
    values[key] = rawIsBoolean ? raw : false;
    known[key] = Boolean(explicitlyKnown && rawIsBoolean);

    const source = nestedSources[key];
    sources[key] = typeof source === 'string' && source.trim()
      ? source.slice(0, 120)
      : known[key] ? 'explicit' : 'unknown';
  }

  const missing = BROWSER_RECOVERY_BOOLEAN_KEYS.filter(key => !known[key]);
  return {
    contract: 'juss/browser-recovery-evidence@v1',
    values,
    known,
    sources,
    complete: missing.length === 0,
    missing
  };
}

export function mergeBrowserRecoveryEvidence(...items) {
  const merged = { values: {}, known: {}, sources: {} };
  for (const item of items) {
    const normalized = normalizeBrowserRecoveryEvidence(item);
    for (const key of BROWSER_RECOVERY_BOOLEAN_KEYS) {
      if (normalized.known[key]) {
        merged.values[key] = normalized.values[key];
        merged.known[key] = true;
        merged.sources[key] = normalized.sources[key];
      }
    }
  }
  return normalizeBrowserRecoveryEvidence(merged);
}

function optionalEnvBoolean(env, name) {
  if (!own(env, name) || env[name] === '') return { known: false, value: false };
  const raw = String(env[name]).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return { known: true, value: true };
  if (['0', 'false', 'no', 'off'].includes(raw)) return { known: true, value: false };
  throw new Error(`${name} must be a boolean-like value.`);
}

export function browserRuntimeEvidenceFromEnv(env = process.env) {
  const values = {};
  const known = {};
  const sources = {};

  const set = (key, value, source) => {
    values[key] = Boolean(value);
    known[key] = true;
    sources[key] = source;
  };

  const operaAvailable = optionalEnvBoolean(env, 'OPERA_CONNECTOR_AVAILABLE');
  if (operaAvailable.known) set('operaConnectorAvailable', operaAvailable.value, 'env:OPERA_CONNECTOR_AVAILABLE');
  else if (env.OPERA_BRIDGE_URL) set('operaConnectorAvailable', true, 'config:OPERA_BRIDGE_URL');

  const operaLive = optionalEnvBoolean(env, 'OPERA_LIVE_SESSION_EXPOSED');
  if (operaLive.known) set('operaLiveSessionExposed', operaLive.value, 'env:OPERA_LIVE_SESSION_EXPOSED');
  else if (known.operaConnectorAvailable && values.operaConnectorAvailable === false) set('operaLiveSessionExposed', false, 'derived:no-opera-connector');

  const alternateAvailable = optionalEnvBoolean(env, 'ALT_AUTH_BROWSER_AVAILABLE');
  if (alternateAvailable.known) set('alternateAuthenticatedBridgeAvailable', alternateAvailable.value, 'env:ALT_AUTH_BROWSER_AVAILABLE');
  else set('alternateAuthenticatedBridgeAvailable', Boolean(env.ALT_AUTH_BROWSER_BRIDGE_URL), 'config:ALT_AUTH_BROWSER_BRIDGE_URL');

  const alternateLive = optionalEnvBoolean(env, 'ALT_AUTH_BROWSER_LIVE');
  if (alternateLive.known) set('alternateAuthenticatedBridgeLive', alternateLive.value, 'env:ALT_AUTH_BROWSER_LIVE');
  else if (values.alternateAuthenticatedBridgeAvailable === false) set('alternateAuthenticatedBridgeLive', false, 'derived:no-alternate-bridge');

  const genericAvailable = optionalEnvBoolean(env, 'GENERIC_BROWSER_AVAILABLE');
  if (genericAvailable.known) set('genericBrowserAvailable', genericAvailable.value, 'env:GENERIC_BROWSER_AVAILABLE');
  else set('genericBrowserAvailable', Boolean(env.GENERIC_BROWSER_BRIDGE_URL), 'config:GENERIC_BROWSER_BRIDGE_URL');

  if (values.genericBrowserAvailable === false) {
    set('genericBrowserSufficient', false, 'derived:no-generic-browser');
  }

  const defaultHostFile = fileURLToPath(new URL('../../data/opera-host-evidence.json', import.meta.url));
  const hostFile = env.OPERA_HOST_EVIDENCE_FILE || (env === process.env ? defaultHostFile : null);
  let operaHostSnapshot = hostFile ? 'missing' : 'disabled';

  if (hostFile) {
    try {
      const snapshot = JSON.parse(readFileSync(hostFile, 'utf8'));
      const now = Date.now();
      const observedAtMs = Date.parse(snapshot.observedAt || '');
      const expiresAtMs = Date.parse(snapshot.expiresAt || '');
      const windowMs = expiresAtMs - observedAtMs;
      const validWindow = Number.isFinite(observedAtMs)
        && Number.isFinite(expiresAtMs)
        && observedAtMs <= now + 5_000
        && expiresAtMs > now
        && windowMs > 0
        && windowMs <= 5 * 60_000
        && typeof snapshot.toolSurfaceAvailable === 'boolean';

      if (validWindow) {
        operaHostSnapshot = 'fresh';
        set('operaConnectorAvailable', snapshot.toolSurfaceAvailable, `host:${String(snapshot.source || 'opera-host-snapshot').slice(0, 100)}`);
        if (typeof snapshot.liveSessionExposed === 'boolean') {
          set('operaLiveSessionExposed', snapshot.liveSessionExposed, `host:${String(snapshot.source || 'opera-host-snapshot').slice(0, 100)}`);
        } else if (snapshot.toolSurfaceAvailable === false) {
          set('operaLiveSessionExposed', false, `host:${String(snapshot.source || 'opera-host-snapshot').slice(0, 100)}:derived`);
        }
      } else {
        operaHostSnapshot = Number.isFinite(expiresAtMs) && expiresAtMs <= now ? 'stale' : 'invalid';
      }
    } catch (error) {
      operaHostSnapshot = error?.code === 'ENOENT' ? 'missing' : 'invalid';
    }
  }

  const result = normalizeBrowserRecoveryEvidence({ values, known, sources });
  return { ...result, runtimeMeta: { operaHostSnapshot } };
}
