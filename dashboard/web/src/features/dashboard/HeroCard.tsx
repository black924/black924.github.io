import { formatKrw, formatPercent, percentChange } from '../../lib/format';
import type { DashboardData } from '../../data/types';
import { useState } from 'react';
import { SERIES, StackedBars, type SeriesKey } from './StackedBars';
import s from './HeroCard.module.css';

const PERIOD_LABEL = { today: '오늘 총수익', yesterday: '어제 총수익', '7d': '최근 7일 총수익', month: '이번 달 총수익' } as const;

export function HeroCard({ data }: { data: DashboardData }) {
  const { totals, previousTotal, period, buckets, hasEstimated } = data;
  const total = totals.ad + totals.inapp + totals.paid;
  const change = percentChange(total, previousTotal);
  const up = change !== null && change >= 0;

  // Which revenue types the chart draws. All on by default; the totals above never change.
  const [visible, setVisible] = useState<ReadonlySet<SeriesKey>>(() => new Set(SERIES.map((ser) => ser.key)));
  const toggle = (key: SeriesKey) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className={`card ${s.hero}`} aria-labelledby="hero-title">
      <div className={s.top}>
        <div className={s.main}>
          <h2 id="hero-title" className={s.label}>
            {PERIOD_LABEL[period]} {hasEstimated && <span className="est">추정</span>}
          </h2>
          <p className={`num ${s.total}`}>{formatKrw(total)}</p>
          <p className={s.compare}>
            {change !== null && (
              <span className={`${s.chip} ${up ? s.up : s.down}`}>
                <span aria-hidden>{up ? '▲' : '▼'}</span>
                <span className="num">{formatPercent(Math.abs(change))}</span>
                <span className="sr-only">{up ? '증가' : '감소'}</span>
              </span>
            )}
            <span>
              {data.compareLabel} · <span className="num">{formatKrw(previousTotal)}</span>
            </span>
          </p>
        </div>

        <ul className={s.kpis} aria-label="그래프에 표시할 항목">
          {SERIES.map((ser) => {
            const on = visible.has(ser.key);
            return (
              <li key={ser.key}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`${s.kpi} ${on ? '' : s.kpiOff}`}
                  onClick={() => toggle(ser.key)}
                >
                  <span className={s.kpiLabel}>
                    <span className={s.kpiCheck} style={on ? { background: ser.color, borderColor: ser.color } : undefined} aria-hidden>
                      {on && (
                        <svg viewBox="0 0 12 12" width="10" height="10">
                          <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#07080b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {ser.label}
                  </span>
                  <span className={`num ${s.kpiValue}`}>{formatKrw(totals[ser.key])}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <StackedBars buckets={buckets} labelEvery={period === 'today' || period === 'yesterday' ? 3 : period === '7d' ? 1 : 5} prevLabel={data.prevLabel} visible={visible} />
    </section>
  );
}
