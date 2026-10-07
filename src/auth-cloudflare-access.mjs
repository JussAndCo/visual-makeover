import { createPublicKey, verify } from 'node:crypto';

const certCache = new Map();
const CLOCK_SKEW_SECONDS = 60;

function b64urlJson(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed Cloudflare Access token.');
  }
}

function issuerFor(teamDomain) {
  if (!teamDomain) throw new Error('CF_ACCESS_TEAM_DOMAIN is required.');
  const raw = teamDomain.startsWith('http://') || teamDomain.startsWith('https://')
    ? teamDomain
    : `https://${teamDomain}`;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Cloudflare Access issuer must use HTTPS.');
  return url.origin;
}

async function jwksFor(issuer, fetchImpl) {
  const cached = certCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Cloudflare Access certs returned ${response.status}.`);
  const body = await response.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new Error('Cloudflare Access certs response contained no keys.');
  certCache.set(issuer, { keys, expiresAt: Date.now() + 5 * 60_000 });
  return keys;
}

function audienceMatches(tokenAudience, expected) {
  if (!expected) throw new Error('CF_ACCESS_AUD is required.');
  const values = Array.isArray(tokenAudience) ? tokenAudience : [tokenAudience];
  return values.includes(expected);
}

export async function verifyCloudflareAccessJwt(jwt, {
  teamDomain,
  audience,
  fetchImpl = fetch,
  nowMs = Date.now()
} = {}) {
  if (!jwt || typeof jwt !== 'string') throw new Error('Cloudflare Access token required.');
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed Cloudflare Access token.');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = b64urlJson(encodedHeader);
  const payload = b64urlJson(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Cloudflare Access token header.');

  const issuer = issuerFor(teamDomain);
  const now = Math.floor(nowMs / 1000);
  if (payload.iss !== issuer) throw new Error('Cloudflare Access token issuer mismatch.');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Cloudflare Access token subject missing.');
  if (!audienceMatches(payload.aud, audience)) throw new Error('Cloudflare Access token audience mismatch.');
  if (!Number.isFinite(payload.exp) || payload.exp <= now - CLOCK_SKEW_SECONDS) throw new Error('Cloudflare Access token expired.');
  if (Number.isFinite(payload.nbf) && payload.nbf > now + CLOCK_SKEW_SECONDS) throw new Error('Cloudflare Access token is not active yet.');

  const keys = await jwksFor(issuer, fetchImpl);
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) throw new Error('Cloudflare Access signing key not found.');

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const signature = Buffer.from(encodedSignature, 'base64url');
  const valid = verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, signature);
  if (!valid) throw new Error('Invalid Cloudflare Access token signature.');

  return {
    sub: payload.sub,
    email: payload.email,
    exp: payload.exp,
    iss: payload.iss,
    aud: payload.aud
  };
}
