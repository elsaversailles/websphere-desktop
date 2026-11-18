import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const caller = { id: 'member', role: 'Project_Member', tv: 0 } as const;
function fixture() {
  const membership = { userId: caller.id, role: 'Project_Member', project: { group: { members: [{ userId: caller.id, role: 'Project_Member' }] } } };
  const prisma = {
    project: { findMany: vi.fn().mockResolvedValue([{ id: 'project' }]) },
    joinCode: { findUnique: vi.fn().mockResolvedValue({ active: true, groupId: 'group', group: { id: 'group' } }) },
    groupRoleHistory: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    projectMember: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(async () => membership), deleteMany: vi.fn(), createMany: vi.fn() },
    groupMember: { upsert: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ role: 'Project_Member' }) },
    task: { findMany: vi.fn().mockResolvedValue([]) }, user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  Object.assign(prisma, { $queryRaw: vi.fn().mockResolvedValue([]), $transaction: async (fn: any) => fn(prisma) });
  const events = { emitGroupMembershipRevoked: vi.fn() };
  const service = Object.assign(Object.create(AppService.prototype), { prisma, events }) as AppService;
  return { service, prisma, events, membership };
}

describe('group membership and historical assignments', () => {
  it('denies stale project membership after removal and restores access when the group is rejoined', async () => {
    const { service, membership } = fixture();
    await expect(service.projectMember('project', caller.id)).resolves.toMatchObject({ userId: caller.id });
    membership.project.group.members = [];
    await expect(service.projectMember('project', caller.id)).rejects.toMatchObject({ status: 403 });
    membership.project.group.members = [{ userId: caller.id, role: 'Project_Member' }];
    await expect(service.projectMember('project', caller.id)).resolves.toMatchObject({ userId: caller.id });
    await expect(service.projectMember('project', caller.id, true)).rejects.toMatchObject({ status: 403 });
  });
  it('keeps assignments and project membership when leaving, and revokes live access', async () => {
    const { service, prisma, events } = fixture();
    await service.leaveGroup(caller, 'group');
    expect(prisma.groupMember.delete).toHaveBeenCalledOnce();
    expect(prisma.projectMember.deleteMany).not.toHaveBeenCalled();
    expect(events.emitGroupMembershipRevoked).toHaveBeenCalledWith('group', caller.id);
  });
  it('keeps the last-leader safeguard without deleting membership', async () => {
    const { service, prisma } = fixture();
    prisma.groupMember.findUnique.mockResolvedValueOnce({ role: 'Project_Leader' });
    Object.assign(prisma.groupMember, { count: vi.fn().mockResolvedValue(1) });
    await expect(service.leaveGroup(caller, 'group')).rejects.toMatchObject({ status: 400 });
    expect(prisma.groupMember.delete).not.toHaveBeenCalled();
  });
  it('requires current group access and preserves legacy active assignments in My Tasks', async () => {
    const { service, prisma } = fixture();
    await service.myTasks(caller, {});
    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ assignments: { some: { assigneeId: caller.id, active: true } }, project: { OR: [{ groupId: null }, { group: { members: { some: { userId: caller.id } } } }] } });
  });
  it('restores project membership deleted by the old leave behavior when the member rejoins', async () => {
    const { service, prisma } = fixture();
    await service.joinGroup(caller, 'valid-code');
    expect(prisma.projectMember.createMany).toHaveBeenCalledWith({ data: [{ projectId: 'project', userId: caller.id }], skipDuplicates: true });
  });
  it.each(['task', 'taskStatus'] as const)('denies %s for a stale assignee after group membership is revoked', async (method) => {
    const { service, prisma } = fixture();
    Object.assign(prisma.task, { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'task', projectId: 'project', project: { groupId: 'group' }, assignments: [{ assigneeId: caller.id }] }) });
    prisma.groupMember.findUnique.mockResolvedValueOnce(null);
    await expect(method === 'task' ? service.task(caller, 'task') : service.taskStatus(caller, 'task', 'ongoing')).rejects.toMatchObject({ status: 403 });
  });

});
