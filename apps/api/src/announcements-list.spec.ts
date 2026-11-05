import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const caller = { id: 'member-1', role: 'Project_Member', tv: 0 } as const;
function fixture() {
  const records = Array.from({ length: 25 }, (_, index) => ({ id: `a-${index}`, groupId: 'group-1', authorId: 'leader-1', title: `Announcement ${index}`, body: 'Details', priority: 'normal', createdAt: new Date(), author: { id: 'leader-1', fullName: 'Leader' }, group: { id: 'group-1', name: 'Team' } }));
  const prisma = {
    announcement: { findMany: vi.fn(async (query: any) => records.slice(0, query.take ?? records.length)) },
    groupMember: { findMany: vi.fn(async () => [{ groupId: 'group-1', userId: 'leader-1', role: 'Project_Leader' }]) },
  };
  const service = Object.assign(Object.create(AppService.prototype), { prisma }) as AppService;
  return { service, prisma };
}

describe('announcements list', () => {
  it('returns all announcements from groups the caller belongs to', async () => {
    const { service, prisma } = fixture();
    const announcements = await service.announcements(caller);
    expect(announcements).toHaveLength(25);
    expect(announcements[0]).toMatchObject({ groupName: 'Team', authorName: 'Leader', authorRole: 'Project_Leader' });
    expect(prisma.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { group: { members: { some: { userId: caller.id } } } }, orderBy: { createdAt: 'desc' } }));
    expect(prisma.announcement.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  });

  it('keeps the dashboard preview limited', async () => {
    const { service, prisma } = fixture();
    expect(await service.announcements(caller, 4)).toHaveLength(4);
    expect(prisma.announcement.findMany.mock.calls[0][0].take).toBe(4);
  });
});
