import { formatKrw, share } from '../../lib/format';
import type { Store, StoreSummary } from '../../data/types';
import s from './Cards.module.css';

const META: Record<Store, { name: string; color: string }> = {
  google: { name: 'Google Play', color: 'var(--inapp)' },
  apple: { name: 'App Store', color: 'var(--ad-light)' },
};

export function Stores({ stores }: { stores: Record<Store, StoreSummary> }) {
  const total = stores.google.amount + stores.apple.amount;
  const keys: Store[] = ['google', 'apple'];
  const refundCount = stores.google.refundCount + stores.apple.refundCount;
  const refundMicros = stores.google.refundMicros + stores.apple.refundMicros;
  const g = stores.google.activeSubscribers;
  const a = stores.apple.activeSubscribers;
  const subs = g === null && a === null ? null : (g ?? 0) + (a ?? 0);
  return (
    <section className="card" aria-labelledby="stores-title">
      <h2 id="stores-title" className="card-title">
        스토어별 결제
        <span className="card-sub num">{formatKrw(total)}</span>
      </h2>
      <ul className={s.meters}>
        {keys.map((k) => (
          <li key={k}>
            <div className={s.meterHead}>
              <span>{META[k].name}</span>
              <span className={s.meterVal}>
                <b className="num">{formatKrw(stores[k].amount)}</b>
                <span className="num">{share(stores[k].amount, total).toFixed(1)}%</span>
              </span>
            </div>
            <div className={s.track}>
              <span style={{ width: `${share(stores[k].amount, total)}%`, background: META[k].color }} />
            </div>
          </li>
        ))}
      </ul>
      <div className={s.boxes}>
        <div className={s.box}>
          <span className={s.boxLabel}>활성 구독자</span>
          <span className={`num ${s.boxValue}`}>
            {subs === null ? '—' : `${subs.toLocaleString('ko-KR')}명`}
          </span>
          <span className={s.boxSub}>
            GP <span className="num">{stores.google.activeSubscribers ?? '—'}</span> · AS{' '}
            <span className="num">{stores.apple.activeSubscribers ?? '—'}</span>
          </span>
        </div>
        <div className={s.box}>
          <span className={s.boxLabel}>이번 달 환불</span>
          <span className={`num ${s.boxValue}`}>{refundCount}건</span>
          <span className={`num ${s.boxSub}`}>{refundMicros ? `-${formatKrw(refundMicros)}` : formatKrw(0)}</span>
        </div>
      </div>
    </section>
  );
}
