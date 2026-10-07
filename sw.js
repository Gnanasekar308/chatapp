const C='ourchat-v6',A=['./','index.html','manifest.json','icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>clients.claim())));
const store=(r,x)=>{const cp=x.clone();caches.open(C).then(c=>c.put(r,cp));return x};
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return; const u=new URL(r.url);
  if(u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/')){ // Firebase SDK: cache-first
    e.respondWith(caches.match(r).then(h=>h||fetch(r).then(x=>store(r,x)))); return }
  if(u.origin!==location.origin)return;
  e.respondWith(caches.match(r).then(h=>{const n=fetch(r).then(x=>store(r,x)).catch(()=>h);return h||n})); // instant open, refresh in background
});
self.addEventListener('push',e=>{e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
  if(cs.some(c=>c.visibilityState==='visible'&&c.focused))return;
  return self.registration.showNotification('Our Chat',{body:'💬 புதிய செய்தி அல்லது அழைப்பு',icon:'icon-192.png',badge:'icon-192.png',tag:'oc',renotify:true});
}))});
self.addEventListener('notificationclick',e=>{e.notification.close();
e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus()}return clients.openWindow('./')}))});
