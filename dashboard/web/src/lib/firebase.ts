import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === 'true';

/** False when no Firebase config is present: the app then runs on mock login + mock data. */
export const firebaseEnabled = useEmulators || Boolean(env.VITE_FIREBASE_API_KEY);

export const dataMode: 'mock' | 'emulator' | 'live' = !firebaseEnabled ? 'mock' : useEmulators ? 'emulator' : 'live';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function init() {
  if (app) return;
  app = initializeApp({
    // The emulator accepts any API key.
    apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
    projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-hnh-dashboard',
    appId: env.VITE_FIREBASE_APP_ID,
  });
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

export function firebaseAuth(): Auth {
  init();
  return auth!;
}

export function firestore(): Firestore {
  init();
  return db!;
}
