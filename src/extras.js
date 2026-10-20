// OurChat extras: settings (colours, text size, background image, many options), in-app notification banner,
// online / typing, read receipts, Timer-messages and Reminders managers, reminder engine.
import { api, WORKER_URL } from './chat.js';
import { doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = selector => document.querySelector(selector);
const db = api.db;
const toast = message => api.toast(message);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = ms => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const toLocalInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const prettyName = email => { const n = String(email || '').split('@')[0]; return n.charAt(0).toUpperCase() + n.slice(1); };

// ============================================================
// 1) Settings (saved on this device only)
// ============================================================
const SET_KEY = 'ourchat.settings.v3';
const DEFAULTS = {
  fs: 100, font: 'system', bold: false,
  bg: '#10111b', panel: '#171925', accent: '#b8a4ff', text: '#f4f4fb', incoming: '#25283a', mine: '#322d4e', read: '#3fb97f', sent: '#fbe9a1', fail: '#ffb3bb',
  bgDim: 45, bgBlur: 0,
  radius: 16, gap: 13, maxw: 83,
  showTime: true, showExpiry: false, showStatus: false,
  pushPreview: true,
  blockCopy: true, shareOnline: true, shareTyping: true, readReceipts: true
};
const RANGES = { fs: [80, 160], bgDim: [0, 85], bgBlur: [0, 20], radius: [0, 28], gap: [4, 28], maxw: [60, 95] };
const FONTS = {
  system: "Inter,'Segoe UI',Arial,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  mono: "ui-monospace,Consolas,'Courier New',monospace",
  rounded: "'Trebuchet MS','Segoe UI',Arial,sans-serif"
};
const PRESETS = {
  Purple: { accent: '#b8a4ff', bg: '#10111b', panel: '#171925', incoming: '#25283a', mine: '#322d4e' },
  Green: { accent: '#80e4b0', bg: '#0e1714', panel: '#13201b', incoming: '#1f2e28', mine: '#203d35' },
  Blue: { accent: '#8dbaff', bg: '#0e1420', panel: '#141c2b', incoming: '#1f2a3d', mine: '#263652' },
  Rose: { accent: '#ff9ec7', bg: '#1a0f16', panel: '#24141d', incoming: '#34202c', mine: '#4a2538' }
};
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
    if (!saved) { // first run of this version: keep the old colours, but start with the clean message boxes
      saved = JSON.parse(localStorage.getItem('ourchat.settings.v2') || localStorage.getItem('ourchat.look.v1') || '{}') || {};
      delete saved.showStatus; delete saved.showExpiry; delete saved.showActions;
    }
  } catch { saved = {}; }
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const fallback = DEFAULTS[key];
    const value = saved[key];
    if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) { const [lo, hi] = RANGES[key] || [-Infinity, Infinity]; result[key] = Math.min(hi, Math.max(lo, value)); }
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') result[key] = value;
    } else if (key === 'font') {
      if (FONTS[value]) result[key] = value;
    } else if (isHex(value)) result[key] = value;
  }
  return result;
}
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(S)); } catch { /* storage blocked */ } }
function readableText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#15151c' : '#ffffff';
}
let S = loadSettings();

// chat background layer (image + blur + dim), placed behind the chat area
const chatPanel = document.querySelector('.chat-panel');
const chatBg = document.createElement('div');
chatBg.id = 'chatBg';
chatBg.innerHTML = '<div class="bg-img"></div><div class="bg-dim"></div>';
if (chatPanel) chatPanel.insertBefore(chatBg, chatPanel.firstChild);
let bgUrl = '';

function applySettings() {
  const st = document.body.style;
  st.setProperty('--bg', S.bg);
  st.setProperty('--panel-bg', S.panel);
  st.setProperty('--accent', S.accent);
  st.setProperty('--accent2', S.accent);
  st.setProperty('--text', S.text);
  st.setProperty('--bubble', S.incoming);
  st.setProperty('--out', S.mine);
  st.setProperty('--c-read', S.read);
  st.setProperty('--c-sent', S.sent);
  st.setProperty('--c-fail', S.fail);
  st.setProperty('--t-read', readableText(S.read));
  st.setProperty('--t-sent', readableText(S.sent));
  st.setProperty('--t-fail', readableText(S.fail));
  st.setProperty('--fs', String(S.fs / 100));
  st.setProperty('--rad', `${S.radius}px`);
  st.setProperty('--gap', `${S.gap}px`);
  st.setProperty('--maxw', `${S.maxw}%`);
  st.setProperty('--fw', S.bold ? '600' : '400');
  st.fontFamily = FONTS[S.font];
  const classes = document.body.classList;
  classes.toggle('hide-time', !S.showTime);
  classes.toggle('hide-expiry', !S.showExpiry);
  classes.toggle('hide-status', !S.showStatus);
  classes.toggle('no-copy', S.blockCopy);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', S.bg);
  const dim = chatBg.querySelector('.bg-dim');
  const img = chatBg.querySelector('.bg-img');
  if (dim) dim.style.background = `rgba(0,0,0,${S.bgDim / 100})`;
  if (img) img.style.filter = S.bgBlur ? `blur(${S.bgBlur}px)` : 'none';
}

// background image is stored in its own small IndexedDB
const openLookDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('ourchat-look', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('img'); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function lookDbRun(mode, work) {
  const database = await openLookDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('img', mode);
    const request = work(tx.objectStore('img'));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}
function showBgBlob(blob) {
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = blob ? URL.createObjectURL(blob) : '';
  const img = chatBg.querySelector('.bg-img');
  if (img) img.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : 'none';
  chatBg.classList.toggle('on', !!bgUrl);
}
async function restoreBackground() {
  try { const blob = await lookDbRun('readonly', store => store.get('bg')); if (blob) showBgBlob(blob); } catch { /* no saved image */ }
}
applySettings();
restoreBackground();

// the settings window is built from this list
const COLOR_ITEMS = [['accent', 'Accent'], ['bg', 'Background'], ['panel', 'Panels'], ['text', 'Text'], ['incoming', 'Their messages'], ['mine', 'My messages'], ['read', 'Read'], ['sent', 'Sent'], ['fail', 'Not sent']];
const SECTIONS = [
  { title: 'Text', items: [
    { key: 'fs', type: 'range', label: 'Message text size', min: 80, max: 160, step: 5, unit: '%' },
    { key: 'font', type: 'select', label: 'Font', options: [['system', 'Default'], ['serif', 'Serif'], ['mono', 'Typewriter'], ['rounded', 'Rounded']] },
    { key: 'bold', type: 'toggle', label: 'Bold message text' }
  ] },
  { title: 'Colours', custom: 'colours' },
  { title: 'Chat background image', custom: 'background' },
  { title: 'Message boxes', items: [
    { key: 'radius', type: 'range', label: 'Roundness', min: 0, max: 28, step: 1, unit: 'px' },
    { key: 'gap', type: 'range', label: 'Space between messages', min: 4, max: 28, step: 1, unit: 'px' },
    { key: 'maxw', type: 'range', label: 'Maximum width', min: 60, max: 95, step: 1, unit: '%' }
  ] },
  { title: 'Show or hide', items: [
    { key: 'showTime', type: 'toggle', label: 'Message time' },
    { key: 'showStatus', type: 'toggle', label: 'Status words (Sent, Read ...)' },
    { key: 'showExpiry', type: 'toggle', label: 'Disappear time label' }
  ] },
  { title: 'Notifications', items: [
    { key: 'pushPreview', type: 'toggle', label: 'Show message text in phone / PC notifications' },
    { type: 'button', id: 'turnOnNotifications', label: 'Turn on notifications on this device' }
  ] },
  { title: 'Privacy', items: [
    { key: 'blockCopy', type: 'toggle', label: 'Make message text hard to copy' },
    { key: 'shareOnline', type: 'toggle', label: 'Let the other person see my online / last seen' },
    { key: 'shareTyping', type: 'toggle', label: 'Let the other person see when I am typing' },
    { key: 'readReceipts', type: 'toggle', label: 'Tell the other person when I read (turns messages green)' }
  ] }
];
function controlHtml(item) {
  if (item.type === 'range') return `<label class="set-row"><span>${esc(item.label)} <b data-val="${item.key}"></b></span><input type="range" data-key="${item.key}" min="${item.min}" max="${item.max}" step="${item.step}"></label>`;
  if (item.type === 'toggle') return `<label class="set-row"><span>${esc(item.label)}</span><input type="checkbox" data-key="${item.key}"></label>`;
  if (item.type === 'select') return `<label class="set-row"><span>${esc(item.label)}</span><select class="field-select set-select" data-key="${item.key}">${item.options.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join('')}</select></label>`;
  if (item.type === 'button') return `<div class="set-row"><span>${esc(item.label)}</span><button type="button" class="secondary-btn" id="${item.id}">Turn on</button></div>`;
  return '';
}
function sectionHtml(section) {
  let body = '';
  if (section.custom === 'colours') {
    body = `<div class="theme-options look-presets">${Object.keys(PRESETS).map(n => `<button type="button" class="theme-choice" data-preset="${n}"><span class="swatch" style="background:${PRESETS[n].accent}"></span>${n}</button>`).join('')}</div>
      <div class="look-grid">${COLOR_ITEMS.map(([k, l]) => `<label class="look-field"><span>${l}</span><input type="color" data-key="${k}"></label>`).join('')}</div>`;
  } else if (section.custom === 'background') {
    body = `<div class="set-row"><span>Image</span><span class="set-actions"><button type="button" class="secondary-btn" id="bgChoose">Choose image</button><button type="button" class="secondary-btn danger" id="bgRemove">Remove</button></span></div>
      <input type="file" id="bgFile" accept="image/*" hidden>
      ${controlHtml({ key: 'bgDim', type: 'range', label: 'Darken image', min: 0, max: 85, step: 5, unit: '%' })}
      ${controlHtml({ key: 'bgBlur', type: 'range', label: 'Blur image', min: 0, max: 20, step: 1, unit: 'px' })}`;
  } else body = section.items.map(controlHtml).join('');
  return `<details class="set-section"${section.title === 'Text' ? ' open' : ''}><summary>${esc(section.title)}</summary>${body}</details>`;
}
const settingsDialog = document.createElement('dialog');
settingsDialog.id = 'settingsDialog';
settingsDialog.innerHTML = `<form method="dialog">
  <div class="dialog-head"><div><p class="eyebrow">கனவுரை</p><h2>Settings</h2></div><button class="icon-btn" value="close" aria-label="Close">×</button></div>
  <p class="field-help">These settings are saved on this device. Open a section to change it.</p>
  ${SECTIONS.map(sectionHtml).join('')}
  <div class="dialog-actions"><button class="secondary-btn" id="settingsReset" type="button">Reset all</button><button class="primary-btn" value="close">Done</button></div>
</form>`;
document.body.appendChild(settingsDialog);

function syncSettings() {
  settingsDialog.querySelectorAll('[data-key]').forEach(input => {
    const key = input.dataset.key;
    if (input.type === 'checkbox') input.checked = !!S[key];
    else input.value = String(S[key]);
  });
  const units = {};
  SECTIONS.forEach(sec => (sec.items || []).forEach(it => { if (it.type === 'range') units[it.key] = it.unit; }));
  units.bgDim = '%'; units.bgBlur = 'px';
  settingsDialog.querySelectorAll('[data-val]').forEach(b => { b.textContent = `${S[b.dataset.val]}${units[b.dataset.val] || ''}`; });
}
function onSettingChange(input) {
  const key = input.dataset.key;
  if (!key || !(key in DEFAULTS)) return;
  if (input.type === 'checkbox') S[key] = input.checked;
  else if (typeof DEFAULTS[key] === 'number') S[key] = Number(input.value);
  else if (key === 'font') S[key] = FONTS[input.value] ? input.value : 'system';
  else if (isHex(input.value)) S[key] = input.value;
  else return;
  applySettings();
  saveSettings();
  syncSettings();
  if (key === 'shareOnline') { if (S.shareOnline) beat(); else goOffline(true); }
  syncPushPrefs();
}
settingsDialog.addEventListener('input', event => { if (event.target.dataset && event.target.dataset.key) onSettingChange(event.target); });
settingsDialog.addEventListener('change', event => { if (event.target.dataset && event.target.dataset.key) onSettingChange(event.target); });
settingsDialog.addEventListener('click', async event => {
  const preset = event.target.closest('[data-preset]');
  if (preset) { S = { ...S, ...PRESETS[preset.dataset.preset] }; applySettings(); saveSettings(); syncSettings(); return; }
  if (event.target.id === 'turnOnNotifications') { api.enablePush(); return; }
  if (event.target.id === 'bgChoose') { $('#bgFile').click(); return; }
  if (event.target.id === 'bgRemove') { try { await lookDbRun('readwrite', store => store.delete('bg')); } catch { /* ignore */ } showBgBlob(null); toast('Background removed.'); return; }
});
settingsDialog.addEventListener('change', async event => {
  if (event.target.id !== 'bgFile') return;
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const blob = await shrinkImage(file);
    await lookDbRun('readwrite', store => store.put(blob, 'bg'));
    showBgBlob(blob);
    toast('Background set.');
  } catch { toast('Could not use that image. Try a JPG or PNG.'); }
});
$('#settingsReset').addEventListener('click', async () => {
  if (!confirm('Reset all settings (colours, text size, options)? Your background image stays.')) return;
  S = { ...DEFAULTS };
  applySettings(); saveSettings(); syncSettings();
  toast('Settings reset.');
});
// the service worker reads this to decide whether a notification may show the message text
async function syncPushPrefs() {
  try {
    const database = await openDb();
    const tx = database.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ showPreview: S.pushPreview }, 'prefs');
  } catch { /* storage blocked */ }
}
function openSettings() { syncSettings(); settingsDialog.showModal(); }

// make copying text hard (this cannot stop screenshots)
document.addEventListener('copy', event => { if (S.blockCopy && event.target && event.target.closest && event.target.closest('.bubble')) event.preventDefault(); });

// ============================================================
// 2) Online status, typing, read receipts
// ============================================================
const messageInput = $('#messageInput');
let presenceTimer = 0;
let typingTick = 0;
let unsubPresence = null;
let otherPresence = null;
let lastTypingSent = 0;
const markingRead = new Set();
const presenceRef = () => doc(db, 'presence', api.me);
const tsMs = value => (value && typeof value.toMillis === 'function' ? value.toMillis() : 0);

function beat() {
  if (!api.me || !S.shareOnline) return;
  setDoc(presenceRef(), { online: document.visibilityState === 'visible', lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
}
function goOffline(force) {
  if (!api.me || (!S.shareOnline && !force)) return;
  setDoc(presenceRef(), { online: false, lastSeen: serverTimestamp(), typingAt: null }, { merge: true }).catch(() => {});
}
function seenLabel(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}
function updatePresence() {
  if (!api.me) return;
  const p = otherPresence;
  const now = Date.now();
  const seen = tsMs(p && p.lastSeen);
  const online = !!(p && p.online && seen && now - seen < 110000);
  const typing = !!(online && tsMs(p.typingAt) && now - tsMs(p.typingAt) < 5000);
  const label = typing ? 'typing…' : online ? 'Online' : seen ? `Last seen ${seenLabel(seen)}` : 'Offline';
  const line = document.querySelector('.contact p');
  if (line) line.innerHTML = `<span class="presence${online ? '' : ' off'}"></span> <span class="${typing ? 'typing-text' : ''}">${esc(label)}</span> <span class="encrypted">· Only you two</span>`;
  if (api.ui.typing !== typing) { api.ui.typing = typing; api.render(); }
}
function startPresence() {
  beat();
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => { if (document.visibilityState === 'visible') beat(); }, 40000);
  clearInterval(typingTick);
  typingTick = setInterval(updatePresence, 3000);
  if (unsubPresence) unsubPresence();
  unsubPresence = onSnapshot(doc(db, 'presence', api.other), snapshot => {
    otherPresence = snapshot.exists() ? snapshot.data({ serverTimestamps: 'estimate' }) : null;
    updatePresence();
  }, error => console.warn('Presence listen failed', error));
  updatePresence();
  const legends = document.querySelectorAll('.status-legend');
  const words = [['Green', 'Read by the other person'], ['Yellow', 'Sent, not read yet'], ['Red', 'Not sent. Tap Retry']];
  legends.forEach((legend, i) => {
    if (!words[i]) return;
    const b = legend.querySelector('b'); const small = legend.querySelector('small');
    if (b) b.textContent = words[i][0];
    if (small) small.textContent = words[i][1];
  });
}
function stopPresence() {
  clearInterval(presenceTimer);
  clearInterval(typingTick);
  if (unsubPresence) { unsubPresence(); unsubPresence = null; }
  otherPresence = null;
}
api.hooks.start.push(startPresence);
api.hooks.stop.push(stopPresence);

document.addEventListener('visibilitychange', () => { if (!api.me) return; if (document.visibilityState === 'visible') beat(); else goOffline(); });
window.addEventListener('pagehide', goOffline);

messageInput.addEventListener('input', () => {
  if (!api.me || !S.shareTyping || !S.shareOnline) return;
  const has = messageInput.value.trim().length > 0;
  const now = Date.now();
  if (has && now - lastTypingSent > 2500) {
    lastTypingSent = now;
    setDoc(presenceRef(), { typingAt: serverTimestamp(), online: true, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
  } else if (!has && lastTypingSent) {
    lastTypingSent = 0;
    setDoc(presenceRef(), { typingAt: null }, { merge: true }).catch(() => {});
  }
});
$('#composer').addEventListener('submit', () => {
  if (!api.me || !lastTypingSent) return;
  lastTypingSent = 0;
  setDoc(presenceRef(), { typingAt: null }, { merge: true }).catch(() => {});
});

// Read receipts: a message the other person sent is marked read when it is on screen and the app is in front.
api.hooks.render.push(items => {
  if (!S.readReceipts || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const ids = items.filter(m => !m.mine && !m.scheduled && !m.failed && !m.readAtMs && !m.pending && !markingRead.has(m.id)).map(m => m.id);
  if (!ids.length) return;
  const batch = writeBatch(db);
  ids.forEach(id => { markingRead.add(id); batch.update(doc(db, 'messages', id), { readAtMs: Date.now() }); });
  batch.commit().catch(() => ids.forEach(id => markingRead.delete(id)));
});
window.addEventListener('focus', () => { if (api.me) api.render(); });

// ============================================================
// 3) Reminders (stored on this device, delivered by push even when the app is closed)
// ============================================================
function openDb() {
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
async function idbAll() {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const query = database.transaction('reminders').objectStore('reminders').getAll();
    query.onsuccess = () => resolve(query.result);
    query.onerror = () => reject(query.error);
  });
}
async function idbPut(value) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('reminders', 'readwrite');
    tx.objectStore('reminders').put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(id) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('reminders', 'readwrite');
    tx.objectStore('reminders').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function pushToSelf(at) {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;
    const response = await fetch(WORKER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoints: [subscription.endpoint], at }) });
    const data = await response.json();
    return !!(data.queued || (data.result || []).some(r => r.status === 201));
  } catch { return false; }
}
async function saveReminder(text, at, id) {
  const reminder = { id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, at, done: false };
  try { await idbPut(reminder); } catch { toast('Could not save the reminder on this device.'); return; }
  const queued = await pushToSelf(at);
  toast(queued ? `Reminder set for ${fmt(at)}. You will be notified even if the app is closed.` : `Reminder set for ${fmt(at)}. Turn on notifications to get it when the app is closed.`);
}
async function fireReminder(reminder) {
  toast(`⏰ ${reminder.text}`);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification('⏰ கனவுரை reminder', { body: reminder.text, icon: './assets/icon-192.png', badge: './assets/icon-192.png', tag: `reminder-${reminder.id}`, requireInteraction: true });
    }
  } catch { /* notification may be blocked */ }
}
async function checkReminders() {
  let all;
  try { all = await idbAll(); } catch { return; }
  const now = Date.now();
  const grace = api.pushActive ? 120000 : 0; // with push on, the push is the main alert; this is the fallback
  for (const reminder of all) {
    if (reminder.done) { if (now - reminder.at > 7 * 86400000) idbDelete(reminder.id).catch(() => {}); continue; }
    if (now >= reminder.at + grace) { await idbPut({ ...reminder, done: true }).catch(() => {}); fireReminder(reminder); }
  }
}
api.hooks.start.push(() => { checkReminders(); });
setInterval(() => { if (api.me) checkReminders(); }, 15000);
document.addEventListener('visibilitychange', () => { if (api.me && document.visibilityState === 'visible') checkReminders(); });

// ============================================================
// 4) Edit dialog + manager dialog (timer messages and reminders)
// ============================================================
const editDialog = document.createElement('dialog');
editDialog.id = 'editDialog';
editDialog.innerHTML = `<form method="dialog" id="editForm">
  <div class="dialog-head"><div><p class="eyebrow">கனவுரை</p><h2 id="editTitle"></h2></div><button class="icon-btn" value="cancel" aria-label="Close">×</button></div>
  <label class="field-label" for="editText" id="editTextLabel">Message</label>
  <input class="field-input" id="editText" maxlength="500">
  <label class="field-label" for="editAt">Date and time</label>
  <input class="field-input" id="editAt" type="datetime-local">
  <p class="field-help" id="editHelp"></p>
  <div class="dialog-actions"><button class="secondary-btn" value="cancel">Cancel</button><button class="primary-btn" id="editSave" value="ok">Save</button></div>
</form>`;
document.body.appendChild(editDialog);
let editCallback = null;
function openEdit({ title, label, text, at, help, onSave }) {
  $('#editTitle').textContent = title;
  $('#editTextLabel').textContent = label;
  $('#editText').value = text || '';
  const input = $('#editAt');
  input.min = toLocalInput(new Date(Date.now() + 60000));
  input.value = toLocalInput(new Date(at));
  $('#editHelp').textContent = help || '';
  editCallback = onSave;
  editDialog.showModal();
}
$('#editSave').addEventListener('click', event => {
  event.preventDefault();
  const text = $('#editText').value.trim();
  const at = new Date($('#editAt').value).getTime();
  if (!text) { toast('Please type something first.'); return; }
  if (!Number.isFinite(at) || at < Date.now() + 30000) { toast('Pick a time in the future.'); return; }
  const callback = editCallback;
  editDialog.close('ok');
  if (callback) callback(text, at);
});

const manageDialog = document.createElement('dialog');
manageDialog.id = 'manageDialog';
manageDialog.innerHTML = `<form method="dialog">
  <div class="dialog-head"><div><p class="eyebrow">கனவுரை</p><h2 id="manageTitle"></h2></div><button class="icon-btn" value="close" aria-label="Close">×</button></div>
  <div id="manageList" class="manage-list"></div>
  <div class="dialog-actions"><button class="secondary-btn" value="close">Close</button><button class="primary-btn" id="manageNew" type="button">＋ New</button></div>
</form>`;
document.body.appendChild(manageDialog);
let manageMode = 'timer';

async function renderManage() {
  const list = $('#manageList');
  let rows = [];
  if (manageMode === 'timer') {
    $('#manageTitle').textContent = 'Timer messages';
    const now = Date.now();
    rows = api.docs.filter(m => m.senderEmail === api.me && m.visibleAtMs > now).sort((a, b) => a.visibleAtMs - b.visibleAtMs).map(m => ({ id: m.id, text: m.text, at: m.visibleAtMs }));
    $('#manageNew').textContent = '＋ New message';
  } else {
    $('#manageTitle').textContent = 'Reminders';
    try { rows = (await idbAll()).filter(r => !r.done).sort((a, b) => a.at - b.at).map(r => ({ id: r.id, text: r.text, at: r.at })); } catch { rows = []; }
    $('#manageNew').textContent = '＋ New reminder';
  }
  list.innerHTML = rows.length
    ? rows.map(r => `<div class="manage-item"><div class="manage-text"><strong>${esc(r.text.length > 70 ? r.text.slice(0, 70) + '…' : r.text)}</strong><small>${manageMode === 'timer' ? 'Sends' : 'Reminds'} ${esc(fmt(r.at))}</small></div><div class="manage-actions"><button type="button" class="secondary-btn" data-act="edit" data-id="${esc(r.id)}">Edit</button><button type="button" class="secondary-btn danger" data-act="delete" data-id="${esc(r.id)}">Delete</button></div></div>`).join('')
    : `<p class="field-help">${manageMode === 'timer' ? 'No timer messages yet. Type a message and tap Timer to send it at a chosen time.' : 'No reminders yet. Tap New reminder to add one.'}</p>`;
}
function openManage(mode) {
  manageMode = mode;
  renderManage();
  manageDialog.showModal();
}
api.hooks.render.push(() => { if (manageDialog.open && manageMode === 'timer') renderManage(); });

async function saveTimerMessage(id, text, at) {
  const expiresAtMs = Math.min(at + 86400000, api.nextMidnightIST(at));
  try {
    await updateDoc(doc(db, 'messages', id), { text, visibleAtMs: at, expiresAtMs, expiresAt: Timestamp.fromMillis(expiresAtMs) });
    api.notifyOther(at);
    toast('Timer message updated.');
  } catch (error) { toast(`Could not update (${error && error.code ? error.code : 'error'}).`); }
  renderManage();
}
function newReminderDialog(existing) {
  const at = existing ? existing.at : Date.now() + 3600000;
  openEdit({
    title: existing ? 'Edit reminder' : 'New reminder',
    label: 'Reminder',
    text: existing ? existing.text : '',
    at,
    help: 'You get a notification at this time, even if the app is closed (notifications must be on).',
    onSave: async (text, when) => { await saveReminder(text, when, existing && existing.id); if (manageDialog.open) renderManage(); }
  });
}
manageDialog.addEventListener('click', async event => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const id = button.dataset.id;
  if (manageMode === 'timer') {
    const message = api.docs.find(m => m.id === id);
    if (!message) return;
    if (button.dataset.act === 'delete') {
      if (!confirm('Delete this timer message?')) return;
      try { await deleteDoc(doc(db, 'messages', id)); toast('Timer message deleted.'); } catch (error) { toast(`Could not delete (${error && error.code ? error.code : 'error'}).`); }
      renderManage();
    } else {
      openEdit({ title: 'Edit timer message', label: 'Message', text: message.text, at: message.visibleAtMs, help: 'It will be sent at the new time.', onSave: (text, at) => saveTimerMessage(id, text, at) });
    }
  } else {
    let reminder = null;
    try { reminder = (await idbAll()).find(r => r.id === id); } catch { /* ignore */ }
    if (!reminder) return;
    if (button.dataset.act === 'delete') {
      if (!confirm('Delete this reminder?')) return;
      await idbDelete(id).catch(() => {});
      toast('Reminder deleted.');
      renderManage();
    } else newReminderDialog(reminder);
  }
});
$('#manageNew').addEventListener('click', () => {
  if (manageMode === 'reminder') { newReminderDialog(null); return; }
  manageDialog.close();
  toast('Type your message, then tap Timer.');
  messageInput.focus();
});

// ============================================================
// 5) Rewire the old buttons (clone = removes the old handlers)
// ============================================================
function rewire(selector, handler, labelText) {
  const old = $(selector);
  if (!old) return;
  const button = old.cloneNode(true);
  old.replaceWith(button);
  if (labelText) { const span = button.querySelector('span'); if (span) span.textContent = labelText; }
  button.addEventListener('click', handler);
}
rewire('#detailTimer', () => openManage('timer'), 'Timer messages');
rewire('#detailReminder', () => openManage('reminder'), 'Reminders');
rewire('#reminderBtn', () => newReminderDialog(null));
rewire('#remindersNav', () => openManage('reminder'));
rewire('#appearanceBtn', openSettings, 'Settings');
rewire('#settingsNav', openSettings);

// ============================================================
// 6) Small extras: reveal buttons when they are hidden, clear notifications and the app badge when the app is opened
// ============================================================
async function clearNotices() {
  try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch { /* not supported */ }
  try { const database = await openDb(); database.transaction('settings', 'readwrite').objectStore('settings').put(0, 'unread'); } catch { /* ignore */ }
  try {
    const registration = await navigator.serviceWorker.ready;
    (await registration.getNotifications({ tag: 'ourchat-message' })).forEach(n => n.close());
  } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (api.me && document.visibilityState === 'visible') clearNotices(); });
api.hooks.start.push(() => { clearNotices(); syncPushPrefs(); });
syncPushPrefs();

// ============================================================
// 7) Top bar (app name + menu), reply by swiping right, long-press menu (reply / copy / delete)
// ============================================================
const barHost = document.querySelector('.chat-panel');
const topBar = document.createElement('div');
topBar.className = 'app-bar';
topBar.innerHTML = '<span class="app-title">கனவுரை</span><button type="button" class="bar-btn" id="barMenu" aria-label="Menu">⋮</button>';
if (barHost) barHost.insertBefore(topBar, chatBg.nextSibling);

const appMenu = document.createElement('div');
appMenu.id = 'appMenu';
appMenu.hidden = true;
document.body.appendChild(appMenu);
function closeAppMenu() { appMenu.hidden = true; }
function openAppMenu() {
  const privacyOn = !!($('#privacyBtn') && $('#privacyBtn').classList.contains('on'));
  const items = [
    ['⚙', 'Settings', () => openSettings()],
    ['⏰', 'Reminders', () => openManage('reminder')],
    ['◷', 'Timer messages', () => openManage('timer')],
    ['◈', privacyOn ? 'Privacy mode: on' : 'Privacy mode: off', () => { const b = $('#privacyBtn'); if (b) b.click(); }]
  ];
  if (!api.pushActive) items.push(['🔔', 'Turn on notifications', () => api.enablePush()]);
  items.push(['🗑', 'Clear all messages', () => api.clearAll()]);
  items.push(['⎋', 'Sign out', () => api.signOutUser()]);
  appMenu.innerHTML = items.map((item, i) => `<button type="button" data-i="${i}"><i>${item[0]}</i><span>${esc(item[1])}</span></button>`).join('');
  appMenu.onclick = event => {
    const button = event.target.closest('button[data-i]');
    if (!button) return;
    closeAppMenu();
    items[Number(button.dataset.i)][2]();
  };
  appMenu.hidden = false;
}
$('#barMenu').addEventListener('click', event => { event.stopPropagation(); if (appMenu.hidden) openAppMenu(); else closeAppMenu(); });
document.addEventListener('pointerdown', event => { if (!appMenu.hidden && !event.target.closest('#appMenu') && !event.target.closest('#barMenu')) closeAppMenu(); }, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeAppMenu(); closeMsgMenu(); } });

// reply bar above the message box
const composerWrap = document.querySelector('.composer-wrap');
const replyBar = document.createElement('div');
replyBar.id = 'replyBar';
replyBar.hidden = true;
replyBar.innerHTML = '<div class="reply-line"></div><div class="reply-text"><b></b><span></span></div><button type="button" id="replyClose" aria-label="Cancel reply">×</button>';
if (composerWrap) composerWrap.insertBefore(replyBar, $('#composer'));
function renderReply() {
  const reply = api.ui.reply;
  replyBar.hidden = !reply;
  if (!reply) return;
  replyBar.querySelector('b').textContent = reply.from === api.me ? 'You' : prettyName(reply.from);
  replyBar.querySelector('span').textContent = reply.text.length > 120 ? reply.text.slice(0, 120) + '…' : reply.text;
}
api.ui.onReplyChange = renderReply;
function setReply(message) {
  api.ui.reply = { id: message.id, text: message.text, from: message.senderEmail };
  renderReply();
  messageInput.focus();
}
$('#replyClose').addEventListener('click', () => { api.ui.reply = null; renderReply(); });
api.hooks.stop.push(() => { api.ui.reply = null; renderReply(); closeMsgMenu(); closeAppMenu(); });

// long-press menu: Reply, Copy, Delete
const messageList = $('#messages');
const msgMenu = document.createElement('div');
msgMenu.id = 'msgMenu';
msgMenu.hidden = true;
document.body.appendChild(msgMenu);
function closeMsgMenu() {
  msgMenu.hidden = true;
  document.querySelectorAll('.message-row.picked').forEach(row => row.classList.remove('picked'));
}
function openMsgMenu(row) {
  const id = row.dataset.id;
  if (!api.docs.some(m => m.id === id)) return;
  document.querySelectorAll('.message-row.picked').forEach(r => r.classList.remove('picked'));
  row.classList.add('picked');
  msgMenu.dataset.id = id;
  msgMenu.innerHTML = '<button type="button" data-do="reply"><i>↩</i><span>Reply</span></button><button type="button" data-do="copy"><i>⧉</i><span>Copy</span></button><button type="button" data-do="delete" class="danger"><i>🗑</i><span>Delete</span></button>';
  msgMenu.hidden = false;
  const rect = row.querySelector('.bubble').getBoundingClientRect();
  const width = msgMenu.offsetWidth;
  const height = msgMenu.offsetHeight;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  let top = rect.top - height - 8;
  if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8);
  msgMenu.style.left = `${left}px`;
  msgMenu.style.top = `${top}px`;
  if (navigator.vibrate) navigator.vibrate(20);
}
msgMenu.addEventListener('click', async event => {
  const button = event.target.closest('button[data-do]');
  if (!button) return;
  const id = msgMenu.dataset.id;
  const message = api.docs.find(m => m.id === id);
  closeMsgMenu();
  if (!message) return;
  if (button.dataset.do === 'reply') setReply(message);
  else if (button.dataset.do === 'copy') {
    try { await navigator.clipboard.writeText(message.text); toast('Copied.'); } catch { toast('Could not copy.'); }
  } else if (button.dataset.do === 'delete') api.deleteMessage(id);
});
document.addEventListener('pointerdown', event => { if (!msgMenu.hidden && !event.target.closest('#msgMenu')) closeMsgMenu(); }, true);
messageList.addEventListener('scroll', closeMsgMenu);
messageList.addEventListener('contextmenu', event => {
  const row = event.target.closest('.message-row');
  if (row && row.dataset.id) { event.preventDefault(); openMsgMenu(row); }
});

// swipe right on a message = reply; press and hold = menu
let press = null;
function releaseRow(row) {
  row.classList.remove('reply-ready');
  row.style.transition = 'transform .18s';
  row.style.transform = '';
  setTimeout(() => { row.style.transition = ''; }, 220);
}
function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  releaseRow(press.row);
  press = null;
}
messageList.addEventListener('pointerdown', event => {
  if (event.button) return;
  const row = event.target.closest('.message-row');
  if (!row || !row.dataset.id || !event.target.closest('.bubble')) return;
  press = {
    row, x: event.clientX, y: event.clientY, moved: false,
    timer: setTimeout(() => { if (!press) return; const target = press.row; releaseRow(target); press = null; openMsgMenu(target); }, 450)
  };
});
messageList.addEventListener('pointermove', event => {
  if (!press) return;
  const dx = event.clientX - press.x;
  const dy = event.clientY - press.y;
  if (!press.moved && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { cancelPress(); return; }
  if (Math.abs(dx) > 8) { press.moved = true; clearTimeout(press.timer); }
  if (press.moved) {
    press.row.style.transform = `translateX(${Math.max(0, Math.min(dx, 90))}px)`;
    press.row.classList.toggle('reply-ready', dx > 60);
  }
});
messageList.addEventListener('pointerup', event => {
  if (!press) return;
  const { row, moved } = press;
  const dx = event.clientX - press.x;
  clearTimeout(press.timer);
  press = null;
  releaseRow(row);
  if (moved && dx > 60) {
    const message = api.docs.find(m => m.id === row.dataset.id);
    if (message) setReply(message);
  }
});
messageList.addEventListener('pointercancel', cancelPress);

// tap a quoted message to jump to the original
messageList.addEventListener('click', event => {
  const quote = event.target.closest('.reply-quote');
  if (!quote) return;
  const target = messageList.querySelector(`.message-row[data-id="${CSS.escape(quote.dataset.replyId)}"]`);
  if (!target) { toast('The original message is gone.'); return; }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1300);
});
