import { useEffect, useState } from 'react';
import { applyTransaction, generateSeed, makeTransaction } from './seed';
import type { RawData } from './types';

/** No-Firebase mode: seed data in memory, plus a fake payment every 15–30s. */
export function useMockRaw(): { raw: RawData; error: null } {
  const [raw, setRaw] = useState<RawData>(() => generateSeed(new Date()));

  useEffect(() => {
    let timer: number;
    let n = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        const at = new Date();
        n += 1;
        setRaw((r) => applyTransaction(r, makeTransaction(`live-${at.getTime()}`, at, n % 7 === 0)));
        schedule();
      }, 15_000 + Math.random() * 15_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return { raw, error: null };
}
