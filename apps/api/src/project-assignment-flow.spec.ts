import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PushService } from './push.service.js';

// Exercise the real request schema, creation, dashboard and mobile notification path together;
// replace only persistence and delivery so this regression cannot contact real users/devices.
describe('project creation assignment flow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes an initial assignment visible in the member dashboard and sends its mobile alert', async () => {
    const leaderId = 'clw00000000000000000000001';
    const memberId = 'clw00000000000000000000002';
    const groupId = 'clw00000000000000000000003';
    const tasks: any[] = [];
    const notifications: any[] = [];
    let project: any;
    let committed = false;
    const prisma: any = {
      project: {
        create: vi.fn(async ({ data }) => {
          project = { ...data, id: 'project-1', status: 'active', group: { name: 'Research group' } };
          return project;
        }),
        findMany: vi.fn(async () => [{ ...project, tasks }]),
      },
      task: {
        create: vi.fn(async ({ data }) => {
          const task = { ...data, id: `task-${tasks.length + 1}`, createdAt: new Date(), project: { id: project.id, title: project.title }, assignments: [{ ...data.assignments.create, active: true, assignedAt: new Date() }] };
          tasks.push(task);
          return task;
        }),
        findMany: vi.fn(async ({ where }) => tasks.filter((task) => {
          const assigneeId = where.assignments?.some.assigneeId ?? where.OR?.[1].assignments.some.assigneeId;
          return task.assignments.some((assignment: any) => assignment.active && assignment.assigneeId === assigneeId);
        })),
      },
      notification: {
        create: vi.fn(async ({ data }) => {
          expect(committed).toBe(true);
          const notification = { ...data, id: 'notification-1', read: false };
          notifications.push(notification);
          return notification;
        }),
        findMany: vi.fn(async ({ where }) => notifications.filter((notification) => notification.userId === where.userId)),
      },
      notificationPreference: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ pushEnabled: true })) },
      mobilePushToken: { findMany: vi.fn(async ({ where }) => where.userId === memberId ? [{ token: 'ExpoPushToken[test-device]' }] : []) },
      user: { findMany: vi.fn(async () => [{ id: leaderId, fullName: 'Project leader' }]) },
      idea: { count: vi.fn(async () => 0) },
      calendarEvent: { findMany: vi.fn(async () => []) },
      systemSetting: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (operation) => { const result = await operation(prisma); committed = true; return result; }),
    };
    const send = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ status: 'ok', id: 'test-ticket' }] }) }));
    vi.stubGlobal('fetch', send);
    const push = new PushService(prisma, { get: () => undefined } as any);
    const deliveries: Promise<void>[] = [];
    const emitNotification = vi.fn();
    const service = Object.assign(Object.create(AppService.prototype), {
      prisma, member: vi.fn(async () => ({})),
      caller: vi.fn(async (auth) => ({ id: auth === 'leader' ? leaderId : memberId, role: auth === 'leader' ? 'Project_Leader' : 'Project_Member', tv: 0 })),
      events: { emitNotification },
      jobs: { enqueueNotificationEmail: vi.fn(async () => undefined) },
      push: { deliver: (notification: any) => { const delivery = push.deliver(notification); deliveries.push(delivery); return delivery; } },
      activityFeed: vi.fn(async () => []), onlineTeammates: vi.fn(async () => []), announcements: vi.fn(async () => []), milestones: vi.fn(async () => []),
      logger: { error: vi.fn() },
    }) as AppService;
    const controller = new AppController(service, {} as any, {} as any, {} as any, {} as any);

    await controller.createProject('leader', {
      groupId, title: 'Research', description: 'Research project', memberIds: [memberId], deadline: '2026-11-08',
      initialTasks: [{ assigneeId: memberId, title: '  Write chapter 1  ' }],
    });
    const dashboard = await controller.dashboard('member');
    const calendar = await service.calendar({ id: memberId, role: 'Project_Member', tv: 0 });
    await Promise.all(deliveries);

    expect(prisma.task.create).toHaveBeenCalledOnce();
    expect(dashboard.glance).toMatchObject({ activeProjects: 1, pendingTasks: 1 });
    expect(dashboard.tasks).toEqual([expect.objectContaining({ id: 'task-1', title: 'Write chapter 1', status: 'pending', priority: 'medium', deadline: new Date('2026-11-08'), assignedBy: 'Project leader' })]);
    expect(calendar.hints.filter((hint: any) => hint.type === 'task_deadline')).toEqual([expect.objectContaining({ id: 'task-1', title: 'Write chapter 1', deadline: new Date('2026-11-08') })]);
    expect(calendar.events).toEqual([]); // Assignment alone is sufficient; no manual calendar event.
    expect(emitNotification).toHaveBeenCalledWith(memberId, expect.objectContaining({ type: 'task_assignment', relatedId: 'task-1', relatedType: 'task' }));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]).toEqual(['https://exp.host/--/api/v2/push/send', expect.objectContaining({ method: 'POST', body: expect.any(String) })]);
    expect(JSON.parse((send.mock.calls[0] as any)[1].body)).toEqual([expect.objectContaining({
      to: 'ExpoPushToken[test-device]', body: 'You were assigned “Write chapter 1” in “Research”',
      data: { notificationId: 'notification-1', relatedId: 'task-1', relatedType: 'task' },
    })]);
  });
});
