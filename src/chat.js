// OurChat live chat: login, real-time messages, push, scheduled messages, delete, privacy mode.
import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, arrayUnion, arrayRemove, Timestamp, query, orderBy, limit, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ALLOWED = ['gnanasekar308@gmail.com', 'venkathu0637@gmail.com'];
const WORKER_URL = 'https://ourchat-push.gnanasekar308.workers.dev/';
const $ = selector => document.querySelector(selector);
const messagesEl = $('#messages');

// ---------- app-only mode: the chat opens only in the installed app (like WhatsApp), not in a normal browser tab ----------
const IS_APP =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: window-controls-overlay)').matches ||
  window.navigator.standalone === true ||
  document.referrer.startsWith('android-app://') ||
  new URLSearchParams(location.search).get('browser') === '1'; // owner's debug switch

if (!IS_APP) {
  const gate = document.createElement('div');
  gate.id = 'appGate';
  gate.innerHTML = `<div class="gate-card">
    <p class="eyebrow">OURCHAT</p>
    <h2>Open the OurChat app</h2>
    <p class="login-sub">Your chat is private and opens only in the installed app, not in the browser.</p>
    <button class="primary-btn" id="gateInstall" type="button" hidden>Install OurChat</button>
    <p class="gate-done" id="gateDone" hidden>Installed. Close this tab and open <b>OurChat</b> from your Start menu or home screen.</p>
    <div class="gate-steps" id="gateSteps">
      <p><b>PC (Chrome):</b> tap the Install icon at the right end of the address bar, then Install. Later, open OurChat from the Start menu.</p>
      <p><b>Android:</b> Chrome menu ⋮ → Install app. Then open OurChat from the home screen.</p>
      <p><b>iPhone:</b> in Safari tap Share → Add to Home Screen. Then open OurChat from the home screen.</p>
      <p>Already installed? Open it from the Start menu or home screen instead of this tab.</p>
    </div>
  </div>`;
  document.body.appendChild(gate);
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    gate.querySelector('#gateInstall').hidden = false;
  });
  gate.querySelector('#gateInstall').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    gate.querySelector('#gateInstall').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    gate.querySelector('#gateInstall').hidden = true;
    gate.querySelector('#gateSteps').hidden = true;
    gate.querySelector('#gateDone').hidden = false;
  });
}

let me = null;
let other = null;
let unsubscribe = null;
let lastDocs = [];
let nextWake = 0;
let forceBottomUntil = 0; // keep the newest message in view right after the app opens or comes back to the front
let uiReady = false;
let autoPushArmed = false;
let privacy = false;
try { privacy = localStorage.getItem('ourchat-privacy') === '1'; } catch { /* storage blocked */ }
const failed = new Map();
const deleting = new Set();

function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function prettyName(email) {
  const name = email.split('@')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function durationLabel(ms) {
  const hours = Math.round(ms / 3600000);
  if (hours >= 24 && hours % 24 === 0) return hours === 24 ? '24h' : `${hours / 24}d`;
  return `${Math.max(hours, 1)}h`;
}
// Every night at 12 AM India time (IST, UTC+5:30) the chat starts fresh.
const IST_OFFSET = 19800000;
const DAY_MS = 86400000;
function nextMidnightIST(t) {
  return (Math.floor((t + IST_OFFSET) / DAY_MS) + 1) * DAY_MS - IST_OFFSET;
}
function expiryLabel(m, startMs) {
  if ((m.expiresAtMs + IST_OFFSET) % DAY_MS === 0) return '12 AM';
  return durationLabel(m.expiresAtMs - startMs);
}
function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const tomorrow = new Date(Date.now() + 86400000);
  if (date.toDateString() === today.toDateString()) return 'TODAY';
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  if (date.toDateString() === tomorrow.toDateString()) return 'TOMORROW';
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}
function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- login screen ----------
const overlay = document.createElement('div');
overlay.id = 'loginOverlay';
overlay.innerHTML = `<form class="login-card" id="loginForm">
  <p class="eyebrow">OURCHAT</p><h2>Sign in</h2><p class="login-sub">Private space for two people.</p>
  <label class="field-label" for="loginEmail">Email</label>
  <input class="field-input" id="loginEmail" type="email" autocomplete="username" required>
  <label class="field-label" for="loginPassword">Password</label>
  <input class="field-input" id="loginPassword" type="password" autocomplete="current-password" required>
  <p class="login-error" id="loginError" role="alert"></p>
  <button class="primary-btn" id="loginBtn" type="submit">Sign in</button>
</form>`;
document.body.appendChild(overlay);
const loginError = $('#loginError');
const loginBtn = $('#loginBtn');

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (error) {
    const code = error && error.code ? error.code : '';
    loginError.textContent =
      code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' ? 'Email or password is wrong.' :
      code === 'auth/network-request-failed' ? 'No internet connection.' :
      code === 'auth/too-many-requests' ? 'Too many tries. Wait a few minutes and try again.' :
      code === 'auth/unauthorized-domain' ? 'This website address is not allowed in Firebase (Authorized domains).' :
      `Could not sign in (${code || 'unknown error'}).`;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
});

// ---------- schedule dialog (Timer button) ----------
const scheduleDialog = document.createElement('dialog');
scheduleDialog.id = 'scheduleDialog';
scheduleDialog.innerHTML = `<form method="dialog" id="scheduleForm">
  <div class="dialog-head"><div><p class="eyebrow">OURCHAT TOOLS</p><h2>Schedule message</h2></div><button class="icon-btn" value="cancel" aria-label="Close">×</button></div>
  <label class="field-label" for="scheduleAt">Send on</label>
  <input class="field-input" id="scheduleAt" type="datetime-local" required>
  <p class="field-help" id="schedulePreview"></p>
  <p class="field-help">The message appears for the other person at this time and they get a notification.</p>
  <div class="dialog-actions"><button class="secondary-btn" value="cancel">Cancel</button><button class="primary-btn" id="scheduleSave" value="ok">Schedule</button></div>
</form>`;
document.body.appendChild(scheduleDialog);

function openSchedule() {
  if (!me) { toast('Please sign in first.'); return; }
  const text = $('#messageInput').value.trim();
  if (!text) { toast('Type a message first, then tap Timer.'); return; }
  const input = $('#scheduleAt');
  const suggested = new Date(Date.now() + 3600000);
  suggested.setSeconds(0, 0);
  input.min = toLocalInput(new Date(Date.now() + 60000));
  input.value = toLocalInput(suggested);
  $('#schedulePreview').textContent = `Message: “${text.length > 80 ? text.slice(0, 80) + '…' : text}”`;
  scheduleDialog.showModal();
}
$('#scheduleSave').addEventListener('click', event => {
  event.preventDefault();
  const when = new Date($('#scheduleAt').value).getTime();
  if (!Number.isFinite(when) || when < Date.now() + 30000) { toast('Pick a time in the future.'); return; }
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text) { scheduleDialog.close('cancel'); return; }
  scheduleDialog.close('ok');
  input.value = '';
  input.dispatchEvent(new Event('input'));
  send(text, { vis: when });
  toast(`Scheduled for ${new Date(when).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`);
});

// ---------- one-time UI changes after login ----------
function updatePrivacyButton() {
  const button = $('#privacyBtn');
  if (!button) return;
  button.classList.toggle('on', privacy);
  button.querySelector('span').textContent = privacy ? 'Privacy on' : 'Privacy';
}
function setPrivacy(on) {
  privacy = on;
  try { localStorage.setItem('ourchat-privacy', on ? '1' : '0'); } catch { /* storage blocked */ }
  updatePrivacyButton();
  render();
}
function setupUi() {
  const name = prettyName(other);
  const initial = name.charAt(0).toUpperCase();
  $('#contactName').textContent = name;
  $('#detailsName').textContent = name;
  document.querySelectorAll('.contact .avatar, .avatar.large').forEach(el => { el.textContent = initial; });
  const headerLine = document.querySelector('.contact p');
  if (headerLine) headerLine.innerHTML = '<span class="presence"></span> Private chat <span class="encrypted">· Only you two</span>';
  $('#conversationList').innerHTML = `<button class="conversation active"><div class="avatar pink">${escapeHtml(initial)}</div><div class="conversation-copy"><div class="conversation-title"><strong>${escapeHtml(name)}</strong><time></time></div><p id="convPreview">No messages yet</p></div></button>`;
  const filterCount = document.querySelector('.filter.active span');
  if (filterCount) filterCount.textContent = '1';
  const banner = document.querySelector('.security-banner');
  if (banner) {
    const textNode = [...banner.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim().length > 5);
    if (textNode) textNode.nodeValue = ' Messages are deleted every night at 12 AM ';
  }
  const composerNote = document.querySelector('.composer-note');
  if (composerNote) composerNote.textContent = 'Chat clears every night at 12 AM';
  const pill = document.querySelector('.profile-pill');
  if (pill) pill.textContent = '✦ Clears at 12 AM';
  const note = document.querySelector('.demo-note');
  if (note) note.textContent = 'Live chat · Messages sync between you two';
  const mine = document.querySelector('.rail .avatar.tiny');
  if (mine) {
    mine.textContent = prettyName(me).charAt(0).toUpperCase();
    mine.title = 'Sign out';
  }
  if (uiReady) return;
  uiReady = true;
  if (mine) mine.addEventListener('click', () => { if (confirm('Sign out of OurChat?')) signOut(auth); });

  // Timer button now schedules a message (replace the old handler by cloning the button).
  const oldTimer = $('#timerBtn');
  if (oldTimer) {
    const timer = oldTimer.cloneNode(true);
    oldTimer.replaceWith(timer);
    timer.addEventListener('click', openSchedule);
  }
  // Privacy button next to Reminder.
  const reminderBtn = $('#reminderBtn');
  if (reminderBtn && !$('#privacyBtn')) {
    const button = document.createElement('button');
    button.id = 'privacyBtn';
    button.type = 'button';
    button.className = 'tool-btn';
    button.innerHTML = '◈ <span>Privacy</span>';
    button.addEventListener('click', () => setPrivacy(!privacy));
    reminderBtn.insertAdjacentElement('afterend', button);
  }
  updatePrivacyButton();
  // "Clear all messages" in the details panel.
  const appearance = $('#appearanceBtn');
  if (appearance && !$('#clearAllBtn')) {
    const button = document.createElement('button');
    button.id = 'clearAllBtn';
    button.type = 'button';
    button.className = 'detail-action';
    button.innerHTML = '🗑 <span>Clear all messages</span><b>›</b>';
    button.addEventListener('click', clearAll);
    appearance.insertAdjacentElement('afterend', button);
  }
}

// ---------- rendering ----------
function render() {
  const now = Date.now();
  const stick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;
  let items = [];
  nextWake = 0;
  const wake = t => { if (t > now && (!nextWake || t < nextWake)) nextWake = t; };
  for (const m of lastDocs) {
    wake(m.expiresAtMs);
    wake(m.visibleAtMs);
    if (m.expiresAtMs && m.expiresAtMs <= now) continue;
    const mineMsg = m.senderEmail === me;
    const scheduled = m.visibleAtMs > now;
    if (scheduled && !mineMsg) continue; // the other person's scheduled message stays hidden until its time
    items.push({ ...m, mine: mineMsg, scheduled, at: new Date(m.visibleAtMs || m.created.getTime()) });
  }
  for (const [id, f] of failed) {
    if (!lastDocs.some(m => m.id === id)) items.push({ id, text: f.text, senderEmail: me, mine: true, scheduled: false, failed: true, expiresAtMs: f.exp, at: new Date(f.vis || f.at) });
  }
  items.sort((a, b) => a.at - b.at);
  if (privacy) {
    const delivered = items.filter(m => !m.scheduled);
    const lastMine = [...delivered].reverse().find(m => m.mine);
    const lastOther = [...delivered].reverse().find(m => !m.mine);
    items = [lastMine, lastOther].filter(Boolean).sort((a, b) => a.at - b.at);
  }
  messagesEl.innerHTML = '';
  if (privacy) {
    const note = document.createElement('div');
    note.className = 'privacy-note';
    note.textContent = '◈ Privacy on · only your last sent and last received message are shown. Nothing is deleted.';
    messagesEl.appendChild(note);
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'No messages yet. Say hi 👋';
    messagesEl.appendChild(empty);
  }
  let lastDay = '';
  for (const m of items) {
    const label = dayLabel(m.at);
    if (label !== lastDay) {
      lastDay = label;
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.innerHTML = `<span>${escapeHtml(label)}</span>`;
      messagesEl.appendChild(divider);
    }
    const row = document.createElement('div');
    row.className = `message-row ${m.mine ? 'outgoing' : 'incoming'}`;
    const time = m.scheduled
      ? 'Scheduled · ' + m.at.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      : m.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const expiry = m.expiresAtMs ? `<span class="expiry">⌛ ${expiryLabel(m, m.at.getTime())}</span>` : '';
    let status = '';
    if (m.mine) {
      if (m.failed) status = `<span class="status failed">● Not sent</span><button type="button" class="retry-btn" data-id="${escapeHtml(m.id)}">Retry</button>`;
      else if (m.scheduled) status = '<span class="status pending">● Scheduled</span>';
      else if (m.pending) status = '<span class="status pending">● Sending</span>';
      else status = '<span class="status sent">● Sent</span>';
    }
    const del = `<button type="button" class="msg-del" data-id="${escapeHtml(m.id)}" title="Delete" aria-label="Delete message">🗑</button>`;
    row.innerHTML = `<div class="bubble${m.scheduled ? ' scheduled' : ''}"><p>${escapeHtml(m.text)}</p><div class="message-meta"><time>${escapeHtml(time)}</time>${status}${expiry}${del}</div></div>`;
    messagesEl.appendChild(row);
  }
  const preview = $('#convPreview');
  const last = [...items].reverse().find(m => !m.scheduled) || items[items.length - 1];
  if (preview) preview.textContent = privacy ? '◈ Privacy on' : (last ? `${last.mine ? 'You: ' : ''}${last.text}` : 'No messages yet');
  if (stick || Date.now() < forceBottomUntil) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- delete ----------
function cleanupExpired() {
  const now = Date.now();
  for (const m of lastDocs) {
    if (m.pending || !m.expiresAtMs || m.expiresAtMs > now || deleting.has(m.id)) continue;
    deleting.add(m.id);
    deleteDoc(doc(db, 'messages', m.id)).catch(error => {
      console.warn('Delete expired failed', error);
      deleting.delete(m.id);
    });
  }
}
async function deleteMessage(id) {
  if (failed.has(id)) { failed.delete(id); render(); return; }
  if (!confirm('Delete this message for both of you?')) return;
  try {
    await deleteDoc(doc(db, 'messages', id));
  } catch (error) {
    toast(`Could not delete (${error && error.code ? error.code : 'error'}).`);
  }
}
async function clearAll() {
  if (!me) return;
  if (!confirm('Delete ALL messages for both of you? This cannot be undone.')) return;
  try {
    failed.clear();
    const snapshot = await getDocs(collection(db, 'messages'));
    let batch = writeBatch(db);
    let inBatch = 0;
    let total = 0;
    for (const d of snapshot.docs) {
      batch.delete(d.ref);
      inBatch += 1;
      total += 1;
      if (inBatch === 400) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    toast(total ? 'All messages deleted.' : 'No messages to delete.');
  } catch (error) {
    toast(`Could not clear messages (${error && error.code ? error.code : 'error'}).`);
  }
}

// ---------- push notifications ----------
function urlBase64ToUint8Array(value) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function getVapidKey() {
  const response = await fetch(WORKER_URL);
  const data = await response.json();
  if (!data.key) throw new Error('no-key');
  return data.key;
}
function sameKey(subscription, keyBytes) {
  const existing = subscription.options && subscription.options.applicationServerKey;
  if (!existing) return false;
  const a = new Uint8Array(existing);
  return a.length === keyBytes.length && a.every((v, i) => v === keyBytes[i]);
}
async function ensurePush(interactive) {
  if (!me) return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (interactive) toast('Push is not supported here. On iPhone, add the app to the Home Screen first.');
    return false;
  }
  if (Notification.permission === 'denied') {
    if (interactive) toast('Notifications are blocked. Allow them from the lock icon next to the address bar.');
    return false;
  }
  if (Notification.permission !== 'granted') {
    if (!interactive) return false;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('Notification permission was not granted.'); return false; }
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const keyBytes = urlBase64ToUint8Array(await getVapidKey());
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, keyBytes)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    }
    await setDoc(doc(db, 'pushEndpoints', me), { endpoints: arrayUnion(subscription.endpoint), updatedAt: serverTimestamp() }, { merge: true });
    const button = $('#notifyBtn');
    if (button) button.classList.add('hidden');
    if (interactive) toast('Notifications are on for this device.');
    return true;
  } catch (error) {
    console.warn('Enable push failed', error);
    if (interactive) toast(`Could not turn on notifications (${error && error.name ? error.name : 'error'}).`);
    return false;
  }
}
window.ourchatEnablePush = () => ensurePush(true);

// Automatic: silent refresh if already allowed; otherwise ask on the first tap/keypress after login.
function autoPush() {
  ensurePush(false);
  if (autoPushArmed || !('Notification' in window) || Notification.permission !== 'default') return;
  autoPushArmed = true;
  const ask = () => {
    document.removeEventListener('pointerdown', ask);
    document.removeEventListener('keydown', ask);
    autoPushArmed = false;
    ensurePush(true);
  };
  document.addEventListener('pointerdown', ask);
  document.addEventListener('keydown', ask);
}

async function notifyOther(at) {
  try {
    const snapshot = await getDoc(doc(db, 'pushEndpoints', other));
    const endpoints = snapshot.exists() ? (snapshot.data().endpoints || []) : [];
    if (!endpoints.length) return;
    const payload = { endpoints };
    if (at) payload.at = at;
    const response = await fetch(WORKER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    const dead = (data.result || []).filter(r => r.status === 404 || r.status === 410).map(r => r.endpoint);
    if (dead.length) await setDoc(doc(db, 'pushEndpoints', other), { endpoints: arrayRemove(...dead) }, { merge: true });
  } catch (error) {
    console.warn('Push notify failed', error);
  }
}

// ---------- sending ----------
async function send(text, opts = {}) {
  if (!me) { toast('Please sign in first.'); return; }
  const id = opts.id || doc(collection(db, 'messages')).id;
  const vis = opts.vis || 0;
  const expiryMs = window.ourchatGetExpiryMs ? window.ourchatGetExpiryMs() : 86400000;
  const base = vis || Date.now();
  const expiresAtMs = opts.exp || Math.min(base + expiryMs, nextMidnightIST(base));
  failed.delete(id);
  const payload = { text, senderEmail: me, createdAt: serverTimestamp(), expiresAtMs, expiresAt: Timestamp.fromMillis(expiresAtMs) };
  if (vis) payload.visibleAtMs = vis;
  try {
    await setDoc(doc(db, 'messages', id), payload);
    notifyOther(vis);
  } catch (error) {
    console.warn('Send failed', error);
    failed.set(id, { text, exp: expiresAtMs, vis, at: Date.now() });
    render();
    toast(error && error.code === 'permission-denied' ? 'Not allowed by Firestore rules.' : 'Message not sent. Tap Retry.');
  }
}
window.ourchatSend = text => send(text);
messagesEl.addEventListener('click', event => {
  const retry = event.target.closest('.retry-btn');
  if (retry) {
    const f = failed.get(retry.dataset.id);
    if (f) send(f.text, { id: retry.dataset.id, exp: f.exp, vis: f.vis });
    return;
  }
  const del = event.target.closest('.msg-del');
  if (del) deleteMessage(del.dataset.id);
});

// ---------- start / stop ----------
function startChat(email) {
  me = email;
  other = ALLOWED.find(e => e !== email) || email;
  overlay.classList.add('hidden');
  setupUi();
  messagesEl.innerHTML = '<div class="chat-empty">Loading messages…</div>';
  forceBottomUntil = Date.now() + 6000;
  const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(300));
  unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
    lastDocs = snapshot.docs.map(d => {
      const data = d.data({ serverTimestamps: 'estimate' });
      const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date();
      return { id: d.id, text: String(data.text || ''), senderEmail: data.senderEmail, created, visibleAtMs: Number(data.visibleAtMs) || 0, expiresAtMs: Number(data.expiresAtMs) || 0, pending: d.metadata.hasPendingWrites };
    });
    render();
    cleanupExpired();
  }, error => {
    console.warn('Listen failed', error);
    messagesEl.innerHTML = `<div class="chat-empty">Could not load messages (${escapeHtml(error.code || 'error')}).</div>`;
  });
  autoPush();
}
function stopChat() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  me = null; other = null; lastDocs = []; failed.clear();
  messagesEl.innerHTML = '';
  overlay.classList.remove('hidden');
}

onAuthStateChanged(auth, user => {
  if (!IS_APP) return; // in a normal browser tab: never load or show the chat
  if (!user) { stopChat(); return; }
  const email = String(user.email || '').toLowerCase();
  if (!ALLOWED.includes(email)) {
    loginError.textContent = 'This account is not allowed in this chat.';
    signOut(auth);
    return;
  }
  startChat(email);
});

// When the app returns to the front (for example after tapping a notification), show the newest message.
function showLatest() {
  if (!me) return;
  forceBottomUntil = Date.now() + 2500;
  render();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') showLatest(); });
window.addEventListener('focus', showLatest);
window.addEventListener('pageshow', showLatest);

setInterval(() => { if (me) { if (nextWake && nextWake <= Date.now()) render(); cleanupExpired(); } }, 10000);
