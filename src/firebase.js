import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Firebase web config (not a secret; Firestore rules protect the data).
const firebaseConfig = {
  apiKey: "AIzaSyDR7da53iqdREIimIhq5K_K4-sc-3FzXrU",
  authDomain: "ourchat-v3.firebaseapp.com",
  projectId: "ourchat-v3",
  storageBucket: "ourchat-v3.firebasestorage.app",
  messagingSenderId: "834106934366",
  appId: "1:834106934366:web:a3d5be1b12eb12628060cf"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let database;
try {
  // Offline cache: messages written without internet stay queued (yellow) and send later.
  database = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), experimentalAutoDetectLongPolling: true });
} catch (error) {
  console.warn('Offline cache unavailable, using default Firestore.', error);
  database = getFirestore(app);
}
export const db = database;
