import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

describe('task tracker project selector', () => {
  it('includes accessible projects with no tasks and project IDs on activity', async () => {
    const prisma = {
      task: { findMany: vi.fn(async () => []) },
      toolConnection: { findMany: vi.fn(async () => []) },
      workflowEvent: { findMany: vi.fn(async () => [{ id: 'event', projectId: 'project-1', type: 'status_change', actorId: 'member', createdAt: new Date(), project: { title: 'First' }, task: { id: 'task', title: 'Report' } }]) },
      toolUsage: { findMany: vi.fn(async () => []) },
      project: { findMany: vi.fn(async () => [{ id: 'project-1', title: 'First', members: [{ user: { id: 'member', fullName: 'Member', avatarUrl: null } }] }, { id: 'project-2', title: 'No tasks', members: [] }]) },
      user: { findMany: vi.fn(async () => []) },
    };
    const service = Object.assign(Object.create(AppService.prototype), { prisma }) as AppService;
    const result = await service.taskTracker({ id: 'member' } as any);
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { members: { some: { userId: 'member' } } } }));
    expect(result.projects).toEqual([{ id: 'project-1', title: 'First', collaborators: [{ id: 'member', fullName: 'Member', avatarUrl: null }] }, { id: 'project-2', title: 'No tasks', collaborators: [] }]);
    expect(result.activity[0]).toMatchObject({ projectId: 'project-1', taskTitle: 'Report' });
  });
});
