export const OPERA_CAPABILITIES = Object.freeze({
  read: ['tab_content', 'screenshot'],
  navigate: ['go_to_page'],
  globalReadBlocked: ['list_tabs', 'history'],
  mutate: []
});

const allowedTools = new Set([...OPERA_CAPABILITIES.read, ...OPERA_CAPABILITIES.navigate]);

export function requiredScopeForOperaTool(tool) {
  if (!allowedTools.has(tool)) throw new Error(`Unsupported Opera tool: ${tool}`);
  return OPERA_CAPABILITIES.navigate.includes(tool) ? 'browser:navigate' : 'browser:read';
}

export async function callOperaBridge({ bridgeUrl, bridgeToken, tool, args, expectedOrigin, signal }) {
  if (!bridgeUrl) throw new Error('Opera bridge is not configured.');
  if (!expectedOrigin) throw new Error('Expected origin is required for Opera calls.');
  requiredScopeForOperaTool(tool);
  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bridgeToken ? { authorization: `Bearer ${bridgeToken}` } : {})
    },
    body: JSON.stringify({ tool, args: args ?? {}, expectedOrigin }),
    signal
  });
  if (!res.ok) throw new Error(`Opera bridge returned ${res.status}.`);
  const payload = await res.json();
  if (payload?.origin !== expectedOrigin) throw new Error('Opera bridge origin proof missing or mismatched.');
  return payload.data ?? payload.result;
}
