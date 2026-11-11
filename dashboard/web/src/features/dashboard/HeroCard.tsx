import { formatKrw, formatPercent, percentChange } from '../../lib/format';
import type { DashboardData } from '../../data/types';
import { StackedBars } from './StackedBars';
import s from './HeroCard.module.css';

const PERIOD_LABEL = { today: '오늘 총수익', yesterday: '어제 총수익', '7d': '최근 7일 총수익', month: '이번 달 총수익' } as const;

export function HeroCard({ data }: { data: DashboardData }) {
  const { totals, previousTotal, period, buckets, hasEstimated } = data;
  const total = totals.ad + totals.inapp + totals.paid;
  const change = percentChange(total, previousTotal);
  const up = change !== null && change >= 0;

  const kpis = [
    { label: '광고', color: 'var(--ad)', value: totals.ad },
    { label: '인앱·구독', color: 'var(--inapp)', value: totals.inapp },
    { label: '유료앱', color: 'var(--paid)', value: totals.paid },
  ];

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

        <ul className={s.kpis}>
          {kpis.map((k) => (
            <li key={k.label} className={s.kpi}>
              <span className={s.kpiLabel}>
                <span className={s.kpiDot} style={{ background: k.color }} aria-hidden />
                {k.label}
              </span>
              <span className={`num ${s.kpiValue}`}>{formatKrw(k.value)}</span>
            </li>
          ))}
        </ul>
      </div>

      <StackedBars buckets={buckets} labelEvery={period === 'today' || period === 'yesterday' ? 3 : period === '7d' ? 1 : 5} prevLabel={data.prevLabel} />
    </section>
  );
}
