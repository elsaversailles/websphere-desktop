import { useCallback, useEffect, useState } from 'react';
import { loadSession, restoreSession, sessionExpiredMessage, sessionInvalidatedEvent, type Session } from '../api';
import { AuthScreen } from './AuthScreen';
import { LandingPage } from './LandingPage';
import { Toast } from './Toast';
import { Workspace } from './Workspace';

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [restoring, setRestoring] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  // Signed-out visitors start on the landing page, except when a password-reset link sent them
  // straight here — that token has to reach AuthScreen or the reset flow breaks.
  const [authEntry, setAuthEntry] = useState<'login' | 'register' | null>(() => new URLSearchParams(window.location.search).get('resetToken') ? 'login' : null);

  useEffect(() => { void restoreSession().then(setSession).finally(() => setRestoring(false)); }, []);
  useEffect(() => {
    function handleSessionInvalidation() {
      setSession(null);
      setToast(sessionExpiredMessage);
    }
    window.addEventListener(sessionInvalidatedEvent, handleSessionInvalidation);
    return () => window.removeEventListener(sessionInvalidatedEvent, handleSessionInvalidation);
  }, []);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(timeout); }, [toast]);
  const notify = useCallback((message: string) => setToast(message), []);

  if (restoring) return <main className="loading-shell">Loading WebSphere…</main>;
  const signedOut = authEntry
    ? <AuthScreen onAuthenticated={setSession} notify={notify} initialMode={authEntry} onBack={() => setAuthEntry(null)} />
    : <LandingPage onGetStarted={setAuthEntry} />;
  return <><>{session ? <Workspace session={session} onSessionChange={setSession} onLogout={() => { setSession(null); setAuthEntry(null); }} notify={notify} /> : signedOut}</><Toast message={toast} onDismiss={() => setToast(null)} /></>;
}
