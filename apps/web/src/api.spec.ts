import { beforeEach, describe, expect, it, vi } from 'vitest';

type Reply = { status: number; body: unknown };

const unauthorized: Reply = { status: 401, body: { code: 'AUTH_UNAUTHENTICATED', message: 'A valid access token is required' } };

function reply({ status, body }: Reply) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * api.ts reads sessionStorage at module load, so the globals have to exist before it is imported.
 * Stubbing them keeps this suite in the default node environment instead of pulling in jsdom.
 */
async function loadApi(seed: Record<string, string>) {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  const dispatched: string[] = [];
  vi.stubGlobal('window', { dispatchEvent: (event: { type: string }) => { dispatched.push(event.type); return true; }, location: { origin: 'http://localhost' } });
  vi.stubGlobal('CustomEvent', class { constructor(readonly type: string) {} });
  vi.resetModules();
  return { api: await import('./api'), store, dispatched };
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
