// கனவுரை app lock: unlock with the phone's fingerprint (or its screen lock) using WebAuthn.
// Runs before the rest of the app so the lock screen is on top from the first moment.
// The fingerprint never leaves the phone. This lock only keeps the app closed on THIS device; it does not encrypt data.
(function () {
  'use strict';
  var KEY = 'ourchat.lock.v1';        // {on:true, id:<credential id>, delay:<minutes>}
  var HIDDEN = 'ourchat.lock.hiddenAt'; // when the app was last left
  var screen = null;
  var busy = false;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(value) { try { if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }
  function stamp() { try { localStorage.setItem(HIDDEN, String(Date.now())); } catch (e) { /* ignore */ } }
  function enc(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function dec(text) { var b = atob(text.replace(/-/g, '+').replace(/_/g, '/')); var out = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
  function random(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  function supported() { return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  async function available() {
    if (!supported()) return false;
    try { return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
  }
  function verify() {
    var config = read();
    if (!config || !config.id) return Promise.reject(new Error('no-lock'));
    return navigator.credentials.get({ publicKey: { challenge: random(32), allowCredentials: [{ id: dec(config.id), type: 'public-key', transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
  }

  // ---------- lock screen ----------
  function build() {
    var style = document.createElement('style');
    style.textContent = '#lockScreen{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:#10111b;color:#f4f4fb;text-align:center;font-family:Inter,"Nirmala UI","Noto Sans Tamil",sans-serif}' +
      '#lockScreen[hidden]{display:none}#lockScreen img{width:88px;height:88px;border-radius:22px}' +
      '#lockScreen h2{margin:0;font-size:24px;font-weight:700}#lockScreen p{margin:0;font-size:13px;color:#a5a9bd}' +
      '#lockScreen button{margin-top:10px;padding:13px 22px;border:0;border-radius:14px;background:#b8a4ff;color:#14151e;font:700 14px Inter,sans-serif}' +
      '#lockScreen .lock-error{color:#ff8a96;min-height:18px}';
    document.head.appendChild(style);
    screen = document.createElement('div');
    screen.id = 'lockScreen';
    screen.hidden = true;
    screen.innerHTML = '<img src="assets/icon-192.png" alt=""><h2>கனவுரை</h2><p>Locked</p><button type="button" id="lockUnlock">Unlock with fingerprint</button><p class="lock-error" id="lockError"></p>';
    document.body.appendChild(screen);
    screen.querySelector('#lockUnlock').addEventListener('click', function () { tryUnlock(); });
  }
  function closeOpenDialogs() {
    var open = document.querySelectorAll('dialog[open]');
    for (var i = 0; i < open.length; i++) { try { open[i].close(); } catch (e) { /* ignore */ } }
  }
  function show() {
    if (!screen) build();
    closeOpenDialogs();
    screen.hidden = false;
    document.documentElement.classList.add('locked');
    tryUnlock();
  }
  function hide() {
    if (screen) screen.hidden = true;
    document.documentElement.classList.remove('locked');
  }
  async function tryUnlock() {
    if (busy) return;
    busy = true;
    var error = screen && screen.querySelector('#lockError');
    if (error) error.textContent = '';
    try { await verify(); hide(); }
    catch (e) { if (error) error.textContent = 'Not unlocked. Tap the button to try again.'; }
    busy = false;
  }
  function isLocked() { return !!(screen && !screen.hidden); }
  function shouldLock() {
    var config = read();
    if (!config || !config.on) return false;
    var last = Number(localStorage.getItem(HIDDEN)) || 0;
    return !last || Date.now() - last >= (Number(config.delay) || 0) * 60000;
  }

  // ---------- public API used by Settings ----------
  async function enable(delay) {
    if (!(await available())) throw new Error('not-available');
    var credential = await navigator.credentials.create({ publicKey: {
      rp: { name: 'கனவுரை' },
      user: { id: random(16), name: 'kanavurai', displayName: 'கனவுரை' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none'
    } });
    write({ on: true, id: enc(new Uint8Array(credential.rawId)), delay: Number(delay) || 0 });
    stamp();
    return true;
  }
  async function disable() { await verify(); write(null); }
  function setDelay(minutes) { var config = read(); if (config) { config.delay = Number(minutes) || 0; write(config); } }

  window.OurLock = {
    supported: supported,
    available: available,
    enabled: function () { var c = read(); return !!(c && c.on); },
    delay: function () { var c = read(); return c ? Number(c.delay) || 0 : 0; },
    enable: enable,
    disable: disable,
    setDelay: setDelay,
    lockNow: function () { if (window.OurLock.enabled()) { stamp(); show(); } },
    isLocked: isLocked
  };

  // lock when the app is opened, and when it comes back after the chosen time
  if (shouldLock()) show();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { stamp(); return; }
    if (!isLocked() && shouldLock()) show();
  });
  window.addEventListener('pagehide', stamp);
})();
