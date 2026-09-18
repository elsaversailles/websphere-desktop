import { HttpException } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { createHash } from 'node:crypto';
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

  it('sends a registration OTP before permitting account creation', async () => {
    const sendRegistrationVerification = vi.fn().mockResolvedValue(true);
    const set = vi.fn().mockResolvedValue(undefined);
    const service = serviceWith({
      prisma: { user: { findUnique: vi.fn().mockResolvedValue(null) } },
      redis: { incrementWithExpiry: vi.fn().mockResolvedValue(1), set },
      config: { get: vi.fn((key: string) => ({ REGISTRATION_OTP_SEND_WINDOW_SECONDS: 900, REGISTRATION_OTP_MAX_SENDS: 3, REGISTRATION_OTP_TTL_SECONDS: 600 }[key] ?? 'test')) },
      email: { sendRegistrationVerification },
    });

    const result = await service.sendRegistrationOtp('New.Member@Example.edu');

    expect(result.verificationId).toMatch(/^[a-f0-9]{64}$/);
    expect(sendRegistrationVerification).toHaveBeenCalledWith('new.member@example.edu', expect.stringMatching(/^\d{6}$/));
    expect(set).toHaveBeenCalledWith(expect.stringContaining(result.verificationId), expect.any(String), 600);
  });

  it('creates an account only after a matching one-time registration code', async () => {
    const verificationId = 'a'.repeat(64);
    const code = '123456';
    const codeHash = createHash('sha256').update(`${verificationId}:${code}`).digest('hex');
    const create = vi.fn().mockResolvedValue({ id: 'user-1', email: 'new@example.edu', passwordHash: 'secret', tokenVersion: 0, role: 'Project_Member' });
    const service = serviceWith({
      prisma: { user: { findUnique: vi.fn().mockResolvedValue(null), create } },
      redis: { get: vi.fn().mockResolvedValue(JSON.stringify({ email: 'new@example.edu', codeHash })), take: vi.fn().mockResolvedValue(JSON.stringify({ email: 'new@example.edu', codeHash })), delete: vi.fn().mockResolvedValue(1) },
      audit: { log: vi.fn().mockResolvedValue(undefined) },
    });
    service.issue = vi.fn().mockResolvedValue({ access: 'access', refresh: 'refresh', role: 'Project_Member' });

    await expect(service.register({ fullName: 'New Member', email: 'new@example.edu', password: 'Valid!Pass9', institution: 'STI College', course: 'BSIT', verificationId, verificationCode: code })).resolves.toMatchObject({ user: { email: 'new@example.edu' } });

    const data = create.mock.calls[0]![0].data;
    await expect(verify(data.passwordHash, 'Valid!Pass9')).resolves.toBe(true);
    expect(data).not.toHaveProperty('verificationCode');
    expect(data).not.toHaveProperty('verificationId');
  });
});
