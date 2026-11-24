const apiBase = import.meta.env.VITE_API_URL || '/api';
export function apiUrl(path: string) { return `${apiBase}${path}`; }
export const sessionInvalidatedEvent = 'websphere:session-invalidated';
export const archivedAccountMessage = 'YOUR ACCOUNT IS ARCHIVED, PLEASE CONTACT OUR ADMIN';
export const sessionExpiredMessage = 'Your session has expired. Please sign in again.';

export type Role = 'Administrator' | 'Project_Leader' | 'Project_Member';
export type User = { id: string; fullName: string; email: string; institution?: string | null; course?: string | null; avatarUrl?: string | null; googleLinked?: boolean; passwordEnabled?: boolean; role: Role };
export type Session = { access: string; refresh: string; role: Role; user: User };

const sessionKeys = ['ws_access', 'ws_refresh', 'ws_role', 'ws_user'] as const;

/**
 * Sessions live in localStorage, not sessionStorage, so they survive a page reload and are shared
 * across tabs of the same origin. sessionStorage is scoped to a single tab and cleared when that tab
 * closes, which meant opening WebSphere in a new tab (or restoring one) always landed on the sign-in
 * screen. Logout still fully invalidates the session server-side (token version bump) and here.
 */
const sessionStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = (() => {
  try {
    const probe = '__ws_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Private-mode or disabled storage: fall back to sessionStorage so the current tab still works.
    return window.sessionStorage;
  }
})();

// One-time migration so anyone with a session already open in sessionStorage is not signed out by this change.
(() => {
  try {
    for (const key of sessionKeys) {
      const legacy = window.sessionStorage.getItem(key);
      if (legacy !== null && sessionStore.getItem(key) === null) sessionStore.setItem(key, legacy);
      window.sessionStorage.removeItem(key);
    }
  } catch { /* ignore storage access failures */ }
})();

let access = sessionStore.getItem('ws_access') ?? '';
let sessionEpoch = 0;

export function getAccessToken() { return access; }
export function socketBaseUrl() { return apiBase.startsWith('http') ? apiBase.replace(/\/api\/?$/, '') : window.location.origin; }

export function loadSession(): Session | null {
  const refresh = sessionStore.getItem('ws_refresh');
  const role = sessionStore.getItem('ws_role') as Role | null;
  const userText = sessionStore.getItem('ws_user');
  if (!access || !refresh || !role || !userText) return null;
  try { return { access, refresh, role, user: JSON.parse(userText) as User }; } catch { return null; }
}

export function saveSession(value: Session) {
  if (value.refresh !== sessionStore.getItem('ws_refresh')) sessionEpoch += 1;
  access = value.access;
  sessionStore.setItem('ws_access', value.access);
  sessionStore.setItem('ws_refresh', value.refresh);
  sessionStore.setItem('ws_role', value.role);
  sessionStore.setItem('ws_user', JSON.stringify(value.user));
}

export function saveSessionUser(user: User) {
  const current = loadSession();
  if (!current || current.user.id !== user.id) return null;
  sessionStore.setItem('ws_user', JSON.stringify(user));
  sessionStore.setItem('ws_role', user.role);
  return { ...current, role: user.role, user };
}

export function clearSession() {
  sessionEpoch += 1;
  access = '';
  sessionKeys.forEach((key) => sessionStore.removeItem(key));
}

type ApiRequestInit = RequestInit & { skipSessionInvalidation?: boolean; skipAuthRetry?: boolean };

export function invalidateSession(code = 'AUTH_UNAUTHENTICATED') {
  clearSession();
  window.dispatchEvent(new CustomEvent(sessionInvalidatedEvent, { detail: code }));
}

/**
 * Access tokens are short lived (15 minutes) while refresh sessions last 180 days, so an idle tab
 * would otherwise start failing every request. Exchanging the refresh token here keeps the session
 * alive for its full lifetime instead of stranding the user mid-task.
 */
type RefreshResult = 'refreshed' | 'expired' | 'unavailable';
let refreshInFlight: Promise<RefreshResult> | null = null;

async function exchangeRefreshToken(epoch: number): Promise<RefreshResult> {
  if (epoch !== sessionEpoch) return 'expired';
  const refresh = sessionStore.getItem('ws_refresh');
  if (!refresh) return 'expired';
  const storedAccess = sessionStore.getItem('ws_access');
  if (storedAccess && storedAccess !== access) {
    access = storedAccess;
    return 'refreshed';
  }
  try {
    const next = await request<{ access: string; refresh: string; role: Role }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh }),
      skipSessionInvalidation: true,
      skipAuthRetry: true,
    });
    if (!next.access || !next.refresh) return 'unavailable';
    if (epoch !== sessionEpoch || refresh !== sessionStore.getItem('ws_refresh')) return 'expired';
    access = next.access;
    sessionStore.setItem('ws_access', next.access);
    sessionStore.setItem('ws_refresh', next.refresh);
    sessionStore.setItem('ws_role', next.role);
    return 'refreshed';
  } catch (error) {
    if (error instanceof ApiRequestError && ['AUTH_UNAUTHENTICATED', 'ACCOUNT_ARCHIVED'].includes(error.code ?? '')) return 'expired';
    return 'unavailable';
  }
}

/** Collapse refresh rotation in this tab and coordinate with other tabs where Web Locks is available. */
function refreshOnce(epoch: number): Promise<RefreshResult> {
  if (!refreshInFlight) {
    const exchange = () => exchangeRefreshToken(epoch);
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    refreshInFlight = Promise.resolve(locks ? locks.request('websphere-session-refresh', exchange) : exchange())
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { skipSessionInvalidation, skipAuthRetry, ...requestInit } = init;
  const formData = init.body instanceof FormData;
  const epoch = sessionEpoch;
  let sentAccess = access;
  const send = () => {
    sentAccess = access;
    return fetch(apiUrl(path), {
      ...requestInit,
      headers: { ...(!formData ? { 'content-type': 'application/json' } : {}), ...(sentAccess ? { authorization: `Bearer ${sentAccess}` } : {}), ...requestInit.headers },
    });
  };
  let response = await send();
  let body = await response.json().catch(() => ({}));
  const expired = () => response.status === 401 && body.code === 'AUTH_UNAUTHENTICATED';
  if (expired() && !skipAuthRetry && epoch === sessionEpoch) {
    const refreshed = sentAccess !== access ? 'refreshed' : await refreshOnce(epoch);
    if (refreshed === 'unavailable') throw new ApiRequestError('Could not reconnect to WebSphere. Please try again.', 'AUTH_REFRESH_UNAVAILABLE');
    if (refreshed === 'refreshed' && epoch === sessionEpoch) {
      response = await send();
      body = await response.json().catch(() => ({}));
    }
  }
  if (!response.ok) {
    if (epoch === sessionEpoch && body.code === 'ACCOUNT_ARCHIVED' && sentAccess) invalidateSession('ACCOUNT_ARCHIVED');
    if (!skipSessionInvalidation && expired() && epoch === sessionEpoch) {
      invalidateSession();
      throw new ApiRequestError(sessionExpiredMessage, body.code, body.fields);
    }
    throw new ApiRequestError(body.message ?? 'Request failed', body.code, body.fields);
  }
  return body as T;
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function authenticate(email: string, password: string, admin = false): Promise<Session> {
  const result = await request<{ access: string; refresh: string; role: Role; user: User }>(admin ? '/auth/admin/login' : '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  return result;
}

/**
 * React 18 StrictMode mounts effects twice in development, so restoreSession() can be called twice
 * on load. Because an expired access token triggers a single-use refresh exchange, two concurrent
 * restores would redeem the same refresh token — the second redemption looks like a replay to the
 * server, which bumps the account's token version and signs every session out. Sharing one in-flight
 * restore (and keeping it cached so a reload mid-flight does not start a second) prevents that.
 */
let restoreInFlight: Promise<Session | null> | null = null;

async function performRestore(): Promise<Session | null> {
  const existing = loadSession();
  if (!existing) return null;
  try {
    // request() transparently exchanges an expired access token here, so read the live values
    // afterwards rather than reusing `existing`, whose access token may now be stale.
    const user = await request<User>('/users/me', { skipSessionInvalidation: true });
    const restored: Session = {
      access,
      refresh: sessionStore.getItem('ws_refresh') ?? existing.refresh,
      role: (sessionStore.getItem('ws_role') as Role | null) ?? existing.role,
      user,
    };
    saveSession(restored);
    return restored;
  } catch (error) {
    if (!(error instanceof ApiRequestError) || !['AUTH_UNAUTHENTICATED', 'ACCOUNT_ARCHIVED'].includes(error.code ?? '')) return existing;
    clearSession();
    return null;
  }
}

export async function restoreSession(): Promise<Session | null> {
  restoreInFlight ??= performRestore().finally(() => { restoreInFlight = null; });
  return restoreInFlight;
}
