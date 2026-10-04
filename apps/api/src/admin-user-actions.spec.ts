import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

type Caller = { id: string; role: 'Administrator'; tv: number };
const admin: Caller = { id: 'admin-1', role: 'Administrator', tv: 0 };

function serviceWith(overrides: Record<string, unknown> = {}) {
  const update = vi.fn().mockResolvedValue({ id: 'user-9', email: 'target@websphere.fun' });
  const findUnique = vi.fn().mockResolvedValue({ email: 'target@websphere.fun' });
  const log = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    prisma: { user: { update, findUnique } },
    audit: { log },
    // admin() is the guard every admin method calls first; stub it so the guard passes.
    admin: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return { service, update, findUnique, log };
}

describe('adminUpdateUser', () => {
  it('only forwards whitelisted fields and ignores attempts to set sensitive columns', async () => {
    const { service, update } = serviceWith();

    await service.adminUpdateUser(admin, 'user-9', {
      fullName: '  New Name  ', role: 'Project_Leader',
      passwordHash: 'pwned', tokenVersion: 999, email: 'evil@websphere.fun',
    } as any);

    const data = update.mock.calls[0][0].data;
    expect(data.fullName).toBe('New Name');
    expect(data.role).toBe('Project_Leader');
    expect(data).not.toHaveProperty('passwordHash');
    expect(data).not.toHaveProperty('email');
    // No status change, so sessions are left intact.
    expect(data).not.toHaveProperty('tokenVersion');
  });

  it('invalidates sessions when a status change makes the account inactive', async () => {
    const { service, update } = serviceWith();

    await service.adminUpdateUser(admin, 'user-9', { status: 'suspended' } as any);

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('suspended');
    expect(data.tokenVersion).toEqual({ increment: 1 });
  });

  it('does not bump tokens when reactivating an account', async () => {
    const { service, update } = serviceWith();

    await service.adminUpdateUser(admin, 'user-9', { status: 'active' } as any);

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('active');
    expect(data).not.toHaveProperty('tokenVersion');
  });

  it('rejects an unknown status', async () => {
    const { service } = serviceWith();
    await expect(service.adminUpdateUser(admin, 'user-9', { status: 'nope' } as any)).rejects.toThrow();
  });

  it('rejects an empty update', async () => {
    const { service } = serviceWith();
    await expect(service.adminUpdateUser(admin, 'user-9', {} as any)).rejects.toThrow();
  });
});

describe('adminDeleteUser', () => {
  it('soft-deletes the account and invalidates its sessions', async () => {
    const { service, update, log } = serviceWith();

    await service.adminDeleteUser(admin, 'user-9');

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('removed');
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(log).toHaveBeenCalled();
  });

  it('refuses to delete the caller themselves', async () => {
    const { service, update } = serviceWith();
    await expect(service.adminDeleteUser(admin, admin.id)).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('404s when the target does not exist', async () => {
    const { service } = serviceWith({ prisma: { user: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) } } });
    await expect(service.adminDeleteUser(admin, 'ghost')).rejects.toThrow();
  });
});
