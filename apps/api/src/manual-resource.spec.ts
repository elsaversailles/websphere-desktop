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

  it('does not allow another member to attach a link without a status change', async () => {
    const { service, prisma } = fixture();
    await expect(service.linkTaskResource({ ...caller, id: 'other' }, 'task-1', link)).rejects.toThrow('Only the active assignee');
    expect(prisma.linkedResource.create).not.toHaveBeenCalled();
  });

  it('does not allow even a project leader to edit another assignee’s link', async () => {
    const { service, prisma } = fixture();
    prisma.linkedResource.findUniqueOrThrow = vi.fn(async () => ({ id: 'resource-1', connection: null, task: { id: 'task-1', projectId: 'project-1', assignments: [{ assigneeId: 'member-1' }] } }));
    prisma.linkedResource.update = vi.fn();
    Object.assign(service, { projectMember: vi.fn(async () => ({ role: 'Project_Leader' })) });
    await expect(service.updateLinkedResource({ ...caller, id: 'leader' }, 'resource-1', link)).rejects.toThrow('Only the active assignee');
    expect(prisma.linkedResource.update).not.toHaveBeenCalled();
  });

  it('lets a project teammate view a linked file owned by another connection', async () => {
    const { service, prisma } = fixture();
    prisma.linkedResource.findUniqueOrThrow = vi.fn(async () => ({ id: 'resource-1', taskId: 'task-1', projectId: 'project-1', externalId: 'file-1', title: 'Report', externalUrl: link.externalUrl, connectionId: 'connection-1', connection: { userId: 'owner', provider: 'google', tool: { name: 'Google Drive' } } }));
    prisma.toolUsage = { create: vi.fn() };
    await expect(service.launchResource({ ...caller, id: 'teammate' }, 'resource-1')).resolves.toMatchObject({ externalUrl: link.externalUrl });
    expect(service.task).toHaveBeenCalledWith(expect.objectContaining({ id: 'teammate' }), 'task-1');
    expect(prisma.toolUsage.create).not.toHaveBeenCalled();
  });

  it('does not expose another user’s unscoped connection resource', async () => {
    const { service, prisma } = fixture();
    prisma.linkedResource.findUniqueOrThrow = vi.fn(async () => ({ taskId: null, projectId: null, connection: { userId: 'owner' } }));
    await expect(service.launchResource(caller, 'resource-1')).rejects.toThrow('not available to you');
  });

  it.each([
    ['google-docs', 'google'], ['microsoft-word', 'microsoft'], ['microsoft-excel', 'microsoft'],
  ] as const)('stores and returns a %s link', async (toolKind, provider) => {
    const { service, prisma } = fixture();
    const input = { ...link, provider, toolKind };
    expect(resourceLinkSchema.safeParse(input).success).toBe(true);
    const result = await service.linkTaskResource(caller, 'task-1', input);
    expect(prisma.linkedResource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ provider, toolKind, externalUrl: input.externalUrl }) }));
    expect(result.externalUrl).toBe(input.externalUrl);
  });

  it('rejects unsafe or malformed links', () => {
    expect(resourceLinkSchema.safeParse({ ...link, externalUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(resourceLinkSchema.safeParse({ ...link, externalUrl: 'not a URL' }).success).toBe(false);
    expect(resourceLinkSchema.safeParse(link).success).toBe(true);
  });
});
