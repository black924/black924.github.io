import { Fragment, useState } from 'react';
import { formatKrw, percentChange, share } from '../../lib/format';
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
/** Rate as 0-100, or null without a denominator. */
const ratio = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
const rate = (num: number, den: number) => {
  const r = ratio(num, den);
  return r === null ? '—' : `${r.toFixed(1)}%`;
};
/** eCPM in won micros: earnings per 1,000 impressions. */
const ecpmMicros = (earnings: number, impressions: number) => (impressions > 0 ? Math.round((earnings * 1000) / impressions) : null);
const ecpm = (earnings: number, impressions: number) => {
  const v = ecpmMicros(earnings, impressions);
  return v === null ? '—' : formatKrw(v);
};

interface UnitTotals {
  requests: number;
  matched: number;
  impressions: number;
  earnings: number;
}
const sumUnits = (units: AdUnitRow[]): UnitTotals =>
  units.reduce(
    (a, u) => ({
      requests: a.requests + u.requests,
      matched: a.matched + u.matchedRequests,
      impressions: a.impressions + u.impressions,
      earnings: a.earnings + u.earningsMicros,
    }),
    { requests: 0, matched: 0, impressions: 0, earnings: 0 },
  );
// A unit with no rows in the comparison window counts as zero there (shown as "신규").
const NO_UNITS: UnitTotals = { requests: 0, matched: 0, impressions: 0, earnings: 0 };
const toTotals = (u: AdUnitRow): UnitTotals => ({ requests: u.requests, matched: u.matchedRequests, impressions: u.impressions, earnings: u.earningsMicros });

export function AppTable({ rows, estimated, compareLabel }: { rows: AppRow[]; estimated: boolean; compareLabel: string }) {
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
                        <AppDetail row={r} compareLabel={compareLabel} />
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

function AppDetail({ row, compareLabel }: { row: AppRow; compareLabel: string }) {
  const tabs: Tab[] = row.app.platform.length > 1 ? ['all', ...row.app.platform] : [];
  const [tab, setTab] = useState<Tab>('all');
  const inTab = (u: AdUnitRow) => tab === 'all' || u.platform === tab;
  const units = row.adUnits.filter(inTab);
  const unknownPlatform = tab !== 'all' && row.adUnits.some((u) => u.platform === '');
  const prev = row.prev;
  const prevUnits = new Map((prev?.adUnits ?? []).filter(inTab).map((u) => [u.key, toTotals(u)]));

  const total = sumUnits(units);
  const prevTotal = prev ? sumUnits(prev.adUnits.filter(inTab)) : null;
  // "전체" uses the app's ad total (all ad sources); platform tabs sum their ad units.
  const adAmount = tab === 'all' ? row.ad : total.earnings;
  const prevAd = prev ? (tab === 'all' ? prev.ad : prevTotal!.earnings) : null;
  const google = { name: 'Google Play', amount: row.stores.google, prev: prev?.stores.google ?? null };
  const apple = { name: 'App Store', amount: row.stores.apple, prev: prev?.stores.apple ?? null };
  const store = tab === 'android' ? [google] : tab === 'ios' ? [apple] : [google, apple];
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
            <Delta cur={adAmount} prev={prevAd} prevText={prevAd === null ? '' : formatKrw(prevAd)} />
          </div>
          {store.map((st) => (
            <div key={st.name} className={s.summaryBox}>
              <span className={s.summaryLabel}>{st.name} 결제</span>
              <span className={`num ${s.summaryValue}`}>{formatKrw(st.amount)}</span>
              <Delta cur={st.amount} prev={st.prev} prevText={st.prev === null ? '' : formatKrw(st.prev)} />
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
                  <MetricCells cur={toTotals(u)} prev={prev ? prevUnits.get(u.key) ?? NO_UNITS : null} />
                </tr>
              ))}
            </tbody>
            {units.length > 1 && (
              <tfoot>
                <tr>
                  <th scope="row">합계</th>
                  {tab === 'all' && tabs.length > 0 && <td />}
                  <td />
                  <MetricCells cur={total} prev={prevTotal} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      <p className={s.note}>
        일치율 = 일치 요청 ÷ 요청, 노출률 = 노출 ÷ 일치 요청, eCPM = 수익 ÷ 노출 × 1,000. 기간 합계로 계산합니다.
        ▲▼는 {compareLabel}이며, 비율은 %p(퍼센트포인트) 차이입니다.
      </p>
    </div>
  );
}

/** The six number cells of an ad-unit row (or total), each with its change vs the comparison window. */
function MetricCells({ cur, prev }: { cur: UnitTotals; prev: UnitTotals | null }) {
  const matchRate = ratio(cur.matched, cur.requests);
  const showRate = ratio(cur.impressions, cur.matched);
  const e = ecpmMicros(cur.earnings, cur.impressions);
  const pMatch = prev && ratio(prev.matched, prev.requests);
  const pShow = prev && ratio(prev.impressions, prev.matched);
  const pE = prev && ecpmMicros(prev.earnings, prev.impressions);
  const pct = (r: number | null | undefined) => (r == null ? '' : `${r.toFixed(1)}%`);
  return (
    <>
      <td className={`num ${s.r}`}>
        {int.format(cur.requests)}
        <Delta cur={cur.requests} prev={prev?.requests ?? null} prevText={prev ? int.format(prev.requests) : ''} />
      </td>
      <td className={`num ${s.r}`}>
        {rate(cur.matched, cur.requests)}
        <Delta cur={matchRate} prev={pMatch ?? null} prevText={pct(pMatch)} points />
      </td>
      <td className={`num ${s.r}`}>
        {int.format(cur.impressions)}
        <Delta cur={cur.impressions} prev={prev?.impressions ?? null} prevText={prev ? int.format(prev.impressions) : ''} />
      </td>
      <td className={`num ${s.r}`}>
        {rate(cur.impressions, cur.matched)}
        <Delta cur={showRate} prev={pShow ?? null} prevText={pct(pShow)} points />
      </td>
      <td className={`num ${s.r}`}>
        {ecpm(cur.earnings, cur.impressions)}
        <Delta cur={e} prev={pE ?? null} prevText={pE == null ? '' : formatKrw(pE)} />
      </td>
      <td className={`num ${s.r} ${s.total}`}>
        {formatKrw(cur.earnings)}
        <Delta cur={cur.earnings} prev={prev?.earnings ?? null} prevText={prev ? formatKrw(prev.earnings) : ''} />
      </td>
    </>
  );
}

/**
 * "▲ 12.3%" under a value. `points` = the values are rates, so show the %p difference instead.
 * Shows nothing when there is nothing to compare with, and "신규" when the previous value was 0.
 */
function Delta({ cur, prev, prevText, points = false }: { cur: number | null; prev: number | null; prevText: string; points?: boolean }) {
  if (cur === null || prev === null) return <span className={s.delta} aria-hidden>&nbsp;</span>;
  const title = `이전 ${prevText}`;
  if (!points && prev === 0) {
    return cur > 0 ? <span className={`${s.delta} ${s.deltaNew}`} title={title}>신규</span> : <span className={s.delta} aria-hidden>&nbsp;</span>;
  }
  const change = points ? cur - prev : percentChange(cur, prev)!;
  const shown = Math.abs(change).toFixed(1);
  const unit = points ? '%p' : '%';
  if (shown === '0.0') return <span className={`${s.delta} ${s.deltaFlat}`} title={title}>0.0{unit}</span>;
  const up = change > 0;
  return (
    <span className={`${s.delta} ${up ? s.deltaUp : s.deltaDown}`} title={title}>
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {shown}
      {unit}
      <span className="sr-only">{up ? ' 증가' : ' 감소'}</span>
    </span>
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

