import worker from './worker.mjs';
import assert from 'node:assert/strict';
const b64u = b => Buffer.from(b).toString('base64url');
const results=[]; const T=async(n,f)=>{ try{ await f(); results.push('PASS '+n) }catch(e){ results.push('FAIL '+n+' → '+e.message); process.exitCode=1 } };

// --- Firebase-ஐ ஒத்த RSA key + JWKS ---
const rsa = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pubJwk = {...await crypto.subtle.exportKey('jwk',rsa.publicKey), kid:'k1', alg:'RS256', use:'sig'};
const PROJ='our-chat-57278';
async function mkTok(over={}, kid='k1'){
  const h=b64u(JSON.stringify({alg:'RS256',kid,typ:'JWT'}));
  const p=b64u(JSON.stringify({aud:PROJ,iss:'https://securetoken.google.com/'+PROJ,sub:'u1',email:'a@gmail.com',email_verified:true,exp:Math.floor(Date.now()/1000)+3600,name:'ஞானம்',...over}));
  const s=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',rsa.privateKey,new TextEncoder().encode(h+'.'+p));
  return h+'.'+p+'.'+b64u(s);
}

// --- VAPID keys (keygen.html போலவே) ---
const ec = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const ecj = await crypto.subtle.exportKey('jwk',ec.privateKey);
const VPUB = b64u(await crypto.subtle.exportKey('raw',ec.publicKey)), VPRIV = ecj.d;

// --- mock KV ---
const store=new Map();
const SCHED={ async get(k){return store.get(k)??null}, async put(k,v){store.set(k,v)}, async delete(k){store.delete(k)}, async list({prefix='',limit=1000}={}){return {keys:[...store.keys()].filter(k=>k.startsWith(prefix)).sort().slice(0,limit).map(name=>({name}))}} };
const env={VAPID_PRIVATE:VPRIV,VAPID_PUBLIC:VPUB,VAPID_SUBJECT:'mailto:a@gmail.com',MEMBERS:'A@gmail.com, b@gmail.com',ALLOWED_ORIGIN:'https://gnanasekar308.github.io',FIREBASE_PROJECT:PROJ,SCHED,TURN_KEY_ID:'kid',TURN_API_TOKEN:'tok'};

// --- mock network ---
const calls=[]; let pushStatus=201;
globalThis.fetch = async (url,opts={})=>{
  url=String(url); calls.push({url,opts});
  if(url.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({keys:[pubJwk]}));
  if(url.startsWith('https://rtc.live.cloudflare.com/')) return new Response(JSON.stringify({iceServers:{urls:['stun:stun.cloudflare.com:3478','turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:53?transport=udp','turns:turn.cloudflare.com:443?transport=tcp'],username:'u',credential:'c'}}));
  if(url.startsWith('https://fcm.googleapis.com/')) return new Response(null,{status:pushStatus});
  return new Response('?',{status:500});
};
const req=(body,tok,method='POST')=>new Request('https://w.example/',{method,headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:method==='POST'?JSON.stringify(body):undefined});
const FCM='https://fcm.googleapis.com/fcm/send/abc123';

await T('OPTIONS preflight allows authorization + origin',async()=>{
  const r=await worker.fetch(new Request('https://w.example/',{method:'OPTIONS'}),env);
  assert.equal(r.status,204); assert.match(r.headers.get('access-control-allow-headers'),/authorization/); assert.equal(r.headers.get('access-control-allow-origin'),env.ALLOWED_ORIGIN);
});
await T('no token → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'}),env)).status,401) });
await T('garbage token → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'},'a.b.c'),env)).status,401) });
await T('tampered signature → 401',async()=>{ const t=await mkTok(); const bad=t.slice(0,-6)+'AAAAAA'; assert.equal((await worker.fetch(req({action:'turn'},bad),env)).status,401) });
await T('wrong project (aud) → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'},await mkTok({aud:'other'})),env)).status,401) });
await T('expired → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'},await mkTok({exp:1})),env)).status,401) });
await T('unverified email → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'},await mkTok({email_verified:false})),env)).status,401) });
await T('non-member email → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'},await mkTok({email:'evil@gmail.com'})),env)).status,401) });
await T('unknown kid → 401',async()=>{ assert.equal((await worker.fetch(req({action:'turn'},await mkTok({},'zzz')),env)).status,401) });
await T('member (case-insensitive MEMBERS) + Tamil name → turn OK, port 53 removed',async()=>{
  const r=await worker.fetch(req({action:'turn'},await mkTok()),env); assert.equal(r.status,200);
  const j=await r.json(); assert.equal(j.iceServers.length,1); const u=j.iceServers[0].urls;
  assert.ok(u.length===3 && !u.some(x=>/:53/.test(x))); assert.equal(j.iceServers[0].username,'u');
});
await T('status: kv ok, keys match, members=2, turn true',async()=>{
  const j=await (await worker.fetch(req({action:'status'},await mkTok()),env)).json();
  assert.deepEqual([j.ok,j.kv,j.vapidKeysMatch,j.members,j.turn,j.vapidPublic],[true,true,true,2,true,VPUB]);
});
await T('status detects MISMATCHED vapid keys',async()=>{
  const other=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const e2={...env,VAPID_PUBLIC:b64u(await crypto.subtle.exportKey('raw',other.publicKey))};
  // fresh module instance so cached signing key is not reused
  const w2=(await import('./worker.mjs?x=2')).default;
  const j=await (await w2.fetch(req({action:'status'},await mkTok()),e2)).json(); assert.equal(j.vapidKeysMatch,false);
});
await T('immediate push: ALLOW filter + valid VAPID ES256 JWT + 201',async()=>{
  calls.length=0;
  const r=await worker.fetch(req({action:'push',endpoints:[FCM,'https://evil.example/x',42],at:0},await mkTok()),env);
  const j=await r.json(); assert.deepEqual(j.res,[201]);
  const c=calls.find(x=>x.url===FCM); assert.ok(c); const a=c.opts.headers.Authorization; 
  const m=a.match(/^vapid t=([^,]+), k=(.+)$/); assert.ok(m); assert.equal(m[2],VPUB);
  const [h,p,s]=m[1].split('.'); const pay=JSON.parse(Buffer.from(p,'base64url')); 
  assert.equal(pay.aud,'https://fcm.googleapis.com'); assert.equal(pay.sub,'mailto:a@gmail.com'); assert.ok(pay.exp>Date.now()/1000);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},ec.publicKey,Buffer.from(s,'base64url'),new TextEncoder().encode(h+'.'+p)); assert.ok(ok,'JWT signature must verify with public key');
  assert.equal(Buffer.from(s,'base64url').length,64);
  assert.equal(calls.some(x=>x.url.includes('evil.example')),false);
});
await T('dead endpoint status passes through (404)',async()=>{ pushStatus=404; const j=await (await worker.fetch(req({action:'push',endpoints:[FCM]},await mkTok()),env)).json(); assert.deepEqual(j.res,[404]); pushStatus=201 });
await T('scheduled push is queued, not sent now',async()=>{
  calls.length=0; const at=Date.now()+3600e3;
  const j=await (await worker.fetch(req({action:'push',endpoints:[FCM],at},await mkTok()),env)).json();
  assert.equal(j.queued,true); assert.equal(calls.some(x=>x.url===FCM),false); assert.equal([...store.keys()].filter(k=>k.startsWith('q:')).length,1);
});
await T('cron: not-yet-due item stays',async()=>{ calls.length=0; await worker.scheduled({},env); assert.equal(calls.some(x=>x.url===FCM),false); assert.equal(store.size,1) });
await T('cron: due item is sent once and removed',async()=>{
  const at=Date.now()-1000; store.set('q:'+String(at).padStart(14,'0')+':x',JSON.stringify([FCM]));
  calls.length=0; await worker.scheduled({},env); assert.equal(calls.filter(x=>x.url===FCM).length,1); assert.equal(store.size,1);
  calls.length=0; await worker.scheduled({},env); assert.equal(calls.filter(x=>x.url===FCM).length,0);
});
await T('schedule > 30 days rejected; queue full → 429',async()=>{
  let r=await worker.fetch(req({action:'push',endpoints:[FCM],at:Date.now()+40*864e5},await mkTok()),env); assert.equal(r.status,400);
  for(let i=0;i<120;i++) store.set('q:'+String(Date.now()+9e6+i).padStart(14,'0')+':'+i,'[]');
  r=await worker.fetch(req({action:'push',endpoints:[FCM],at:Date.now()+7200e3},await mkTok()),env); assert.equal(r.status,429);
});
await T('no TURN config → empty list (not an error)',async()=>{ const e3={...env}; delete e3.TURN_KEY_ID; const j=await (await worker.fetch(req({action:'turn'},await mkTok()),e3)).json(); assert.deepEqual(j.iceServers,[]) });
await T('JWKS cached (single fetch across many requests)',async()=>{ calls.length=0; await worker.fetch(req({action:'turn'},await mkTok()),env); await worker.fetch(req({action:'turn'},await mkTok()),env); assert.equal(calls.filter(x=>x.url.includes('securetoken')).length,0) });
console.log(results.join('\n'));
