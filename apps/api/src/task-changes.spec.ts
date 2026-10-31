import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';
import { taskEditSchema, taskSchema } from '@websphere/shared';

const assignee = { id: 'clw00000000000000000000001', role: 'Project_Member' as const, tv: 0 };
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
    user: { findMany: vi.fn(async () => [{ id: 'admin-1' }]), findUniqueOrThrow: vi.fn(async () => ({ fullName: 'Demo Member' })) },
    $transaction: vi.fn(async (operation: any) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
  };
  const service = Object.assign(Object.create(AppService.prototype), {
    prisma, projectMember, notify, jobs: { enqueueAnalyticsRecompute }, logger: { error: vi.fn() },
  }) as AppService;
  return { service, prisma, projectMember, notify, update, workflowCreate, assignmentCreate, assignmentUpdateMany };
}

describe('task authorization and persistence', () => {
  it('creates a task with a planned start date and no description from the new form', async () => {
    const { service, prisma, projectMember } = taskService();
    const create = vi.fn(async ({ data }) => ({ id: 'task-2', ...data }));
    Object.assign(prisma.task, { create });
    const input = taskSchema.parse({ title: 'Write chapter 1', startDate: '2026-10-29', deadline: '2026-11-08', priority: 'high' });
    await service.createTask(leader, 'project-1', input);
    expect(projectMember).toHaveBeenCalledWith('project-1', leader.id, true);
    expect(create).toHaveBeenCalledWith({ data: {
      title: 'Write chapter 1', description: '', startDate: new Date('2026-10-29'), deadline: new Date('2026-11-08'),
      priority: 'high', projectId: 'project-1', createdBy: leader.id,
    } });
  });

  it('edits planned dates without changing task status, existing description or actual work-start time', async () => {
    const { service, update, workflowCreate, notify } = taskService();
    await service.updateTask(leader, 'task-1', taskEditSchema.parse({ title: 'Final report', startDate: '2026-10-30', deadline: '2026-11-08', priority: 'high', assigneeId: assignee.id }));
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({ title: 'Final report', startDate: new Date('2026-10-30'), deadline: new Date('2026-11-08'), priority: 'high' });
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('clears a planned start date without clearing the actual work-start timestamp', async () => {
    const { service, update } = taskService();
    await service.updateTask(leader, 'task-1', taskEditSchema.parse({ startDate: null }));
    expect(update).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { startDate: null } });
  });

  it('lets the active assignee change status without a legacy project membership row', async () => {
    const { service, projectMember, update, workflowCreate, notify } = taskService();
    const result = await service.taskStatus(assignee, 'task-1', 'ongoing');
    expect(projectMember).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ongoing', startedAt: expect.any(Date) }) }));
    expect(workflowCreate).toHaveBeenCalledOnce();
    expect(result.status).toBe('ongoing');
    expect(notify).toHaveBeenCalledWith(['admin-1'], 'task_update', 'Demo Member updated “Draft report” to In Progress.', 'task-1', 'task');
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

  it('does not send another assignment alert when only the due date changes', async () => {
    const { service, notify, update } = taskService();
    const deadline = new Date('2026-10-30');
    await service.updateTask(leader, 'task-1', { deadline });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deadline }) }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not repeat an assignment alert for the same active assignee', async () => {
    const { service, notify, assignmentCreate } = taskService();
    await service.assignTask(leader, 'task-1', assignee.id);
    expect(assignmentCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('puts an older task newly assigned today first in the dashboard task preview', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'new-task', createdAt: new Date('2026-10-27'), status: 'pending', assignments: [{ assigneeId: assignee.id, assignedAt: new Date('2026-10-27') }] },
      { id: 'old-task-new-assignment', createdAt: new Date('2026-09-01'), status: 'pending', assignments: [{ assigneeId: assignee.id, assignedAt: new Date('2026-10-28') }] },
    ]);
    const service = Object.assign(Object.create(AppService.prototype), { prisma: { task: { findMany }, user: { findMany: vi.fn().mockResolvedValue([]) } } }) as AppService;
    const tasks = await service.myTasks(assignee, { sort: 'assigned' });
    expect(tasks.map((task: any) => task.id)).toEqual(['old-task-new-assignment', 'new-task']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { assignments: { some: { assigneeId: assignee.id, active: true } } } }));
  });
});
