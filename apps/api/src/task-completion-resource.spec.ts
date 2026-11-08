import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const caller = { id: 'assignee', role: 'Project_Member', tv: 0 } as const;
function fixture(hasResource: boolean, status = 'for_review') {
  const task = { id: 'task-1', projectId: 'project-1', status, startedAt: null, assignments: [{ assigneeId: caller.id }], project: { title: 'Project' } };
  const prisma: any = {
    task: { findUniqueOrThrow: vi.fn(async () => task), update: vi.fn(async ({ data }) => ({ ...task, ...data })) },
    taskAssignment: { findFirst: vi.fn(async () => task.assignments[0]) },
    linkedResource: { findFirst: vi.fn(async () => hasResource ? { id: 'resource-1' } : null) },
    workflowEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (operation) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
  };
  const service = Object.assign(Object.create(AppService.prototype), { prisma, projectMember: vi.fn(async () => ({})), notifyTaskStatus: vi.fn(async () => {}), jobs: { enqueueAnalyticsRecompute: vi.fn(async () => {}) } }) as AppService;
  return { service, prisma };
}

describe('task completion requires a linked file', () => {
  it('blocks a direct completion without a task-linked file', async () => {
    const { service, prisma } = fixture(false);
    await expect(service.taskStatus(caller, 'task-1', 'completed')).rejects.toThrow('Attach a file link');
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.linkedResource.findFirst).toHaveBeenCalledWith({ where: { taskId: 'task-1' }, select: { id: true } });
  });
  it('blocks completion through the project task editor as well', async () => {
    const { service, prisma } = fixture(false);
    await expect(service.updateTask(caller, 'task-1', { status: 'completed' })).rejects.toThrow('Attach a file link');
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
  it('allows completion with a linked file', async () => {
    const { service, prisma } = fixture(true);
    await expect(service.taskStatus(caller, 'task-1', 'completed')).resolves.toMatchObject({ status: 'completed', completedAt: expect.any(Date) });
    expect(prisma.workflowEvent.create).toHaveBeenCalledOnce();
  });
  it('still permits existing completed tasks to be edited or reopened without a file', async () => {
    const { service, prisma } = fixture(false, 'completed');
    await service.updateTask(caller, 'task-1', { title: 'Renamed' });
    await service.taskStatus(caller, 'task-1', 'for_review');
    expect(prisma.linkedResource.findFirst).not.toHaveBeenCalled();
  });
});
