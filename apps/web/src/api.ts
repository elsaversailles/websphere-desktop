const apiBase = import.meta.env.VITE_API_URL || '/api';

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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const formData = init.body instanceof FormData;
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { ...(!formData ? { 'content-type': 'application/json' } : {}), ...(access ? { authorization: `Bearer ${access}` } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiRequestError(body.message ?? 'Request failed', body.code, body.fields);
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
    const user = await request<User>('/users/me');
    const restored = { ...existing, user };
    saveSession(restored);
    return restored;
  } catch {
    try {
      const refreshed = await request<{ access: string; refresh: string; role: Role }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh: existing.refresh }) });
      access = refreshed.access;
      const user = await request<User>('/users/me');
      const restored = { ...refreshed, user };
      saveSession(restored);
      return restored;
    } catch {
      clearSession();
      return null;
    }
  }
}
