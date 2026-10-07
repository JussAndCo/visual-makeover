import { createHash } from 'node:crypto';

export const BROWSER_REALITY_CONTRACT_ID = 'juss/browser-reality@v1';
export const BROWSER_REALITY_CANONICALIZATION = 'juss-browser-reality-canonical-json-v1';

const STATE_ORDER = new Map(['VERIFIED','INFERRED','UNKNOWN','BLOCKED'].map((v,i)=>[v,i]));
const TRACKING = new Set(['dclid','fbclid','gclid','mibextid','msclkid','rdid','share_url']);
const SENSITIVE = new Set([
  'accesstoken','apikey','auth','authorization','clientsecret','code','connectsid','cookie','cookies',
  'credential','credentials','csrftoken','encryptedcontext','idtoken','jsessionid','jwt','key','oauth',
  'oauthtoken','password','phpsessid','refreshtoken','secret','session','sessionid','sid','sig',
  'signature','state','token','xsrftoken'
]);

function normKey(k){ return k.normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g,''); }
function cleanText(v,max){
  if(typeof v!=='string') throw new TypeError('browser reality text must be string');
  const s=v.normalize('NFC').trim().replace(/\s+/gu,' ');
  if(!s || s.length>max) throw new TypeError('browser reality text invalid length');
  return s;
}
function sanitizeUrl(raw,depth=0){
  if(typeof raw!=='string' || !raw || raw.length>4096) throw new TypeError('browser reality URL invalid');
  const u=new URL(raw);
  if(!['http:','https:'].includes(u.protocol)) throw new TypeError('browser reality URL protocol must be http or https');
  const pairs=[];
  for(const [rk,rv] of u.searchParams.entries()){
    const k=rk.normalize('NFC');
    const lower=k.toLowerCase();
    if(lower.startsWith('utm_') || TRACKING.has(lower)) continue;
    let v=rv.normalize('NFC');
    if(SENSITIVE.has(normKey(k))) v='REDACTED';
    else {
      try{
        const nested=new URL(v);
        if(['http:','https:'].includes(nested.protocol)){
          v=depth>=3 ? 'REDACTED_NESTED_URL' : sanitizeUrl(v,depth+1);
        }
      }catch{}
    }
    pairs.push([k,v]);
  }
  pairs.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
  const q=new URLSearchParams();
  for(const [k,v] of pairs) q.append(k,v);
  const host=u.hostname.toLowerCase();
  const renderedHost=host.startsWith('[')?host:host.includes(':')?`[${host}]`:host;
  const port=u.port?`:${u.port}`:'';
  return `${u.protocol.toLowerCase()}//${renderedHost}${port}${u.pathname||'/'}${q.size?`?${q.toString()}`:''}`;
}
function canon(v){
  if(v===null || typeof v==='string' || typeof v==='boolean') return JSON.stringify(v);
  if(typeof v==='number'){
    if(!Number.isFinite(v)) throw new TypeError('non-finite number');
    return JSON.stringify(v);
  }
  if(Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if(v && typeof v==='object'){
    const keys=Object.keys(v).sort();
    return `{${keys.map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  throw new TypeError('unsupported canonical value');
}

export function buildBrowserRealityReceipt(input){
  const allowed=new Set(['contractId','authorizedInputUrl','finalUrl','observedAt','scope','observations','screenshotSha256']);
  const required=['contractId','authorizedInputUrl','finalUrl','observedAt','scope','observations'];
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new TypeError('browser reality input must be object');
  for(const k of required) if(!(k in input)) throw new TypeError(`${k} is required`);
  for(const k of Object.keys(input)) if(!allowed.has(k)) throw new TypeError(`${k} is not allowed`);
  if(input.contractId!==BROWSER_REALITY_CONTRACT_ID) throw new TypeError(`contractId must be ${BROWSER_REALITY_CONTRACT_ID}`);
  const observed=new Date(input.observedAt);
  if(Number.isNaN(observed.valueOf())) throw new TypeError('observedAt invalid');
  if(!Array.isArray(input.observations) || input.observations.length<1 || input.observations.length>64) throw new TypeError('observations invalid');
  const observations=input.observations.map(o=>{
    if(!o || Object.keys(o).sort().join(',')!=='state,statement') throw new TypeError('observation fields invalid');
    if(!STATE_ORDER.has(o.state)) throw new TypeError('observation state invalid');
    return {state:o.state,statement:cleanText(o.statement,1000)};
  }).sort((a,b)=>STATE_ORDER.get(a.state)-STATE_ORDER.get(b.state) || (a.statement<b.statement?-1:a.statement>b.statement?1:0))
    .filter((o,i,a)=>i===0 || o.state!==a[i-1].state || o.statement!==a[i-1].statement);
  const receipt={
    contractId:BROWSER_REALITY_CONTRACT_ID,
    authorizedInputUrl:sanitizeUrl(input.authorizedInputUrl),
    finalUrl:sanitizeUrl(input.finalUrl),
    observedAt:observed.toISOString(),
    scope:cleanText(input.scope,160),
    observations
  };
  if('screenshotSha256' in input){
    if(typeof input.screenshotSha256!=='string' || !/^[a-f0-9]{64}$/i.test(input.screenshotSha256)) throw new TypeError('screenshotSha256 invalid');
    receipt.screenshotSha256=input.screenshotSha256.toLowerCase();
  }
  return receipt;
}

export function fingerprintBrowserRealityEvidence(input){
  const receipt=buildBrowserRealityReceipt(input);
  const canonicalJson=canon(receipt);
  const sha256=createHash('sha256').update(canonicalJson,'utf8').digest('hex');
  return Object.freeze({receipt,canonicalJson,sha256});
}
