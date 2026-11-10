import { useAuth } from '../../app/auth';
import { LogoMark } from '../dashboard/Icons';
import s from './LoginPage.module.css';

export function LoginPage({ denied, error }: { denied: boolean; error?: string }) {
  const { signIn, busy } = useAuth();

  return (
    <main className={s.page}>
      <section className={`card ${s.card}`} aria-labelledby="login-title">
        <div className={s.brandRow}>
          <LogoMark size={40} />
          <span className={s.badge}>
            <ShieldIcon />
            ADMIN · RESTRICTED
          </span>
        </div>

        <h1 id="login-title" className={s.title}>
          HNH Labs 관리자 콘솔
        </h1>
        <p className={s.lead}>승인된 관리자 계정으로 로그인하세요.</p>

        {(denied || error) && (
          <p className={s.error} role="alert">
            {denied ? '접근 권한이 없는 계정입니다' : error}
          </p>
        )}

        <button type="button" className={s.google} onClick={signIn} disabled={busy} aria-busy={busy}>
          <GoogleG />
          {busy ? '로그인 창을 확인해 주세요…' : 'Google 계정으로 로그인'}
        </button>

        <p className={s.note}>
          <LockIcon />
          <span>이 페이지는 관리자 전용입니다. 승인되지 않은 계정은 접속할 수 없습니다.</span>
        </p>
      </section>
      <p className={s.footer}>© HNH Labs</p>
    </main>
  );
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
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
