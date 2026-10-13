import { jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const sixMonthsInSeconds = 180 * 24 * 60 * 60;
const secret = new TextEncoder().encode('test-secret-that-is-at-least-32-characters');
const user = { id: 'user-1', role: 'Project_Member' as const, tokenVersion: 0, status: 'active' };

function sessionService() {
  const records = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
    take: vi.fn(async (key: string) => { const value = records.get(key) ?? null; records.delete(key); return value; }),
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    addToSet: vi.fn(async () => {}),
    removeFromSet: vi.fn(async () => {}),
  };
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    refreshSecret: secret,
    accessSecret: secret,
    redis,
    config: { get: (key: string) => key === 'JWT_REFRESH_TTL' ? '180d' : '15m' },
    prisma: { user: { findUnique: vi.fn().mockResolvedValue(user) } },
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
    const rotated = await service.refreshToken(first.refresh);
    const next = (await jwtVerify(rotated.refresh, secret)).payload;

    expect(next.exp).toBe(original.exp);
    expect(next.sessionStartedAt).toBe(original.iat);
    expect(redis.set).toHaveBeenLastCalledWith(expect.stringContaining('auth:refresh:'), expect.any(String), original.exp! - Math.floor(Date.now() / 1000));

    vi.setSystemTime(new Date((original.exp! + 1) * 1000));
    await expect(service.refreshToken(rotated.refresh)).rejects.toMatchObject({ status: 401 });
  });
});
