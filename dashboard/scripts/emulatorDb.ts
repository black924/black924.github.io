// Admin SDK handle that can ONLY talk to the local Firestore emulator.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const EMULATOR_PROJECT = 'demo-hnh-dashboard';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  throw new Error(`Refusing to run: FIRESTORE_EMULATOR_HOST=${host} is not local`);
}

initializeApp({ projectId: EMULATOR_PROJECT });
export const db = getFirestore();
export const emulatorHost = host;
