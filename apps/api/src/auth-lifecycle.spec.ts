import { HttpException } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

function serviceWith(overrides: Record<string, unknown> = {}) {
  const service = Object.create(AppService.prototype) as any;
  Object.assign(service, {
    prisma: { user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() } },
    redis: { take: vi.fn(), get: vi.fn(), set: vi.fn(), delete: vi.fn(), setMembers: vi.fn().mockResolvedValue([]) },
    config: { get: vi.fn((key: string) => key === 'PASSWORD_RESET_TTL_SECONDS' ? 3600 : 'test') },
    email: { sendPasswordReset: vi.fn().mockResolvedValue(false) },
    ...overrides,
  });
  return service as AppService & any;
}

describe('guided and locked password reset lifecycle', () => {
  it('denies guided password changes for locked accounts before checking the old password', async () => {
    const prisma = { user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', status: 'locked', passwordHash: 'unused' }) } };
    const service = serviceWith({ prisma });
    await expect(service.changePassword({ id: 'user-1' }, 'old', 'Valid!Pass9', 'Valid!Pass9')).rejects.toMatchObject({ status: 423 });
  });

  it('does not consume a reset token when confirmation is invalid', async () => {
    const service = serviceWith();
    await expect(service.resetPassword('a'.repeat(64), 'Valid!Pass9', 'different')).rejects.toBeInstanceOf(HttpException);
    expect(service.redis.take).not.toHaveBeenCalled();
  });

  it('rejects a wrong current password with PASSWORD_INCORRECT', async () => {
    const passwordHash = await hash('Old!Pass9');
    const prisma = { user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', status: 'active', passwordHash }) } };
    const service = serviceWith({ prisma });
    await expect(service.changePassword({ id: 'user-1' }, 'Wrong!Pass9', 'Valid!Pass9', 'Valid!Pass9')).rejects.toMatchObject({ response: { code: 'PASSWORD_INCORRECT' } });
  });

  it('changes a valid guided password and invalidates existing sessions', async () => {
    const passwordHash = await hash('Old!Pass9');
    const update = vi.fn().mockResolvedValue({});
    const prisma = { user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', status: 'active', passwordHash }), update } };
    const service = serviceWith({ prisma });
    await expect(service.changePassword({ id: 'user-1' }, 'Old!Pass9', 'Valid!Pass9', 'Valid!Pass9')).resolves.toEqual({ ok: true });
    const data = update.mock.calls[0]![0].data;
    await expect(verify(data.passwordHash, 'Valid!Pass9')).resolves.toBe(true);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(service.redis.delete).toHaveBeenCalled();
  });

  it('creates a one-time reset token only for a locked account', async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', email: 'locked@example.edu', status: 'locked' }) } };
    const service = serviceWith({ prisma });
    const result = await service.forgot('locked@example.edu');
    expect(result.ok).toBe(true);
    expect(result.resetToken).toHaveLength(64);
    expect(service.redis.set).toHaveBeenCalledTimes(2);
    expect(service.email.sendPasswordReset).toHaveBeenCalledWith('locked@example.edu', result.resetToken);
  });

  it('consumes the emailed token, unlocks the account, and clears lockout state', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { user: { update } };
    const service = serviceWith({ prisma });
    service.redis.take.mockResolvedValue('user-1');
    await expect(service.resetPassword('a'.repeat(64), 'Valid!Pass9', 'Valid!Pass9')).resolves.toEqual({ ok: true });
    const data = update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ status: 'active', lockedAt: null, failedLogins: 0, tokenVersion: { increment: 1 } });
    await expect(verify(data.passwordHash, 'Valid!Pass9')).resolves.toBe(true);
    expect(service.redis.take).toHaveBeenCalledTimes(1);
  });
});
