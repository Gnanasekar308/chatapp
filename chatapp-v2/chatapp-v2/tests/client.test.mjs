import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const html=fs.readFileSync('/mnt/user-data/outputs/chatapp-v2/1-GITHUB-upload/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
const results=[]; const T=async(n,f)=>{ try{ await f(); results.push('PASS '+n) }catch(e){ results.push('FAIL '+n+' → '+(e.stack||e.message).split('\n').slice(0,3).join(' | ')); process.exitCode=1 } };
const tick=()=>new Promise(r=>setTimeout(r,5)); const flush=async(n=8)=>{ for(let i=0;i<n;i++) await tick() };

// ---------- fake DOM ----------
class El{
  constructor(tag,id){ this.tag=tag; this.id=id||''; this.style={}; this.children=[]; this._t=''; this.value=''; this.checked=false; this.dataset={}; this.className=''; this.handlers={}; this.scrollTop=0; this.scrollHeight=1000; this.clientHeight=500; this.srcObject=null }
  get textContent(){ return this._t+this.children.map(c=>c.textContent||c.text||'').join('') }
  set textContent(v){ this._t=String(v); this.children=[] }
  get firstChild(){ return this.children[0]||null }
  appendChild(c){ this.children.push(c); return c } append(...cs){ cs.forEach(c=>this.children.push(typeof c==='string'?{text:c}:c)) }
  addEventListener(t,f){ (this.handlers[t]??=[]).push(f) } focus(){} click(){ this.onclick&&this.onclick({stopPropagation(){},target:this}) }
  all(){ return [this,...this.children.flatMap(c=>c.all?c.all():[])] }
}
const els=new Proxy({},{get:(t,k)=>typeof k==='string'?document.getElementById(k):undefined}); const _els={}; 
const document={ getElementById:id=>{ if(!ids.has(id)) throw new Error('HTML-ல் id இல்லை: '+id); return _els[id]??=new El('x',id) },
  createElement:t=>new El(t), createTextNode:t=>({text:t,textContent:t}), addEventListener(){}, visibilityState:'visible' };
const ls=new Map(); const alerts=[]; const timers=[]; const fetches=[]; const dbLog=[]; const snaps={}; const sentFetchTokens=[];
// ---------- fake Firestore ----------
const TSc=ms=>({ms,toMillis:()=>ms});
const DB={ // path -> data for get()
  'rooms/main':{}, 'rooms/main/subs':[{id:'a@x.com',data:{eps:['https://fcm.googleapis.com/fcm/send/MY']}},{id:'b@x.com',data:{eps:['https://fcm.googleapis.com/fcm/send/OTHER']}}] };
function docRef(path){ return { path,
  get:async o=>{ dbLog.push(['get',path,o]); if(globalThis.__denyRoom&&path==='rooms/main') {const e=new Error('denied');e.code='permission-denied';throw e}
    const sub=path.split('/'); const parent=sub.slice(0,-1).join('/'); const arr=DB[parent]; const hit=Array.isArray(arr)&&arr.find(x=>x.id===sub.at(-1)); return {exists:true,data:()=>hit?hit.data:(DB[path]||{})} },
  set:async(d,o)=>{ dbLog.push(['set',path,d,o]) }, update:async d=>{ dbLog.push(['update',path,d]) }, delete:async()=>{ dbLog.push(['delete',path]) },
  onSnapshot:cb=>{ snaps[path]=cb; return()=>{ delete snaps[path] } }, collection:n=>collRef(path+'/'+n) } }
function collRef(path){ const q={ path,
  add:async d=>{ dbLog.push(['add',path,d]); return {id:'new'} }, doc:id=>docRef(path+'/'+id),
  get:async()=>{ dbLog.push(['getColl',path]); const docs=(DB[path]||[]).map(x=>({id:x.id,data:()=>x.data})); return {empty:!docs.length,docs,forEach:f=>docs.forEach(f)} },
  where:(...a)=>{ const w=collRef(path); w.get=async()=>({empty:true,docs:[],forEach(){}}); w.onSnapshot=cb=>{ snaps[path+'?'+a.join(',')]=cb; return()=>{} }; return w },
  orderBy:()=>q, limitToLast:()=>q, limit:()=>q, onSnapshot:cb=>{ snaps[path]=cb; return()=>{} } }; return q }
const firestore=()=>({ settings(){}, enablePersistence:async()=>{}, collection:n=>({doc:id=>docRef(n+'/'+id)}), batch:()=>({delete(){},commit:async()=>{}}) });
firestore.FieldValue={serverTimestamp:()=>'SRV',arrayUnion:v=>({union:v}),arrayRemove:v=>({remove:v})};
firestore.Timestamp={now:()=>TSc(Date.now()),fromMillis:TSc};
// ---------- fake auth ----------
let authCb=null; const authLog=[]; let curUser=null;
const authObj={ onAuthStateChanged:cb=>{authCb=cb}, setPersistence:async p=>{authLog.push(['persist',p])}, signInWithPopup:async()=>{authLog.push(['popup'])},
  signInWithEmailAndPassword:async(e,k)=>{authLog.push(['email',e,k])}, signOut:async()=>{authLog.push(['signOut'])}, get currentUser(){ return curUser } };
const auth=()=>authObj; auth.EmailAuthProvider={credential:(e,p)=>({e,p})}; auth.Auth={Persistence:{LOCAL:'LOCAL',SESSION:'SESSION'}}; auth.GoogleAuthProvider=class{ setCustomParameters(){} };
// ---------- WebRTC / media fakes ----------
const track=kind=>({kind,enabled:true,stop(){}}); 
const fakeStream={getTracks:()=>[track('audio'),track('video')],getAudioTracks:()=>[track('audio')],getVideoTracks:()=>[track('video')]};
class PC{ constructor(c){ this.cfg=c; this.remoteDescription=null; PC.last=this } addTrack(){} async createOffer(){return{type:'offer',sdp:'o'}} async createAnswer(){return{type:'answer',sdp:'a'}}
  async setLocalDescription(){} async setRemoteDescription(d){this.remoteDescription=d} async addIceCandidate(){} close(){} }
const sandbox={ document, console, setTimeout:(f,ms)=>{timers.push(['t',f,ms]);return timers.length}, clearTimeout(){}, setInterval:(f,ms)=>{timers.push(['i',f,ms]);return timers.length}, clearInterval(){},
  localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v))}, alert:m=>alerts.push(m), confirm:()=>true,
  navigator:{onLine:true,vibrate(){},clipboard:{writeText:async()=>{}},mediaDevices:{getUserMedia:async()=>fakeStream},
    serviceWorker:{controller:{},register:async()=>{},addEventListener(){},ready:Promise.resolve({pushManager:{getSubscription:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/MY'}),subscribe:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/MY'})}})}},
  Notification:{permission:'granted',requestPermission:async()=>'granted'}, firebase:{initializeApp(){},auth,firestore},
  crypto:globalThis.crypto, TextEncoder, btoa, atob, Uint8Array, Date, Math, JSON, Promise, Object, Array, Number, String, URL, Error, RegExp,
  RTCPeerConnection:PC, AudioContext:class{ constructor(){this.state='running';this.currentTime=0;this.destination={}} createOscillator(){return{frequency:{},connect(){},start(){},stop(){}}} createGain(){return{gain:{},connect(){}}} resume(){} },
  Image:class{}, URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}}, location:{reload(){}},
  fetch:async(u,o)=>{ fetches.push({u,o}); const b=JSON.parse(o.body); 
    if(b.action==='status') return {status:200,json:async()=>({ok:true,kv:true,vapidKeysMatch:true,vapidPublic:'V'.repeat(87),members:2,turn:true})};
    if(b.action==='turn') return {status:200,json:async()=>({iceServers:[{urls:['turn:t:3478'],username:'u',credential:'c'}]})};
    return {status:200,json:async()=>({res:b.endpoints.map(()=>201)})} } };
sandbox.window=sandbox; sandbox.window.PushManager=function(){}; sandbox.window.addEventListener=()=>{}; sandbox.self=sandbox;
vm.createContext(sandbox);
const user={uid:'u-me',email:'a@x.com',displayName:'Gnana Sekar',providerData:[{providerId:'google.com'},{providerId:'password'}],getIdToken:async()=>'ID.TOKEN.X'};
const run=c=>vm.runInContext(c,sandbox);
// VAPID_PUB placeholder-ஐ சோதனைக்கு 87-எழுத்து மதிப்பாக்கு
const testScript=script.replace('PASTE_NEW_VAPID_PUBLIC_KEY_HERE','V'.repeat(87));

await T('script loads with no error; every $("id") exists in HTML',async()=>{ vm.runInContext(testScript,sandbox) });
await T('every id used in JS exists (static)',async()=>{ const used=new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1])); const miss=[...used].filter(i=>!ids.has(i)); assert.deepEqual(miss,[]) });
await T('startup: persistence set, auth listener registered',async()=>{ assert.ok(authCb); assert.ok(authLog.some(l=>l[0]==='persist')) });
await T('signed-out → login form shown',async()=>{ await authCb(null); assert.equal(els.lf.style.display,'flex') });
await T('non-member (permission-denied) → blocked + signed out',async()=>{ globalThis.__denyRoom=true; curUser=user; await authCb(user); await flush(); globalThis.__denyRoom=false;
  assert.match(els.err.textContent,/அனுமதி இல்லை/); assert.ok(authLog.some(l=>l[0]==='signOut')); assert.notEqual(els.chat.style.display,'flex') });
await T('member with password → chat opens; listeners attached',async()=>{ authLog.length=0; await authCb(user); await flush();
  assert.equal(els.chat.style.display,'flex'); assert.ok(snaps['rooms/main']); assert.ok(snaps['rooms/main/messages']); assert.ok(snaps['rooms/main/calls/current']) });
await T('member WITHOUT password → set-password screen (not chat)',async()=>{ /* separate quick check on gate logic */
  const nopw={...user,providerData:[{providerId:'google.com'}]}; const before=els.sp.style.display; await authCb(nopw); await flush(); assert.equal(els.sp.style.display,'flex'); assert.match(els.spt.textContent,/8/) });

const now=Date.now(); const D=(o)=>({id:o.id,data:()=>({uid:o.uid,name:o.name||'Subasri',text:o.text??'',img:o.img,reply:o.reply,sched:o.sched,ts:TSc(o.ms)}),metadata:{hasPendingWrites:!!o.pending}});
await T('messages render: text, image, reply quote, hides expired + other\'s future scheduled',async()=>{
  const docs=[ D({id:'1',uid:'u-o',text:'பழையது',ms:now-26*3600e3}), D({id:'2',uid:'u-o',text:'வணக்கம்',ms:now-60000}),
    D({id:'3',uid:'u-o',text:'',img:'data:image/jpeg;base64,AAAA',ms:now-50000}), D({id:'4',uid:'u-me',text:'பதில்',ms:now-40000,reply:{n:'Subasri',t:'வணக்கம்'}}),
    D({id:'5',uid:'u-o',text:'ரகசியம்',ms:now+3600e3,sched:true}), D({id:'6',uid:'u-me',text:'என் schedule',ms:now+3600e3,sched:true}), D({id:'7',uid:'u-me',text:'pending',ms:now-1000,pending:true}) ];
  snaps['rooms/main/messages']({docs}); const box=els.msgs; const texts=box.all().map(e=>e.textContent).join('|');
  assert.ok(!texts.includes('பழையது'),'expired hidden'); assert.ok(!texts.includes('ரகசியம்'),"other's future msg hidden"); assert.ok(texts.includes('வணக்கம்')); assert.ok(texts.includes('என் schedule'));
  const msgs=box.children.filter(c=>c.className.startsWith('m')); assert.equal(msgs.length,5);
  assert.ok(box.all().some(e=>e.tag==='img'&&e.src.startsWith('data:image/')),'image rendered'); assert.ok(box.all().some(e=>e.className==='rq'),'reply quote rendered');
  assert.equal(ls.get('cache3_u-me').includes('AAAA'),false,'image data not cached in localStorage') });
await T('seen: ✓ → ✓✓ when other has seen; typing indicator shows',async()=>{
  const ticks=()=>els.msgs.all().filter(e=>e.className.startsWith('tk'));
  assert.ok(ticks().length>0 && ticks().every(t=>!t.className.includes('seen')));
  snaps['rooms/main']({data:()=>({seen:{'u-o':now,'u-me':1},typing:{'u-o':Date.now()}})}); 
  assert.ok(ticks().some(t=>t.className.includes('seen')&&t.textContent==='✓✓')); assert.match(els.sub.textContent,/தட்டச்சு/);
  snaps['rooms/main']({data:()=>({seen:{'u-o':now},typing:{'u-o':Date.now()-20000}})}); timers.filter(t=>t[0]==='i'&&t[2]===2000).forEach(t=>t[1]()); assert.equal(els.sub.textContent,'private chat') });
await T('marks other\'s messages as seen (writes seen.<uid>)',async()=>{ assert.ok(dbLog.some(l=>l[0]==='set'&&l[1]==='rooms/main'&&l[2].seen&&l[2].seen['u-me']>0)) });
await T('send: doc has uid/name/text/ts/exp(+24h); push pinged with Bearer token & OTHER endpoint only',async()=>{
  dbLog.length=0; fetches.length=0; els.t.value='  வணக்கம் டா  '; els.s.onclick(); await flush();
  const add=dbLog.find(l=>l[0]==='add'&&l[1]==='rooms/main/messages'); assert.ok(add); const d=add[2];
  assert.equal(d.uid,'u-me'); assert.equal(d.name,'Gnana'); assert.equal(d.text,'வணக்கம் டா'); assert.equal(d.ts,'SRV'); assert.ok(Math.abs(d.exp.ms-(Date.now()+864e5))<5000);
  assert.equal(els.t.value,''); const f=fetches.at(-1); assert.equal(f.o.headers.authorization,'Bearer ID.TOKEN.X'); const b=JSON.parse(f.o.body); assert.deepEqual(b.endpoints,['https://fcm.googleapis.com/fcm/send/OTHER']); assert.equal(b.action,'push');
  assert.ok(dbLog.some(l=>l[0]==='set'&&l[2].typing&&l[2].typing['u-me']===0),'typing cleared') });
await T('empty message is not sent',async()=>{ dbLog.length=0; els.t.value='   '; els.s.onclick(); await flush(); assert.equal(dbLog.some(l=>l[0]==='add'),false) });
await T('tap message → sheet; reply bar; reply is attached to next message and cleared',async()=>{
  const m=els.msgs.children.find(c=>c.className.startsWith('m')&&c.textContent.includes('வணக்கம்')&&!c.className.includes('me')); m.onclick(); assert.equal(els.act.style.display,'flex'); assert.equal(els.adel.style.display,'none','no delete on other\'s msg');
  els.arp.onclick(); assert.equal(els.rp.style.display,'flex'); dbLog.length=0; els.t.value='சரி'; els.s.onclick(); await flush();
  const d=dbLog.find(l=>l[0]==='add')[2]; assert.deepEqual([d.reply.n,d.reply.t],['Subasri','வணக்கம்']); assert.equal(els.rp.style.display,'none') });
await T('own message → delete button; delete calls Firestore delete',async()=>{
  const m=els.msgs.children.find(c=>c.className.includes('me')&&c.textContent.includes('பதில்')); m.onclick(); assert.equal(els.adel.style.display,'block'); dbLog.length=0; els.adel.onclick(); await flush();
  assert.ok(dbLog.some(l=>l[0]==='delete'&&l[1]==='rooms/main/messages/4')) });
await T('schedule: future time → doc.sched + ts in future + exp = at+24h + ping(at)',async()=>{
  els.t.value='நாளை பார்க்கலாம்'; els.sc.onclick(); assert.equal(els.sch.style.display,'flex'); const at=Date.now()+2*3600e3; 
  const dt=new Date(at); dt.setMinutes(dt.getMinutes()-dt.getTimezoneOffset()); els.sdt.value=dt.toISOString().slice(0,16); dbLog.length=0; fetches.length=0; els.sok.onclick(); await flush();
  const d=dbLog.find(l=>l[0]==='add')[2]; assert.equal(d.sched,true); assert.ok(d.ts.ms>Date.now()+3600e3); assert.ok(Math.abs(d.exp.ms-(d.ts.ms+864e5))<10); assert.ok(JSON.parse(fetches.at(-1).o.body).at>Date.now()) });
await T('past schedule time rejected',async()=>{ alerts.length=0; els.t.value='x'; els.sdt.value='2020-01-01T10:00'; dbLog.length=0; els.sok.onclick(); assert.ok(alerts.length&&!dbLog.some(l=>l[0]==='add')) });
await T('typing: input event throttled to 1 write / 3s',async()=>{ dbLog.length=0; const h=els.t.handlers.input; h.forEach(f=>f()); h.forEach(f=>f()); await flush(); assert.equal(dbLog.filter(l=>l[0]==='set'&&l[2].typing&&l[2].typing['u-me']>0).length,1) });
await T('image: oversize guard + post() with img',async()=>{ dbLog.length=0; run("post({img:'data:image/jpeg;base64,QQ==',text:''})"); await flush(); const d=dbLog.find(l=>l[0]==='add')[2]; assert.equal(d.img,'data:image/jpeg;base64,QQ=='); assert.equal(d.text,'') });
await T('push: dead (404/410) endpoints get removed from subs',async()=>{ sandbox.fetch=async(u,o)=>({status:200,json:async()=>({res:[410]})}); dbLog.length=0; await run("ping(0)"); await flush();
  assert.ok(dbLog.some(l=>l[0]==='update'&&l[1]==='rooms/main/subs/b@x.com'&&l[2].eps.remove)) });
await T('🩺 diagnostics: all green with healthy worker',async()=>{ sandbox.fetch=async(u,o)=>{ fetches.push({u,o}); const b=JSON.parse(o.body); return b.action==='status'?{status:200,json:async()=>({ok:true,kv:true,vapidKeysMatch:true,vapidPublic:'V'.repeat(87),members:2,turn:true})}:{status:200,json:async()=>({res:[201]})} };
  els.dg.onclick(); await flush(30); const out=els.dgo.textContent; assert.match(out,/🎉/,out); assert.ok(!out.includes('❌'),out) });
await T('🩺 diagnostics: 401 from worker is explained',async()=>{ sandbox.fetch=async()=>({status:401,json:async()=>({error:'unauthorized'})}); els.dg.onclick(); await flush(30); assert.match(els.dgo.textContent,/401/); assert.match(els.dgo.textContent,/MEMBERS/) });
await T('🩺 test push button → 201 success message',async()=>{ sandbox.fetch=async()=>({status:200,json:async()=>({res:[201]})}); alerts.length=0; await els.dgt.onclick(); assert.match(alerts.at(-1),/201/) });
await T('call: offer is written with TURN servers from worker; no-answer timeout armed',async()=>{
  sandbox.fetch=async(u,o)=>{ const b=JSON.parse(o.body); return b.action==='turn'?{status:200,json:async()=>({iceServers:[{urls:['turn:t:3478'],username:'u',credential:'c'}]})}:{status:200,json:async()=>({res:[201]})} };
  dbLog.length=0; await els.call.onclick(); await flush(); const s=dbLog.find(l=>l[0]==='set'&&l[1]==='rooms/main/calls/current'); assert.ok(s); assert.equal(s[2].offer.type,'offer'); assert.equal(s[2].fromName,'Gnana');
  assert.ok(PC.last.cfg.iceServers.some(x=>x.credential==='c'),'TURN passed to RTCPeerConnection'); assert.equal(els.vid.style.display,'flex') });
await T('call: answer arrives → remote description set; hang up deletes call doc',async()=>{
  snaps['rooms/main/calls/current']({data:()=>({callId:'1',from:'u-me',answer:{type:'answer',sdp:'a'}})}); await flush(); assert.ok(PC.last.remoteDescription);
  dbLog.length=0; els.hang.onclick(); await flush(); assert.ok(dbLog.some(l=>l[0]==='delete'&&l[1]==='rooms/main/calls/current')); assert.equal(els.vid.style.display,'none') });
await T('incoming call: banner + ring; accept writes answer; stale (>60s) call ignored',async()=>{
  els.inc.style.display='none'; snaps['rooms/main/calls/current']({data:()=>({callId:String(Date.now()-120000),from:'u-o',fromName:'Subasri',offer:{type:'offer',sdp:'o'},answer:null})}); assert.notEqual(els.inc.style.display,'flex','stale ignored');
  snaps['rooms/main/calls/current']({data:()=>({callId:String(Date.now()),from:'u-o',fromName:'Subasri',offer:{type:'offer',sdp:'o'},answer:null})}); assert.equal(els.inc.style.display,'flex'); assert.match(els.who.textContent,/Subasri/);
  dbLog.length=0; await els.acc.onclick(); await flush(); const u=dbLog.find(l=>l[0]==='update'&&l[1]==='rooms/main/calls/current'); assert.ok(u&&u[2].answer.type==='answer'); assert.equal(els.inc.style.display,'none') });
await T('call ends when other side deletes the call doc',async()=>{ snaps['rooms/main/calls/current']({data:()=>undefined}); await flush(); assert.equal(els.vid.style.display,'none') });
await T('login: email+password → PBKDF2-derived key (not raw password) sent to Firebase',async()=>{ authLog.length=0; els.em.value='A@X.com'; els.pw.value='mysecret99'; els.rm.checked=true; await els.pl.onclick(); await flush();
  const l=authLog.find(x=>x[0]==='email'); assert.equal(l[1],'a@x.com'); assert.ok(l[2].length>=40&&!l[2].includes('mysecret')); assert.ok(authLog.some(x=>x[0]==='persist'&&x[1]==='LOCAL')) });
await T('set-password enforces min 8 and match',async()=>{ run("spMode='link'"); els.p1.value='short'; els.p2.value='short'; await els.ps.onclick(); assert.match(els.err.textContent,/8/); els.p1.value='longenough1'; els.p2.value='different11'; await els.ps.onclick(); assert.match(els.err.textContent,/ஒன்றாக/) });
await T('Tamil UI text for friendly errors',async()=>{ assert.match(run("niceErr('auth/too-many-requests')"),/அதிக/) });
console.log(results.join('\n')); process.exit(process.exitCode||0);
