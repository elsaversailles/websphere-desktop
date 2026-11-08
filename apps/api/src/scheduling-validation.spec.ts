import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

const caller = { id: 'leader-1', role: 'Project_Leader', tv: 0 } as const;
function fixture() {
  const project = { id: 'project-1', title: 'Research', startDate: new Date('2026-11-10'), deadline: new Date('2026-11-12') };
  const task = { ...project, id: 'task-1', projectId: project.id, status: 'pending', assignments: [], project: { title: project.title } };
  const event = { id: 'event-1', ownerId: caller.id, projectId: null, title: 'Meeting', type: 'meeting', startAt: new Date('2026-11-10T02:00:00Z'), endAt: new Date('2026-11-10T03:00:00Z') };
  const prisma: any = {
    project: { create: vi.fn(async ({ data }) => ({ id: project.id, ...data })), findUniqueOrThrow: vi.fn(async () => project), update: vi.fn(async ({ data }) => ({ ...project, ...data })) },
    task: { create: vi.fn(async ({ data }) => ({ id: task.id, ...data })), findUniqueOrThrow: vi.fn(async () => task), update: vi.fn(async ({ data }) => ({ ...task, ...data })) },
    calendarEvent: { create: vi.fn(async ({ data }) => ({ id: event.id, ...data })), findUniqueOrThrow: vi.fn(async () => event), update: vi.fn(async ({ data }) => ({ ...event, ...data })) },
    taskAssignment: { updateMany: vi.fn(), create: vi.fn() }, workflowEvent: { create: vi.fn() },
    $transaction: vi.fn(async (operation) => operation(prisma)),
  };
  const notify = vi.fn(async () => undefined);
  const service = Object.assign(Object.create(AppService.prototype), {
    prisma, caller: vi.fn(async () => caller), member: vi.fn(async () => ({})), projectMember: vi.fn(async () => ({})), notify,
    notifyCalendarEvent: vi.fn(async () => undefined), notifyTaskAdmins: vi.fn(async () => undefined),
    jobs: { enqueueAnalyticsRecompute: vi.fn(async () => undefined) },
  }) as AppService;
  const controller = new AppController(service, {} as any, {} as any, { publishTaskUpdated: vi.fn() } as any, {} as any);
  return { controller, service, prisma, project, task, event, notify };
}

describe('scheduling API validation', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-08T16:30:00Z')); vi.stubEnv('APP_TIME_ZONE', 'Asia/Manila'); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(['project', 'task', 'event'] as const)('rejects reversed %s dates before saving or notifying', async (kind) => {
    const { controller, prisma, notify } = fixture();
    const operation = kind === 'project' ? controller.createProject('token', { title: 'Research', startDate: '2026-11-20', deadline: '2026-11-10' })
      : kind === 'task' ? controller.createTask('token', 'project-1', { title: 'Write report', startDate: '2026-11-20', deadline: '2026-11-10' })
        : controller.createEvent('token', { title: 'Meeting', type: 'meeting', startAt: '2026-11-10T03:00:00Z', endAt: '2026-11-10T02:00:00Z' });
    await expect(operation).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED', fields: { [kind === 'event' ? 'endAt' : 'deadline']: expect.stringContaining('on or after') } } });
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(['project', 'task', 'event'] as const)('rejects a past %s deadline using the app timezone', async (kind) => {
    const { controller } = fixture();
    const operation = kind === 'project' ? controller.createProject('token', { title: 'Research', deadline: '2026-11-08' })
      : kind === 'task' ? controller.createTask('token', 'project-1', { title: 'Write report', startDate: '2026-11-08', deadline: '2026-11-08' })
        : controller.createEvent('token', { title: 'Meeting', type: 'meeting', startAt: '2026-11-08T15:00:00Z', endAt: '2026-11-08T16:00:00Z' });
    await expect(operation).rejects.toThrow('cannot be in the past');
  });

  it('accepts today as a project/task deadline and carries dates into initial tasks', async () => {
    const { controller, service, prisma } = fixture();
    const assigneeId = 'clw00000000000000000000001';
    vi.mocked(service.caller).mockResolvedValueOnce({ ...caller, id: assigneeId });
    await controller.createProject('token', { title: 'Research', startDate: '2026-11-09', deadline: '2026-11-09', initialTasks: [{ assigneeId, title: 'Write report' }] });
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ startDate: new Date('2026-11-09'), deadline: new Date('2026-11-09') }) }));
    await expect(controller.createTask('token', 'project-1', { title: 'Write report', startDate: '2026-11-09', deadline: '2026-11-09' })).resolves.toMatchObject({ deadline: new Date('2026-11-09') });
  });

  it.each(['startDate', 'deadline'] as const)('requires a task %s before saving', async (missingField) => {
    const { controller, prisma } = fixture();
    const dates = { startDate: '2026-11-09', deadline: '2026-11-10' };
    delete dates[missingField];

    await expect(controller.createTask('token', 'project-1', { title: 'Write report', ...dates })).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED', fields: { [missingField]: expect.stringContaining('required') } },
    });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it.each(['project', 'task', 'event'] as const)('merges partial %s date edits with the stored other endpoint', async (kind) => {
    const { controller, prisma } = fixture();
    const operation = kind === 'project' ? controller.updateProject('token', 'project-1', { startDate: '2026-11-20' })
      : kind === 'task' ? controller.updateTask('token', 'task-1', { startDate: '2026-11-20' })
        : controller.updateEvent('token', 'event-1', { startAt: '2026-11-11T02:00:00Z' });
    await expect(operation).rejects.toThrow('on or after');
    expect(prisma[kind === 'event' ? 'calendarEvent' : kind].update).not.toHaveBeenCalled();
  });

  it('rejects past event starts when the optional end is omitted', async () => {
    const { controller } = fixture();
    await expect(controller.createEvent('token', { title: 'Meeting', type: 'meeting', startAt: '2026-11-08T16:00:00Z' })).rejects.toMatchObject({ response: { fields: { startAt: 'Event start cannot be in the past.' } } });
  });

  it.each(['project', 'task', 'event'] as const)('checks an end-only %s edit against the saved start', async (kind) => {
    const { controller } = fixture();
    const operation = kind === 'project' ? controller.updateProject('token', 'project-1', { deadline: '2026-11-09' })
      : kind === 'task' ? controller.updateTask('token', 'task-1', { deadline: '2026-11-09' })
        : controller.updateEvent('token', 'event-1', { endAt: '2026-11-10T01:00:00Z' });
    await expect(operation).rejects.toThrow('on or after');
  });

  it('rejects clearing an event end if its remaining start time is already past', async () => {
    const { controller, event, prisma } = fixture();
    event.startAt = new Date('2026-11-08T16:00:00Z');
    await expect(controller.updateEvent('token', event.id, { endAt: null })).rejects.toThrow('Event start cannot be in the past.');
    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('allows optional dates to be cleared and an event end to be removed', async () => {
    const { controller } = fixture();
    await expect(controller.updateProject('token', 'project-1', { startDate: null, deadline: null })).resolves.toMatchObject({ startDate: null, deadline: null });
    await expect(controller.updateTask('token', 'task-1', { startDate: null, deadline: null })).resolves.toMatchObject({ startDate: null, deadline: null });
    await expect(controller.updateEvent('token', 'event-1', { endAt: null })).resolves.toMatchObject({ endAt: null });
  });

  it('allows non-scheduling edits and reassignment of existing overdue work', async () => {
    const { controller, service, project, task, event } = fixture();
    project.deadline = new Date('2026-10-01'); task.deadline = new Date('2026-10-01');
    event.startAt = new Date('2026-10-01T02:00:00Z'); event.endAt = new Date('2026-10-01T03:00:00Z');
    await expect(controller.updateProject('token', project.id, { title: 'Revised title', deadline: '2026-10-01' })).resolves.toMatchObject({ title: 'Revised title' });
    await expect(service.assignTask(caller, task.id, 'member-2')).resolves.toMatchObject({ id: task.id });
    await expect(controller.updateEvent('token', event.id, { title: 'Corrected meeting name' })).resolves.toMatchObject({ title: 'Corrected meeting name' });
  });
});
