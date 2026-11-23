import { httpsCallable } from 'firebase/functions';
import { dataMode, firebaseFunctions } from '../lib/firebase';

export interface SyncResponse {
  status: 'synced' | 'recent' | 'failed';
  lastRunAt: string | null;
  message?: string;
}

/**
 * Asks the server to run the AdMob sync now (functions/src/requestSync.ts).
 * Emulator/mock modes have no functions running, so they just resolve after a short delay.
 */
export async function requestSync(): Promise<SyncResponse> {
  if (dataMode !== 'live') {
    await new Promise((r) => setTimeout(r, 700));
    return { status: 'synced', lastRunAt: new Date().toISOString() };
  }
  const call = httpsCallable<void, SyncResponse>(firebaseFunctions(), 'requestSync', { timeout: 130_000 });
  return (await call()).data;
}
