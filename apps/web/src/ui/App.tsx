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

  const returnToLanding = useCallback(() => {
    window.history.replaceState({}, '', '/');
    setSession(null);
    setAuthEntry(null);
  }, []);

  useEffect(() => { void restoreSession().then(setSession).finally(() => setRestoring(false)); }, []);
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('emailChange');
    if (!outcome) return;
    window.history.replaceState({}, '', window.location.pathname);
    setToast(outcome === 'confirmed' ? 'Your email address has been confirmed and updated.' : 'That email-change link is invalid or has expired.');
  }, []);
  useEffect(() => {
    function handleSessionInvalidation() {
      returnToLanding();
      setToast(sessionExpiredMessage);
    }
    window.addEventListener(sessionInvalidatedEvent, handleSessionInvalidation);
    return () => window.removeEventListener(sessionInvalidatedEvent, handleSessionInvalidation);
  }, [returnToLanding]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(timeout); }, [toast]);
  const notify = useCallback((message: string) => setToast(message), []);

  if (restoring) return <main className="loading-shell">Loading WebSphere…</main>;
  const signedOut = authEntry
    ? <AuthScreen onAuthenticated={setSession} notify={notify} initialMode={authEntry} onBack={() => setAuthEntry(null)} />
    : <LandingPage onGetStarted={setAuthEntry} notify={notify} />;
  return <><>{session ? <Workspace session={session} onSessionChange={setSession} onLogout={returnToLanding} notify={notify} /> : signedOut}</><Toast message={toast} onDismiss={() => setToast(null)} /></>;
}
