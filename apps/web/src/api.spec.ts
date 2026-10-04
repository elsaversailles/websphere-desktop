import { beforeEach, describe, expect, it, vi } from 'vitest';

type Reply = { status: number; body: unknown };

const unauthorized: Reply = { status: 401, body: { code: 'AUTH_UNAUTHENTICATED', message: 'A valid access token is required' } };

function reply({ status, body }: Reply) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function memoryStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    api: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

/**
 * api.ts now keeps the session in localStorage (shared across tabs and reloads) and reads it at
 * module load, so both storages have to exist before it is imported. Stubbing them keeps this suite
 * in the default node environment instead of pulling in jsdom. The seed goes into localStorage to
 * mirror where live sessions are persisted; sessionStorage starts empty like a fresh tab.
 */
async function loadApi(seed: Record<string, string>) {
  const local = memoryStorage(seed);
  const session = memoryStorage();
  vi.stubGlobal('localStorage', local.api);
  vi.stubGlobal('sessionStorage', session.api);
  const dispatched: string[] = [];
  vi.stubGlobal('window', { localStorage: local.api, sessionStorage: session.api, dispatchEvent: (event: { type: string }) => { dispatched.push(event.type); return true; }, location: { origin: 'http://localhost' } });
  vi.stubGlobal('CustomEvent', class { constructor(readonly type: string) {} });
  vi.resetModules();
  return { api: await import('./api'), store: local.store, dispatched };
}

/** Records every fetch call so we can assert on the Authorization header each attempt carried. */
function fetchStub(replies: Reply[]) {
  const calls: Array<{ path: string; method: string; authorization?: string }> = [];
  const stub = vi.fn(async (path: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ path, method: String(init.method ?? 'GET'), authorization: headers.authorization });
    return reply(replies[Math.min(calls.length - 1, replies.length - 1)]) as unknown as Response;
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

const seeded = { ws_access: 'expired-access', ws_refresh: 'refresh-1', ws_role: 'Project_Member', ws_user: JSON.stringify({ id: 'u1', fullName: 'Ada', email: 'a@b.c', role: 'Project_Member' }) };

describe('request token refresh', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('exchanges an expired access token and replays the original request', async () => {
    const { api, store } = await loadApi(seeded);
    const calls = fetchStub([
      unauthorized,
      { status: 200, body: { access: 'fresh-access', refresh: 'refresh-2', role: 'Project_Member' } },
      { status: 200, body: { id: 'project-1' } },
    ]);

    await expect(api.request('/projects', { method: 'POST', body: '{}' })).resolves.toEqual({ id: 'project-1' });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/projects',
      'POST /api/auth/refresh',
      'POST /api/projects',
    ]);
    // The replay must carry the new token, not the one that just failed.
    expect(calls[0].authorization).toBe('Bearer expired-access');
    expect(calls[2].authorization).toBe('Bearer fresh-access');
    // The rotated refresh token has to be persisted or the next exchange replays a consumed one.
    expect(store.get('ws_refresh')).toBe('refresh-2');
    expect(store.get('ws_access')).toBe('fresh-access');
  });

  it('shares a single refresh exchange across concurrent 401s', async () => {
    const { api } = await loadApi(seeded);
    const calls = fetchStub([
      unauthorized, unauthorized, unauthorized,
      { status: 200, body: { access: 'fresh-access', refresh: 'refresh-2', role: 'Project_Member' } },
      { status: 200, body: { ok: true } },
    ]);

    await Promise.all([api.request('/dashboard'), api.request('/groups'), api.request('/tasks/mine')]);

    const refreshCalls = calls.filter((call) => call.path === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('invalidates the session when the refresh token is rejected', async () => {
    const { api, dispatched } = await loadApi(seeded);
    fetchStub([unauthorized]);

    await expect(api.request('/projects', { method: 'POST', body: '{}' })).rejects.toThrow(api.sessionExpiredMessage);
    expect(dispatched).toContain(api.sessionInvalidatedEvent);
  });

  it('does not attempt a refresh when no refresh token is stored', async () => {
    const { api } = await loadApi({ ws_access: 'expired-access' });
    const calls = fetchStub([unauthorized]);

    await expect(api.request('/projects')).rejects.toThrow(api.sessionExpiredMessage);
    expect(calls.filter((call) => call.path === '/api/auth/refresh')).toHaveLength(0);
  });
});

describe('restoreSession', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('shares one restore across concurrent calls so a single-use refresh token is not replayed', async () => {
    const { api, store } = await loadApi(seeded);
    // /users/me is unauthorized on the stale access token, forcing exactly one refresh exchange.
    const calls = fetchStub([
      unauthorized,
      { status: 200, body: { access: 'fresh-access', refresh: 'refresh-2', role: 'Project_Member' } },
      { status: 200, body: { id: 'u1', fullName: 'Ada', email: 'a@b.c', role: 'Project_Member' } },
    ]);

    // StrictMode double-invokes effects, so restoreSession() can run twice on mount.
    const [first, second] = await Promise.all([api.restoreSession(), api.restoreSession()]);

    expect(first?.user.id).toBe('u1');
    expect(second?.user.id).toBe('u1');
    expect(calls.filter((call) => call.path === '/api/auth/refresh')).toHaveLength(1);
    expect(store.get('ws_refresh')).toBe('refresh-2');
  });

  it('restores from a persisted session when the access token is still valid', async () => {
    const { api } = await loadApi(seeded);
    const calls = fetchStub([{ status: 200, body: { id: 'u1', fullName: 'Ada', email: 'a@b.c', role: 'Project_Member' } }]);

    await expect(api.restoreSession()).resolves.toMatchObject({ user: { id: 'u1' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/users/me');
  });

  it('returns null without a stored session', async () => {
    const { api } = await loadApi({});
    const calls = fetchStub([{ status: 200, body: {} }]);

    await expect(api.restoreSession()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
