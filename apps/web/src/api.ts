const apiBase = import.meta.env.VITE_API_URL || '/api';
export function apiUrl(path: string) { return `${apiBase}${path}`; }
export const sessionInvalidatedEvent = 'websphere:session-invalidated';
export const sessionExpiredMessage = 'Your session has expired. Please sign in again.';

export type Role = 'Administrator' | 'Project_Leader' | 'Project_Member';
export type User = { id: string; fullName: string; email: string; institution?: string | null; course?: string | null; avatarUrl?: string | null; role: Role };
export type Session = { access: string; refresh: string; role: Role; user: User };

let access = sessionStorage.getItem('ws_access') ?? '';

const sessionKeys = ['ws_access', 'ws_refresh', 'ws_role', 'ws_user'] as const;

export function getAccessToken() { return access; }
export function socketBaseUrl() { return apiBase.startsWith('http') ? apiBase.replace(/\/api\/?$/, '') : window.location.origin; }

export function loadSession(): Session | null {
  const refresh = sessionStorage.getItem('ws_refresh');
  const role = sessionStorage.getItem('ws_role') as Role | null;
  const userText = sessionStorage.getItem('ws_user');
  if (!access || !refresh || !role || !userText) return null;
  try { return { access, refresh, role, user: JSON.parse(userText) as User }; } catch { return null; }
}

export function saveSession(value: Session) {
  access = value.access;
  sessionStorage.setItem('ws_access', value.access);
  sessionStorage.setItem('ws_refresh', value.refresh);
  sessionStorage.setItem('ws_role', value.role);
  sessionStorage.setItem('ws_user', JSON.stringify(value.user));
}

export function clearSession() {
  access = '';
  sessionKeys.forEach((key) => sessionStorage.removeItem(key));
}

type ApiRequestInit = RequestInit & { skipSessionInvalidation?: boolean; skipAuthRetry?: boolean };

function invalidateSession() {
  clearSession();
  window.dispatchEvent(new CustomEvent(sessionInvalidatedEvent));
}

/**
 * Access tokens are short lived (15 minutes) while refresh tokens last 30 days, so an idle tab
 * would otherwise start failing every request. Exchanging the refresh token here keeps the session
 * alive for its full lifetime instead of stranding the user mid-task.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function exchangeRefreshToken(): Promise<boolean> {
  const refresh = sessionStorage.getItem('ws_refresh');
  if (!refresh) return false;
  try {
    const next = await request<{ access: string; refresh: string; role: Role }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh }),
      skipSessionInvalidation: true,
      skipAuthRetry: true,
    });
    access = next.access;
    sessionStorage.setItem('ws_access', next.access);
    sessionStorage.setItem('ws_refresh', next.refresh);
    sessionStorage.setItem('ws_role', next.role);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refresh tokens are single use and rotate on every exchange, and replaying a consumed one bumps
 * the account's token version, which signs every session out. Parallel 401s therefore have to share
 * one exchange rather than each redeeming the same token.
 */
function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= exchangeRefreshToken().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { skipSessionInvalidation, skipAuthRetry, ...requestInit } = init;
  const formData = init.body instanceof FormData;
  // Rebuilt per attempt so a retry picks up the token minted by the refresh.
  const send = () => fetch(apiUrl(path), {
    ...requestInit,
    headers: { ...(!formData ? { 'content-type': 'application/json' } : {}), ...(access ? { authorization: `Bearer ${access}` } : {}), ...requestInit.headers },
  });
  let response = await send();
  let body = await response.json().catch(() => ({}));
  const expired = response.status === 401 && body.code === 'AUTH_UNAUTHENTICATED';
  if (expired && !skipAuthRetry && await refreshOnce()) {
    response = await send();
    body = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    if (!skipSessionInvalidation && response.status === 401 && body.code === 'AUTH_UNAUTHENTICATED') {
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

export async function restoreSession(): Promise<Session | null> {
  const existing = loadSession();
  if (!existing) return null;
  try {
    // request() transparently exchanges an expired access token here, so read the live values
    // afterwards rather than reusing `existing`, whose access token may now be stale.
    const user = await request<User>('/users/me', { skipSessionInvalidation: true });
    const restored: Session = {
      access,
      refresh: sessionStorage.getItem('ws_refresh') ?? existing.refresh,
      role: (sessionStorage.getItem('ws_role') as Role | null) ?? existing.role,
      user,
    };
    saveSession(restored);
    return restored;
  } catch {
    clearSession();
    return null;
  }
}
