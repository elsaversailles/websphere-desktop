import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const caller = { id: 'member-1', role: 'Project_Member', tv: 0 } as const;

describe('event announcements', () => {
  it('lists user-created events visible to the owner or a project member, including events created by members', async () => {
    const event = { id: 'event-1', ownerId: 'member-2', title: 'Team meeting', type: 'meeting', startAt: new Date('2026-11-08T02:00:00Z'), endAt: null, createdAt: new Date(), project: { id: 'project-1', title: 'Project' } };
    const prisma = { calendarEvent: { findMany: vi.fn(async (_query: any) => [event]) }, user: { findMany: vi.fn(async () => [{ id: 'member-2', fullName: 'Team member' }]) } };
    const service = Object.assign(Object.create(AppService.prototype), { prisma }) as AppService;
    expect(await service.eventAnnouncements(caller, 4)).toEqual([expect.objectContaining({ id: event.id, authorName: 'Team member', title: event.title, project: event.project })]);
    expect(prisma.calendarEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { source: 'websphere', OR: [{ ownerId: caller.id }, { project: { members: { some: { userId: caller.id } } } }] }, take: 4,
    }));
    await service.eventAnnouncements(caller);
    expect(prisma.calendarEvent.findMany.mock.calls[1][0]).not.toHaveProperty('take');
  });
});
