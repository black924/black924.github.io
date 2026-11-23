import { formatKrw, share } from '../../lib/format';
import { InfoIcon } from './Icons';
import s from './Cards.module.css';

export function AdSources({ sources }: { sources: { admob: number; unity: number; other: number } }) {
  const total = sources.admob + sources.unity + sources.other;
  const rows = [
    { name: 'AdMob 네트워크', color: 'var(--ad)', value: sources.admob },
    { name: 'Unity Ads', color: 'var(--ad-light)', value: sources.unity },
    { name: '기타', color: 'var(--other)', value: sources.other },
  ];
  return (
    <section className="card" aria-labelledby="ads-title">
      <h2 id="ads-title" className="card-title">
        광고 소스별
        <span className="card-sub num">{formatKrw(total)}</span>
      </h2>
      <ul className={s.meters}>
        {rows.map((r) => (
          <li key={r.name}>
            <div className={s.meterHead}>
              <span>{r.name}</span>
              <span className={s.meterVal}>
                <b className="num">{formatKrw(r.value)}</b>
                <span className="num">{share(r.value, total).toFixed(1)}%</span>
              </span>
            </div>
            <div className={s.track}>
              <span style={{ width: `${share(r.value, total)}%`, background: r.color }} />
            </div>
          </li>
        ))}
      </ul>
      <p className={s.hint}>
        <InfoIcon />
        Unity Ads는 AdMob 미디에이션 리포트에 포함되어 있어 별도 합산하지 않습니다.
      </p>
    </section>
  );
}
