import { useCallback, useEffect, useState } from 'react';
import { loadSession, restoreSession, type Session } from '../api';
import { AuthScreen } from './AuthScreen';
import { Toast } from './Toast';
import { Workspace } from './Workspace';

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [restoring, setRestoring] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { void restoreSession().then(setSession).finally(() => setRestoring(false)); }, []);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(timeout); }, [toast]);
  const notify = useCallback((message: string) => setToast(message), []);

  if (restoring) return <main className="loading-shell">Loading WebSphere…</main>;
  return <><>{session ? <Workspace session={session} onLogout={() => setSession(null)} notify={notify} /> : <AuthScreen onAuthenticated={setSession} notify={notify} />}</><Toast message={toast} onDismiss={() => setToast(null)} /></>;
}
