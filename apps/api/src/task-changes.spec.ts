import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const assignee = { id: 'member-1', role: 'Project_Member' as const, tv: 0 };
const leader = { id: 'leader-1', role: 'Project_Leader' as const, tv: 0 };

function taskService() {
  const saved = { id: 'task-1', projectId: 'project-1', title: 'Draft report', status: 'pending', startedAt: null };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...saved, ...data }));
  const workflowCreate = vi.fn(async () => ({}));
  const assignmentCreate = vi.fn(async () => ({}));
  const assignmentUpdateMany = vi.fn(async () => ({}));
  const projectMember = vi.fn(async () => ({ role: 'Project_Leader' }));
  const notify = vi.fn(async () => ({ ok: true, delivered: 1 }));
  const enqueueAnalyticsRecompute = vi.fn(async () => { throw new Error('queue unavailable'); });
  const prisma = {
    task: { findUniqueOrThrow: vi.fn(async () => ({ ...saved, assignments: [{ assigneeId: assignee.id }], project: { title: 'Capstone' } })), update },
    taskAssignment: { findFirst: vi.fn(async () => ({ assigneeId: assignee.id })), create: assignmentCreate, updateMany: assignmentUpdateMany },
    workflowEvent: { create: workflowCreate },
    user: { findMany: vi.fn(async () => [{ id: 'admin-1' }]) },
    $transaction: vi.fn(async (operation: any) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
  };
  const service = Object.assign(Object.create(AppService.prototype), {
    prisma, projectMember, notify, jobs: { enqueueAnalyticsRecompute },
  }) as AppService;
  return { service, prisma, projectMember, notify, update, workflowCreate, assignmentCreate, assignmentUpdateMany };
}

describe('task authorization and persistence', () => {
  it('lets the active assignee change status without a legacy project membership row', async () => {
    const { service, projectMember, update, workflowCreate, notify } = taskService();
    const result = await service.taskStatus(assignee, 'task-1', 'ongoing');
    expect(projectMember).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ongoing', startedAt: expect.any(Date) }) }));
    expect(workflowCreate).toHaveBeenCalledOnce();
    expect(result.status).toBe('ongoing');
    expect(notify).toHaveBeenCalledWith(['admin-1'], 'task_update', expect.stringContaining('ongoing'), 'task-1', 'task');
  });

  it('requires project leadership when the caller is not the active assignee', async () => {
    const { service, prisma, projectMember, update } = taskService();
    prisma.taskAssignment.findFirst.mockResolvedValueOnce(null as any);
    projectMember.mockRejectedValueOnce(new Error('Project membership does not grant this action'));
    await expect(service.taskStatus({ ...assignee, id: 'other-1' }, 'task-1', 'completed')).rejects.toThrow('Project membership does not grant this action');
    expect(projectMember).toHaveBeenCalledWith('project-1', 'other-1', true);
    expect(update).not.toHaveBeenCalled();
  });

  it('saves task details, status, and reassignment together, then informs the new assignee', async () => {
    const { service, projectMember, update, workflowCreate, assignmentCreate, assignmentUpdateMany, notify } = taskService();
    const result = await service.updateTask(leader, 'task-1', { title: 'Final report', description: 'Revised', status: 'ongoing', assigneeId: 'member-2' });
    expect(projectMember).toHaveBeenCalledWith('project-1', leader.id, true);
    expect(projectMember).toHaveBeenCalledWith('project-1', 'member-2');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Final report', description: 'Revised', status: 'ongoing' }) }));
    expect(assignmentUpdateMany).toHaveBeenCalledWith({ where: { taskId: 'task-1', active: true }, data: { active: false } });
    expect(assignmentCreate).toHaveBeenCalledWith({ data: { taskId: 'task-1', assigneeId: 'member-2', assignerId: leader.id } });
    expect(workflowCreate).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(['member-2'], 'task_assignment', expect.any(String), 'task-1', 'task');
    expect(result.title).toBe('Final report');
  });
});
