import { useEffect, useRef, useState } from 'react';
import { hhmm, kstLongDate } from '../../lib/kst';
import { requestSync } from '../../data/requestSync';
import type { Period } from '../../data/types';
import { LogoMark, LogoutIcon, RefreshIcon } from './Icons';
import s from './Header.module.css';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: '오늘' },
  { id: 'yesterday', label: '어제' },
  { id: '7d', label: '7일' },
  { id: 'month', label: '이번 달' },
];

interface Props {
  now: Date;
  syncedAt: Date | null;
  period: Period;
  onPeriod: (p: Period) => void;
  email: string;
  photoURL: string | null;
  onLogout: () => void;
}

export function Header({ now, syncedAt, period, onPeriod, email, photoURL, onLogout }: Props) {
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <LogoMark size={36} />
        <div>
          <h1 className={s.title}>수익 대시보드</h1>
          <p className={s.date}>{kstLongDate(now)}</p>
        </div>
      </div>

      <div className={s.controls}>
        <LiveSync syncedAt={syncedAt} />

        <div className={s.toggle} role="group" aria-label="기간 선택">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={s.toggleBtn}
              aria-pressed={period === p.id}
              onClick={() => onPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={s.account}>
          {photoURL ? (
            <img className={s.avatar} src={photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className={s.avatar} aria-hidden>
              {email[0]?.toUpperCase()}
            </span>
          )}
          <span className={s.email}>{email}</span>
        </div>
        <button type="button" className={s.iconBtn} aria-label="로그아웃" title="로그아웃" onClick={onLogout}>
          <LogoutIcon />
        </button>
      </div>
    </header>
  );
}

/** LIVE dot + last sync time + manual refresh. On phones only the dot and the button are visible. */
function LiveSync({ syncedAt }: { syncedAt: Date | null }) {
  const sync = useManualSync();
  return (
    <span className={s.live}>
      <span className={s.liveDot} aria-hidden />
      <span className={s.liveLabel}>LIVE</span>
      <span aria-live="polite" className={`${s.syncText} ${sync.tone === 'error' ? s.syncError : ''}`}>
        {sync.text ??
          (syncedAt ? (
            <>
              <span className="num">{hhmm(syncedAt)}</span> 동기화
            </>
          ) : (
            '동기화 전'
          ))}
      </span>
      <button
        type="button"
        className={`${s.refreshBtn} ${sync.running ? s.spinning : ''}`}
        aria-label="지금 동기화"
        title="지금 동기화"
        onClick={sync.run}
        disabled={sync.running}
      >
        <RefreshIcon />
      </button>
    </span>
  );
}

/** Runs requestSync and shows a short status in place of "HH:MM 동기화" for a few seconds. */
function useManualSync() {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = (text: string, tone: 'ok' | 'error') => {
    setMsg({ text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setMsg({ text: '갱신 중…', tone: 'ok' });
    try {
      const r = await requestSync();
      if (r.status === 'failed') flash(r.message ?? '갱신 실패', 'error');
      else if (r.status === 'recent') flash('방금 갱신했습니다', 'ok');
      else flash('갱신 완료', 'ok');
    } catch {
      flash('갱신 실패', 'error');
    } finally {
      setRunning(false);
    }
  };

  return { running, run, text: msg?.text ?? null, tone: msg?.tone ?? 'ok' };
}
