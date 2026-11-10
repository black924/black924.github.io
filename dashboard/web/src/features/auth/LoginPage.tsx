import { useAuth } from '../../app/auth';
import { LogoMark } from '../dashboard/Icons';
import s from './LoginPage.module.css';

const SOURCES = [
  { color: 'var(--ad)', name: 'AdMob 미디에이션', desc: 'AdMob 네트워크 · Unity Ads' },
  { color: 'var(--inapp)', name: 'Google Play', desc: '인앱 · 구독 · 유료앱' },
  { color: 'var(--ad-light)', name: 'App Store', desc: '인앱 · 구독 · 유료앱' },
];

export function LoginPage({ denied, error }: { denied: boolean; error?: string }) {
  const { signIn, busy } = useAuth();

  return (
    <main className={s.page}>
      <section className={`card ${s.card}`} aria-labelledby="login-title">
        <LogoMark size={48} />
        <h1 id="login-title" className={s.title}>
          모든 앱 수익을
          <br />한 화면에서.
        </h1>
        <p className={s.lead}>HNH Labs 수익 대시보드</p>

        <ul className={s.sources}>
          {SOURCES.map((src) => (
            <li key={src.name}>
              <span className={s.dot} style={{ background: src.color }} aria-hidden />
              <span className={s.srcName}>{src.name}</span>
              <span className={s.srcDesc}>{src.desc}</span>
            </li>
          ))}
        </ul>

        {(denied || error) && (
          <p className={s.error} role="alert">
            {denied ? '접근 권한이 없는 계정입니다' : error}
          </p>
        )}

        <button type="button" className={s.google} onClick={signIn} disabled={busy} aria-busy={busy}>
          <GoogleG />
          {busy ? '로그인 창을 확인해 주세요…' : 'Google 계정으로 계속하기'}
        </button>

        <p className={s.note}>허용된 본인 계정만 접속할 수 있으며, 리포트 읽기 권한만 요청합니다.</p>
      </section>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
