'use strict';
const CACHE = 'ourchat-shell-v10';
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
    const request = indexedDB.open('ourchat', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('reminders')) request.result.createObjectStore('reminders', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
    };
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

async function readPref(key) {
  try {
    const database = await openReminderDb();
    return await new Promise((resolve, reject) => {
      const query = database.transaction('settings').objectStore('settings').get(key);
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
  } catch (error) { return undefined; }
}
async function writePref(key, value) {
  const database = await openReminderDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function appIsInFront() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return list.some(client => client.visibilityState === 'visible' && client.focused);
}
function setBadge(count) {
  try { if (self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge(count).catch(() => {}); } catch (error) { /* not supported */ }
}

// Push. Two kinds:
//  1) with data {t: sender name, b: message text}: show "Name" + text (the text can be hidden with a setting on this device).
//     Several messages become "Name (3)". Nothing is shown while the app itself is open in front.
//  2) empty: a reminder on this device if one is due, otherwise a generic "new message" notification.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = null;
    try { data = event.data ? event.data.json() : null; } catch (error) { data = null; }
    const icons = { icon: './assets/icon-192.png', badge: './assets/icon-192.png' };

    if (data && data.t) {
      if (await appIsInFront()) return;
      const prefs = (await readPref('prefs')) || {};
      // unread messages since the app was last opened (the app resets this to 0 when it opens)
      const count = (Number(await readPref('unread')) || 0) + 1;
      try { await writePref('unread', count); } catch (error) { /* ignore */ }
      await self.registration.showNotification(count > 1 ? data.t + ' (' + count + ' messages)' : data.t, {
        body: prefs.showPreview === false ? 'New message' : String(data.b || 'New message'),
        tag: 'ourchat-message',
        renotify: true,
        data: { count },
        ...icons
      });
      setBadge(count);
      return;
    }

    let due = [];
    try { due = (await readReminders()).filter(r => !r.done && r.at <= Date.now() + 30000); } catch (error) { due = []; }
    if (due.length) {
      for (const reminder of due) {
        await self.registration.showNotification('⏰ கனவுரை reminder', { body: reminder.text, tag: 'reminder-' + reminder.id, requireInteraction: true, ...icons });
        try { await markReminderDone(reminder); } catch (error) { /* ignore */ }
      }
      return;
    }
    if (await appIsInFront()) return;
    await self.registration.showNotification('கனவுரை', { body: 'You have a new message', tag: 'ourchat-message', renotify: true, ...icons });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  try { if (self.navigator && self.navigator.clearAppBadge) self.navigator.clearAppBadge(); } catch (error) { /* ignore */ }
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) { if ('focus' in client) return client.focus(); }
    return clients.openWindow('./');
  })());
});
