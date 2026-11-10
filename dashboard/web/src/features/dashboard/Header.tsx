import { hhmm, kstLongDate } from '../../lib/kst';
import type { Period } from '../../data/types';
import { LogoMark, LogoutIcon } from './Icons';
import s from './Header.module.css';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: '오늘' },
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
        <span className={s.live}>
          <span className={s.liveDot} aria-hidden />
          <span className={s.liveLabel}>LIVE</span>
          {syncedAt ? (
            <>
              <span className="num">{hhmm(syncedAt)}</span> 동기화
            </>
          ) : (
            '동기화 전'
          )}
        </span>

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
