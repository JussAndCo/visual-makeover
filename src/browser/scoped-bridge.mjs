export async function callScopedBrowserBridge({
  bridgeUrl,
  bridgeToken,
  provider,
  tool,
  args,
  expectedOrigin,
  signal
}) {
  if (!bridgeUrl) throw new Error(`${provider} bridge is not configured.`);
  if (!expectedOrigin) throw new Error('Expected origin is required for browser bridge calls.');

  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bridgeToken ? { authorization: `Bearer ${bridgeToken}` } : {})
    },
    body: JSON.stringify({ provider, tool, args: args ?? {}, expectedOrigin }),
    signal
  });

  let payload = null;
  try { payload = await res.json(); } catch {}
  if (!res.ok) {
    const detail = typeof payload?.error === 'string' ? `: ${payload.error.slice(0, 300)}` : '';
    throw new Error(`${provider} bridge returned ${res.status}${detail}.`);
  }
  if (payload?.origin !== expectedOrigin) throw new Error(`${provider} bridge origin proof missing or mismatched.`);
  return payload.data ?? payload.result;
}
