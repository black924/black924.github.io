import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './firestore';

export type SyncSource = 'admob' | 'google_play' | 'app_store' | 'reconcile';

export async function recordSyncOk(source: SyncSource, extra: Record<string, unknown> = {}) {
  await db.doc(`sync/${source}`).set(
    { state: 'ok', lastRunAt: Timestamp.now(), lastError: FieldValue.delete(), ...extra },
    { merge: true },
  );
}

/** `message` is shown on the dashboard: keep it in Korean and free of tokens or raw payloads. */
export async function recordSyncError(source: SyncSource, message: string, extra: Record<string, unknown> = {}) {
  await db.doc(`sync/${source}`).set({ state: 'error', lastRunAt: Timestamp.now(), lastError: message, ...extra }, { merge: true });
}
