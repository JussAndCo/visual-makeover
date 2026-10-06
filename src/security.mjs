import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false;
  if (ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (ip.startsWith('169.254.')) return true;
  return false;
}

export async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are allowed.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Local/private targets are blocked.');
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private IP targets are blocked.');
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some(r => isPrivateIp(r.address))) {
    throw new Error('Target resolves to a private or unavailable address.');
  }
  return url;
}

export function originOf(raw) {
  return new URL(raw).origin;
}
