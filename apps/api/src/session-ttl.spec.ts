import { jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const sixMonthsInSeconds = 180 * 24 * 60 * 60;
const secret = new TextEncoder().encode('test-secret-that-is-at-least-32-characters');
const user = { id: 'user-1', role: 'Project_Member' as const, tokenVersion: 0, status: 'active' };

function sessionService() {
  const records = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, _expiresInSeconds?: number) => { records.set(key, value); }),
    take: vi.fn(async (key: string) => { const value = records.get(key) ?? null; records.delete(key); return value; }),
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    delete: vi.fn(async (...keys: string[]) => { keys.forEach((key) => records.delete(key)); }),
    addToSet: vi.fn(async () => {}),
    removeFromSet: vi.fn(async () => {}),
  };
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    refreshSecret: secret,
    accessSecret: secret,
    redis,
    audit: { log: vi.fn(async () => {}) },
    config: { get: (key: string) => key === 'JWT_REFRESH_TTL' ? '180d' : '15m' },
    prisma: { user: { findUnique: vi.fn().mockResolvedValue(user) }, systemSetting: { findUnique: vi.fn().mockResolvedValue(null) } },
  });
  return { service, redis };
}

afterEach(() => vi.useRealTimers());

describe('login session lifetime', () => {
  it('issues a refresh token and Redis record valid for 180 days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { service, redis } = sessionService();

    const session = await service.issue(user);
    const { payload } = await jwtVerify(session.refresh, secret);

    expect(payload.exp! - payload.iat!).toBe(sixMonthsInSeconds);
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('auth:refresh:'), expect.any(String), sixMonthsInSeconds);
  });

  it('keeps the original expiration when a refresh token rotates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { service, redis } = sessionService();
    const first = await service.issue(user);
    const original = (await jwtVerify(first.refresh, secret)).payload;

    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    // The user was active before the token rotated; a timeout must not turn a normal refresh
    // into a new session or shorten its original absolute lifetime.
    await redis.set(`auth:session:${String(original.sid)}`, String(Date.now()), sixMonthsInSeconds);
    const rotated = await service.refreshToken(first.refresh);
    const next = (await jwtVerify(rotated.refresh, secret)).payload;

    expect(next.exp).toBe(original.exp);
    expect(next.sessionStartedAt).toBe(original.iat);
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('auth:refresh:'), expect.any(String), original.exp! - Math.floor(Date.now() / 1000));

    vi.setSystemTime(new Date((original.exp! + 1) * 1000));
    await expect(service.refreshToken(rotated.refresh)).rejects.toMatchObject({ status: 401 });
  });

  it('does not refresh a session after its configured inactivity timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { service } = sessionService();
    (service as any).prisma.systemSetting.findUnique.mockResolvedValue({ value: 5 });
    const session = await service.issue(user);

    vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));
    await expect(service.refreshToken(session.refresh)).rejects.toMatchObject({ status: 401 });
  });
});


describe('separate mobile and web sessions', () => {
  it('keeps mobile active when a second web session replaces the first', async () => {
    const { service } = sessionService();
    const web = await service.issue(user);
    const mobile = await service.issue(user, undefined, undefined, 'mobile');
    const newerWeb = await service.issue(user);
    await expect(service.caller(`Bearer ${web.access}`)).rejects.toMatchObject({ status: 401 });
    await expect(service.refreshToken(web.refresh)).rejects.toMatchObject({ status: 401 });
    await expect(service.caller(`Bearer ${mobile.access}`)).resolves.toMatchObject({ id: user.id });
    await expect(service.caller(`Bearer ${newerWeb.access}`)).resolves.toMatchObject({ id: user.id });
    const rotated = await service.refreshToken(mobile.refresh);
    await expect(service.caller(`Bearer ${rotated.access}`)).resolves.toMatchObject({ id: user.id });
  });

  it('signs out only the current session', async () => {
    const { service } = sessionService();
    const web = await service.issue(user);
    const mobile = await service.issue(user, undefined, undefined, 'mobile');
    await service.logout(await service.caller(`Bearer ${mobile.access}`));
    await expect(service.caller(`Bearer ${mobile.access}`)).rejects.toMatchObject({ status: 401 });
    await expect(service.refreshToken(mobile.refresh)).rejects.toMatchObject({ status: 401 });
    await expect(service.caller(`Bearer ${web.access}`)).resolves.toMatchObject({ id: user.id });
  });
});
