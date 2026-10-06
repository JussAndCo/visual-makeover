export const OPERA_CAPABILITIES = Object.freeze({
  read: ['list_tabs', 'history', 'tab_content', 'screenshot'],
  navigate: ['go_to_page'],
  mutate: []
});

const allowedTools = new Set([...OPERA_CAPABILITIES.read, ...OPERA_CAPABILITIES.navigate]);

export function requiredScopeForOperaTool(tool) {
  if (!allowedTools.has(tool)) throw new Error(`Unsupported Opera tool: ${tool}`);
  return OPERA_CAPABILITIES.navigate.includes(tool) ? 'browser:navigate' : 'browser:read';
}

export async function callOperaBridge({ bridgeUrl, bridgeToken, tool, args, signal }) {
  if (!bridgeUrl) throw new Error('Opera bridge is not configured.');
  requiredScopeForOperaTool(tool);
  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bridgeToken ? { authorization: `Bearer ${bridgeToken}` } : {})
    },
    body: JSON.stringify({ tool, args: args ?? {} }),
    signal
  });
  if (!res.ok) throw new Error(`Opera bridge returned ${res.status}.`);
  return res.json();
}
