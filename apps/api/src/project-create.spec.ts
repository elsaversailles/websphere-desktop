import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

/**
 * projectSchema defaults memberIds to [], so it always reaches the service. It maps onto the
 * members relation rather than a Project column, and leaking it into create() made Prisma reject
 * every project with "Unknown argument `memberIds`".
 */
function serviceWithPrismaSpy() {
  const create = vi.fn().mockResolvedValue({ id: 'project-1' });
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    prisma: { project: { create } },
    member: vi.fn().mockResolvedValue({}),
  });
  return { service, create };
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
