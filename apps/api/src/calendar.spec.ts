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
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    });

    const result = await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 });

    expect(result.events.map((event: { id: string }) => event.id)).toEqual(['personal-event', 'team-event']);
    expect(findEvents).toHaveBeenCalledWith({
      where: { OR: [{ ownerId: 'user-1' }, { project: { members: { some: { userId: 'user-1' } } } }] },
      orderBy: { startAt: 'asc' },
      include: { project: { select: { id: true, title: true } } },
    });
  });

  it('projects dated tasks for their creator or current assignee, including completed history', async () => {
    const tasks = [{ id: 'created-task', title: 'Write draft', deadline: new Date('2026-10-28'), project: { id: 'project-1', title: 'Research' } }, { id: 'assigned-task', title: 'Review draft', deadline: new Date('2026-11-02'), project: { id: 'project-2', title: 'Capstone' } }];
    const findTasks = vi.fn().mockResolvedValue(tasks);
    const findNotifications = vi.fn().mockResolvedValue([{ id: 'assignment-note', type: 'task_assignment', relatedId: 'assigned-task' }]);
    const service = Object.assign(Object.create(AppService.prototype), { prisma: {
      calendarEvent: { findMany: vi.fn().mockResolvedValue([]) }, project: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: findTasks }, notification: { findMany: findNotifications },
      systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    } }) as AppService;

    const result = await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 });

    expect(findTasks).toHaveBeenCalledWith({ where: {
      OR: [{ createdBy: 'user-1' }, { assignments: { some: { assigneeId: 'user-1', active: true } } }], deadline: { not: null },
    }, select: { id: true, title: true, deadline: true, project: { select: { id: true, title: true } } }, orderBy: { deadline: 'asc' } });
    expect(result.hints).toEqual(tasks.map((task) => ({ ...task, type: 'task_deadline' })));
    expect(findNotifications).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', read: false, relatedType: 'task', type: { in: ['task_assignment', 'deadline_reminder', 'delay_risk'] } } }));
    expect(result.notifications).toEqual([{ id: 'assignment-note', type: 'task_assignment', relatedId: 'assigned-task' }]);
  });

  it('applies requested bounds to task due dates as well as event dates', async () => {
    const findTasks = vi.fn().mockResolvedValue([]);
    const service = Object.assign(Object.create(AppService.prototype), { prisma: {
      calendarEvent: { findMany: vi.fn().mockResolvedValue([]) }, project: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: findTasks }, notification: { findMany: vi.fn().mockResolvedValue([]) },
      systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    } }) as AppService;
    await service.calendar({ id: 'user-1', role: 'Project_Member', tv: 0 }, '2026-10-01', '2026-10-31');
    expect(findTasks.mock.calls[0][0].where.deadline).toEqual({ not: null, gte: new Date('2026-10-01'), lte: new Date('2026-10-31') });
  });
});

describe('calendar maintenance agendas', () => {
  function fixture(value: unknown) {
    const prisma = {
      calendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
      project: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      notification: { findMany: vi.fn().mockResolvedValue([]) },
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ value }) },
    };
    const service = Object.assign(Object.create(AppService.prototype), { prisma }) as AppService;
    const caller = { id: 'member-1', role: 'Project_Member', tv: 0 } as const;
    return { service, prisma, caller };
  }

  it('projects the shared maintenance schedule with its message, without creating a calendar row', async () => {
    const { service, prisma, caller } = fixture({ startsAt: '2026-11-05T10:00:00+08:00', message: 'Database upgrades', notifiedAt: '2026-10-29T01:00:00Z' });
    const result = await service.calendar(caller);
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: 'maintenanceSchedule' }, select: { value: true } });
    expect(result.events).toEqual([{ id: 'system-maintenance', title: 'System maintenance', type: 'maintenance', source: 'system', startAt: '2026-11-05T02:00:00.000Z', description: 'Database upgrades' }]);
    expect(result.events[0]).not.toHaveProperty('notifiedAt');
  });

  it('reflects rescheduling and cancellation without leaving stale or duplicate entries', async () => {
    const { service, prisma, caller } = fixture({ startsAt: '2026-11-05T02:00:00Z' });
    expect((await service.calendar(caller)).events).toHaveLength(1);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: { startsAt: '2026-11-06T02:00:00Z' } });
    expect((await service.calendar(caller)).events).toEqual([expect.objectContaining({ startAt: '2026-11-06T02:00:00.000Z' })]);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: null });
    expect((await service.calendar(caller)).events).toEqual([]);
  });

  it.each([null, {}, { startsAt: 'not-a-date' }])('ignores missing or malformed schedules (%j)', async (value) => {
    const { service, caller } = fixture(value);
    expect((await service.calendar(caller)).events).toEqual([]);
  });

  it('respects the requested calendar bounds for maintenance', async () => {
    const { service, caller } = fixture({ startsAt: '2026-11-05T02:00:00Z' });
    expect((await service.calendar(caller, '2026-11-05T00:00:00Z', '2026-11-05T23:59:59Z')).events).toHaveLength(1);
    expect((await service.calendar(caller, '2026-11-06', '2026-11-30')).events).toEqual([]);
  });
});
