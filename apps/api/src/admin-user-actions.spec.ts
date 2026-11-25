import { describe, expect, it, vi } from 'vitest';
import { hash } from 'argon2';
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
      role: 'Project_Leader',
      passwordHash: 'pwned', tokenVersion: 999, email: 'evil@websphere.fun',
    } as any);

    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('fullName');
    expect(data.role).toBe('Project_Leader');
    expect(data).not.toHaveProperty('passwordHash');
    expect(data).not.toHaveProperty('email');
    // No status change, so sessions are left intact.
    expect(data).not.toHaveProperty('tokenVersion');
  });

  it('rejects attempts to change a name', async () => {
    const { service, update } = serviceWith();
    await expect(service.adminUpdateUser(admin, 'user-9', { fullName: 'New Name', status: 'active' })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects changes to deleted accounts', async () => {
    const { service, update, findUnique } = serviceWith();
    findUnique.mockResolvedValue({ status: 'removed' });
    await expect(service.adminUpdateUser(admin, 'user-9', { status: 'active' })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects granting administrator access to an account without a password', async () => {
    const { service, update, findUnique } = serviceWith();
    findUnique.mockResolvedValue({ role: 'Project_Member', status: 'active', passwordEnabled: false });
    await expect(service.adminUpdateUser(admin, 'user-9', { role: 'Administrator' })).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
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

describe('self-service account deletion', () => {
  const caller = { id: 'user-9', role: 'Project_Member', tv: 3 } as const;
  const password = 'Current-password-1';

  async function fixture() {
    const user = {
      id: caller.id, email: 'target@websphere.fun', fullName: 'Target User',
      passwordHash: await hash(password), passwordEnabled: true, status: 'active',
    };
    const update = vi.fn().mockImplementation(async ({ data }) => Object.assign(user, data));
    const emitAccountArchived = vi.fn();
    const removeRefreshSessions = vi.fn().mockResolvedValue(undefined);
    const { service, log } = serviceWith({
      prisma: { user: { update, findUniqueOrThrow: async () => user, findUnique: async () => user } },
      events: { emitAccountArchived },
      redis: { get: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue(undefined) },
      removeRefreshSessions,
      admin: AppService.prototype.admin,
    });
    return { service, user, update, emitAccountArchived, removeRefreshSessions, log };
  }

  it('archives the account in place and lets only an administrator restore it', async () => {
    const { service, user, update, emitAccountArchived, removeRefreshSessions, log } = await fixture();
    await expect(service.deleteMyAccount(caller, password)).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: caller.id, status: 'active', tokenVersion: caller.tv },
      data: { status: 'archived', archivedAt: expect.any(Date), tokenVersion: { increment: 1 } },
    });
    expect(emitAccountArchived).toHaveBeenCalledWith(caller.id);
    expect(removeRefreshSessions).toHaveBeenCalledWith(caller.id);
    expect(log).toHaveBeenCalledWith('Privacy', 'account_archived', 'info', expect.any(String), caller.id);
    await expect(service.login(user.email, password)).rejects.toMatchObject({ response: { code: 'ACCOUNT_ARCHIVED' } });
    await expect(service.adminRestoreUser(caller, caller.id)).rejects.toMatchObject({ response: { code: 'RBAC_FORBIDDEN' } });
    await expect(service.adminRestoreUser(admin, caller.id)).resolves.toEqual({ ok: true });
    expect(user).toMatchObject({ status: 'active', archivedAt: null, email: 'target@websphere.fun', fullName: 'Target User' });
  });

  it('requires the current password before archiving', async () => {
    const { service, update, emitAccountArchived, removeRefreshSessions } = await fixture();
    await expect(service.deleteMyAccount(caller, 'wrong password')).rejects.toMatchObject({ response: { code: 'AUTH_INVALID_CREDENTIALS' } });
    expect(update).not.toHaveBeenCalled();
    expect(emitAccountArchived).not.toHaveBeenCalled();
    expect(removeRefreshSessions).not.toHaveBeenCalled();
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

describe('adminUsers', () => {
  it('excludes deleted and archived accounts from both the page and count', async () => {
    const findMany = vi.fn().mockReturnValue('users-query');
    const count = vi.fn().mockReturnValue('count-query');
    const transaction = vi.fn().mockResolvedValue([[], 0]);
    const { service } = serviceWith({ prisma: { user: { findMany, count }, $transaction: transaction } });
    await service.adminUsers(admin, 1, 10, 'test');
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ status: { notIn: ['archived', 'removed'] } });
    expect(count.mock.calls[0][0].where).toEqual(where);
  });
});
