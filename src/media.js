// கனவுரை media: photos (several at once), voice notes, view once, download (single, selected, all as ZIP).
// Photos and voice notes live in the Firestore collection "media" (one document each, max about 850 KB, protected by the
// same login rules) and are deleted with the message, at 12 AM, or right after a view-once item has been opened.
import { api } from './chat.js';
import { makeZipBytes } from './zip.js';
import { doc, collection, getDoc, setDoc, deleteDoc, updateDoc, Bytes, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = selector => document.querySelector(selector);
const db = api.db;
const toast = message => api.toast(message);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MAX_IMAGES = 10;
const MAX_BYTES = 850000;       // a Firestore document can hold about 1 MB
const MAX_VOICE_MS = 180000;    // 3 minutes
const fmtDur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const expiryFor = () => Math.min(Date.now() + 86400000, api.nextMidnightIST(Date.now()));

// ============================================================
// 1) Reading media (on demand) and saving files
// ============================================================
const cache = new Map(); // id -> { id, blob, url, mime, dur }
async function loadMedia(id) {
  if (cache.has(id)) return cache.get(id);
  const snapshot = await getDoc(doc(db, 'media', id));
  if (!snapshot.exists()) throw new Error('gone');
  const data = snapshot.data();
  const blob = new Blob([data.bytes.toUint8Array()], { type: data.mime || 'application/octet-stream' });
  const entry = { id, blob, url: URL.createObjectURL(blob), mime: data.mime || '', dur: Number(data.dur) || 0 };
  cache.set(id, entry);
  if (cache.size > 40) { const oldest = cache.keys().next().value; forget([oldest]); }
  return entry;
}
function forget(ids) {
  for (const id of ids) { const entry = cache.get(id); if (entry) { try { URL.revokeObjectURL(entry.url); } catch { /* ignore */ } cache.delete(id); } }
}
function extensionOf(mime) {
  return /png/.test(mime) ? 'png' : /webm/.test(mime) ? 'webm' : /mp4|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /mpeg/.test(mime) ? 'mp3' : 'jpg';
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function saveEntries(entries, label) {
  if (!entries.length) { toast('Nothing to download yet.'); return; }
  if (entries.length === 1) { saveBlob(entries[0].blob, `kanavurai-${stamp()}.${extensionOf(entries[0].mime)}`); toast('Downloaded.'); return; }
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    files.push({ name: `kanavurai-${stamp()}-${i + 1}.${extensionOf(entries[i].mime)}`, bytes: new Uint8Array(await entries[i].blob.arrayBuffer()) });
  }
  saveBlob(new Blob([makeZipBytes(files)], { type: 'application/zip' }), `kanavurai-${label || 'photos'}-${stamp()}.zip`);
  toast(`Downloaded ${entries.length} files as one ZIP.`);
}
async function loadAll(message) {
  const entries = [];
  for (const item of message.media || []) { try { entries.push(await loadMedia(item.id)); } catch { /* missing */ } }
  return entries;
}

// ============================================================
// 2) Photos: choose, shrink, send
// ============================================================
async function shrinkImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bitmap = await createImageBitmap(file); }
  let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const qualities = [0.74, 0.68, 0.6, 0.52, 0.45, 0.4];
  for (let attempt = 0; attempt < qualities.length; attempt++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
    context.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', qualities[attempt]));
    if (blob && blob.size <= MAX_BYTES) {
      const t = document.createElement('canvas');
      const ratio = 220 / Math.max(w, h);
      t.width = Math.max(1, Math.round(w * ratio)); t.height = Math.max(1, Math.round(h * ratio));
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      return { blob, w, h, thumb: t.toDataURL('image/jpeg', 0.55) };
    }
    scale *= 0.85;
  }
  throw new Error('too-big');
}
async function writeMedia(kind, blob, extra) {
  const id = doc(collection(db, 'media')).id;
  const expiresAtMs = expiryFor();
  await setDoc(doc(db, 'media', id), {
    owner: api.me, kind, mime: blob.type || (kind === 'voice' ? 'audio/webm' : 'image/jpeg'),
    bytes: Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer())),
    expiresAtMs, expiresAt: Timestamp.fromMillis(expiresAtMs), createdAt: serverTimestamp(), ...extra
  });
  return id;
}
function takeReply() {
  const reply = api.ui.reply;
  api.ui.reply = null;
  if (api.ui.onReplyChange) api.ui.onReplyChange();
  return reply;
}
async function sendImages(files, once, caption) {
  const reply = takeReply();
  try {
    const prepared = [];
    for (const file of files.slice(0, MAX_IMAGES)) prepared.push(await shrinkImage(file));
    const ids = [];
    for (const p of prepared) ids.push(await writeMedia('image', p.blob, { w: p.w, h: p.h }));
    const media = prepared.map((p, i) => ({ id: ids[i], w: p.w, h: p.h, t: once ? '' : p.thumb }));
    await api.send(caption, { extra: { kind: 'image', media, once: !!once, mediaIds: ids }, label: prepared.length > 1 ? `${prepared.length} photos` : 'Photo', reply });
  } catch (error) {
    console.warn('Photo send failed', error);
    toast(error && error.message === 'too-big' ? 'A photo is too large to send. Try another one.' : 'Photos not sent. Check the internet and try again.');
  }
}

// ============================================================
// 3) Voice notes
// ============================================================
let rec = null;
function pickMime() {
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return window.MediaRecorder ? list.find(type => MediaRecorder.isTypeSupported(type)) || '' : '';
}
async function startRecording() {
  if (rec) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Voice notes are not supported on this device.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Please allow the microphone to record a voice note.'); return; }
  const mime = pickMime();
  let recorder;
  try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
  catch { stream.getTracks().forEach(t => t.stop()); toast('Could not start the recorder.'); return; }
  rec = { recorder, stream, chunks: [], startedAt: Date.now(), once: false, send: false, timer: 0 };
  recorder.ondataavailable = event => { if (event.data && event.data.size) rec.chunks.push(event.data); };
  recorder.onstop = finishRecording;
  recorder.start(1000);
  $('.composer-wrap').classList.add('recording');
  $('#recOnce').classList.remove('on');
  $('#recTime').textContent = '0:00';
  rec.timer = setInterval(() => {
    const elapsed = Date.now() - rec.startedAt;
    $('#recTime').textContent = fmtDur(elapsed);
    if (elapsed >= MAX_VOICE_MS) stopRecording(true);
  }, 250);
}
function stopRecording(send) {
  if (!rec) return;
  rec.send = !!send;
  clearInterval(rec.timer);
  try { rec.recorder.stop(); } catch { finishRecording(); }
}
async function finishRecording() {
  const current = rec;
  if (!current) return;
  rec = null;
  clearInterval(current.timer);
  current.stream.getTracks().forEach(track => track.stop());
  $('.composer-wrap').classList.remove('recording');
  if (!current.send) return;
  const durMs = Date.now() - current.startedAt;
  if (durMs < 700) { toast('Voice note too short.'); return; }
  const blob = new Blob(current.chunks, { type: current.recorder.mimeType || 'audio/webm' });
  if (blob.size > MAX_BYTES) { toast('Voice note is too long to send.'); return; }
  const reply = takeReply();
  try {
    const id = await writeMedia('voice', blob, { dur: durMs });
    await api.send('', { extra: { kind: 'voice', media: [{ id, d: Math.round(durMs) }], once: current.once, mediaIds: [id] }, label: 'Voice message', reply });
  } catch (error) {
    console.warn('Voice send failed', error);
    toast('Voice note not sent. Check the internet and try again.');
  }
}

// ============================================================
// 4) Message boxes for photos and voice notes
// ============================================================
api.mediaHtml = message => {
  if (message.kind === 'image') {
    const items = message.media || [];
    if (message.once) {
      if (message.viewedAtMs) return '<div class="once-note">📷 Opened</div>';
      if (message.mine) return '<div class="once-note">📷 Photo · view once</div>';
      return `<button type="button" class="once-open" data-act="once">📷 ${items.length > 1 ? items.length + ' photos' : 'Photo'} · tap to view once</button>`;
    }
    if (!items.length) return '<div class="once-note">📷 Photo (not available)</div>';
    const shown = items.slice(0, 4);
    return `<div class="media-grid g${shown.length}">${shown.map((item, i) => `<button type="button" class="thumb" data-act="view" data-i="${i}"><img src="${esc(item.t)}" alt="photo" draggable="false">${i === 3 && items.length > 4 ? `<span class="more">+${items.length - 4}</span>` : ''}</button>`).join('')}</div>`;
  }
  if (message.kind === 'voice') {
    const dur = message.media && message.media[0] ? message.media[0].d : 0;
    if (message.once && message.viewedAtMs) return '<div class="once-note">🎤 Opened</div>';
    if (message.once && message.mine) return `<div class="once-note">🎤 Voice message · play once (${fmtDur(dur)})</div>`;
    return `<div class="voice${message.once ? ' once' : ''}" data-dur="${dur}"><button type="button" class="v-play" data-act="play">▶</button><div class="v-bar"><i></i></div><span class="v-time">${fmtDur(dur)}</span><button type="button" class="v-speed" data-act="speed">1×</button></div>`;
  }
  return '';
};

// voice player
let audio = null;
let playingId = '';
let speed = 1;
function playerUi() {
  const row = playingId ? document.querySelector(`.message-row[data-id="${CSS.escape(playingId)}"]`) : null;
  const player = row && row.querySelector('.voice');
  if (!player) return;
  const button = player.querySelector('.v-play');
  const bar = player.querySelector('.v-bar i');
  const time = player.querySelector('.v-time');
  button.textContent = audio && !audio.paused ? '❚❚' : '▶';
  player.querySelector('.v-speed').textContent = `${speed}×`;
  if (audio && audio.duration) {
    bar.style.width = `${Math.min(100, (audio.currentTime / audio.duration) * 100)}%`;
    time.textContent = fmtDur(audio.currentTime * 1000);
  }
}
function stopAudio() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
  const finished = playingId;
  playingId = '';
  return finished;
}
async function togglePlay(message) {
  if (audio && playingId === message.id) { if (audio.paused) audio.play(); else audio.pause(); playerUi(); return; }
  stopAudio();
  let entry;
  try { entry = await loadMedia(message.media[0].id); }
  catch { toast('This voice note is not available (expired, or still uploading).'); return; }
  playingId = message.id;
  audio = new Audio(entry.url);
  audio.playbackRate = speed;
  audio.ontimeupdate = playerUi;
  audio.onpause = playerUi;
  audio.onplay = playerUi;
  audio.onended = () => { const done = playingId; const msg = api.docs.find(m => m.id === done); stopAudio(); api.render(); if (msg && msg.once) finalizeOnce(msg); };
  audio.play().catch(() => toast('Could not play the voice note.'));
}
api.hooks.render.push(() => { if (playingId) playerUi(); });

// ============================================================
// 5) Viewer: one photo at a time, select photos, download one / selected / all
// ============================================================
const viewerEl = document.createElement('div');
viewerEl.id = 'mediaViewer';
viewerEl.hidden = true;
viewerEl.innerHTML = `<div class="mv-top"><button type="button" id="mvClose" aria-label="Close">←</button><span id="mvCount"></span><span class="mv-spacer"></span><button type="button" id="mvSelectToggle">Select</button><button type="button" id="mvDownload" aria-label="Download this photo">⬇</button></div>
<div class="mv-stage" id="mvStage"><button type="button" class="mv-nav" id="mvPrev" aria-label="Previous">‹</button><img id="mvImg" alt="" draggable="false"><div class="mv-msg" id="mvMsg"></div><button type="button" class="mv-nav" id="mvNext" aria-label="Next">›</button></div>
<div class="mv-strip" id="mvStrip"></div>
<div class="mv-bottom" id="mvBottom"><button type="button" id="mvSaveSel">Download selected (0)</button><button type="button" id="mvSaveAll">Download all</button></div>
<p class="mv-once" id="mvOnce" hidden>View once · when you close this, the photo is deleted for good.</p>`;
document.body.appendChild(viewerEl);
const V = { message: null, items: [], index: 0, select: false, once: false };

function openViewer(message, index, once) {
  V.message = message; V.once = !!once; V.index = Math.max(0, index || 0); V.select = false;
  V.items = (message.media || []).map(item => ({ id: item.id, thumb: item.t, entry: null, failed: false, selected: false }));
  viewerEl.hidden = false;
  document.documentElement.classList.add('viewing');
  renderViewer();
  loadViewerItems();
}
async function loadViewerItems() {
  const order = V.items.map((_, i) => i).sort((a, b) => (a === V.index ? -1 : b === V.index ? 1 : a - b));
  const message = V.message;
  for (const i of order) {
    if (V.message !== message) return;
    try { V.items[i].entry = await loadMedia(V.items[i].id); } catch { V.items[i].failed = true; }
    if (V.message === message) renderViewer();
  }
}
function renderViewer() {
  const item = V.items[V.index];
  if (!item) return;
  $('#mvCount').textContent = V.items.length > 1 ? `${V.index + 1} / ${V.items.length}` : 'Photo';
  const img = $('#mvImg');
  const src = item.entry ? item.entry.url : (V.once ? '' : item.thumb || '');
  if (img.getAttribute('src') !== src) img.src = src;
  img.style.opacity = item.entry ? '1' : '0.5';
  $('#mvMsg').textContent = item.failed ? 'This photo is not available (expired or removed).' : (!item.entry ? 'Loading…' : '');
  $('#mvPrev').hidden = V.index === 0;
  $('#mvNext').hidden = V.index >= V.items.length - 1;
  const many = V.items.length > 1;
  $('#mvSelectToggle').hidden = V.once || !many;
  $('#mvSelectToggle').textContent = V.select ? 'Done' : 'Select';
  $('#mvDownload').hidden = V.once;
  $('#mvOnce').hidden = !V.once;
  const strip = $('#mvStrip');
  strip.hidden = V.once || !many;
  strip.innerHTML = V.items.map((it, i) => `<button type="button" class="mv-thumb${i === V.index ? ' cur' : ''}${it.selected ? ' sel' : ''}" data-i="${i}"><img src="${esc(it.entry ? it.entry.url : it.thumb || '')}" alt="" draggable="false">${V.select ? `<span class="tick">${it.selected ? '✓' : ''}</span>` : ''}</button>`).join('');
  const selected = V.items.filter(it => it.selected).length;
  const bottom = $('#mvBottom');
  bottom.hidden = V.once || !many;
  $('#mvSaveSel').hidden = !V.select;
  $('#mvSaveSel').textContent = `Download selected (${selected})`;
  $('#mvSaveSel').disabled = !selected;
  $('#mvSaveAll').textContent = `Download all (${V.items.length})`;
}
function closeViewer() {
  viewerEl.hidden = true;
  document.documentElement.classList.remove('viewing');
  $('#mvImg').removeAttribute('src');
  const message = V.message;
  const once = V.once;
  V.message = null; V.items = []; V.select = false; V.once = false;
  if (once && message) finalizeOnce(message);
}
function go(step) { const next = V.index + step; if (next >= 0 && next < V.items.length) { V.index = next; renderViewer(); } }
async function downloadItems(items, label) {
  const entries = [];
  for (const item of items) {
    if (!item.entry && !item.failed) { try { item.entry = await loadMedia(item.id); } catch { item.failed = true; } }
    if (item.entry) entries.push(item.entry);
  }
  await saveEntries(entries, label);
  renderViewer();
}
viewerEl.addEventListener('click', event => {
  const id = event.target.closest('button')?.id;
  const thumb = event.target.closest('.mv-thumb');
  if (thumb) {
    const i = Number(thumb.dataset.i);
    if (V.select) V.items[i].selected = !V.items[i].selected; else V.index = i;
    renderViewer();
    return;
  }
  if (id === 'mvClose') closeViewer();
  else if (id === 'mvPrev') go(-1);
  else if (id === 'mvNext') go(1);
  else if (id === 'mvSelectToggle') { V.select = !V.select; if (!V.select) V.items.forEach(it => { it.selected = false; }); renderViewer(); }
  else if (id === 'mvDownload') downloadItems([V.items[V.index]], 'photo');
  else if (id === 'mvSaveSel') downloadItems(V.items.filter(it => it.selected), 'selected-photos');
  else if (id === 'mvSaveAll') downloadItems(V.items, 'all-photos');
});
let swipeFrom = null;
$('#mvStage').addEventListener('pointerdown', event => { swipeFrom = event.clientX; });
$('#mvStage').addEventListener('pointerup', event => {
  if (swipeFrom === null) return;
  const dx = event.clientX - swipeFrom;
  swipeFrom = null;
  if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
});
document.addEventListener('keydown', event => {
  if (viewerEl.hidden) return;
  if (event.key === 'Escape') closeViewer();
  else if (event.key === 'ArrowRight') go(1);
  else if (event.key === 'ArrowLeft') go(-1);
});

// ============================================================
// 6) View once: the photo or voice note is deleted from the server right after it has been opened
// ============================================================
async function finalizeOnce(message) {
  const ids = (message.media || []).map(item => item.id);
  forget(ids);
  await Promise.allSettled(ids.map(id => deleteDoc(doc(db, 'media', id))));
  try { await updateDoc(doc(db, 'messages', message.id), { viewedAtMs: Date.now() }); } catch (error) { console.warn('Could not mark as opened', error); }
}

// ============================================================
// 7) Clicks inside the chat
// ============================================================
$('#messages').addEventListener('click', event => {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const row = target.closest('.message-row');
  const message = row && api.docs.find(m => m.id === row.dataset.id);
  if (!message) return;
  const act = target.dataset.act;
  if (act === 'view') openViewer(message, Number(target.dataset.i) || 0, false);
  else if (act === 'once') openViewer(message, 0, true);
  else if (act === 'play') togglePlay(message);
  else if (act === 'speed') { speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1; if (audio) audio.playbackRate = speed; const label = row.querySelector('.v-speed'); if (label) label.textContent = `${speed}×`; }
});

// used by the long-press menu: Download (photos as ZIP when there are several; not for view-once)
window.OurMedia = {
  isMedia: message => message.kind === 'image' || message.kind === 'voice',
  async download(message) {
    if (message.once) { toast('View once items cannot be downloaded.'); return; }
    toast('Preparing the download…');
    await saveEntries(await loadAll(message), message.kind === 'voice' ? 'voice' : 'photos');
  }
};

// ============================================================
// 8) Composer: attach menu, photo tray, microphone, recording bar
// ============================================================
const composerWrap = document.querySelector('.composer-wrap');
const composerForm = $('#composer');

const photoInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true });
const cameraInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
cameraInput.setAttribute('capture', 'environment');
document.body.append(photoInput, cameraInput);

const attachMenu = document.createElement('div');
attachMenu.id = 'attachMenu';
attachMenu.hidden = true;
attachMenu.innerHTML = '<button type="button" data-pick="photos"><i>🖼</i><span>Photos</span></button><button type="button" data-pick="camera"><i>📷</i><span>Camera</span></button>';
document.body.appendChild(attachMenu);

const tray = document.createElement('div');
tray.id = 'photoTray';
tray.hidden = true;
tray.innerHTML = `<div class="tray-thumbs" id="trayThumbs"></div>
<div class="tray-row"><input id="trayCaption" maxlength="300" placeholder="Add a caption…" aria-label="Caption"><button type="button" class="chip" id="trayOnce">① View once</button></div>
<div class="tray-actions"><button type="button" id="trayAdd">＋ Add</button><button type="button" id="trayCancel">Cancel</button><button type="button" id="traySend" class="tray-send">Send</button></div>`;
composerWrap.insertBefore(tray, composerForm);

const recBar = document.createElement('div');
recBar.id = 'recBar';
recBar.innerHTML = '<button type="button" id="recCancel" aria-label="Cancel">🗑</button><span class="rec-dot"></span><span id="recTime">0:00</span><span class="mv-spacer"></span><button type="button" class="chip" id="recOnce">① Once</button><button type="button" id="recSend" aria-label="Send voice note">➤</button>';
composerWrap.appendChild(recBar);

const T = { files: [], urls: [], once: false };
function renderTray() {
  tray.hidden = !T.files.length;
  $('#trayThumbs').innerHTML = T.urls.map((url, i) => `<div class="tray-thumb"><img src="${url}" alt="" draggable="false"><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
  $('#traySend').textContent = T.files.length > 1 ? `Send ${T.files.length} photos` : 'Send photo';
  $('#trayOnce').classList.toggle('on', T.once);
}
function addFiles(list) {
  const images = [...list].filter(file => /^image\//.test(file.type));
  if (!images.length) { toast('Please choose a photo.'); return; }
  for (const file of images) {
    if (T.files.length >= MAX_IMAGES) { toast(`You can send up to ${MAX_IMAGES} photos at once.`); break; }
    T.files.push(file);
    T.urls.push(URL.createObjectURL(file));
  }
  renderTray();
}
function closeTray() {
  T.urls.forEach(url => URL.revokeObjectURL(url));
  T.files = []; T.urls = []; T.once = false;
  $('#trayCaption').value = '';
  renderTray();
}
photoInput.addEventListener('change', () => { addFiles(photoInput.files); photoInput.value = ''; });
cameraInput.addEventListener('change', () => { addFiles(cameraInput.files); cameraInput.value = ''; });
tray.addEventListener('click', event => {
  const remove = event.target.closest('[data-rm]');
  if (remove) { const i = Number(remove.dataset.rm); URL.revokeObjectURL(T.urls[i]); T.files.splice(i, 1); T.urls.splice(i, 1); renderTray(); return; }
  const id = event.target.closest('button')?.id;
  if (id === 'trayOnce') { T.once = !T.once; renderTray(); }
  else if (id === 'trayAdd') photoInput.click();
  else if (id === 'trayCancel') closeTray();
  else if (id === 'traySend') {
    const files = T.files.slice();
    const once = T.once;
    const caption = $('#trayCaption').value.trim();
    closeTray();
    toast(files.length > 1 ? 'Sending photos…' : 'Sending photo…');
    sendImages(files, once, caption);
  }
});
attachMenu.addEventListener('click', event => {
  const button = event.target.closest('[data-pick]');
  if (!button) return;
  attachMenu.hidden = true;
  if (button.dataset.pick === 'photos') photoInput.click(); else cameraInput.click();
});
document.addEventListener('pointerdown', event => { if (!attachMenu.hidden && !event.target.closest('#attachMenu') && !event.target.closest('#attachBtn')) attachMenu.hidden = true; }, true);

function rewireButton(selector, handler, text, title) {
  const old = $(selector);
  if (!old) return null;
  const button = old.cloneNode(true);
  old.replaceWith(button);
  if (text) button.textContent = text;
  if (title) { button.title = title; button.setAttribute('aria-label', title); }
  button.addEventListener('click', handler);
  return button;
}
rewireButton('#attachBtn', event => {
  event.stopPropagation();
  if (!api.me) { toast('Please sign in first.'); return; }
  attachMenu.hidden = !attachMenu.hidden;
  if (!attachMenu.hidden) {
    const rect = $('#attachBtn').getBoundingClientRect();
    attachMenu.style.left = `${Math.max(8, rect.left)}px`;
    attachMenu.style.top = `${Math.max(8, rect.top - attachMenu.offsetHeight - 8)}px`;
  }
}, '＋', 'Attach a photo');
rewireButton('#emojiBtn', () => { if (!api.me) { toast('Please sign in first.'); return; } startRecording(); }, '🎤', 'Record a voice note');

$('#recCancel').addEventListener('click', () => stopRecording(false));
$('#recSend').addEventListener('click', () => { if (rec) { rec.once = $('#recOnce').classList.contains('on'); stopRecording(true); } });
$('#recOnce').addEventListener('click', () => $('#recOnce').classList.toggle('on'));
api.hooks.stop.push(() => { stopRecording(false); stopAudio(); closeTray(); if (!viewerEl.hidden) closeViewer(); });
