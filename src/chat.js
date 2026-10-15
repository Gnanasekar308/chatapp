// OurChat live chat: Firebase login + real-time messages for the two allowed people.
import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { collection, doc, setDoc, deleteDoc, Timestamp, query, orderBy, limit, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ALLOWED = ['gnanasekar308@gmail.com', 'venkathu0637@gmail.com'];
const $ = selector => document.querySelector(selector);
const messagesEl = $('#messages');
let me = null;
let other = null;
let unsubscribe = null;
let lastDocs = [];
let nextExpiry = 0;
let uiReady = false;
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
function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'TODAY';
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
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

// ---------- one-time UI changes after login ----------
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
  const note = document.querySelector('.demo-note');
  if (note) note.textContent = 'Live chat · Messages sync between you two';
  const mine = document.querySelector('.rail .avatar.tiny');
  if (mine) {
    mine.textContent = prettyName(me).charAt(0).toUpperCase();
    mine.title = 'Sign out';
    if (!uiReady) mine.addEventListener('click', () => { if (confirm('Sign out of OurChat?')) signOut(auth); });
  }
  uiReady = true;
}

// ---------- rendering ----------
function render() {
  const now = Date.now();
  const stick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;
  const items = lastDocs.filter(m => !(m.expiresAtMs && m.expiresAtMs <= now));
  for (const [id, f] of failed) {
    if (!lastDocs.some(m => m.id === id)) items.push({ id, text: f.text, senderEmail: me, date: new Date(f.at), expiresAtMs: f.exp, failed: true });
  }
  nextExpiry = items.reduce((min, m) => (m.expiresAtMs && (!min || m.expiresAtMs < min) ? m.expiresAtMs : min), 0);
  messagesEl.innerHTML = '';
  if (!items.length) {
    messagesEl.innerHTML = '<div class="chat-empty">No messages yet. Say hi 👋</div>';
  }
  let lastDay = '';
  for (const m of items) {
    const label = dayLabel(m.date);
    if (label !== lastDay) {
      lastDay = label;
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.innerHTML = `<span>${escapeHtml(label)}</span>`;
      messagesEl.appendChild(divider);
    }
    const mineMsg = m.senderEmail === me;
    const row = document.createElement('div');
    row.className = `message-row ${mineMsg ? 'outgoing' : 'incoming'}`;
    const time = m.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const expiry = m.expiresAtMs ? `<span class="expiry">⌛ ${durationLabel(m.expiresAtMs - m.date.getTime())}</span>` : '';
    let status = '';
    if (mineMsg) {
      if (m.failed) status = `<span class="status failed">● Not sent</span><button type="button" class="retry-btn" data-id="${escapeHtml(m.id)}">Retry</button>`;
      else if (m.pending) status = '<span class="status pending">● Sending</span>';
      else status = '<span class="status sent">● Sent</span>';
    }
    row.innerHTML = `<div class="bubble"><p>${escapeHtml(m.text)}</p><div class="message-meta"><time>${escapeHtml(time)}</time>${status}${expiry}</div></div>`;
    messagesEl.appendChild(row);
  }
  const preview = $('#convPreview');
  const last = items[items.length - 1];
  if (preview) preview.textContent = last ? `${last.senderEmail === me ? 'You: ' : ''}${last.text}` : 'No messages yet';
  if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- delete expired messages from the database ----------
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

// ---------- sending ----------
async function send(text, existing) {
  if (!me) { toast('Please sign in first.'); return; }
  const id = existing ? existing.id : doc(collection(db, 'messages')).id;
  const expiresAtMs = existing ? existing.exp : Date.now() + (window.ourchatGetExpiryMs ? window.ourchatGetExpiryMs() : 86400000);
  failed.delete(id);
  try {
    await setDoc(doc(db, 'messages', id), { text, senderEmail: me, createdAt: serverTimestamp(), expiresAtMs, expiresAt: Timestamp.fromMillis(expiresAtMs) });
  } catch (error) {
    console.warn('Send failed', error);
    failed.set(id, { text, exp: expiresAtMs, at: Date.now() });
    render();
    toast(error && error.code === 'permission-denied' ? 'Not allowed by Firestore rules.' : 'Message not sent. Tap Retry.');
  }
}
window.ourchatSend = text => send(text);
messagesEl.addEventListener('click', event => {
  const button = event.target.closest('.retry-btn');
  if (!button) return;
  const f = failed.get(button.dataset.id);
  if (f) send(f.text, { id: button.dataset.id, exp: f.exp });
});

// ---------- start / stop ----------
function startChat(email) {
  me = email;
  other = ALLOWED.find(e => e !== email) || email;
  overlay.classList.add('hidden');
  setupUi();
  messagesEl.innerHTML = '<div class="chat-empty">Loading messages…</div>';
  const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(300));
  unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
    lastDocs = snapshot.docs.map(d => {
      const data = d.data({ serverTimestamps: 'estimate' });
      const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date();
      return { id: d.id, text: String(data.text || ''), senderEmail: data.senderEmail, date: created, expiresAtMs: Number(data.expiresAtMs) || 0, pending: d.metadata.hasPendingWrites };
    }).reverse();
    render();
    cleanupExpired();
  }, error => {
    console.warn('Listen failed', error);
    messagesEl.innerHTML = `<div class="chat-empty">Could not load messages (${escapeHtml(error.code || 'error')}).</div>`;
  });
}
function stopChat() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  me = null; other = null; lastDocs = []; failed.clear();
  messagesEl.innerHTML = '';
  overlay.classList.remove('hidden');
}

onAuthStateChanged(auth, user => {
  if (!user) { stopChat(); return; }
  const email = String(user.email || '').toLowerCase();
  if (!ALLOWED.includes(email)) {
    loginError.textContent = 'This account is not allowed in this chat.';
    signOut(auth);
    return;
  }
  startChat(email);
});

setInterval(() => { if (nextExpiry && nextExpiry <= Date.now()) render(); cleanupExpired(); }, 10000);
