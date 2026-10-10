/* OurChat front-end prototype. Messages are local to this browser until Firebase is connected. */
'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const messages = $('#messages');
const composer = $('#composer');
const input = $('#messageInput');
const dialog = $('#actionDialog');
const dialogBody = $('#dialogBody');
const STORAGE_KEYS = { reminders: 'ourchat.reminders.v1', theme: 'ourchat.theme.v1' };
let action = 'timer';
let currentTheme = safeStorageGet(STORAGE_KEYS.theme) || 'default';
let draftTheme = currentTheme;
let toastTimer = null;
let currentExpiryMs = 24 * 60 * 60 * 1000;
const messageExpiryTimers = new WeakMap();
const reminderTimers = new Map();

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeStorageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* storage may be disabled */ }
}
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function timeLabel(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function expiryLabel(ms) {
  if (ms === 60 * 60 * 1000) return '1h';
  if (ms === 6 * 60 * 60 * 1000) return '6h';
  if (ms === 24 * 60 * 60 * 1000) return '24h';
  if (ms === 7 * 24 * 60 * 60 * 1000) return '7d';
  return `${Math.round(ms / 60000)}m`;
}
function removeAfterExpiry(row, expiresAt) {
  const oldTimer = messageExpiryTimers.get(row);
  if (oldTimer) clearTimeout(oldTimer);
  row.dataset.expiresAt = String(expiresAt);
  const remaining = Math.max(0, expiresAt - Date.now());
  if (remaining === 0) { row.remove(); return; }
  // Long browser timers are capped; check again if the expiry is farther away.
  messageExpiryTimers.set(row, setTimeout(() => {
    if (Date.now() < expiresAt) removeAfterExpiry(row, expiresAt);
    else { row.remove(); toast('Demo message expired on this device.'); }
  }, Math.min(remaining, 2147480000)));
}
function addMessage(text, status = 'sent', scheduledAt = null) {
  const row = document.createElement('div');
  row.className = 'message-row outgoing';
  const statusText = status === 'sent' ? 'Sent' : status === 'pending' ? 'Sending' : 'Not sent';
  const stamp = scheduledAt
    ? `Scheduled · ${new Date(scheduledAt).toLocaleString([], { hour: 'numeric', minute: '2-digit' })}`
    : timeLabel();
  row.innerHTML = `<div class="bubble ${scheduledAt ? 'scheduled' : ''}"><p>${escapeHtml(text)}</p><div class="message-meta"><time>${escapeHtml(stamp)}</time><span class="status ${status}">● ${statusText}</span><span class="expiry">⌛ ${expiryLabel(currentExpiryMs)}</span></div></div>`;
  const statusEl = $('.status', row);
  if (!scheduledAt) {
    statusEl.classList.remove('sent');
    statusEl.classList.add('pending');
    statusEl.textContent = '● Sending (demo)';
    setTimeout(() => {
      if (!statusEl.isConnected) return;
      statusEl.classList.remove('pending');
      statusEl.classList.add('sent');
      statusEl.textContent = '● Sent (demo)';
      statusEl.title = 'Local demo only; not delivered to another user';
    }, 550);
  }
  const createdAt = Date.now();
  row.dataset.createdAt = String(createdAt);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  removeAfterExpiry(row, createdAt + currentExpiryMs);
}
function openDialog(type) {
  action = type;
  const title = $('#dialogTitle');
  const save = $('#dialogSave');
  save.textContent = type === 'appearance' ? 'Apply look' : 'Save';
  if (type === 'timer') {
    title.textContent = 'Set a message timer';
    dialogBody.innerHTML = `<label class="field-label" for="timerMinutes">Disappear after</label><select id="timerMinutes" class="field-select"><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440" selected>24 hours</option><option value="10080">7 days</option></select><p class="field-help">This is a local preview timer. Real deletion for every participant needs server-side expiry handling.</p>`;
  } else if (type === 'reminder') {
    title.textContent = 'Create a reminder';
    dialogBody.innerHTML = `<label class="field-label" for="reminderText">Reminder</label><input class="field-input" id="reminderText" maxlength="160" placeholder="e.g. Send Mira the photos" required><label class="field-label" for="reminderAt">Remind me at</label><input class="field-input" id="reminderAt" type="datetime-local" required><p class="field-help">Reminders are saved in this browser and trigger while this app is open. Background delivery while closed needs push-service setup.</p>`;
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    $('#reminderAt').value = date.toISOString().slice(0, 16);
    $('#reminderAt').min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } else if (type === 'appearance') {
    draftTheme = currentTheme;
    title.textContent = 'Choose your app look';
    dialogBody.innerHTML = `<p class="field-help">Choose a visual theme. Browser rules may prevent changing the installed app icon dynamically.</p><div class="theme-options"><button type="button" class="theme-choice ${draftTheme === 'default' ? 'selected' : ''}" data-theme="default"><span class="swatch"></span>OurChat</button><button type="button" class="theme-choice ${draftTheme === 'calculator' ? 'selected' : ''}" data-theme="calculator"><span class="swatch"></span>Calculator</button><button type="button" class="theme-choice ${draftTheme === 'clock' ? 'selected' : ''}" data-theme="clock"><span class="swatch"></span>Clock</button></div>`;
    $$('.theme-choice', dialogBody).forEach(button => button.addEventListener('click', () => {
      $$('.theme-choice', dialogBody).forEach(item => item.classList.remove('selected'));
      button.classList.add('selected');
      draftTheme = button.dataset.theme;
    }));
  } else if (type === 'call') {
    title.textContent = 'Calls are not connected yet';
    dialogBody.innerHTML = '<p class="field-help">Live calling is not implemented in this prototype. It needs WebRTC, signaling, camera/microphone permissions and usually a TURN server.</p>';
    save.textContent = 'Got it';
  } else if (type === 'expiry') {
    title.textContent = 'About disappearing messages';
    dialogBody.innerHTML = '<p class="field-help">This preview removes outgoing demo messages from this screen only. Production deletion needs server-enforced expiry and cleanup. It cannot erase screenshots or copies already saved by recipients.</p>';
    save.textContent = 'Understood';
  } else if (type === 'newchat') {
    title.textContent = 'Start a conversation';
    dialogBody.innerHTML = '<label class="field-label" for="newContact">Username or phone number</label><input class="field-input" id="newContact" maxlength="120" placeholder="Search a person" required><p class="field-help">Contact lookup will work after user authentication and profiles are connected.</p>';
  }
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else toast('Your browser does not support this dialog. Please use a modern browser.');
}
function initializeExistingMessageExpiry() {
  // Static sample messages start their local preview lifetime when this page is opened.
  $$('.message-row').forEach(row => {
    const bubble = $('.bubble', row);
    if (!bubble || bubble.classList.contains('scheduled')) return;
    const createdAt = Number(row.dataset.createdAt || Date.now());
    row.dataset.createdAt = String(createdAt);
    const expiry = $('.expiry', bubble);
    if (expiry) expiry.textContent = `⌛ ${expiryLabel(currentExpiryMs)}`;
    removeAfterExpiry(row, createdAt + currentExpiryMs);
  });
}
function loadReminders() {
  try {
    const parsed = JSON.parse(safeStorageGet(STORAGE_KEYS.reminders) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string' && Number.isFinite(item.at) && !item.done) : [];
  } catch { return []; }
}
function saveReminders(reminders) {
  return safeStorageSet(STORAGE_KEYS.reminders, JSON.stringify(reminders));
}
function notifyReminder(reminder) {
  toast(`Reminder: ${reminder.text}`);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('OurChat reminder', { body: reminder.text, tag: `ourchat-reminder-${reminder.id}` }); } catch { /* notification may be blocked */ }
  }
}
function scheduleReminder(reminder) {
  const old = reminderTimers.get(reminder.id);
  if (old) clearTimeout(old);
  const remaining = reminder.at - Date.now();
  if (remaining <= 0) {
    const reminders = loadReminders().filter(item => item.id !== reminder.id);
    saveReminders(reminders);
    reminderTimers.delete(reminder.id);
    notifyReminder(reminder);
    return;
  }
  reminderTimers.set(reminder.id, setTimeout(() => {
    if (Date.now() < reminder.at) scheduleReminder(reminder);
    else {
      const reminders = loadReminders().filter(item => item.id !== reminder.id);
      saveReminders(reminders);
      reminderTimers.delete(reminder.id);
      notifyReminder(reminder);
    }
  }, Math.min(remaining, 2147480000)));
}
function restoreReminders() {
  const now = Date.now();
  const due = [];
  const upcoming = [];
  for (const reminder of loadReminders()) {
    if (reminder.at <= now) due.push(reminder);
    else upcoming.push(reminder);
  }
  saveReminders(upcoming);
  due.forEach(notifyReminder);
  upcoming.forEach(scheduleReminder);
}

$('#timerBtn').addEventListener('click', () => openDialog('timer'));
$('#detailTimer').addEventListener('click', () => openDialog('timer'));
$('#reminderBtn').addEventListener('click', () => openDialog('reminder'));
$('#detailReminder').addEventListener('click', () => openDialog('reminder'));
$('#appearanceBtn').addEventListener('click', () => openDialog('appearance'));
$('#settingsNav').addEventListener('click', () => openDialog('appearance'));
$('#newChatBtn').addEventListener('click', () => openDialog('newchat'));
$('#audioCall').addEventListener('click', () => openDialog('call'));
$('#videoCall').addEventListener('click', () => openDialog('call'));
$('#learnExpiry').addEventListener('click', () => openDialog('expiry'));
$('#detailsBtn').addEventListener('click', () => $('#detailsPanel').classList.toggle('open'));
$('#closeDetails').addEventListener('click', () => $('#detailsPanel').classList.remove('open'));
$('#remindersNav').addEventListener('click', () => {
  const reminders = loadReminders().sort((a, b) => a.at - b.at);
  if (!reminders.length) toast('No upcoming reminders saved on this device.');
  else toast(`${reminders.length} upcoming reminder${reminders.length === 1 ? '' : 's'}: ${reminders.slice(0, 2).map(item => item.text).join('; ')}`);
});
$('#notifyBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('This browser does not support notifications.'); return; }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      toast('Notifications enabled for this browser.');
      try { new Notification('OurChat notifications enabled', { body: 'Reminders can show browser notifications while this app is active.' }); } catch { /* some browsers restrict constructor */ }
    } else toast('Notification permission was not granted.');
  } catch { toast('Could not request notification permission in this context. Use HTTPS or localhost.'); }
});
$('#emojiBtn').addEventListener('click', () => { input.value += ' ✨'; input.focus(); });
$('#attachBtn').addEventListener('click', () => toast('Attachments are not implemented in this prototype.'));
composer.addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  addMessage(text);
  input.value = '';
  input.style.height = 'auto';
});
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 100)}px`; });
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (typeof composer.requestSubmit === 'function') composer.requestSubmit();
  }
});
$('#actionForm').addEventListener('submit', event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  if (action === 'appearance') {
    currentTheme = draftTheme;
    document.body.dataset.theme = currentTheme;
    safeStorageSet(STORAGE_KEYS.theme, currentTheme);
    toast(`Applied ${currentTheme === 'default' ? 'OurChat' : currentTheme} theme.`);
    dialog.close(); return;
  }
  if (action === 'reminder') {
    const text = $('#reminderText')?.value.trim();
    const value = $('#reminderAt')?.value;
    if (!text || !value) { toast('Add a reminder and time first.'); return; }
    const when = new Date(value);
    if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) { toast('Choose a valid future time.'); return; }
    const reminder = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, text, at: when.getTime(), done: false };
    const reminders = loadReminders();
    reminders.push(reminder);
    if (!saveReminders(reminders)) { toast('Could not save reminder. Browser storage may be full or disabled.'); return; }
    scheduleReminder(reminder);
    toast(`Reminder saved for ${when.toLocaleString()}. Keep the app open for its alert.`);
    dialog.close(); return;
  }
  if (action === 'timer') {
    const mins = Number($('#timerMinutes')?.value || 1440);
    if (![60, 360, 1440, 10080].includes(mins)) { toast('Choose one of the available timer options.'); return; }
    currentExpiryMs = mins * 60 * 1000;
    $$('.message-row').forEach(row => {
      const bubble = $('.bubble', row);
      if (!bubble || bubble.classList.contains('scheduled')) return;
      const expiry = $('.expiry', bubble);
      if (expiry) expiry.textContent = `⌛ ${expiryLabel(currentExpiryMs)}`;
      const createdAt = Number(row.dataset.createdAt || Date.now());
      removeAfterExpiry(row, createdAt + currentExpiryMs);
    });
    toast(`Timer set to ${mins === 60 ? '1 hour' : mins === 360 ? '6 hours' : mins === 1440 ? '24 hours' : '7 days'} for preview messages.`);
    dialog.close(); return;
  }
  if (action === 'newchat') {
    const name = $('#newContact')?.value.trim();
    if (!name) { toast('Enter a username or phone number.'); return; }
    toast(`Contact lookup for “${name}” needs Firebase setup.`);
    dialog.close(); return;
  }
  dialog.close();
});
$('#searchInput').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  $$('.conversation').forEach(conversation => conversation.classList.toggle('hidden', !conversation.dataset.name.toLowerCase().includes(query)));
});
$$('.conversation').forEach(conversation => conversation.addEventListener('click', () => {
  $$('.conversation').forEach(item => item.classList.remove('active'));
  conversation.classList.add('active');
  const name = conversation.dataset.name || 'Conversation';
  $('#contactName').textContent = name;
  $('#detailsName').textContent = name;
  toast(`Opened ${name} preview. Messages are not synced between users.`);
  if (window.innerWidth < 760) $('#detailsPanel').classList.remove('open');
}));

// Restore local preferences and timers. This is still a single-device prototype.
document.body.dataset.theme = ['default', 'calculator', 'clock'].includes(currentTheme) ? currentTheme : 'default';
initializeExistingMessageExpiry();
restoreReminders();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('OurChat service worker registration failed:', error));
}
