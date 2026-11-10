import { formatKrw, share } from '../../lib/format';
import type { Split } from '../../data/types';
import s from './Cards.module.css';

const R = 54;
const C = 2 * Math.PI * R;
const GAP = 3;

export function DonutMix({ totals }: { totals: Split }) {
  const total = totals.ad + totals.inapp + totals.paid;
  const parts = [
    { label: '광고', color: 'var(--ad)', value: totals.ad },
    { label: '인앱·구독', color: 'var(--inapp)', value: totals.inapp },
    { label: '유료앱', color: 'var(--paid)', value: totals.paid },
  ];
  const visible = parts.filter((p) => p.value > 0);
  let offset = 0;

  return (
    <section className="card" aria-labelledby="mix-title">
      <h2 id="mix-title" className="card-title">수익 구성</h2>
      <div className={s.donutRow}>
        <div className={s.donut}>
          <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--divider)" strokeWidth="16" />
            {visible.map((p) => {
              const len = (p.value / (total || 1)) * C;
              const dash = Math.max(0, len - (visible.length > 1 ? GAP : 0));
              const el = (
                <circle
                  key={p.label}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="16"
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                />
              );
              offset += len;
              return el;
            })}
          </svg>
          <div className={s.donutCenter}>
            <span className={`num ${s.donutPct}`}>{Math.round(share(totals.ad, total))}%</span>
            <span className={s.donutLabel}>광고 비중</span>
          </div>
        </div>

        <ul className={s.legend}>
          {parts.map((p) => (
            <li key={p.label}>
              <span className={s.swatch} style={{ background: p.color }} aria-hidden />
              <span className={s.legendName}>{p.label}</span>
              <span className={`num ${s.legendPct}`}>{share(p.value, total).toFixed(1)}%</span>
              <span className={`num ${s.legendAmt}`}>{formatKrw(p.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
