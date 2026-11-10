import { useEffect, useMemo, useState } from 'react';
import { firebaseEnabled } from '../lib/firebase';
import { buildDashboard } from './aggregate';
import { useFirestoreRaw } from './firestoreRaw';
import { useMockRaw } from './mockRaw';
import type { DashboardData, Period, RawData } from './types';

// Chosen once at load, so hook order never changes between renders.
const useRaw: (now: Date) => { raw: RawData | null; error: string | null } = firebaseEnabled ? useFirestoreRaw : () => useMockRaw();

export interface DashboardState {
  data: DashboardData | null; // null while the first snapshots load
  error: string | null;
}

export function useDashboardData(period: Period): DashboardState {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const { raw, error } = useRaw(now);
  // Recompute "now" whenever data changes so new payments show as "방금".
  const data = useMemo(() => (raw ? buildDashboard(raw, period, new Date()) : null), [raw, period, now]);
  return { data, error };
}
