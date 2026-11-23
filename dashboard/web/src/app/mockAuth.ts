// Placeholder auth for milestone 1. Replaced by Firebase Auth + allowlist in milestone 2.
const KEY = 'mockSignedIn';
export const MOCK_EMAIL = 'me@hnh-labs.com';

export function isSignedIn(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function signIn() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable: session stays in memory only */
  }
}

export function signOut() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
