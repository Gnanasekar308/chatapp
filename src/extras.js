// OurChat extras: online / typing, read receipts, look settings, timer-message manager, reminders that work when the app is closed.
import { api, WORKER_URL } from './chat.js';
import { doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = selector => document.querySelector(selector);
const db = api.db;
const toast = message => api.toast(message);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = ms => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const toLocalInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// ============================================================
// 1) Look settings: colours and text size (saved on this device)
// ============================================================
const LOOK_KEY = 'ourchat.look.v1';
const LOOK_DEFAULT = { fs: 100, bg: '#10111b', panel: '#171925', accent: '#b8a4ff', text: '#f4f4fb', incoming: '#25283a', mine: '#322d4e', read: '#3fb97f', sent: '#fbe9a1', fail: '#ffb3bb' };
const PRESETS = {
  Purple: { accent: '#b8a4ff', bg: '#10111b', panel: '#171925', incoming: '#25283a', mine: '#322d4e' },
  Green: { accent: '#80e4b0', bg: '#0e1714', panel: '#13201b', incoming: '#1f2e28', mine: '#203d35' },
  Blue: { accent: '#8dbaff', bg: '#0e1420', panel: '#141c2b', incoming: '#1f2a3d', mine: '#263652' },
  Rose: { accent: '#ff9ec7', bg: '#1a0f16', panel: '#24141d', incoming: '#34202c', mine: '#4a2538' }
};
const COLOR_FIELDS = [['accent', 'Accent'], ['bg', 'Background'], ['panel', 'Panels'], ['text', 'Text'], ['incoming', 'Their messages'], ['mine', 'My messages'], ['read', 'Read'], ['sent', 'Sent'], ['fail', 'Not sent']];
const isHex = v => /^#[0-9a-f]{6}$/i.test(v);

function loadLook() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}'); } catch { saved = {}; }
  const look = { ...LOOK_DEFAULT };
  for (const key of Object.keys(LOOK_DEFAULT)) {
    if (key === 'fs') { const n = Number(saved.fs); if (n >= 80 && n <= 150) look.fs = n; }
    else if (isHex(saved[key])) look[key] = saved[key];
  }
  return look;
}
function saveLook(look) { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* storage blocked */ } }
function readableText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#15151c' : '#ffffff';
}
function applyLook(look) {
  const s = document.body.style;
  s.setProperty('--bg', look.bg);
  s.setProperty('--panel-bg', look.panel);
  s.setProperty('--accent', look.accent);
  s.setProperty('--accent2', look.accent);
  s.setProperty('--text', look.text);
  s.setProperty('--bubble', look.incoming);
  s.setProperty('--out', look.mine);
  s.setProperty('--c-read', look.read);
  s.setProperty('--c-sent', look.sent);
  s.setProperty('--c-fail', look.fail);
  s.setProperty('--t-read', readableText(look.read));
  s.setProperty('--t-sent', readableText(look.sent));
  s.setProperty('--t-fail', readableText(look.fail));
  s.setProperty('--fs', String(look.fs / 100));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', look.bg);
}
let look = loadLook();
applyLook(look);

const lookDialog = document.createElement('dialog');
lookDialog.id = 'lookDialog';
lookDialog.innerHTML = `<form method="dialog">
  <div class="dialog-head"><div><p class="eyebrow">OURCHAT TOOLS</p><h2>App look</h2></div><button class="icon-btn" value="close" aria-label="Close">×</button></div>
  <label class="field-label" for="lookFs">Text size: <b id="fsValue"></b></label>
  <input type="range" id="lookFs" min="80" max="150" step="5" class="look-range">
  <label class="field-label">Quick looks</label>
  <div class="theme-options look-presets" id="lookPresets"></div>
  <label class="field-label">Colours (tap a colour to change it)</label>
  <div class="look-grid" id="lookGrid"></div>
  <div class="dialog-actions"><button class="secondary-btn" id="lookReset" type="button">Reset all</button><button class="primary-btn" value="close">Done</button></div>
</form>`;
document.body.appendChild(lookDialog);

function syncLookDialog() {
  $('#lookFs').value = String(look.fs);
  $('#fsValue').textContent = `${look.fs}%`;
  for (const [key] of COLOR_FIELDS) { const input = lookDialog.querySelector(`input[data-key="${key}"]`); if (input) input.value = look[key]; }
}
$('#lookPresets').innerHTML = Object.keys(PRESETS).map(name => `<button type="button" class="theme-choice" data-preset="${name}"><span class="swatch" style="background:${PRESETS[name].accent}"></span>${name}</button>`).join('');
$('#lookGrid').innerHTML = COLOR_FIELDS.map(([key, label]) => `<label class="look-field"><span>${label}</span><input type="color" data-key="${key}"></label>`).join('');
lookDialog.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'lookFs') { look.fs = Number(input.value); $('#fsValue').textContent = `${look.fs}%`; }
  else if (input.dataset && input.dataset.key && isHex(input.value)) look[input.dataset.key] = input.value;
  else return;
  applyLook(look);
  saveLook(look);
});
lookDialog.addEventListener('click', event => {
  const preset = event.target.closest('[data-preset]');
  if (preset) { look = { ...look, ...PRESETS[preset.dataset.preset] }; applyLook(look); saveLook(look); syncLookDialog(); }
});
$('#lookReset').addEventListener('click', () => { look = { ...LOOK_DEFAULT }; applyLook(look); saveLook(look); syncLookDialog(); toast('Look reset.'); });
function openLook() { syncLookDialog(); lookDialog.showModal(); }

// ============================================================
// 2) Online status, typing, read receipts
// ============================================================
let presenceTimer = 0;
let typingTick = 0;
let unsubPresence = null;
let otherPresence = null;
let lastTypingSent = 0;
const markingRead = new Set();
const presenceRef = () => doc(db, 'presence', api.me);
const tsMs = value => (value && typeof value.toMillis === 'function' ? value.toMillis() : 0);

function beat() {
  if (!api.me) return;
  setDoc(presenceRef(), { online: document.visibilityState === 'visible', lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
}
function goOffline() {
  if (!api.me) return;
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

const messageInput = $('#messageInput');
messageInput.addEventListener('input', () => {
  if (!api.me) return;
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
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
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
    const request = indexedDB.open('ourchat', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('reminders', { keyPath: 'id' }); };
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
      await registration.showNotification('⏰ OurChat reminder', { body: reminder.text, icon: './assets/icon-192.png', badge: './assets/icon-192.png', tag: `reminder-${reminder.id}`, requireInteraction: true });
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
  <div class="dialog-head"><div><p class="eyebrow">OURCHAT TOOLS</p><h2 id="editTitle"></h2></div><button class="icon-btn" value="cancel" aria-label="Close">×</button></div>
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
  <div class="dialog-head"><div><p class="eyebrow">OURCHAT TOOLS</p><h2 id="manageTitle"></h2></div><button class="icon-btn" value="close" aria-label="Close">×</button></div>
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
rewire('#appearanceBtn', openLook, 'Colours and text size');
rewire('#settingsNav', openLook);
