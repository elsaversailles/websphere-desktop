import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

/**
 * projectSchema defaults memberIds to [], so it always reaches the service. It maps onto the
 * members relation rather than a Project column, and leaking it into create() made Prisma reject
 * every project with "Unknown argument `memberIds`".
 */
function serviceWithPrismaSpy() {
  const create = vi.fn(async ({ data }) => ({ id: 'project-1', ...data }));
  const taskCreate = vi.fn(async ({ data }) => ({ id: `task-${data.assignments.create.assigneeId}`, ...data }));
  const prisma = { project: { create }, task: { create: taskCreate }, $transaction: vi.fn(async (operation: any) => operation(prisma)) };
  const notify = vi.fn().mockResolvedValue({ ok: true });
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    prisma,
    member: vi.fn().mockResolvedValue({}),
    notify,
    logger: { error: vi.fn() },
  });
  return { service, create, taskCreate, prisma, notify };
}

describe('createProject payload', () => {
  it('maps memberIds onto the members relation instead of passing it as a column', async () => {
    const { service, create } = serviceWithPrismaSpy();

    await service.createProject({ id: 'leader', role: 'Project_Leader', tv: 0 } as any, {
      groupId: 'group-1', title: 'Capstone', description: 'Scope', memberIds: ['member-1'],
    });

    const { data } = create.mock.calls[0][0];
    expect(data).not.toHaveProperty('memberIds');
    expect(data.title).toBe('Capstone');
    expect(data.createdBy).toBe('leader');
    // The creator leads, everyone named joins as a member.
    expect(data.members.create).toEqual([
      { userId: 'leader', role: 'Project_Leader' },
      { userId: 'member-1', role: 'Project_Member' },
    ]);
  });

  it('still strips the key when the caller sends the schema default', async () => {
    const { service, create } = serviceWithPrismaSpy();

    await service.createProject({ id: 'leader', role: 'Project_Leader', tv: 0 } as any, {
      groupId: 'group-1', title: 'Solo', description: 'Scope', memberIds: [],
    });

    const { data } = create.mock.calls[0][0];
    expect(data).not.toHaveProperty('memberIds');
    expect(data.members.create).toEqual([{ userId: 'leader', role: 'Project_Leader' }]);
  });

  it('does not add the creator twice when they are also listed', async () => {
    const { service, create } = serviceWithPrismaSpy();

    await service.createProject({ id: 'leader', role: 'Project_Leader', tv: 0 } as any, {
      groupId: 'group-1', title: 'Dedup', description: 'Scope', memberIds: ['leader', 'member-1'],
    });

    expect(create.mock.calls[0][0].data.members.create).toEqual([
      { userId: 'leader', role: 'Project_Leader' },
      { userId: 'member-1', role: 'Project_Member' },
    ]);
  });
});

describe('initial project task assignments', () => {
  const caller = { id: 'leader', role: 'Project_Leader', tv: 0 } as const;
  const deadline = new Date('2026-11-08T00:00:00.000Z');
  const input = {
    groupId: 'group-1', title: 'Research', description: 'Research project', deadline,
    memberIds: ['leader', 'member-1', 'member-2', 'member-3'],
    initialTasks: [{ assigneeId: 'leader', title: 'Write chapter 1' }, { assigneeId: 'member-1', title: 'Write chapter 2' }],
  };

  it('creates real tasks and active assignments for each entered title, including the leader', async () => {
    const { service, create, taskCreate, notify } = serviceWithPrismaSpy();
    await service.createProject(caller, input);

    expect(create.mock.calls[0][0].data).not.toHaveProperty('initialTasks');
    expect(create.mock.calls[0][0].data.members.create).toContainEqual({ userId: 'member-1', role: 'Project_Member', responsibility: 'Write chapter 2' });
    expect(taskCreate).toHaveBeenCalledTimes(2);
    for (const { assigneeId, title } of input.initialTasks) {
      expect(taskCreate).toHaveBeenCalledWith({ data: {
        projectId: 'project-1', title, description: title, createdBy: caller.id,
        deadline, priority: 'medium', status: 'pending',
        assignments: { create: { assigneeId, assignerId: caller.id } },
        workflow: { create: { projectId: 'project-1', actorId: caller.id, type: 'assignment_change', toValue: assigneeId } },
      } });
      expect(notify).toHaveBeenCalledWith([assigneeId], 'task_assignment', expect.stringContaining(title), `task-${assigneeId}`, 'task');
    }
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not create tasks or assignment alerts for members without an entered task', async () => {
    const { service, taskCreate, notify } = serviceWithPrismaSpy();
    await service.createProject(caller, { ...input, initialTasks: [] });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('allows an independent project to start with a task for its creator', async () => {
    const { service, taskCreate } = serviceWithPrismaSpy();
    await service.createProject(caller, { title: 'Solo', description: 'My work', initialTasks: [input.initialTasks[0]] });
    expect(taskCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignments: { create: { assigneeId: 'leader', assignerId: 'leader' } } }) }));
  });

  it('rejects assignments to people not selected for the project before writing anything', async () => {
    const { service, create, taskCreate, notify } = serviceWithPrismaSpy();
    await expect(service.createProject(caller, { ...input, initialTasks: [{ assigneeId: 'outsider', title: 'Write report' }] })).rejects.toThrow('Assign initial tasks only to selected project members.');
    expect(create).not.toHaveBeenCalled();
    expect(taskCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('checks that selected members belong to the chosen group before writing', async () => {
    const { service, create } = serviceWithPrismaSpy();
    vi.mocked(service.member).mockRejectedValueOnce(new Error('Group access denied'));
    await expect(service.createProject(caller, input)).rejects.toThrow('Group access denied');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects repeated initial assignments for one member', async () => {
    const { service, create } = serviceWithPrismaSpy();
    await expect(service.createProject(caller, { ...input, initialTasks: [input.initialTasks[0], input.initialTasks[0]] })).rejects.toThrow('Provide one initial task per member.');
    expect(create).not.toHaveBeenCalled();
  });

  it('sends alerts only after the transaction commits', async () => {
    const { service, prisma, notify } = serviceWithPrismaSpy();
    let committed = false;
    prisma.$transaction.mockImplementationOnce(async (operation) => {
      const result = await operation(prisma);
      expect(notify).not.toHaveBeenCalled();
      committed = true;
      return result;
    });
    notify.mockImplementation(async () => { expect(committed).toBe(true); });
    await service.createProject(caller, input);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('fails the transaction without sending alerts if any task cannot be saved', async () => {
    const { service, taskCreate, notify } = serviceWithPrismaSpy();
    taskCreate.mockRejectedValueOnce(new Error('Database write failed'));
    await expect(service.createProject(caller, input)).rejects.toThrow('Database write failed');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not report a failed creation after commit when notification delivery is unavailable', async () => {
    const { service, notify } = serviceWithPrismaSpy();
    notify.mockRejectedValue(new Error('Notifications unavailable'));
    await expect(service.createProject(caller, input)).resolves.toMatchObject({ id: 'project-1' });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
