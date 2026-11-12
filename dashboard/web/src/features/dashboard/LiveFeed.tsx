import { formatKrw, relativeTime } from '../../lib/format';
import type { AppInfo, Transaction } from '../../data/types';
import { AppIcon } from './AppIcon';
import s from './Cards.module.css';

const TYPE_LABEL: Record<Transaction['type'], string> = {
  subscription: '구독',
  inapp: '인앱',
  paid: '유료앱',
  refund: '환불',
};

function originalAmount(t: Transaction) {
  if (t.currency === 'KRW') return null;
  const v = Math.abs(t.amountMicros) / 1_000_000;
  return `${t.amountMicros < 0 ? '-' : ''}${new Intl.NumberFormat('en-US', { style: 'currency', currency: t.currency }).format(v)}`;
}

export function LiveFeed({ items, appsById, now }: { items: Transaction[]; appsById: Record<string, AppInfo>; now: Date }) {
  return (
    <section className="card" aria-labelledby="feed-title">
      <h2 id="feed-title" className="card-title">
        실시간 결제
        <span className="card-sub">최근 {items.length}건</span>
      </h2>
      {items.length === 0 && <p className={s.empty}>아직 들어온 결제가 없습니다.</p>}
      <ul className={s.feed} aria-live="polite">
        {items.map((t) => {
          const app = appsById[t.appId];
          const orig = originalAmount(t);
          const refund = t.type === 'refund';
          return (
            <li key={t.id} className={`${s.feedItem} ${t.test ? s.feedTest : ''}`}>
              <span className={`${s.storeMark} ${t.store === 'google' ? s.gp : s.as}`} title={t.store === 'google' ? 'Google Play' : 'App Store'}>
                {t.store === 'google' ? 'GP' : 'AS'}
              </span>
              <span className={s.feedText}>
                <span className={s.feedApp}>
                  {app && <AppIcon app={app} size={16} />}
                  <span className={s.feedAppName}>{app?.name ?? t.appId}</span>
                </span>
                <span className={s.feedProduct}>
                  {t.test && <span className={`est ${s.testTag}`} title="테스트 결제는 수익에 포함되지 않습니다">테스트</span>}
                  {TYPE_LABEL[t.type]} · {t.productName}
                </span>
              </span>
              <span className={s.feedRight}>
                <span className={`num ${s.feedAmt} ${refund && !t.test ? s.refund : ''}`}>{t.test && t.amountKrwMicros === 0 ? '—' : formatKrw(t.amountKrwMicros)}</span>
                <span className={s.feedTime}>
                  {orig && <span className="num">{orig} · </span>}
                  {relativeTime(t.occurredAt, now)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
