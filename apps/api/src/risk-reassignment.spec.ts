import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const caller = { id: 'leader', role: 'Project_Leader' as const, tv: 0 };

function fixture(days: number | null, assigned = true) {
  const now = new Date('2026-11-10T00:00:00Z');
  const task: any = { id: 'task-1', projectId: 'project-1', title: 'Research', status: 'pending', startedAt: null,
    deadline: days === null ? null : new Date(now.getTime() + days * 86400000),
    assignments: assigned ? [{ assigneeId: caller.id }] : [], project: { title: 'Project', members: [] } };
  const prisma: any = {
    task: { findUniqueOrThrow: vi.fn(async () => task), update: vi.fn(async ({ data }: any) => ({ ...task, ...data })) },
    taskAssignment: { updateMany: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
    workflowEvent: { create: vi.fn(async () => ({})) },
    linkedResource: { findUniqueOrThrow: vi.fn(async () => ({ id: 'resource-1', task, connection: null })), update: vi.fn(async () => ({})) },
    user: { findMany: vi.fn(async () => []) },
  };
  prisma.$transaction = vi.fn(async (operation: any) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation));
  const service = Object.assign(Object.create(AppService.prototype), {
    prisma, projectMember: vi.fn(async () => ({ role: 'Project_Leader' })), notify: vi.fn(async () => ({})),
    jobs: { enqueueAnalyticsRecompute: vi.fn(async () => ({})) }, logger: { error: vi.fn() },
  }) as AppService;
  return { service, prisma, task };
}

describe('risk-based task reassignment', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-10T00:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each([[10, 'low'], [2, 'medium']] as const)('rejects %s-day %s risk through every task assignment path', async (days, _level) => {
    const { service, prisma } = fixture(days);
    await expect(service.assignTask(caller, 'task-1', 'other')).rejects.toMatchObject({ response: { code: 'RISK_REASSIGNMENT_FORBIDDEN' }, status: 403 });
    await expect(service.updateTask(caller, 'task-1', { assigneeId: 'other' })).rejects.toMatchObject({ status: 403 });
    await expect(service.updateTask(caller, 'task-1', { assigneeId: null })).rejects.toMatchObject({ status: 403 });
    await expect(service.updateLinkedResource(caller, 'resource-1', { provider: 'google', title: 'Document', externalUrl: 'https://example.com/', assigneeId: 'other' })).rejects.toMatchObject({ status: 403 });
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.linkedResource.update).not.toHaveBeenCalled();
  });

  it('permits high-risk reassignment and checks risk again on each request', async () => {
    const { service, prisma, task } = fixture(0.5);
    await service.assignTask(caller, task.id, 'other');
    expect(prisma.taskAssignment.create).toHaveBeenCalledOnce();
    task.deadline = new Date('2026-11-20T00:00:00Z');
    await expect(service.assignTask(caller, task.id, 'other')).rejects.toMatchObject({ status: 403 });
    expect(prisma.taskAssignment.create).toHaveBeenCalledOnce();
  });

  it('permits a high-risk reassignment through a linked resource', async () => {
    const { service, prisma } = fixture(0.5);
    await expect(service.updateLinkedResource(caller, 'resource-1', { provider: 'google', title: 'Document', externalUrl: 'https://example.com/', assigneeId: 'other' })).resolves.toMatchObject({ ok: true });
    expect(prisma.taskAssignment.create).toHaveBeenCalledOnce();
    expect(prisma.linkedResource.update).toHaveBeenCalledOnce();
  });

  it('rechecks the latest risk inside the transaction before any assignment write', async () => {
    const { service, prisma, task } = fixture(0.5);
    prisma.task.findUniqueOrThrow.mockResolvedValueOnce({ ...task }).mockResolvedValueOnce({ ...task, deadline: new Date('2026-11-20T00:00:00Z') });
    await expect(service.assignTask(caller, task.id, 'other')).rejects.toMatchObject({ status: 403 });
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
  });

  it('allows the first assignment and saving the current assignee at any risk level', async () => {
    const unassigned = fixture(10, false);
    await expect(unassigned.service.assignTask(caller, 'task-1', 'other')).resolves.toBeTruthy();
    const assigned = fixture(10);
    await expect(assigned.service.assignTask(caller, 'task-1', caller.id)).resolves.toBeTruthy();
    expect(assigned.prisma.taskAssignment.create).not.toHaveBeenCalled();
  });

  it('does not bypass project-leader authorization even for high risk', async () => {
    const { service, prisma } = fixture(0.5);
    (service as any).projectMember.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(service.assignTask({ ...caller, id: 'member' }, 'task-1', 'other')).rejects.toThrow('Forbidden');
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
  });
});
