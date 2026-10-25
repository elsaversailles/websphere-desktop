import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const leader = { id: 'leader-1', role: 'Project_Leader' as const, tv: 0 };

function deletionService() {
  const calls: string[] = [];
  const model = (name: string) => ({
    deleteMany: vi.fn(async () => { calls.push(`${name}.deleteMany`); }),
    updateMany: vi.fn(async () => { calls.push(`${name}.updateMany`); }),
    delete: vi.fn(async () => { calls.push(`${name}.delete`); }),
    findMany: vi.fn(async () => [{ id: 'task-1' }]),
    findUnique: vi.fn(async () => ({ projectId: 'project-1' })),
  });
  const tx = Object.fromEntries(['notification', 'taskDependency', 'taskAssignment', 'taskComment', 'embedding', 'linkedResource', 'workflowEvent', 'task', 'calendarEvent', 'analyticsSnapshot', 'projectMember', 'project'].map((name) => [name, model(name)]));
  const prisma = { ...tx, $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
  const projectMember = vi.fn().mockResolvedValue({ role: 'Project_Leader' });
  const enqueueAnalyticsRecompute = vi.fn().mockResolvedValue(undefined);
  const service = Object.assign(Object.create(AppService.prototype), { prisma, projectMember, jobs: { enqueueAnalyticsRecompute } }) as AppService;
  return { service, prisma, projectMember, enqueueAnalyticsRecompute, calls };
}

describe('project and task deletion', () => {
  it('checks leader access and removes project dependents before the project', async () => {
    const { service, projectMember, calls } = deletionService();
    await service.deleteProject(leader, 'project-1');
    expect(projectMember).toHaveBeenCalledWith('project-1', leader.id, true);
    expect(calls.at(-1)).toBe('project.delete');
    expect(calls.indexOf('taskDependency.deleteMany')).toBeLessThan(calls.indexOf('task.deleteMany'));
    expect(calls.indexOf('task.deleteMany')).toBeLessThan(calls.indexOf('project.delete'));
  });

  it('does not enter the transaction when leader access is denied', async () => {
    const { service, prisma, projectMember } = deletionService();
    projectMember.mockRejectedValueOnce(new Error('forbidden'));
    await expect(service.deleteProject(leader, 'project-1')).rejects.toThrow('forbidden');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('removes task dependents and recomputes project analytics', async () => {
    const { service, projectMember, enqueueAnalyticsRecompute, calls } = deletionService();
    await service.deleteTask(leader, 'task-1');
    expect(projectMember).toHaveBeenCalledWith('project-1', leader.id, true);
    expect(calls.at(-1)).toBe('task.delete');
    expect(enqueueAnalyticsRecompute).toHaveBeenCalledWith('project-1');
  });
});
