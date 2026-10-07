import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertPublicUrl, originOf } from './security.mjs';
import { callOperaBridge, requiredScopeForOperaTool, OPERA_CAPABILITIES } from './browser/opera-provider.mjs';
import { callScopedBrowserBridge } from './browser/scoped-bridge.mjs';
import { verifyCloudflareAccessJwt } from './auth-cloudflare-access.mjs';
import { decideBrowserBridgeRecovery } from './browser/recovery.mjs';
import {
  BROWSER_RECOVERY_BOOLEAN_KEYS,
  normalizeBrowserRecoveryEvidence,
  mergeBrowserRecoveryEvidence,
  browserRuntimeEvidenceFromEnv
} from './browser/evidence.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('..', import.meta.url)), '..'));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const NOTICE_VERSION = '2026-10-07.v2';
const MAX_BODY = 64 * 1024;
const MAX_SCRAPE_BYTES = 1_500_000;
const sessions = new Map();
const grants = new Map();
const recoveryStates = new Map();
const RECOVERY_STATE_TTL_MS = 15 * 60_000;
const BROWSER_PROVIDERS = Object.freeze(['opera', 'authenticated_browser_bridge', 'generic_browser_automation']);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}

function requireSession(req) {
  const token = bearer(req);
  const session = token && sessions.get(token);
  if (!session || (session.expiresAt && session.expiresAt <= Date.now())) {
    if (token) sessions.delete(token);
    throw Object.assign(new Error('Sign in required.'), { status: 401 });
  }
  return session;
}

function requireGrant(req, { scope, origin, sessionId, provider }) {
  const token = req.headers['x-browser-grant'];
  const grant = token && grants.get(token);
  if (!grant || grant.expiresAt < Date.now()) throw Object.assign(new Error('Browser grant required or expired.'), { status: 403 });
  if (sessionId && grant.sessionId !== sessionId) throw Object.assign(new Error('Browser grant belongs to another app session.'), { status: 403 });
  if (!grant.scopes.includes(scope)) throw Object.assign(new Error(`Grant lacks ${scope}.`), { status: 403 });
  if (origin && grant.origin !== origin) throw Object.assign(new Error('Grant is scoped to another origin.'), { status: 403 });
  if (provider && !grant.providers.includes(provider)) throw Object.assign(new Error(`Browser grant does not authorize provider ${provider}.`), { status: 403 });
  return grant;
}

async function receipt(event, detail = {}) {
  const row = { id: randomUUID(), at: new Date().toISOString(), event, ...detail };
  const dataDir = join(ROOT, 'data');
  await mkdir(dataDir, { recursive: true });
  await appendFile(join(dataDir, 'receipts.jsonl'), JSON.stringify(row) + '\n');
  return row;
}

function htmlToSignals(html, url) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].slice(0, 24).map(m => m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 20000);
  const colors = [...new Set((html.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(x => x.toLowerCase()))].slice(0, 16);
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  return { url, title, headings, text, colors, hasViewport };
}

function heuristicMakeover(signals) {
  const recommendations = [];
  if (!signals.hasViewport) recommendations.push({ priority: 'high', area: 'responsive', change: 'Add a viewport meta tag before any visual redesign.' });
  if (!signals.headings.length) recommendations.push({ priority: 'high', area: 'hierarchy', change: 'Create a visible H1-led hierarchy so the page has a clear visual spine.' });
  if (signals.colors.length > 8) recommendations.push({ priority: 'medium', area: 'palette', change: 'Collapse the palette into 3-5 semantic tokens and reserve accent colors for actions.' });
  recommendations.push({ priority: 'medium', area: 'layout', change: 'Use a consistent max-width, spacing scale, and section rhythm before adding decorative effects.' });
  recommendations.push({ priority: 'medium', area: 'interaction', change: 'Give primary actions one dominant treatment and preserve visible keyboard focus states.' });
  return {
    summary: `Makeover plan for ${signals.title || new URL(signals.url).hostname}`,
    direction: 'Preserve product meaning, improve hierarchy, spacing, contrast, and action clarity before changing brand personality.',
    recommendations,
    tokens: { radius: '18px', space: ['4px','8px','12px','16px','24px','32px','48px'], maxWidth: '1180px' }
  };
}

async function scrape(rawUrl) {
  let url = await assertPublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'VisualMakeoverBot/0.1 (+consent-first visual audit)' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (redirects === 5) throw new Error('Too many redirects.');
        const location = res.headers.get('location');
        if (!location) throw new Error('Redirect missing location.');
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      if (!res.ok) throw new Error(`Target returned ${res.status}.`);
      const type = res.headers.get('content-type') || '';
      if (!type.includes('text/html')) throw new Error('Only HTML pages are supported in this starter.');
      const reader = res.body.getReader();
      let total = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_SCRAPE_BYTES) throw new Error('Page exceeded scrape size limit.');
        chunks.push(value);
      }
      return htmlToSignals(Buffer.concat(chunks).toString('utf8'), url.toString());
    }
    throw new Error('Too many redirects.');
  } finally { clearTimeout(timer); }
}

function recoveryStateFor(sessionId, origin) {
  const key = `${sessionId}|${origin}`;
  const existing = recoveryStates.get(key);
  if (!existing || Date.now() - existing.updatedAt > RECOVERY_STATE_TTL_MS) {
    const fresh = { key, operaRetryCount: 0, updatedAt: Date.now() };
    recoveryStates.set(key, fresh);
    return fresh;
  }
  return existing;
}

function resolveBrowserRecovery(body, operaRetryCount) {
  const providerEvidenceValues = ['unknown', 'founder_reported_ready', 'observed_ready', 'contradicted'];
  const providerPageEvidence = body.providerPageEvidence ?? 'unknown';
  if (!providerEvidenceValues.includes(providerPageEvidence)) {
    return { error: { status: 400, message: 'Invalid providerPageEvidence.' } };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'operaRetryCount')) {
    return { error: { status: 400, message: 'operaRetryCount is server-owned and must not be supplied by the client.' } };
  }
  if (!Number.isInteger(operaRetryCount) || operaRetryCount < 0 || operaRetryCount > 1) {
    return { error: { status: 500, message: 'Invalid server recovery retry state.' } };
  }
  if (body.operaConnectorError != null && (typeof body.operaConnectorError !== 'string' || body.operaConnectorError.length > 500)) {
    return { error: { status: 400, message: 'Invalid operaConnectorError.' } };
  }

  let callerEvidence;
  try {
    callerEvidence = normalizeBrowserRecoveryEvidence(body.recoveryEvidence ?? body.evidence ?? body);
  } catch (error) {
    return { error: { status: 400, message: error.message } };
  }

  let runtimeEvidence;
  try {
    runtimeEvidence = browserRuntimeEvidenceFromEnv(process.env);
  } catch (error) {
    return { error: { status: 500, message: error.message } };
  }

  const evidence = mergeBrowserRecoveryEvidence(callerEvidence, runtimeEvidence);
  const runtimeMeta = runtimeEvidence.runtimeMeta ?? {};
  if (!evidence.complete) {
    return {
      error: {
        status: 409,
        message: `Browser recovery evidence incomplete: ${evidence.missing.join(', ')}.`
      },
      evidence
    };
  }

  const decision = decideBrowserBridgeRecovery({
    ...evidence.values,
    providerPageEvidence,
    operaConnectorError: body.operaConnectorError ?? null,
    operaRetryCount
  });
  return { evidence, decision, providerPageEvidence, runtimeMeta };
}

async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, noticeVersion: NOTICE_VERSION });
  if (pathname === '/api/browser/recovery/schema' && req.method === 'GET') {
    return json(res, 200, {
      contract: 'juss/browser-recovery-evidence@v1',
      requiredBooleans: BROWSER_RECOVERY_BOOLEAN_KEYS,
      grantProviders: BROWSER_PROVIDERS
    });
  }

  if (pathname === '/api/browser/opera/status' && req.method === 'GET') {
    const runtimeEvidence = browserRuntimeEvidenceFromEnv(process.env);
    return json(res, 200, {
      provider: 'opera-mcp',
      configured: Boolean(process.env.OPERA_BRIDGE_URL),
      capabilities: OPERA_CAPABILITIES,
      runtimeEvidence,
      note: 'Plugin installation/permission and live browser-session exposure are separate states.'
    });
  }

  if (pathname === '/api/browser/recovery' && req.method === 'POST') {
    const session = requireSession(req);
    const b = await bodyJson(req);
    if (!b.targetUrl) return json(res, 400, { error: 'targetUrl is required to scope browser recovery state.' });
    const targetOrigin = originOf(b.targetUrl);
    const recoveryState = recoveryStateFor(session.id, targetOrigin);
    const resolved = resolveBrowserRecovery(b, recoveryState.operaRetryCount);
    if (resolved.error) return json(res, resolved.error.status, { error: resolved.error.message, evidence: resolved.evidence });
    const { evidence, decision, providerPageEvidence, runtimeMeta } = resolved;
    const r = await receipt('BROWSER_ROUTE_DECIDED', {
      contract: decision.contract,
      evidenceContract: evidence.contract,
      route: decision.route,
      classification: decision.classification,
      providerPageEvidence,
      evidenceSources: evidence.sources,
      operaHostSnapshot: runtimeMeta.operaHostSnapshot,
      targetOrigin,
      operaRetryCount: recoveryState.operaRetryCount,
      executionAuthorized: decision.executionAuthorized
    });
    return json(res, 200, {
      decision,
      evidence,
      runtimeMeta,
      recoveryState: { operaRetryCount: recoveryState.operaRetryCount, targetOrigin },
      receipt: r
    });
  }

  if (pathname === '/api/auth/session' && req.method === 'POST') {
    let identity;
    let mode;
    let expiresAt;

    if (process.env.NODE_ENV === 'production') {
      const assertion = req.headers['cf-access-jwt-assertion'];
      try {
        identity = await verifyCloudflareAccessJwt(assertion, {
          teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
          audience: process.env.CF_ACCESS_AUD
        });
      } catch (error) {
        return json(res, 401, { error: error.message });
      }
      mode = 'cloudflare-access';
      expiresAt = Math.min(identity.exp * 1000, Date.now() + 8 * 60 * 60_000);
    } else {
      mode = 'dev';
      identity = { sub: 'local-dev' };
      expiresAt = Date.now() + 8 * 60 * 60_000;
    }

    const token = randomBytes(24).toString('base64url');
    const session = { id: randomUUID(), createdAt: Date.now(), expiresAt, mode, identity: { sub: identity.sub, email: identity.email } };
    sessions.set(token, session);
    const r = await receipt('APP_SESSION_CREATED', { mode, subject: identity.sub, expiresAt: new Date(expiresAt).toISOString() });
    return json(res, 201, { token, mode, expiresAt, identity: session.identity, receipt: r });
  }

  if (pathname === '/api/browser/grants' && req.method === 'POST') {
    const session = requireSession(req);
    const b = await bodyJson(req);
    if (b.noticeVersion !== NOTICE_VERSION || b.accepted !== true) return json(res, 400, { error: 'Current browser notice must be accepted.' });
    const origin = originOf(b.targetUrl);
    const allowedScopes = ['browser:read', 'browser:navigate', 'scrape:public'];
    const scopes = [...new Set(Array.isArray(b.scopes) ? b.scopes : [])].filter(x => allowedScopes.includes(x));
    if (!scopes.length) return json(res, 400, { error: 'At least one scope is required.' });
    const hasBrowserScope = scopes.includes('browser:read') || scopes.includes('browser:navigate');
    const providers = [...new Set(Array.isArray(b.providers) ? b.providers : [])].filter(x => BROWSER_PROVIDERS.includes(x));
    if (hasBrowserScope && !providers.length) return json(res, 400, { error: 'At least one explicitly authorized browser provider is required.' });
    if (!hasBrowserScope && providers.length) return json(res, 400, { error: 'Browser providers require a browser scope.' });
    const token = randomBytes(24).toString('base64url');
    const grant = { id: randomUUID(), sessionId: session.id, origin, scopes, providers, createdAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 };
    grants.set(token, grant);
    const r = await receipt('BROWSER_GRANT_CREATED', { grantId: grant.id, origin, scopes, providers, expiresAt: new Date(grant.expiresAt).toISOString() });
    return json(res, 201, { token, grant: { id: grant.id, origin, scopes, providers, expiresAt: grant.expiresAt }, receipt: r });
  }

  if (pathname === '/api/scrape' && req.method === 'POST') {
    const session = requireSession(req);
    const b = await bodyJson(req);
    const origin = originOf(b.url);
    const grant = requireGrant(req, { scope: 'scrape:public', origin, sessionId: session.id });
    const signals = await scrape(b.url);
    const r = await receipt('PUBLIC_SCRAPE_COMPLETED', { grantId: grant.id, origin, url: signals.url });
    return json(res, 200, { signals, receipt: r });
  }

  if (pathname === '/api/analyze' && req.method === 'POST') {
    requireSession(req);
    const b = await bodyJson(req);
    if (!b.signals?.url) return json(res, 400, { error: 'Scrape signals are required.' });
    const plan = heuristicMakeover(b.signals);
    return json(res, 200, { plan, provider: 'local-heuristic', note: 'Swap this adapter for PromptOS/your model router without changing browser authority.' });
  }

  if (pathname === '/api/browser/inspect' && req.method === 'POST') {
    const session = requireSession(req);
    const b = await bodyJson(req);
    const scope = requiredScopeForOperaTool(b.tool);
    if (!b.targetUrl) return json(res, 400, { error: 'targetUrl is required for browser inspection.' });
    const targetOrigin = originOf(b.targetUrl);
    if (b.tool === 'go_to_page') {
      if (!b.args?.url || originOf(b.args.url) !== targetOrigin) return json(res, 400, { error: 'Browser navigation must stay on the granted origin.' });
    }

    const grant = requireGrant(req, { scope, origin: targetOrigin, sessionId: session.id });
    const recoveryState = recoveryStateFor(session.id, targetOrigin);
    const resolved = resolveBrowserRecovery(b, recoveryState.operaRetryCount);
    if (resolved.error) return json(res, resolved.error.status, { error: resolved.error.message, evidence: resolved.evidence });
    const { evidence, decision, providerPageEvidence, runtimeMeta } = resolved;

    const routeReceipt = await receipt('BROWSER_ROUTE_DECIDED', {
      contract: decision.contract,
      evidenceContract: evidence.contract,
      route: decision.route,
      classification: decision.classification,
      providerPageEvidence,
      evidenceSources: evidence.sources,
      operaHostSnapshot: runtimeMeta.operaHostSnapshot,
      grantId: grant.id,
      targetOrigin,
      operaRetryCount: recoveryState.operaRetryCount,
      executionAuthorized: decision.executionAuthorized
    });

    if (decision.classification === 'BLOCKED_CONNECTOR_BRIDGE' && decision.retryOperaBridge) {
      recoveryState.operaRetryCount = 1;
      recoveryState.updatedAt = Date.now();
      const retryReceipt = await receipt('OPERA_REPROBE_BUDGET_CONSUMED', {
        grantId: grant.id,
        targetOrigin,
        operaRetryCount: recoveryState.operaRetryCount
      });
      const decisionAfterAttempt = decideBrowserBridgeRecovery({
        ...evidence.values,
        providerPageEvidence,
        operaConnectorError: b.operaConnectorError ?? null,
        operaRetryCount: recoveryState.operaRetryCount
      });
      return json(res, 409, {
        error: 'Opera connector handshake retry budget consumed; live session is still not exposed.',
        decision: decisionAfterAttempt,
        previousDecision: decision,
        evidence,
        runtimeMeta,
        recoveryState: { operaRetryCount: recoveryState.operaRetryCount, targetOrigin },
        receipts: [routeReceipt, retryReceipt]
      });
    }

    const executableProvider = BROWSER_PROVIDERS.includes(decision.route) ? decision.route : null;
    if (!executableProvider) {
      return json(res, 409, {
        error: `Selected browser route ${decision.route} is not executable as a browser provider.`,
        decision,
        evidence,
        runtimeMeta,
        receipt: routeReceipt
      });
    }

    try {
      requireGrant(req, { scope, origin: targetOrigin, sessionId: session.id, provider: executableProvider });
    } catch (error) {
      return json(res, error.status || 403, {
        error: error.message,
        decision,
        evidence,
        receipt: routeReceipt
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      let result;
      if (executableProvider === 'opera') {
        result = await callOperaBridge({
          bridgeUrl: process.env.OPERA_BRIDGE_URL,
          bridgeToken: process.env.OPERA_BRIDGE_TOKEN,
          tool: b.tool,
          args: b.args,
          expectedOrigin: targetOrigin,
          signal: controller.signal
        });
      } else if (executableProvider === 'authenticated_browser_bridge') {
        result = await callScopedBrowserBridge({
          bridgeUrl: process.env.ALT_AUTH_BROWSER_BRIDGE_URL,
          bridgeToken: process.env.ALT_AUTH_BROWSER_BRIDGE_TOKEN,
          provider: executableProvider,
          tool: b.tool,
          args: b.args,
          expectedOrigin: targetOrigin,
          signal: controller.signal
        });
      } else {
        result = await callScopedBrowserBridge({
          bridgeUrl: process.env.GENERIC_BROWSER_BRIDGE_URL,
          bridgeToken: process.env.GENERIC_BROWSER_BRIDGE_TOKEN,
          provider: executableProvider,
          tool: b.tool,
          args: b.args,
          expectedOrigin: targetOrigin,
          signal: controller.signal
        });
      }

      if (executableProvider === 'opera') recoveryStates.delete(recoveryState.key);
      const callReceipt = await receipt('BROWSER_INSPECT_COMPLETED', {
        grantId: grant.id,
        route: decision.route,
        provider: executableProvider,
        tool: b.tool,
        origin: grant.origin
      });
      return json(res, 200, {
        provider: executableProvider,
        result,
        decision,
        evidence,
        runtimeMeta,
        authority: { source: 'browser-grant', grantId: grant.id, scope, provider: executableProvider },
        receipts: [routeReceipt, callReceipt]
      });
    } finally { clearTimeout(timer); }
  }

  if (pathname === '/api/browser/opera/call' && req.method === 'POST') {
    return json(res, 410, { error: 'Use /api/browser/inspect so recovery evidence and browser authority are evaluated together.' });
  }

  return false;
}

async function staticFile(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const target = normalize(join(PUBLIC, rel));
  if (!target.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden.' });
  try {
    const content = await readFile(target);
    res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    const html = await readFile(join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await api(req, res, url.pathname);
      if (handled === false) json(res, 404, { error: 'Not found.' });
    } else await staticFile(req, res, url.pathname);
  } catch (err) {
    json(res, err.status || 400, { error: err.message || 'Request failed.' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Visual Makeover on http://127.0.0.1:${PORT}`));
