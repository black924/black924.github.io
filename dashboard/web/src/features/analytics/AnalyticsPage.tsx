import { useEffect, useMemo, useState } from 'react';
import { useAuth, type SessionUser } from '../../app/auth';
import { dataMode } from '../../lib/firebase';
import { addDays, hhmm, kstDateKey } from '../../lib/kst';
import appsJson from '../../data/apps.json';
import type { AppInfo } from '../../data/types';
import {
  changeAt, countryName, fillDays, useAnalytics,
  type AnalyticsDaily, type DayPoint, type NamedCount, type Realtime,
} from '../../data/analytics';
import { AppIcon } from '../dashboard/AppIcon';
import { Header } from '../dashboard/Header';
import { useScrolled } from '../dashboard/DashboardPage';
import page from '../dashboard/DashboardPage.module.css';
import { LineChart } from './LineChart';
import s from './Analytics.module.css';

const APPS = appsJson as AppInfo[];
const CHART_DAYS = 30;
const fmt = (n: number) => n.toLocaleString('ko-KR');

export function AnalyticsPage({ user }: { user: SessionUser }) {
  const { signOut } = useAuth();
  const scrolled = useScrolled();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const today = kstDateKey(now);
  const state = useAnalytics(today);

  return (
    <>
      <div className={`${page.headerBar} ${scrolled ? page.scrolled : ''}`}>
        <div className={page.headerInner}>
          <Header screen="analytics" now={now} email={user.email} photoURL={user.photoURL} onLogout={signOut} />
        </div>
      </div>
      <div className={page.page}>
        {state.disabled && (
          <p className={page.error} role="alert">
            Google Analytics 속성 ID(config/app.ga4PropertyId)가 설정되지 않았습니다.
          </p>
        )}
        {state.loading ? (
          <p className={page.loading} role="status">데이터 불러오는 중…</p>
        ) : (
          <Body realtime={state.realtime} daily={state.daily} today={today} />
        )}
      </div>
    </>
  );
}

function appInfo(id: string, fallbackName?: string): AppInfo {
  return APPS.find((a) => a.id === id) ?? { id, name: fallbackName ?? id, platform: [], iconColor: '#4A5468' };
}

function Body({ realtime, daily, today }: { realtime: Realtime | null; daily: AnalyticsDaily | null; today: string }) {
  const [appId, setAppId] = useState<string>('all');
  const lastDay = addDays(today, -1); // today is still filling up

  const appIds = useMemo(() => {
    const ids = new Set<string>([...Object.keys(daily?.apps ?? {}), ...(realtime?.apps.map((a) => a.appId) ?? [])]);
    const order = (id: string) => {
      const i = APPS.findIndex((a) => a.id === id);
      return i < 0 ? 999 : i;
    };
    return [...ids].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  }, [daily, realtime]);
  const nameOf = (id: string) => appInfo(id, daily?.names[id] ?? realtime?.apps.find((a) => a.appId === id)?.name).name;

  const series: DayPoint[] = appId === 'all' ? daily?.total ?? [] : daily?.apps[appId] ?? [];
  const chartDays = fillDays(series, lastDay, CHART_DAYS);
  const errors = [realtime?.error, daily?.error].filter((e): e is string => Boolean(e));

  return (
    <main className={page.main}>
      {errors.map((e) => (
        <p key={e} className={page.error} role="alert">
          {e}
        </p>
      ))}

      <RealtimeCard realtime={realtime} />

      <div className={s.filter} role="group" aria-label="앱 선택">
        {['all', ...appIds].map((id) => (
          <button key={id} type="button" className={s.filterBtn} aria-pressed={appId === id} onClick={() => setAppId(id)}>
            {id !== 'all' && <AppIcon app={appInfo(id, nameOf(id))} size={18} />}
            {id === 'all' ? '전체' : nameOf(id)}
          </button>
        ))}
      </div>

      <div className={s.kpis}>
        <Kpi label="DAU" sub={`${lastDay} 하루`} {...changeAt(series, lastDay, 'dau')} />
        <Kpi label="MAU" sub="최근 28일" {...changeAt(series, lastDay, 'mau')} />
        <Kpi label="신규 사용자" sub={`${lastDay} 하루`} {...changeAt(series, lastDay, 'newUsers')} />
      </div>

      <div className={s.charts}>
        <section className="card" aria-labelledby="dau-title">
          <h2 id="dau-title" className="card-title">
            DAU 추이 <span className="card-sub">최근 {CHART_DAYS}일 · 일별 활성 사용자</span>
          </h2>
          <LineChart points={chartDays.map((p) => ({ date: p.date, value: p.dau }))} color="var(--ad)" label="DAU" />
        </section>
        <section className="card" aria-labelledby="mau-title">
          <h2 id="mau-title" className="card-title">
            MAU 추이 <span className="card-sub">최근 {CHART_DAYS}일 · 각 날짜 기준 28일 활성 사용자</span>
          </h2>
          <LineChart points={chartDays.map((p) => ({ date: p.date, value: p.mau }))} color="var(--paid)" label="MAU" />
        </section>
        <section className="card" aria-labelledby="new-title">
          <h2 id="new-title" className="card-title">
            새 사용자 추이 <span className="card-sub">최근 {CHART_DAYS}일 · 일별 신규 사용자</span>
          </h2>
          <LineChart points={chartDays.map((p) => ({ date: p.date, value: p.newUsers }))} color="var(--inapp)" label="새 사용자" />
        </section>
      </div>

      <AppUsersTable appIds={appIds} nameOf={nameOf} realtime={realtime} daily={daily} lastDay={lastDay} />

      <footer className={page.footer}>
        <p>출처: Google Analytics 4 (Firebase Analytics). 실시간은 지난 30분, DAU·MAU는 어제까지의 완료된 날 기준이며 1분마다 갱신합니다.</p>
        <p>MAU는 GA4의 28일 활성 사용자입니다. 증감은 7일 전 같은 요일 대비입니다. 앱별 값은 Android·iOS 스트림을 더한 값이라 전체 합계와 조금 다를 수 있습니다.</p>
        {daily?.timeZone && daily.timeZone !== 'Asia/Seoul' && <p>속성 시간대가 {daily.timeZone}이라 날짜 경계가 한국 시간과 다릅니다.</p>}
        {daily?.updatedAt && <p>일별 데이터 갱신: <span className="num">{hhmm(daily.updatedAt)}</span></p>}
        {dataMode === 'mock' && <p className={page.mock}>현재 목업 데이터로 표시 중입니다.</p>}
      </footer>
    </main>
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className={s.flat}>—</span>;
  const up = value >= 0;
  return (
    <span className={`num ${s.chg} ${up ? s.up : s.down}`}>
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? '증가' : '감소'}</span> {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Kpi({ label, sub, value, change }: { label: string; sub: string; value: number; change: number | null }) {
  return (
    <section className={`card ${s.kpi}`}>
      <span className={s.kpiLabel}>
        {label} <span className={s.kpiSub}>{sub}</span>
      </span>
      <b className={`num ${s.kpiValue}`}>{fmt(value)}</b>
      <span className={s.kpiFoot}>
        <Change value={change} /> <span className={s.kpiSub}>7일 전 대비</span>
      </span>
    </section>
  );
}

function RealtimeCard({ realtime }: { realtime: Realtime | null }) {
  const minutes = [...(realtime?.perMinute ?? new Array(30).fill(0))].reverse(); // oldest → now
  const max = Math.max(1, ...minutes);
  const countries = realtime?.countries ?? [];
  const totalCountry = countries.reduce((a, c) => a + c.users, 0);
  return (
    <section className={`card ${s.realtime}`} aria-labelledby="rt-title">
      <div className={s.rtMain}>
        <h2 id="rt-title" className="card-title">
          <span className={s.rtTitle}>
            <span className={s.liveDot} aria-hidden /> 실시간 사용자
          </span>
          <span className="card-sub">{realtime?.updatedAt ? `${hhmm(realtime.updatedAt)} 기준 · 지난 30분` : '아직 받은 데이터가 없습니다'}</span>
        </h2>
        <b className={`num ${s.rtValue}`}>{fmt(realtime?.activeUsers ?? 0)}</b>
        <div className={s.minutes} role="img" aria-label="분당 활성 사용자, 30분 전부터 지금까지">
          {minutes.map((n, i) => (
            <span key={i} style={{ height: `${Math.max(3, (n / max) * 100)}%` }} title={`${29 - i === 0 ? '지금' : `${29 - i}분 전`}: ${n}명`} />
          ))}
        </div>
        <div className={s.minuteAxis} aria-hidden>
          <span>30분 전</span>
          <span>지금</span>
        </div>
      </div>
      <div className={s.rtSide}>
        <h3 className={s.subTitle}>국가별</h3>
        {countries.length === 0 ? <p className={s.empty}>지금 접속한 사용자가 없습니다.</p> : <CountryMeters items={countries.slice(0, 6)} total={totalCountry} />}
      </div>
    </section>
  );
}

function CountryMeters({ items, total }: { items: NamedCount[]; total: number }) {
  return (
    <ul className={s.meters}>
      {items.map((c) => (
        <li key={c.name}>
          <span className={s.meterName}>{countryName(c.name)}</span>
          <span className={`num ${s.meterVal}`}>{fmt(c.users)}</span>
          <span className={s.track}>
            <span style={{ width: `${total ? (c.users / total) * 100 : 0}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function AppUsersTable({ appIds, nameOf, realtime, daily, lastDay }: {
  appIds: string[];
  nameOf: (id: string) => string;
  realtime: Realtime | null;
  daily: AnalyticsDaily | null;
  lastDay: string;
}) {
  return (
    <section className="card" aria-labelledby="apps-users-title">
      <h2 id="apps-users-title" className="card-title">
        앱별 사용자 <span className="card-sub">DAU·MAU는 {lastDay} 기준</span>
      </h2>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">앱</th>
              <th scope="col" className={s.r}>실시간</th>
              <th scope="col">실시간 국가</th>
              <th scope="col" className={s.r}>DAU</th>
              <th scope="col" className={s.r}>증감</th>
              <th scope="col" className={s.r}>MAU</th>
              <th scope="col" className={s.r}>증감</th>
              <th scope="col">DAU 14일</th>
            </tr>
          </thead>
          <tbody>
            {appIds.map((id) => {
              const rt = realtime?.apps.find((a) => a.appId === id);
              const series = daily?.apps[id] ?? [];
              const dau = changeAt(series, lastDay, 'dau');
              const mau = changeAt(series, lastDay, 'mau');
              const app = appInfo(id, nameOf(id));
              return (
                <tr key={id}>
                  <th scope="row">
                    <span className={s.app}>
                      <AppIcon app={app} size={28} />
                      <span>{app.name}</span>
                    </span>
                  </th>
                  <td className={`num ${s.r} ${rt?.users ? '' : s.zero}`}>
                    {fmt(rt?.users ?? 0)}
                    {rt && rt.android > 0 && rt.ios > 0 && <span className={s.split}> A {rt.android} · i {rt.ios}</span>}
                  </td>
                  <td className={s.countries}>{rt?.countries.slice(0, 3).map((c) => `${countryName(c.name)} ${c.users}`).join(' · ') || '—'}</td>
                  <td className={`num ${s.r}`}>{fmt(dau.value)}</td>
                  <td className={s.r}><Change value={dau.change} /></td>
                  <td className={`num ${s.r}`}>{fmt(mau.value)}</td>
                  <td className={s.r}><Change value={mau.change} /></td>
                  <td><Spark values={fillDays(series, lastDay, 14).map((p) => p.dau)} label={`${app.name} DAU 14일 추이`} /></td>
                </tr>
              );
            })}
            {appIds.length === 0 && (
              <tr>
                <td colSpan={8} className={s.zero}>아직 받은 데이터가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Spark({ values, label }: { values: number[]; label: string }) {
  const w = 96;
  const h = 26;
  const max = Math.max(1, ...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className={s.spark}>
      <path d={d} fill="none" stroke="var(--ad)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
