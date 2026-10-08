# 💬 Our Chat v2 — முழு வழிகாட்டி (தமிழ்)

## 0. முதலில் உண்மை நிலை (நேர்மையாக)

"100% வேலை செய்யும்" என்று உங்கள் Firebase / Cloudflare / phone-ஐத் தொடாமல் யாராலும் உறுதி கொடுக்க முடியாது. அதனால் இரண்டு காரியங்கள் செய்துள்ளேன்:

**✅ நான் சோதித்தவை (உண்மையாக ஓட்டி):**
- **Worker – 20 சோதனைகள்:** போலி token / காலாவதி / வேறு project / மூன்றாம் நபர் Gmail → எல்லாம் 401; உங்கள் இருவர் மட்டும் ✔; VAPID signature உண்மையாகச் சரிபார்க்கப்பட்டது; schedule queue + cron ஒருமுறை மட்டும் அனுப்புகிறது; தவறான key ஜோடியைக் கண்டுபிடிக்கிறது.
- **ஆப் – 29 சோதனைகள்** (போலி Firebase/DOM-ல்): login, அனுமதி இல்லாதவர் தடை, செய்தி/படம்/பதில் காட்சி, ✓✓, தட்டச்சு, அனுப்புதல், நீக்குதல், schedule, push, 🩺 சோதனை, call (TURN உடன்), incoming ring, password விதிகள்.

**⚠️ என்னால் சோதிக்க முடியாதவை (உங்கள் கணக்குகளில் மட்டுமே தெரியும்):**
Firestore rules-ன் உண்மையான செயல்பாடு, உண்மையான push delivery, இரண்டு நெட்வொர்க்குகளுக்கிடையே video call, iPhone நடத்தை.

👉 இதற்காக ஆப்பிலேயே **🩺 சோதனை பொத்தான்** சேர்த்துள்ளேன். 2 நிமிடத்தில் எது சரி/எது தவறு என்று தமிழில் சொல்லிவிடும். அது எல்லாம் ✅ காட்டினால் setup சரி.

---

## 1. Folder அமைப்பு

```
chatapp-v2/
├─ 1-GITHUB-upload/     ← இவற்றை மட்டும் GitHub-ல் ஏற்றவும்
│    index.html  sw.js  manifest.json  icon-192.png  icon-512.png
├─ 2-CLOUDFLARE-paste/  ← Cloudflare-ல் paste செய்யவும் (GitHub-ல் ஏற்றக்கூடாது)
│    worker.js
├─ 3-FIREBASE-paste/    ← Firebase-ல் paste செய்யவும் (GitHub-ல் ஏற்றக்கூடாது)
│    firestore.rules
├─ tools/keygen.html    ← புதிய key உருவாக்க (GitHub-ல் ஏற்றக்கூடாது)
└─ tests/               ← நான் ஓட்டிய சோதனைகள் (விருப்பம்)
```

**நேரம்:** சுமார் 30–40 நிமிடம். **வரிசையை மாற்ற வேண்டாம்.**

---

## 2. படி 1 — புதிய VAPID key (5 நிமிடம்)

> ஏன்? பழைய private key public GitHub-ல் வெளியாகிவிட்டது. அதை மாற்றியே ஆக வேண்டும்.

1. `tools/keygen.html`-ஐ உங்கள் கணினியில் double-click செய்து திறக்கவும்.
2. **"புதிய keys உருவாக்கு"** அழுத்தவும்.
3. இரண்டு மதிப்புகள்:
   - **Public key** (87 எழுத்துகள், `B`-ல் தொடங்கும்) → படி 2, 4-ல் தேவை.
   - **Private key** (43 எழுத்துகள்) → **படி 2-ல் Cloudflare Secret-ல் மட்டும்.**
4. இந்தத் தாவலை மூடாமல் வைத்திருங்கள் (அல்லது Notepad-ல் தற்காலிகமாக ஒட்டி, வேலை முடிந்ததும் அழித்துவிடுங்கள்).

❗ Private key-ஐ **இந்த chat-ல் அல்லது GitHub-ல் ஒருபோதும் paste செய்ய வேண்டாம்.**

---

## 3. படி 2 — Cloudflare Worker (10 நிமிடம்)

### 2A. Code மாற்று
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → `ourchat-push` → **Edit code**.
2. எல்லாவற்றையும் தேர்ந்து (Ctrl+A) நீக்கி, `2-CLOUDFLARE-paste/worker.js` முழுவதையும் paste → **Deploy**.

### 2B. Variables சேர்
**Settings → Variables and Secrets → Add**

| பெயர் | வகை | மதிப்பு |
|---|---|---|
| `VAPID_PRIVATE` | **Secret** | keygen-ன் Private key |
| `VAPID_PUBLIC` | Text | keygen-ன் Public key |
| `VAPID_SUBJECT` | Text | `mailto:உங்கள்-email` |
| `MEMBERS` | Text | `gnanasekar308@gmail.com,subasri0112@gmail.com` (கமாவால் பிரித்து, இடைவெளி பிரச்சினை இல்லை) |
| `ALLOWED_ORIGIN` | Text | `https://gnanasekar308.github.io` **(கடைசியில் `/` இல்லாமல்)** |
| `FIREBASE_PROJECT` | Text | `our-chat-57278` |

→ **Deploy** (மாற்றங்களைச் சேமிக்க).

### 2C. ஏற்கனவே உள்ளவை சரிபார்
- **Settings → Bindings:** KV namespace, பெயர் சரியாக **`SCHED`**.
- **Settings → Triggers:** Cron `* * * * *`.

### 2D. TURN (விருப்பம் — 4G/5G-ல் video call வேண்டுமெனில்)
1. Cloudflare dashboard → **Realtime → TURN Server → Create**.
2. **Turn Token ID** + **API Token** எடுக்கவும்.
3. Worker variables: `TURN_KEY_ID` (Text), `TURN_API_TOKEN` (**Secret**) → Deploy.
4. Cloudflare தற்போது மாதம் 1,000 GB இலவசம் என்று குறிப்பிடுகிறது; அவர்கள் பக்கத்தில் ஒருமுறை உறுதிசெய்யுங்கள்.

---

## 4. படி 3 — Firebase (10 நிமிடம்)

### 3A. Authentication
- Firebase console → **Authentication → Sign-in method:** **Google** ✔ Enabled, **Email/Password** ✔ Enabled.
- **Settings → Authorized domains:** `gnanasekar308.github.io` இருக்க வேண்டும் (இல்லையெனில் Add domain).

### 3B. Firestore Rules — **மிக முக்கியம்**
1. **Firestore Database → Rules**.
2. `3-FIREBASE-paste/firestore.rules` உள்ளடக்கத்தை முழுவதும் paste.
3. `EMAIL_1@gmail.com`, `EMAIL_2@gmail.com` → உங்கள் இருவரின் Gmail (**சிறிய எழுத்துகளில்**).
4. **Publish**.

இதுதான் உண்மையான பூட்டு. மற்ற எந்த Google கணக்கும் உங்கள் chat-ஐப் படிக்க முடியாது.

### 3C. API key கட்டுப்பாடு (பரிந்துரை, 3 நிமிடம்)
[console.cloud.google.com](https://console.cloud.google.com) → project தேர்வு → **APIs & Services → Credentials** → "Browser key" → **Application restrictions: Websites** → சேர்:
- `https://gnanasekar308.github.io/*`
- `https://our-chat-57278.firebaseapp.com/*`

Save. (Login-ல் பிரச்சினை வந்தால் இதைத் தற்காலிகமாக நீக்கிப் பாருங்கள்.)

### 3D. TTL (விருப்பம்)
Google Cloud Console → **Firestore → Time-to-live (TTL) → Create policy:** `messages` / `exp`, மற்றும் `ice` / `exp`. இது இல்லாவிட்டாலும் ஆப் தானே பழைய செய்திகளை அழிக்கும்.

---

## 5. படி 4 — GitHub (5 நிமிடம்)

1. **முதலில் `index.html`-ஐ திருத்து:** GitHub-ல் `index.html` → ✏️ → `Ctrl+F` → `VAPID_PUB` → வரி:
   `const VAPID_PUB = "PASTE_NEW_VAPID_PUBLIC_KEY_HERE";`
   → மேற்கோள்களுக்குள் உள்ளதை **keygen-ன் Public key**-ஆக மாற்று → **Commit changes**.
   (PC-ல் Notepad-ல் திருத்தி upload செய்வதும் சரி.)
2. repo → **Add file → Upload files** → `1-GITHUB-upload` உள்ள `sw.js`, `manifest.json` (மற்றும் நீங்கள் PC-ல் திருத்திய `index.html`) → **Commit**.
3. **`worker.js`-ஐ repo-விலிருந்து நீக்கு:** repo → `worker.js` → மேல் வலது **⋯ → Delete file → Commit**.
4. **Security tab**-ல் secret alert இருந்தால் "Revoked" என்று மூடு (key மாற்றிவிட்டதால் பழையது பயனற்றது).
5. **Settings → Pages**-ல் "Your site is live" வரும் வரை 1–2 நிமிடம் காத்திரு.

> ↩️ ஏதாவது தவறானால்: repo → **Commits** → முந்தைய commit-ஐத் திறந்து revert செய்யலாம்.

---

## 6. படி 5 — இரண்டு phones-லும் (ஒவ்வொருவரும்)

1. ஆப்பை முழுதாக மூடி, **இரண்டு முறை** திறக்கவும் (புதிய version load ஆக).
2. Login (முதல் முறை என்றால் Google பொத்தான் → புதிய password, குறைந்தது 8).
3. **🔔 அழுத்தி Allow** — புதிய key என்பதால் **இருவரும் கட்டாயம்**.
4. **iPhone:** iOS 16.4+, Safari → Share → **Add to Home Screen** → அங்கிருந்து திற → பின் 🔔.

---

## 7. படி 6 — 🩺 சோதனை (மிக முக்கியம்)

ஆப்பின் மேலே **🩺** அழுத்துங்கள். இப்படி வர வேண்டும்:

```
✅ Login: உங்கள்-email
✅ Firestore படிக்க முடிகிறது
✅ Firestore எழுத முடிகிறது
✅ index.html-ல் VAPID_PUB அமைக்கப்பட்டுள்ளது
✅ Worker இணைந்தது, உங்கள் login ஏற்கப்பட்டது
✅ Worker-ன் VAPID keys ஜோடி சரி
✅ Worker public key = index.html public key
✅ KV (SCHED) இணைந்துள்ளது
✅ MEMBERS-ல் 2 முகவரிகள்
✅ Service worker இயங்குகிறது
✅ Notification அனுமதி: granted
✅ இந்த சாதனத்தின் push subscription உள்ளது
✅ Subscription Firestore-ல் சேமிக்கப்பட்டது
✅ மற்றவரின் சாதனம் notification-க்குத் தயார்
🎉 எல்லாம் சரி!
```

**❌ வந்தால்** — கீழே `👉` என்று சரியான தீர்வு எழுதப்பட்டிருக்கும். சரிசெய்து 🩺-ஐ மீண்டும் அழுத்துங்கள்.

பிறகு **🔔 சோதனை push** பொத்தானை அழுத்தி, ஆப்பை மூடிவிடுங்கள் → சில நொடிகளில் notification வர வேண்டும்.

(`TURN இல்லை` என்பது ℹ️ தகவல் மட்டும்; படி 2D செய்யாதவர்களுக்கு இயல்பு. `மற்றவர் இன்னும் 🔔 அழுத்தவில்லை` என்பது அவருடைய phone-ல் 🩺 செய்தால் மறையும்.)

---

## 8. இறுதி கள சோதனைப் பட்டியல் ✅

இரண்டு phones வைத்து:

- [ ] மூன்றாவது Google கணக்கில் login → "அனுமதி இல்லை" என்று தடுக்கப்படுகிறது
- [ ] செய்தி → ✓ ; மற்றவர் திறந்ததும் நீல ✓✓
- [ ] மற்றவர் தட்டச்சு செய்யும்போது "தட்டச்சு செய்கிறார்..."
- [ ] ஆப் மூடிய நிலையில் செய்தி → notification
- [ ] 📎 படம் அனுப்பு; தொட்டால் பெரிதாகும்
- [ ] செய்தியைத் தொடு → ↩ பதில் / 📋 / 🗑
- [ ] ⏰ 2 நிமிடம் கழித்த நேரம் → நேரத்தில் notification
- [ ] 📞 Wi-Fi-ல் call; பிறகு ஒருவர் mobile data-வில் call (TURN இருந்தால்)
- [ ] அழைப்பு வரும்போது ஆப் திறந்திருந்தால் மணி + vibrate

---

## 9. பிரச்சினை தீர்வுகள்

| அறிகுறி | காரணம் → தீர்வு |
|---|---|
| Login-க்குப் பின் "அனுமதி இல்லை" | rules-ல் Gmail தவறு/பெரிய எழுத்து → சிறிய எழுத்தில் திருத்தி Publish |
| 🩺: Worker 401 | `MEMBERS` / `FIREBASE_PROJECT` தவறு |
| 🩺: Worker-ஐ அடைய முடியவில்லை | `WORKER_URL` அல்லது `ALLOWED_ORIGIN` (கடைசியில் `/` இருக்கக்கூடாது) |
| 🩺: keys ஜோடி தவறு | `VAPID_PRIVATE`, `VAPID_PUBLIC` வேறு வேறு keygen ஓட்டங்களிலிருந்து → ஒரே ஜோடி வை |
| 🩺: public key பொருந்தவில்லை | `index.html`-ல் `VAPID_PUB` மாற்ற மறந்தீர்கள் |
| 🩺: KV இல்லை | Worker → Bindings → KV → பெயர் `SCHED` |
| Notification வரவில்லை | இருவரும் 🔔 அழுத்தினார்களா? 🔔 சோதனை push 201 தருகிறதா? iPhone என்றால் Home Screen ஆப்பா? |
| Call 4G-ல் இணையவில்லை | படி 2D (TURN) செய்யவும் |
| பழைய version தெரிகிறது | ஆப்பை மூடி இரண்டு முறை திற |
| iPhone Google login popup திறக்கவில்லை | தானாக redirect முறைக்கு மாறும்; அதுவும் தோல்வியுற்றால் Safari-ல் ஒருமுறை login செய்து பின் Home Screen ஆப் |

---

## 10. தெரிந்த வரம்புகள்

1. **⏰ Schedule செய்தி** — Firestore-ல் உடனே சேமிக்கப்பட்டு, மற்றவரின் ஆப் நேரம் வரை மறைக்கிறது; DevTools-ல் பார்க்க முடியும். இருவர் chat-க்கு போதும்.
2. **Notification உரை பொதுவானது** — செய்தி உள்ளடக்கம் Google/Apple push server வழி போகாது என்பதற்காக.
3. **End-to-end encryption இல்லை** — Firebase தொழில்நுட்ப ரீதியாகப் படிக்க முடியும்.
4. **பழைய செய்திகள்** (`exp` இல்லாதவை) தானாக அழியாது; 24 மணி நேரத்துக்குப் பின் திரையில் தெரியாது.
5. **படங்கள்** Firestore-ல் சுருக்கப்பட்டு (≈220 KB வரை) சேமிக்கப்படும்; 24 மணி நேரத்தில் அழியும்.
6. Firebase இலவச வரம்பு நாளுக்கு ~20,000 எழுத்துகள் — இருவர் chat-க்கு மிகவும் போதும்.

---

## 11. அடுத்து சேர்க்கலாம்
End-to-end encryption · அழைப்புக்கு தனி notification · voice message · reaction emoji · pin செய்தி.
