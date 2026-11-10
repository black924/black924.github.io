import { Fragment, useState } from 'react';
import { formatKrw, share } from '../../lib/format';
import type { AdUnitRow, AppRow } from '../../data/types';
import { AppIcon } from './AppIcon';
import s from './AppTable.module.css';

const PLATFORM_LABEL = { android: 'Android', ios: 'iOS' } as const;

// AdMob FORMAT values are lowercase words per the API docs' examples ("banner", "native"); match loosely.
const FORMAT_LABEL: Record<string, string> = {
  banner: '배너',
  interstitial: '전면',
  rewarded: '보상형',
  rewarded_interstitial: '보상형 전면',
  rewardedinterstitial: '보상형 전면',
  native: '네이티브',
  app_open: '앱 오프닝',
  appopen: '앱 오프닝',
};
const formatLabel = (f: string) => FORMAT_LABEL[f.toLowerCase().replace(/[\s-]/g, '_')] ?? (f || '—');

const int = new Intl.NumberFormat('ko-KR');
const rate = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—');
/** eCPM in won micros: earnings per 1,000 impressions. */
const ecpm = (u: AdUnitRow) => (u.impressions > 0 ? formatKrw(Math.round((u.earningsMicros * 1000) / u.impressions)) : '—');

export function AppTable({ rows, estimated }: { rows: AppRow[]; estimated: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sum = rows.reduce(
    (acc, r) => ({ ad: acc.ad + r.ad, inapp: acc.inapp + r.inapp, paid: acc.paid + r.paid }),
    { ad: 0, inapp: 0, paid: 0 },
  );
  const grand = sum.ad + sum.inapp + sum.paid;

  return (
    <section className="card" aria-labelledby="apps-title">
      <h2 id="apps-title" className="card-title">
        <span>
          앱별 수익 {estimated && <span className="est">추정 포함</span>}
        </span>
        <span className="card-sub">{rows.length}개 앱 · 행을 누르면 상세</span>
      </h2>
      <div className={s.scroll} tabIndex={0} aria-label="앱별 수익 표 (가로 스크롤)">
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">앱</th>
              <th scope="col" className={s.r}>광고</th>
              <th scope="col" className={s.r}>인앱·구독</th>
              <th scope="col" className={s.r}>유료앱</th>
              <th scope="col" className={s.r}>합계</th>
              <th scope="col" className={s.shareCol}>비중</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={s.emptyRow}>
                  등록된 앱이 없습니다. Firestore의 apps 컬렉션에 앱을 추가하세요.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const t = r.ad + r.inapp + r.paid;
              const pct = share(t, grand);
              const isOpen = open.has(r.app.id);
              const detailId = `app-detail-${r.app.id}`;
              return (
                <Fragment key={r.app.id}>
                  <tr className={`${s.row} ${isOpen ? s.rowOpen : ''}`} onClick={() => toggle(r.app.id)}>
                    <th scope="row">
                      <button
                        type="button"
                        className={s.appBtn}
                        aria-expanded={isOpen}
                        aria-controls={detailId}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r.app.id);
                        }}
                      >
                        <Chevron open={isOpen} />
                        <AppIcon app={r.app} size={34} />
                        <span className={s.appText}>
                          <span className={s.appName}>{r.app.name}</span>
                          <span className={s.platform}>{r.app.platform.map((p) => PLATFORM_LABEL[p]).join(' · ')}</span>
                        </span>
                      </button>
                    </th>
                    <td className={`num ${s.r}`}>{formatKrw(r.ad)}</td>
                    <td className={`num ${s.r} ${r.inapp ? '' : s.zero}`}>{formatKrw(r.inapp)}</td>
                    <td className={`num ${s.r} ${r.paid ? '' : s.zero}`}>{formatKrw(r.paid)}</td>
                    <td className={`num ${s.r} ${s.total}`}>{formatKrw(t)}</td>
                    <td className={s.shareCol}>
                      <span className={s.share}>
                        <span className={s.track}>
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="num">{pct.toFixed(1)}%</span>
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className={s.detailRow} id={detailId}>
                      <td colSpan={6}>
                        <AppDetail row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">합계</th>
              <td className={`num ${s.r}`}>{formatKrw(sum.ad)}</td>
              <td className={`num ${s.r}`}>{formatKrw(sum.inapp)}</td>
              <td className={`num ${s.r}`}>{formatKrw(sum.paid)}</td>
              <td className={`num ${s.r} ${s.total}`}>{formatKrw(grand)}</td>
              <td className={s.shareCol} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

type Tab = 'all' | 'android' | 'ios';
const TAB_LABEL: Record<Tab, string> = { all: '전체', android: 'Android', ios: 'iOS' };

function AppDetail({ row }: { row: AppRow }) {
  const tabs: Tab[] = row.app.platform.length > 1 ? ['all', ...row.app.platform] : [];
  const [tab, setTab] = useState<Tab>('all');
  const units = tab === 'all' ? row.adUnits : row.adUnits.filter((u) => u.platform === tab);
  const unknownPlatform = tab !== 'all' && row.adUnits.some((u) => u.platform === '');

  const total = units.reduce(
    (a, u) => ({
      requests: a.requests + u.requests,
      matched: a.matched + u.matchedRequests,
      impressions: a.impressions + u.impressions,
      earnings: a.earnings + u.earningsMicros,
    }),
    { requests: 0, matched: 0, impressions: 0, earnings: 0 },
  );
  // "전체" uses the app's ad total (all ad sources); platform tabs sum their ad units.
  const adAmount = tab === 'all' ? row.ad : total.earnings;
  const store =
    tab === 'android'
      ? [{ name: 'Google Play', amount: row.stores.google }]
      : tab === 'ios'
        ? [{ name: 'App Store', amount: row.stores.apple }]
        : [
            { name: 'Google Play', amount: row.stores.google },
            { name: 'App Store', amount: row.stores.apple },
          ];
  const panelId = `app-tabpanel-${row.app.id}`;

  return (
    <div className={s.detail}>
      {tabs.length > 0 && (
        <div className={s.tabs} role="tablist" aria-label={`${row.app.name} 플랫폼`}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${panelId}-${t}`}
              aria-selected={tab === t}
              aria-controls={panelId}
              className={s.tab}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <div id={panelId} role={tabs.length ? 'tabpanel' : undefined} aria-labelledby={tabs.length ? `${panelId}-${tab}` : undefined}>
        <div className={s.summary}>
          <div className={s.summaryBox}>
            <span className={s.summaryLabel}>광고 수익</span>
            <span className={`num ${s.summaryValue}`}>{formatKrw(adAmount)}</span>
          </div>
          {store.map((st) => (
            <div key={st.name} className={s.summaryBox}>
              <span className={s.summaryLabel}>{st.name} 결제</span>
              <span className={`num ${s.summaryValue}`}>{formatKrw(st.amount)}</span>
            </div>
          ))}
        </div>

        <h3 className={s.detailTitle}>광고 단위</h3>
        {units.length === 0 ? (
          <p className={s.muted}>
            {unknownPlatform
              ? '플랫폼 정보가 아직 없습니다. 다음 동기화 후 표시됩니다.'
              : '이 기간에 광고 단위 데이터가 없습니다.'}
          </p>
        ) : (
          <table className={s.unitTable}>
            <thead>
              <tr>
                <th scope="col">광고 단위</th>
                {tab === 'all' && tabs.length > 0 && <th scope="col">플랫폼</th>}
                <th scope="col">형식</th>
                <th scope="col" className={s.r}>요청</th>
                <th scope="col" className={s.r}>일치율</th>
                <th scope="col" className={s.r}>노출</th>
                <th scope="col" className={s.r}>노출률</th>
                <th scope="col" className={s.r}>eCPM</th>
                <th scope="col" className={s.r}>수익</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.key}>
                  <th scope="row" className={s.unitName}>{u.name}</th>
                  {tab === 'all' && tabs.length > 0 && <td className={s.platformCell}>{u.platform ? TAB_LABEL[u.platform] : '—'}</td>}
                  <td>{formatLabel(u.format)}</td>
                  <td className={`num ${s.r}`}>{int.format(u.requests)}</td>
                  <td className={`num ${s.r}`}>{rate(u.matchedRequests, u.requests)}</td>
                  <td className={`num ${s.r}`}>{int.format(u.impressions)}</td>
                  <td className={`num ${s.r}`}>{rate(u.impressions, u.matchedRequests)}</td>
                  <td className={`num ${s.r}`}>{ecpm(u)}</td>
                  <td className={`num ${s.r} ${s.total}`}>{formatKrw(u.earningsMicros)}</td>
                </tr>
              ))}
            </tbody>
            {units.length > 1 && (
              <tfoot>
                <tr>
                  <th scope="row">합계</th>
                  {tab === 'all' && tabs.length > 0 && <td />}
                  <td />
                  <td className={`num ${s.r}`}>{int.format(total.requests)}</td>
                  <td className={`num ${s.r}`}>{rate(total.matched, total.requests)}</td>
                  <td className={`num ${s.r}`}>{int.format(total.impressions)}</td>
                  <td className={`num ${s.r}`}>{rate(total.impressions, total.matched)}</td>
                  <td className={`num ${s.r}`}>
                    {total.impressions > 0 ? formatKrw(Math.round((total.earnings * 1000) / total.impressions)) : '—'}
                  </td>
                  <td className={`num ${s.r} ${s.total}`}>{formatKrw(total.earnings)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      <p className={s.note}>
        일치율 = 일치 요청 ÷ 요청, 노출률 = 노출 ÷ 일치 요청, eCPM = 수익 ÷ 노출 × 1,000. 기간 합계로 계산합니다.
      </p>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flex: 'none' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

