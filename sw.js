'use strict';
const CACHE = 'ourchat-shell-v8';
const ASSETS = [
  './', './index.html', './src/styles.css', './src/chat.css', './src/app.js', './src/chat.js', './src/extras.js', './src/firebase.js',
  './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ourchat-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
// Network first: new versions show up right away; cache is only used when offline.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});

// Reminders are stored on the device in IndexedDB (written by src/extras.js).
function openReminderDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ourchat', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('reminders', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readReminders() {
  const database = await openReminderDb();
  return new Promise((resolve, reject) => {
    const query = database.transaction('reminders').objectStore('reminders').getAll();
    query.onsuccess = () => resolve(query.result);
    query.onerror = () => reject(query.error);
  });
}
async function markReminderDone(reminder) {
  const database = await openReminderDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('reminders', 'readwrite');
    tx.objectStore('reminders').put({ ...reminder, done: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Push: the Worker sends an empty signal. If a reminder on this device is due, show it; otherwise show a generic
// "new message" notification (no message text leaves the app).
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let due = [];
    try { due = (await readReminders()).filter(r => !r.done && r.at <= Date.now() + 30000); } catch (error) { due = []; }
    if (due.length) {
      for (const reminder of due) {
        await self.registration.showNotification('⏰ OurChat reminder', {
          body: reminder.text,
          icon: './assets/icon-192.png',
          badge: './assets/icon-192.png',
          tag: 'reminder-' + reminder.id,
          requireInteraction: true
        });
        try { await markReminderDone(reminder); } catch (error) { /* ignore */ }
      }
      return;
    }
    await self.registration.showNotification('OurChat', {
      body: 'You have a new message',
      icon: './assets/icon-192.png',
      badge: './assets/icon-192.png',
      tag: 'ourchat-message',
      renotify: true
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) { if ('focus' in client) return client.focus(); }
    return clients.openWindow('./');
  })());
});
