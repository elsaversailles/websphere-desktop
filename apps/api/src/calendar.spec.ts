import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

describe('calendar event visibility', () => {
  it('loads personal events and events from projects the caller belongs to', async () => {
    const findEvents = vi.fn().mockResolvedValue([
      { id: 'personal-event', ownerId: 'user-1', projectId: null },
      { id: 'team-event', ownerId: 'user-2', projectId: 'project-1' },
    ]);
    const service = Object.create(AppService.prototype) as AppService;
    Object.assign(service, {
      prisma: {
        calendarEvent: { findMany: findEvents },
        project: { findMany: vi.fn().mockResolvedValue([]) },
        task: { findMany: vi.fn().mockResolvedValue([]) },
      },
    });

    const result = await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 });

    expect(result.events.map((event: { id: string }) => event.id)).toEqual(['personal-event', 'team-event']);
    expect(findEvents).toHaveBeenCalledWith({
      where: { OR: [{ ownerId: 'user-1' }, { project: { members: { some: { userId: 'user-1' } } } }] },
      orderBy: { startAt: 'asc' },
    });
  });
});
