import { addDays, hhmm, kstDateKey, shortDay } from '../../lib/kst';
import { relativeTime } from '../../lib/format';
import type { SyncInfo, SyncSource } from '../../data/types';
import s from './Cards.module.css';

const META: Record<SyncSource, { name: string; method: string }> = {
  admob: { name: 'AdMob 미디에이션', method: 'API 폴링 · 30분' },
  google_play: { name: 'Google Play', method: 'RTDN 실시간 + 재무 리포트' },
  app_store: { name: 'App Store', method: 'ASN V2 실시간 + Sales 리포트' },
  reconcile: { name: '일일 보정', method: '매일 04:00 KST · D-1~D-3 확정' },
};

const CONNECT_URL = import.meta.env.VITE_ADMOB_CONNECT_URL;

const STATE_LABEL = { ok: '정상', error: '오류', scheduled: '예약됨', pending: '연결 전' } as const;

export function SyncStatus({ items, now, userEmail }: { items: SyncInfo[]; now: Date; userEmail?: string }) {
  const connectUrl = CONNECT_URL && userEmail ? `${CONNECT_URL}?login_hint=${encodeURIComponent(userEmail)}` : CONNECT_URL;
  return (
    <section className="card" aria-labelledby="sync-title">
      <h2 id="sync-title" className="card-title">데이터 연동 상태</h2>
      <ul className={s.syncList}>
        {items.map((it) => (
          <li key={it.source}>
            <span className={`${s.stateDot} ${s[it.state]}`} aria-hidden />
            <span className={s.syncText}>
              <span className={s.syncName}>
                {META[it.source].name}
                <span className={`${s.stateTag} ${s[`${it.state}Tag`]}`}>{STATE_LABEL[it.state]}</span>
              </span>
              <span className={s.syncMethod}>{META[it.source].method}</span>
              {it.lastError && <span className={s.syncError}>{it.lastError}</span>}
              {it.warning && <span className={s.syncWarning}>{it.warning}</span>}
              {it.source === 'admob' && it.state !== 'ok' && connectUrl && (
                <a className={s.connect} href={connectUrl} target="_blank" rel="noopener">
                  {it.state === 'pending' ? 'AdMob 연결' : 'AdMob 다시 연결'}
                </a>
              )}
            </span>
            {it.lastRunAt ? (
              <span className={s.syncTime}>
                <span className="num">{timeLabel(it.lastRunAt, now)}</span>
                <span>{relativeTime(it.lastRunAt, now)}</span>
              </span>
            ) : (
              <span className={s.syncTime}>—</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function timeLabel(at: Date, now: Date) {
  const day = kstDateKey(at);
  const today = kstDateKey(now);
  if (day === today) return hhmm(at);
  if (day === addDays(today, -1)) return `어제 ${hhmm(at)}`;
  return `${shortDay(day)} ${hhmm(at)}`;
}
