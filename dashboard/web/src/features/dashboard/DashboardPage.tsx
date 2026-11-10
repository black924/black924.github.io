import { useEffect, useState } from 'react';
import { useAuth, type SessionUser } from '../../app/auth';
import { dataMode } from '../../lib/firebase';
import { useDashboardData } from '../../data/useDashboardData';
import type { DashboardData, Period } from '../../data/types';
import { AdSources } from './AdSources';
import { AppTable } from './AppTable';
import { DonutMix } from './DonutMix';
import { Header } from './Header';
import { HeroCard } from './HeroCard';
import { LiveFeed } from './LiveFeed';
import { Stores } from './Stores';
import { SyncStatus } from './SyncStatus';
import s from './DashboardPage.module.css';

const MODE_NOTE = {
  mock: '현재 목업 데이터로 표시 중입니다.',
  emulator: '로컬 에뮬레이터 데이터로 표시 중입니다.',
  live: null,
} as const;

export function DashboardPage({ user }: { user: SessionUser }) {
  const { signOut } = useAuth();
  const [period, setPeriod] = useState<Period>('today');
  const { data, error } = useDashboardData(period);
  const scrolled = useScrolled();

  return (
    <>
      <div className={`${s.headerBar} ${scrolled ? s.scrolled : ''}`}>
        <div className={s.headerInner}>
          <Header
        now={data?.now ?? new Date()}
        syncedAt={data?.lastSyncAt ?? null}
        period={period}
        onPeriod={setPeriod}
        email={user.email}
        photoURL={user.photoURL}
        onLogout={signOut}
          />
        </div>
      </div>

      <div className={s.page}>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {data ? <Body data={data} userEmail={user.email} /> : !error && <p className={s.loading} role="status">데이터 불러오는 중…</p>}
      </div>
    </>
  );
}

/** True once the page has scrolled, i.e. content is sliding under the fixed header. */
function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

function Body({ data, userEmail }: { data: DashboardData; userEmail: string }) {
  const usd = data.fx?.rates.USD;
  const note = MODE_NOTE[dataMode];
  return (
    <>
      <main className={s.main}>
        <div className={s.top}>
          <HeroCard data={data} />
          <div className={s.side}>
            <DonutMix totals={data.totals} />
            <LiveFeed items={data.transactions.slice(0, 6)} appsById={data.appsById} now={data.now} />
          </div>
        </div>

        <div className={s.three}>
          <AdSources sources={data.adSources} />
          <Stores stores={data.stores} />
          <SyncStatus items={data.sync} now={data.now} userEmail={userEmail} />
        </div>

        <AppTable rows={data.appRows} estimated={data.hasEstimated} />
      </main>

      <footer className={s.footer}>
        <p>
          {usd ? (
            <>
              환율: 1 USD = <span className="num">₩{usd.toLocaleString('ko-KR')}</span> ({data.fx!.date} 기준) · 외화 결제는 결제 시점 환율로 원화 환산합니다.
            </>
          ) : (
            '환율: 아직 받은 환율 정보가 없습니다.'
          )}
        </p>
        <p>
          수수료 기준: 스토어 수수료 차감 {data.revenueBasis === 'net' ? '후(net)' : '전(gross)'} 금액입니다.
        </p>
        <p>오늘 수치는 실시간 알림과 30분 폴링으로 집계한 추정치이며, 다음 날 04:00 공식 리포트로 확정됩니다.</p>
        {note && <p className={s.mock}>{note}</p>}
      </footer>
    </>
  );
}
