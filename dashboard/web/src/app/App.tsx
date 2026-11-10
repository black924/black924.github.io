import { useEffect } from 'react';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AuthProvider, useAuth } from './auth';
import { navigate, useLocation } from './router';

export function App() {
  return (
    <AuthProvider>
      <AuthGuard />
    </AuthProvider>
  );
}

function AuthGuard() {
  const { state } = useAuth();
  const { path, search } = useLocation();
  const onLogin = path === '/login';

  useEffect(() => {
    if (state.status === 'signedOut' && !onLogin) navigate('/login');
    if (state.status === 'allowed' && onLogin) navigate('/');
  }, [state.status, onLogin]);

  if (state.status === 'loading') return <Splash />;
  if (state.status === 'signedOut') {
    const previewDenied = new URLSearchParams(search).get('error') === 'denied';
    return <LoginPage denied={state.denied || previewDenied} error={state.error} />;
  }
  if (onLogin) return null;
  return <DashboardPage user={state.user} />;
}

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }} role="status">
      계정 확인 중…
    </div>
  );
}
