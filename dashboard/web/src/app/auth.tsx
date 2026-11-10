import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseAuth, firebaseEnabled, firestore } from '../lib/firebase';
import { MOCK_EMAIL, isSignedIn as mockIsSignedIn, signIn as mockSignIn, signOut as mockSignOut } from './mockAuth';

export interface SessionUser {
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; denied: boolean; error?: string }
  | { status: 'allowed'; user: SessionUser };

interface AuthApi {
  state: AuthState;
  busy: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = firebaseEnabled ? useFirebaseAuth() : useMockAuth();
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

/**
 * The allowlist lives in config/app, which Firestore rules only let allowlisted,
 * verified emails read. So a successful read is the server's answer to "is this the owner?".
 */
async function isAllowed(user: User): Promise<boolean> {
  if (!user.emailVerified || !user.email) return false;
  try {
    const snap = await getDoc(doc(firestore(), 'config', 'app'));
    return snap.exists();
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') return false;
    throw e;
  }
}

const ERR_CHECK = '계정 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
const ERR_SIGNIN = '로그인에 실패했습니다. 다시 시도해 주세요.';
const IGNORED_SIGNIN_ERRORS = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

function useFirebaseAuth(): AuthApi {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  // Survives the signOut() we trigger ourselves, so the login page can explain why.
  const reason = useRef<{ denied: boolean; error?: string }>({ denied: false });

  useEffect(() => {
    const auth = firebaseAuth();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ status: 'signedOut', ...reason.current });
        return;
      }
      setState({ status: 'loading' });
      try {
        if (await isAllowed(user)) {
          reason.current = { denied: false };
          setState({ status: 'allowed', user: { email: user.email!, displayName: user.displayName, photoURL: user.photoURL } });
          return;
        }
        reason.current = { denied: true };
      } catch {
        reason.current = { denied: false, error: ERR_CHECK };
      }
      await fbSignOut(auth);
    });
  }, []);

  const signIn = useCallback(async () => {
    reason.current = { denied: false };
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(firebaseAuth(), provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (!IGNORED_SIGNIN_ERRORS.has(code)) setState({ status: 'signedOut', denied: false, error: ERR_SIGNIN });
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    reason.current = { denied: false };
    await fbSignOut(firebaseAuth());
  }, []);

  return useMemo(() => ({ state, busy, signIn, signOut }), [state, busy, signIn, signOut]);
}

/** No Firebase config: keep milestone-1 behaviour so the UI still runs standalone. */
function useMockAuth(): AuthApi {
  const [signedIn, setSignedIn] = useState(mockIsSignedIn);
  const state: AuthState = signedIn
    ? { status: 'allowed', user: { email: MOCK_EMAIL, displayName: null, photoURL: null } }
    : { status: 'signedOut', denied: false };
  return {
    state,
    busy: false,
    signIn: async () => {
      mockSignIn();
      setSignedIn(true);
    },
    signOut: async () => {
      mockSignOut();
      setSignedIn(false);
    },
  };
}
