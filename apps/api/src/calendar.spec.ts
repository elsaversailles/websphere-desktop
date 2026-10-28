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
        notification: { findMany: vi.fn().mockResolvedValue([]) },
      },
    });

    const result = await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 });

    expect(result.events.map((event: { id: string }) => event.id)).toEqual(['personal-event', 'team-event']);
    expect(findEvents).toHaveBeenCalledWith({
      where: { OR: [{ ownerId: 'user-1' }, { project: { members: { some: { userId: 'user-1' } } } }] },
      orderBy: { startAt: 'asc' },
    });
  });

  it('projects dated tasks for their creator or current assignee, including completed history', async () => {
    const tasks = [{ id: 'created-task', title: 'Write draft', deadline: new Date('2026-10-28') }, { id: 'assigned-task', title: 'Review draft', deadline: new Date('2026-11-02') }];
    const findTasks = vi.fn().mockResolvedValue(tasks);
    const findNotifications = vi.fn().mockResolvedValue([{ id: 'assignment-note', type: 'task_assignment', relatedId: 'assigned-task' }]);
    const service = Object.assign(Object.create(AppService.prototype), { prisma: {
      calendarEvent: { findMany: vi.fn().mockResolvedValue([]) }, project: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: findTasks }, notification: { findMany: findNotifications },
    } }) as AppService;

    const result = await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 });

    expect(findTasks).toHaveBeenCalledWith({ where: {
      OR: [{ createdBy: 'user-1' }, { assignments: { some: { assigneeId: 'user-1', active: true } } }], deadline: { not: null },
    }, select: { id: true, title: true, deadline: true }, orderBy: { deadline: 'asc' } });
    expect(result.hints).toEqual(tasks.map((task) => ({ ...task, type: 'task_deadline' })));
    expect(findNotifications).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', read: false, relatedType: 'task', type: { in: ['task_assignment', 'deadline_reminder'] } } }));
    expect(result.notifications).toEqual([{ id: 'assignment-note', type: 'task_assignment', relatedId: 'assigned-task' }]);
  });

  it('applies requested bounds to task due dates as well as event dates', async () => {
    const findTasks = vi.fn().mockResolvedValue([]);
    const service = Object.assign(Object.create(AppService.prototype), { prisma: {
      calendarEvent: { findMany: vi.fn().mockResolvedValue([]) }, project: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: findTasks }, notification: { findMany: vi.fn().mockResolvedValue([]) },
    } }) as AppService;
    await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 }, '2026-10-01', '2026-10-31');
    expect(findTasks.mock.calls[0][0].where.deadline).toEqual({ not: null, gte: new Date('2026-10-01'), lte: new Date('2026-10-31') });
  });
});
