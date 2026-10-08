// Our Chat — Service Worker v7
const C = 'ourchat-v7';
const A = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(A)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

// வெற்றிகரமான response-ஐ மட்டும் cache-ல் சேமி
const store = (r, x) => {
  if (x && (x.ok || x.type === 'opaque')) {
    const cp = x.clone();
    caches.open(C).then(c => c.put(r, cp));
  }
  return x;
};

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // Firebase SDK: cache-first
  if (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(r).then(h => h || fetch(r).then(x => store(r, x))));
    return;
  }
  if (u.origin !== location.origin) return;

  // உடனே திறக்கும்; பின்னணியில் புதுப்பிக்கும்
  e.respondWith(
    caches.match(r).then(h => {
      const n = fetch(r).then(x => store(r, x)).catch(() => h);
      return h || n;
    })
  );
});

self.addEventListener('push', e => {
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.some(c => c.visibilityState === 'visible' && c.focused)) return;
      return self.registration.showNotification('Our Chat', {
        body: '💬 புதிய செய்தி அல்லது அழைப்பு',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'oc',
        renotify: true,
        vibrate: [200, 100, 200]
      });
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('./');
    })
  );
});
