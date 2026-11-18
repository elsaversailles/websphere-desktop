import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

function fixture() {
  const members = new Map<string, any>([['host', { userId: 'host', role: 'Project_Leader' }], ['peer', { userId: 'peer', role: 'Project_Leader' }]]);
  const history = new Map<string, any>();
  const prisma: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    groupMember: {
      findUnique: vi.fn(async ({ where }) => members.get(where.groupId_userId.userId) ?? null),
      count: vi.fn(async () => [...members.values()].filter((m) => m.role === 'Project_Leader').length),
      update: vi.fn(async ({ where, data }) => { const m = { ...members.get(where.groupId_userId.userId), ...data }; members.set(m.userId, m); return m; }),
      delete: vi.fn(async ({ where }) => { members.delete(where.groupId_userId.userId); }),
      create: vi.fn(async ({ data }) => { members.set(data.userId, data); return data; }),
      upsert: vi.fn(async ({ where, create }) => { if (!members.has(where.groupId_userId.userId)) members.set(create.userId, create); return members.get(where.groupId_userId.userId); }),
    },
    groupRoleHistory: {
      findUnique: vi.fn(async ({ where }) => history.get(where.groupId_userId.userId) ?? null),
      upsert: vi.fn(async ({ create, update }) => { const row = history.has(create.userId) ? { ...history.get(create.userId), ...update } : create; history.set(create.userId, row); return row; }),
    },
    projectMember: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), createMany: vi.fn() },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    joinCode: { findUnique: vi.fn().mockResolvedValue({ active: true, groupId: 'g', group: { id: 'g' } }) },
    group: { findUnique: vi.fn().mockResolvedValue({ name: 'Team' }), findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Team' }) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  const service = Object.assign(Object.create(AppService.prototype), { prisma, notify: vi.fn(), events: { emitGroupMembershipRevoked: vi.fn() } }) as AppService;
  return { service, prisma, members, history };
}
const host = { id: 'host', role: 'Project_Member', tv: 0 } as const;
const peer = { ...host, id: 'peer' };

describe('remembered group roles', () => {
  it('restores a removed admin through both invitation and add-member paths', async () => {
    const { service, members, history } = fixture();
    await service.removeGroupMember(host, 'g', 'peer');
    expect(members.has('peer')).toBe(false);
    expect(history.get('peer').role).toBe('Project_Leader');
    await service.joinGroup(peer, 'code');
    expect(members.get('peer').role).toBe('Project_Leader');
    await service.removeGroupMember(host, 'g', 'peer');
    await service.addGroupMember(host, 'g', 'peer');
    expect(members.get('peer').role).toBe('Project_Leader');
  });
  it('demotes project permissions and preserves the explicit demotion after rejoining', async () => {
    const { service, prisma, members } = fixture();
    await service.demoteGroupMember(host, 'g', 'peer');
    expect(prisma.projectMember.updateMany).toHaveBeenCalledWith({ where: { userId: 'peer', project: { groupId: 'g' } }, data: { role: 'Project_Member' } });
    // A stale legacy project leader row must never override explicit role history.
    prisma.projectMember.findFirst.mockResolvedValue({ role: 'Project_Leader' });
    await service.removeGroupMember(host, 'g', 'peer');
    await service.joinGroup(peer, 'code');
    expect(members.get('peer').role).toBe('Project_Member');
    await service.promoteGroupMember(host, 'g', 'peer');
    expect(members.get('peer').role).toBe('Project_Leader');
  });
  it('prevents last-leader demotion and removal', async () => {
    const { service, prisma, members } = fixture();
    members.delete('peer');
    await expect(service.demoteGroupMember(host, 'g', 'host')).rejects.toMatchObject({ status: 400 });
    await expect(service.removeGroupMember(host, 'g', 'host')).rejects.toMatchObject({ status: 400 });
    expect(prisma.groupMember.update).not.toHaveBeenCalled();
    expect(prisma.groupMember.delete).not.toHaveBeenCalled();
  });
  it('rejects stale project leadership when the current group role is member', async () => {
    const { service, prisma } = fixture();
    prisma.projectMember.findUnique = vi.fn().mockResolvedValue({ userId: 'peer', role: 'Project_Leader', project: { group: { members: [{ role: 'Project_Member' }] } } });
    await expect(service.projectMember('p', 'peer', true)).rejects.toMatchObject({ status: 403 });
  });
  it('recovers a pre-history leader while keeping a new member at member role', async () => {
    const { service, prisma, members } = fixture();
    members.delete('peer');
    prisma.projectMember.findFirst.mockResolvedValueOnce({ role: 'Project_Leader' });
    await service.joinGroup(peer, 'code');
    await service.joinGroup({ ...peer, id: 'new' }, 'code');
    expect(members.get('peer').role).toBe('Project_Leader');
    expect(members.get('new').role).toBe('Project_Member');
  });
});
