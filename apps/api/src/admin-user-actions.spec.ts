import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

type Caller = { id: string; role: 'Administrator'; tv: number };
const admin: Caller = { id: 'admin-1', role: 'Administrator', tv: 0 };

function serviceWith(overrides: Record<string, unknown> = {}) {
  const update = vi.fn().mockResolvedValue({ id: 'user-9', email: 'target@websphere.fun' });
  const findUnique = vi.fn().mockResolvedValue({ email: 'target@websphere.fun', status: 'active' });
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

describe('adminArchiveUser', () => {
  it('emails the account owner after archiving', async () => {
    const sendAccountStatusChange = vi.fn().mockResolvedValue(true);
    const { service } = serviceWith({ email: { sendAccountStatusChange }, prisma: { user: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ email: 'target@websphere.fun', fullName: 'Target User', status: 'active' }) } } });
    await service.adminArchiveUser(admin, 'user-9');
    expect(sendAccountStatusChange).toHaveBeenCalledWith('target@websphere.fun', 'Target User', 'archived');
  });
  it('archives the account, stamps the archive time, and invalidates its sessions', async () => {
    const { service, update, log } = serviceWith();

    await service.adminArchiveUser(admin, 'user-9');

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('archived');
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(log).toHaveBeenCalled();
  });

  it('refuses to archive the caller themselves', async () => {
    const { service, update } = serviceWith();
    await expect(service.adminArchiveUser(admin, admin.id)).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects archiving an already-archived account', async () => {
    const { service, update } = serviceWith({ prisma: { user: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ email: 'a@b.c', status: 'archived' }) } } });
    await expect(service.adminArchiveUser(admin, 'user-9')).rejects.toThrow();
    // The update came from the fresh mock in overrides, which must not have been called.
  });

  it('404s when the target does not exist', async () => {
    const { service } = serviceWith({ prisma: { user: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) } } });
    await expect(service.adminArchiveUser(admin, 'ghost')).rejects.toThrow();
  });
});

describe('adminRestoreUser', () => {
  it('emails the account owner after reactivation', async () => {
    const sendAccountStatusChange = vi.fn().mockResolvedValue(true);
    const { service } = serviceWith({ email: { sendAccountStatusChange }, prisma: { user: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ email: 'target@websphere.fun', fullName: 'Target User', status: 'archived' }) } } });
    await service.adminRestoreUser(admin, 'user-9');
    expect(sendAccountStatusChange).toHaveBeenCalledWith('target@websphere.fun', 'Target User', 'active');
  });
  it('restores an archived account to active and clears the archive time', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'user-9', email: 'a@b.c' });
    const log = vi.fn().mockResolvedValue(undefined);
    const { service } = serviceWith({ prisma: { user: { update, findUnique: vi.fn().mockResolvedValue({ email: 'a@b.c', status: 'archived' }) } }, audit: { log } });

    await service.adminRestoreUser(admin, 'user-9');

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('active');
    expect(data.archivedAt).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it('rejects restoring an account that is not archived', async () => {
    const { service } = serviceWith();
    await expect(service.adminRestoreUser(admin, 'user-9')).rejects.toThrow();
  });
});
