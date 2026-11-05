import { describe, expect, it, vi } from 'vitest';
import { resourceLinkSchema } from '@websphere/shared';
import { AppService } from './app.service.js';

function fixture() {
  const task = { id: 'task-1', projectId: 'project-1', title: 'Report', status: 'pending', startedAt: null, assignments: [{ assigneeId: 'member-1' }] };
  const prisma: any = {
    linkedResource: { create: vi.fn(async ({ data }) => ({ id: 'resource-1', ...data })) },
    task: { update: vi.fn(async () => ({})) },
    workflowEvent: { create: vi.fn(async () => ({})) },
    toolConnection: { findFirst: vi.fn() },
    $transaction: vi.fn(async (operation) => operation(prisma)),
  };
  const notifyTaskStatus = vi.fn(async () => {});
  const service = Object.assign(Object.create(AppService.prototype), {
    prisma, task: vi.fn(async () => task), jobs: { enqueueAnalyticsRecompute: vi.fn(async () => {}) }, notifyTaskStatus,
  }) as AppService;
  return { service, prisma, notifyTaskStatus };
}
const caller = { id: 'member-1', role: 'Project_Member', tv: 0 } as const;
const link = { provider: 'google' as const, title: 'Report file', externalUrl: 'https://example.com/report' };

describe('manual task file links', () => {
  it('saves a link without a connection and updates the assigned task status', async () => {
    const { service, prisma, notifyTaskStatus } = fixture();
    await service.linkTaskResource(caller, 'task-1', { ...link, status: 'completed' });
    expect(prisma.toolConnection.findFirst).not.toHaveBeenCalled();
    expect(prisma.linkedResource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionId: null, provider: 'google', taskId: 'task-1' }) }));
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed', completedAt: expect.any(Date) }) }));
    expect(notifyTaskStatus).toHaveBeenCalledWith('task-1', caller.id, 'completed');
  });

  it('does not let a different project member change the task status when linking', async () => {
    const { service, prisma } = fixture();
    await expect(service.linkTaskResource({ ...caller, id: 'other' }, 'task-1', { ...link, status: 'completed' })).rejects.toThrow('Only the active assignee');
    expect(prisma.linkedResource.create).not.toHaveBeenCalled();
  });

  it('rejects unsafe or malformed links', () => {
    expect(resourceLinkSchema.safeParse({ ...link, externalUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(resourceLinkSchema.safeParse({ ...link, externalUrl: 'not a URL' }).success).toBe(false);
    expect(resourceLinkSchema.safeParse(link).success).toBe(true);
  });
});
