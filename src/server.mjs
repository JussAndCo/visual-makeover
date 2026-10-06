import http from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertPublicUrl, originOf } from './security.mjs';
import { callOperaBridge, requiredScopeForOperaTool, OPERA_CAPABILITIES } from './browser/opera-provider.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('..', import.meta.url)), '..'));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const NOTICE_VERSION = '2026-10-06.v1';
const MAX_BODY = 64 * 1024;
const MAX_SCRAPE_BYTES = 1_500_000;
const sessions = new Map();
const grants = new Map();

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
  if (!session) throw Object.assign(new Error('Sign in required.'), { status: 401 });
  return session;
}

function requireGrant(req, { scope, origin }) {
  const token = req.headers['x-browser-grant'];
  const grant = token && grants.get(token);
  if (!grant || grant.expiresAt < Date.now()) throw Object.assign(new Error('Browser grant required or expired.'), { status: 403 });
  if (!grant.scopes.includes(scope)) throw Object.assign(new Error(`Grant lacks ${scope}.`), { status: 403 });
  if (origin && grant.origin !== origin) throw Object.assign(new Error('Grant is scoped to another origin.'), { status: 403 });
  return grant;
}

async function receipt(event, detail = {}) {
  const row = { id: randomUUID(), at: new Date().toISOString(), event, ...detail };
  try { await appendFile(join(ROOT, 'data', 'receipts.jsonl'), JSON.stringify(row) + '\n'); } catch {}
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
  if (signals.colors.length > 8) recommendations.push({ priority: 'medium', area: 'palette', change: 'Collapse the palette into 3–5 semantic tokens and reserve accent colors for actions.' });
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

async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, noticeVersion: NOTICE_VERSION });
  if (pathname === '/api/browser/opera/status' && req.method === 'GET') return json(res, 200, { provider: 'opera-mcp', configured: Boolean(process.env.OPERA_BRIDGE_URL), capabilities: OPERA_CAPABILITIES });

  if (pathname === '/api/auth/dev-sign-in' && req.method === 'POST') {
    if (process.env.NODE_ENV === 'production') return json(res, 404, { error: 'Not found.' });
    const token = randomBytes(24).toString('base64url');
    sessions.set(token, { id: randomUUID(), createdAt: Date.now(), mode: 'dev' });
    await receipt('APP_SESSION_CREATED', { mode: 'dev' });
    return json(res, 201, { token, mode: 'dev', warning: 'Development-only sign-in. Replace with your real identity provider before production.' });
  }

  if (pathname === '/api/browser/grants' && req.method === 'POST') {
    const session = requireSession(req);
    const b = await bodyJson(req);
    if (b.noticeVersion !== NOTICE_VERSION || b.accepted !== true) return json(res, 400, { error: 'Current browser notice must be accepted.' });
    const origin = originOf(b.targetUrl);
    const allowedScopes = ['browser:read', 'browser:navigate', 'scrape:public', 'export:makeover'];
    const scopes = [...new Set(Array.isArray(b.scopes) ? b.scopes : [])].filter(x => allowedScopes.includes(x));
    if (!scopes.length) return json(res, 400, { error: 'At least one scope is required.' });
    const token = randomBytes(24).toString('base64url');
    const grant = { id: randomUUID(), sessionId: session.id, origin, scopes, createdAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 };
    grants.set(token, grant);
    const r = await receipt('BROWSER_GRANT_CREATED', { grantId: grant.id, origin, scopes, expiresAt: new Date(grant.expiresAt).toISOString() });
    return json(res, 201, { token, grant: { id: grant.id, origin, scopes, expiresAt: grant.expiresAt }, receipt: r });
  }

  if (pathname === '/api/scrape' && req.method === 'POST') {
    requireSession(req);
    const b = await bodyJson(req);
    const origin = originOf(b.url);
    const grant = requireGrant(req, { scope: 'scrape:public', origin });
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

  if (pathname === '/api/browser/opera/call' && req.method === 'POST') {
    requireSession(req);
    const b = await bodyJson(req);
    const scope = requiredScopeForOperaTool(b.tool);
    const targetOrigin = b.targetUrl ? originOf(b.targetUrl) : undefined;
    const grant = requireGrant(req, { scope, origin: targetOrigin });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await callOperaBridge({ bridgeUrl: process.env.OPERA_BRIDGE_URL, bridgeToken: process.env.OPERA_BRIDGE_TOKEN, tool: b.toool, args: b.args, signal: controller.signal });
      const r = await receipt('OPERA_CALL_COMPLETED', { grantId: grant.id, tool: b.tool, origin: grant.origin });
      return json(res, 200, { result, receipt: r });
    } finally { clearTimeout(timer); }
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
