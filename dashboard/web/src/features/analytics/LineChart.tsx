import { useLayoutEffect, useRef, useState } from 'react';
import { shortDay } from '../../lib/kst';
import s from './Analytics.module.css';

export interface LinePoint {
  date: string;
  value: number;
}

const H = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= v / 4)! * mag;
  return Math.ceil(v / step) * step;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const change = (cur: number, prev: number | undefined) => (prev ? ((cur - prev) / prev) * 100 : null);

/** Single-series line with a hover crosshair. Tooltip shows the day's value and its change vs the day before and 7 days before. */
export function LineChart({ points, color, label }: { points: LinePoint[]; color: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) return <p className={s.empty}>아직 데이터가 없습니다.</p>;

  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const iw = w - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * iw;
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(points.length / Math.max(2, Math.floor(iw / 70)));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - PAD.left) / iw) * (points.length - 1)))));
  };

  const h = hover !== null ? points[hover] : null;
  return (
    <div ref={box} className={s.chart}>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-label={`${label} 추이, ${points[0].date}부터 ${points[points.length - 1].date}까지`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? s.axis : s.grid} />
            <text x={PAD.left - 8} y={y(t)} className={s.tick} textAnchor="end" dominantBaseline="middle">
              {max >= 10_000 && t > 0 ? `${fmt(Math.round(t / 100) / 10)}k` : fmt(Math.round(t))}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (i % labelEvery === 0 && points.length - 1 - i >= labelEvery * 0.7) || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 6} className={s.tick} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {shortDay(p.date)}
            </text>
          ) : null,
        )}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} className={s.cross} />
            <circle cx={x(hover)} cy={y(h.value)} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        {!h && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
      </svg>
      {h && hover !== null && (
        <div className={s.tooltip} style={{ left: Math.min(Math.max(x(hover), 80), w - 80) }} role="status">
          <span className={s.ttDate}>{h.date}</span>
          <b className="num">{fmt(h.value)}명</b>
          <span className="num">전일 {pct(change(h.value, points[hover - 1]?.value))}</span>
          <span className="num">7일 전 {pct(change(h.value, points[hover - 7]?.value))}</span>
        </div>
      )}
    </div>
  );
}
