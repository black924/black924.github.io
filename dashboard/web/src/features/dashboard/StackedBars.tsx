import { useState } from 'react';
import { formatKrw, formatKrwCompact, formatPercent, percentChange } from '../../lib/format';
import type { Bucket } from '../../data/types';
import s from './StackedBars.module.css';

const SERIES = [
  { key: 'ad', label: '광고', color: 'var(--ad)' },
  { key: 'inapp', label: '인앱·구독', color: 'var(--inapp)' },
  { key: 'paid', label: '유료앱', color: 'var(--paid)' },
] as const;

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Axis max as 4 × a readable step (e.g. 1.5만 → 6만). */
function niceMax(value: number): number {
  if (value <= 0) return 4;
  const raw = value / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = STEPS.find((c) => c * exp >= raw)! * exp;
  return step * 4;
}

interface Props {
  buckets: Bucket[];
  labelEvery: number;
  prevLabel: string; // "어제" | "이전 7일" | "지난달"
}

export function StackedBars({ buckets, labelEvery, prevLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = buckets.map((b) => b.ad + b.inapp + b.paid);
  const max = niceMax(Math.max(...totals, ...buckets.map((b) => b.prev ?? 0), 0));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const empty = totals.every((t) => t === 0) && buckets.every((b) => !b.prev);
  const hasPrev = buckets.some((b) => b.prev !== null);
  const lastReal = buckets.reduce((acc, b, i) => (b.future ? acc : i), 0);
  const activeIdx = hover ?? lastReal;
  const active = buckets[activeIdx];
  const activeTotal = active ? totals[activeIdx] : 0;
  const change = active && !active.future && active.prev ? percentChange(activeTotal, active.prev) : null;

  return (
    <div className={s.wrap}>
      <div className={s.readout} aria-live="polite">
        {active && (
          <>
            <span className={s.readoutTitle}>
              {active.title}
              {active.partial && <span className={s.partial}> (집계 중)</span>}
            </span>
            {!active.future &&
              SERIES.map((ser) => (
                <span key={ser.key} className={s.readoutItem}>
                  <span className={s.swatch} style={{ background: ser.color }} aria-hidden />
                  {ser.label}
                  <b className="num">{formatKrw(active[ser.key])}</b>
                </span>
              ))}
            {!active.future && (
              <span className={s.readoutItem}>
                합계 <b className="num">{formatKrw(activeTotal)}</b>
              </span>
            )}
            {active.prev !== null && (
              <span className={s.readoutItem}>
                <span className={`${s.swatch} ${s.swatchPrev}`} aria-hidden />
                {active.prevTitle || prevLabel}
                <b className="num">{formatKrw(active.prev)}</b>
                {change !== null && (
                  <span className={change >= 0 ? s.up : s.down}>
                    {change >= 0 ? '▲' : '▼'}
                    <span className="num">{formatPercent(Math.abs(change))}</span>
                  </span>
                )}
              </span>
            )}
          </>
        )}
      </div>

      <div className={s.chart}>
        <div className={s.yAxis} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num" style={{ top: `${(1 - t) * 100}%` }}>
              {empty ? '' : formatKrwCompact(max * t)}
            </span>
          ))}
        </div>

        <div className={s.plot}>
          {empty && <p className={s.empty}>아직 집계된 수익이 없습니다.</p>}
          <div className={s.grid} aria-hidden>
            {ticks.map((t) => (
              <span key={t} style={{ top: `${(1 - t) * 100}%` }} />
            ))}
          </div>

          <div className={s.bars} onMouseLeave={() => setHover(null)} style={{ gap: buckets.length > 20 ? 3 : 8 }}>
            {buckets.map((b, i) => {
              const t = totals[i];
              const dim = hover !== null && hover !== i;
              const label = b.future
                ? `${b.title}: ${b.prevTitle || prevLabel} ${formatKrw(b.prev ?? 0)}`
                : `${b.title}${b.partial ? ' 집계 중' : ''}: 합계 ${formatKrw(t)}${b.prev !== null ? `, ${b.prevTitle || prevLabel} ${formatKrw(b.prev)}` : ''}`;
              return (
                <div
                  key={b.key}
                  className={`${s.col} ${dim ? s.dim : ''}`}
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <div className={s.slot}>
                    {hasPrev && (
                      <div className={s.prevBar} style={{ height: b.prev ? `${(b.prev / max) * 100}%` : 0 }} />
                    )}
                    <div
                      className={`${s.bar} ${b.partial ? s.barPartial : ''}`}
                      style={{ height: b.future ? 0 : `${(t / max) * 100}%` }}
                    >
                      {SERIES.map((ser) =>
                        b[ser.key] > 0 ? <span key={ser.key} style={{ flexGrow: b[ser.key], background: ser.color }} /> : null,
                      )}
                    </div>
                  </div>
                  <span className={`${s.xLabel} ${i % labelEvery === 0 || i === buckets.length - 1 ? '' : s.xHidden}`}>
                    {b.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ul className={s.legend} aria-label="범례">
        {SERIES.map((ser) => (
          <li key={ser.key}>
            <span className={s.swatch} style={{ background: ser.color }} aria-hidden />
            {ser.label}
          </li>
        ))}
        <li>
          <span className={`${s.swatch} ${s.swatchPrev}`} aria-hidden />
          {prevLabel}
          {!hasPrev && <span className={s.legendNote}> (기록 없음)</span>}
        </li>
      </ul>
    </div>
  );
}
