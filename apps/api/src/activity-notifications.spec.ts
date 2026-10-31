import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const actor = { id: 'member-1', role: 'Project_Member', tv: 0 } as const;

function fixture() {
  const stored: any[] = [];
  let calendarEvent: any = null;
  const task: any = { id: 'task-1', projectId: 'project-1', createdBy: 'leader-1', title: 'Research report', status: 'pending', startedAt: null, completedAt: null, assignments: [{ assigneeId: actor.id, assignerId: 'leader-1', active: true }] };
  const prisma: any = {
    calendarEvent: {
      create: vi.fn(async ({ data }) => (calendarEvent = { id: 'event-1', projectId: null, endAt: null, ...data })),
      findUniqueOrThrow: vi.fn(async () => ({ ...calendarEvent })),
      update: vi.fn(async ({ data }) => (calendarEvent = { ...calendarEvent, ...data })),
    },
    task: {
      findUniqueOrThrow: vi.fn(async () => ({ ...task, project: { title: 'Capstone' } })),
      update: vi.fn(async ({ data }) => Object.assign(task, data)),
    },
    taskAssignment: { findFirst: vi.fn(async () => task.assignments[0]) },
    workflowEvent: { create: vi.fn(async () => ({})) },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ fullName: 'Alex Santos' })),
      findMany: vi.fn(async () => [{ id: actor.id }, { id: 'peer-1' }]),
    },
    notificationPreference: { findMany: vi.fn(async () => []) },
    notification: {
      create: vi.fn(async ({ data }) => {
        const notification = { id: `note-${stored.length}`, read: false, ...data };
        stored.push(notification);
        return notification;
      }),
      findMany: vi.fn(async ({ where }) => stored.filter((item) => item.userId === where.userId)),
    },
    $transaction: vi.fn(async (operation) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
  };
  const events = { emitNotification: vi.fn() };
  const push = { deliver: vi.fn(async () => undefined) };
  const jobs = { enqueueNotificationEmail: vi.fn(async () => undefined), enqueueAnalyticsRecompute: vi.fn(async () => undefined) };
  const logger = { error: vi.fn() };
  const projectMember = vi.fn(async (_projectId: string, _userId: string, _leaderOnly?: boolean) => ({ role: 'Project_Leader' }));
  const service = Object.assign(Object.create(AppService.prototype), { prisma, events, push, jobs, logger, projectMember }) as AppService;
  return { service, prisma, events, push, jobs, logger, stored, task, projectMember };
}

describe('scheduled event notifications', () => {
  afterEach(() => vi.unstubAllEnvs());
  const input = { title: 'Project review', type: 'meeting', startAt: new Date('2026-11-05T02:00:00Z'), endAt: new Date('2026-11-05T03:00:00Z'), projectId: 'project-1' };

  it('saves a project event and notifies its owner and active project members through the maintenance delivery pipeline', async () => {
    vi.stubEnv('APP_TIME_ZONE', 'Asia/Manila');
    const { service, prisma, projectMember, events, push, jobs, stored } = fixture();
    const event = await service.createCalendarEvent(actor, input);
    expect(event).toMatchObject({ ownerId: actor.id, ...input });
    expect(projectMember).toHaveBeenCalledWith('project-1', actor.id);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { status: 'active', OR: [{ id: actor.id }, { projectMembers: { some: { projectId: 'project-1' } } }] }, select: { id: true } });
    expect((await service.notifications({ ...actor, id: 'peer-1' }))[0]).toMatchObject({ relatedId: event.id, relatedType: 'calendar', type: 'announcement', message: expect.stringContaining('Alex Santos scheduled “Project review”') });
    expect(stored[0].message).toContain('Nov 5, 2026, 10:00 AM GMT+8');
    expect(stored[0].message).toContain('ends Nov 5, 2026, 11:00 AM GMT+8');
    expect(events.emitNotification).toHaveBeenCalledTimes(2);
    expect(push.deliver).toHaveBeenCalledTimes(2);
    expect(jobs.enqueueNotificationEmail).toHaveBeenCalledTimes(2);
  });

  it('limits personal event notifications to the active owner', async () => {
    const { service, prisma, projectMember, stored } = fixture();
    prisma.user.findMany.mockResolvedValueOnce([{ id: actor.id }]);
    await service.createCalendarEvent(actor, { ...input, projectId: undefined });
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { status: 'active', OR: [{ id: actor.id }] }, select: { id: true } });
    expect(projectMember).not.toHaveBeenCalled();
    expect(stored.map((item) => item.userId)).toEqual([actor.id]);
  });

  it('notifies members when an event changes, without repeating alerts for an unchanged save', async () => {
    const { service, stored } = fixture();
    const event = await service.createCalendarEvent(actor, input);
    stored.length = 0;
    await service.updateCalendarEvent(actor, event.id, { startAt: new Date('2026-11-06T02:00:00Z') });
    expect(stored).toHaveLength(2);
    expect(stored[0].message).toContain('updated “Project review”');
    expect(stored[0].message).toContain('Nov 6, 2026');
    stored.length = 0;
    await service.updateCalendarEvent(actor, event.id, { startAt: new Date('2026-11-06T02:00:00Z') });
    expect(stored).toHaveLength(0);
  });

  it('checks membership before saving into a different project', async () => {
    const { service, projectMember, prisma } = fixture();
    const event = await service.createCalendarEvent(actor, input);
    projectMember.mockImplementation(async (projectId: string) => { if (projectId === 'other-project') throw new Error('Not a project member'); return { role: 'Project_Leader' }; });
    await expect(service.updateCalendarEvent(actor, event.id, { projectId: 'other-project' })).rejects.toThrow('Not a project member');
    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('preserves complete start/end times in the notification even with long names and titles', async () => {
    const { service, prisma, stored } = fixture();
    vi.stubEnv('APP_TIME_ZONE', 'Asia/Manila');
    prisma.user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A'.repeat(180) });
    await service.createCalendarEvent(actor, { ...input, title: 'B'.repeat(180), type: 'presentation' });
    expect(stored[0].message.length).toBeLessThanOrEqual(191);
    expect(stored[0].message).toContain('Starts Nov 5, 2026, 10:00 AM GMT+8; ends Nov 5, 2026, 11:00 AM GMT+8.');
  });

  it('keeps the saved event and in-app notifications when the email queue is unavailable', async () => {
    const { service, jobs, stored, events } = fixture();
    jobs.enqueueNotificationEmail.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service.createCalendarEvent(actor, input)).resolves.toMatchObject({ id: 'event-1' });
    expect(stored).toHaveLength(2);
    expect(events.emitNotification).toHaveBeenCalledTimes(2);
  });
});

describe('task status notifications', () => {
  it.each([
    ['ongoing', 'In Progress'], ['for_review', 'For Review'], ['completed', 'Completed'], ['pending', 'Not Started'],
  ] as const)('notifies other involved members when status becomes %s', async (status, label) => {
    const { service, prisma, stored, events, push, jobs, task } = fixture();
    task.status = status === 'pending' ? 'ongoing' : 'pending';
    prisma.user.findMany.mockResolvedValue([{ id: 'peer-1' }, { id: 'leader-1' }, { id: 'admin-1' }]);
    await service.taskStatus(actor, task.id, status);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { status: 'active', id: { not: actor.id }, OR: [
      { projectMembers: { some: { projectId: 'project-1' } } }, { id: { in: ['leader-1', actor.id, 'leader-1'] } }, { role: 'Administrator' },
    ] }, select: { id: true } });
    expect(stored.map((item) => item.userId)).toEqual(['peer-1', 'leader-1', 'admin-1']);
    expect(stored[0]).toMatchObject({ type: 'task_update', relatedId: task.id, relatedType: 'task', message: `Alex Santos ${status === 'completed' ? 'marked' : 'updated'} “Research report” ${status === 'completed' ? 'as' : 'to'} ${label}.` });
    expect(events.emitNotification).toHaveBeenCalledTimes(3);
    expect(push.deliver).toHaveBeenCalledTimes(3);
    expect(jobs.enqueueNotificationEmail).toHaveBeenCalledTimes(3);
    expect(task.completedAt).toEqual(status === 'completed' ? expect.any(Date) : null);
  });

  it('uses the same status alert for the project task editor', async () => {
    const { service, stored, prisma } = fixture();
    prisma.user.findMany.mockResolvedValue([{ id: 'peer-1' }]);
    await service.updateTask(actor, 'task-1', { status: 'completed' });
    expect(stored).toHaveLength(1);
    expect(stored[0].message).toBe('Alex Santos marked “Research report” as Completed.');
  });

  it('notifies teammates when an external-file edit changes task status, and clears completion when reopened', async () => {
    const { service, stored, prisma, task } = fixture();
    task.status = 'completed';
    task.completedAt = new Date();
    prisma.user.findMany.mockResolvedValue([{ id: 'peer-1' }]);
    prisma.linkedResource = {
      findUniqueOrThrow: vi.fn(async () => ({ id: 'resource-1', task: { ...task, project: { members: [] } } })),
      update: vi.fn(async () => ({})),
    };
    prisma.toolConnection = { findFirst: vi.fn(async () => ({ id: 'connection-1' })) };
    prisma.toolUsage = { create: vi.fn(async () => ({})) };
    await service.updateLinkedResource(actor, 'resource-1', { connectionId: 'connection-1', title: 'Report document', externalUrl: 'https://example.com/report', status: 'for_review' });
    expect(stored).toHaveLength(1);
    expect(stored[0].message).toBe('Alex Santos updated “Research report” to For Review.');
    expect(task.completedAt).toBeNull();
  });

  it('does not notify on a repeated status save', async () => {
    const { service, stored, events } = fixture();
    await service.taskStatus(actor, 'task-1', 'pending');
    await service.updateTask(actor, 'task-1', { status: 'pending' });
    expect(stored).toHaveLength(0);
    expect(events.emitNotification).not.toHaveBeenCalled();
  });

  it('honors notification preferences and still keeps in-app alerts if email queueing fails', async () => {
    const { service, prisma, jobs, stored } = fixture();
    prisma.user.findMany.mockResolvedValue([{ id: 'peer-1' }, { id: 'muted-peer' }]);
    prisma.notificationPreference.findMany.mockResolvedValue([{ userId: 'muted-peer', tasks: false }]);
    jobs.enqueueNotificationEmail.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service.taskStatus(actor, 'task-1', 'completed')).resolves.toMatchObject({ status: 'completed' });
    expect(stored.map((item) => item.userId)).toEqual(['peer-1']);
  });
});
