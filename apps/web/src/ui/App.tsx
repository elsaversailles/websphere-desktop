import { useCallback, useEffect, useState } from 'react';
import { archivedAccountMessage, loadSession, restoreSession, saveSession, sessionExpiredMessage, sessionInvalidatedEvent, type Session } from '../api';
import { finishGoogle } from '../googleAuth';
import { AuthScreen } from './AuthScreen';
import { LandingPage } from './LandingPage';
import { Toast } from './Toast';
import { Workspace } from './Workspace';

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [restoring, setRestoring] = useState(true);
  const [archiveNotice, setArchiveNotice] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Signed-out visitors start on the landing page, except when a password-reset link sent them
  // straight here — that token has to reach AuthScreen or the reset flow breaks.
  const [authEntry, setAuthEntry] = useState<'login' | 'register' | null>(() => ['resetToken', 'googleCode', 'googleError'].some((key) => new URLSearchParams(window.location.search).has(key)) ? 'login' : null);

  const returnToLanding = useCallback(() => {
    window.history.replaceState({}, '', '/');
    setSession(null);
    setAuthEntry(null);
  }, []);

  const enterDashboard = useCallback((next: Session) => {
    saveSession(next);
    window.history.replaceState(null, '', next.role === 'Administrator' ? '/admin' : '/dashboard');
    setSession(next);
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      let current = await restoreSession();
      try {
        const google = await finishGoogle();
        if (google && 'access' in google) {
          if (active) enterDashboard(google);
          return;
        }
        if (google && current) {
          current = { ...current, user: { ...current.user, googleLinked: true } };
          saveSession(current);
          if (active) setToast('Google account linked.');
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Google sign-in failed.';
          if (message === archivedAccountMessage) setArchiveNotice(true);
          else setToast(message);
        }
      } finally {
        if (active) setRestoring(false);
      }
      if (active) setSession(current);
    })();
    return () => { active = false; };
  }, [enterDashboard]);
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('emailChange');
    if (!outcome) return;
    window.history.replaceState({}, '', window.location.pathname);
    setToast(outcome === 'confirmed' ? 'Your email address has been confirmed and updated.' : 'That email-change link is invalid or has expired.');
  }, []);
  useEffect(() => {
    function handleSessionInvalidation(event: Event) {
      returnToLanding();
      if ((event as CustomEvent<string>).detail === 'ACCOUNT_ARCHIVED') setArchiveNotice(true);
      else setToast(sessionExpiredMessage);
    }
    window.addEventListener(sessionInvalidatedEvent, handleSessionInvalidation);
    return () => window.removeEventListener(sessionInvalidatedEvent, handleSessionInvalidation);
  }, [returnToLanding]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(timeout); }, [toast]);
  const notify = useCallback((message: string) => setToast(message), []);

  if (restoring) return <main className="loading-shell">Loading WebSphere…</main>;
  const signedOut = authEntry
    ? <AuthScreen onAuthenticated={enterDashboard} notify={notify} initialMode={authEntry} onBack={() => setAuthEntry(null)} />
    : <LandingPage onGetStarted={setAuthEntry} notify={notify} />;
  return <><>{session ? <Workspace session={session} onSessionChange={setSession} onLogout={returnToLanding} notify={notify} /> : signedOut}</>{archiveNotice ? <div className="modal-ov open"><section className="modal-box" role="alertdialog" aria-modal="true" aria-labelledby="archive-notice"><h2 id="archive-notice">{archivedAccountMessage}</h2><button className="btn" type="button" autoFocus onClick={() => setArchiveNotice(false)}>OK</button></section></div> : null}<Toast message={toast} onDismiss={() => setToast(null)} /></>;
}
