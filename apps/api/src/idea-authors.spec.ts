import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

describe('idea authors', () => {
  it('resolves authors by user ID even when they are no longer group members', async () => {
    const ideas = [{ id: 'one', authorId: 'former' }, { id: 'two', authorId: 'viewer' }, { id: 'three', authorId: 'missing' }];
    const prisma = { idea: { findMany: vi.fn().mockResolvedValue(ideas) }, user: { findMany: vi.fn().mockResolvedValue([{ id: 'viewer', fullName: 'Alex Rivera' }, { id: 'former', fullName: 'Sam Cruz' }]) } };
    const member = vi.fn().mockResolvedValue({});
    const service = Object.assign(Object.create(AppService.prototype), { prisma, member }) as AppService;
    const result = await service.ideas({ id: 'viewer', role: 'Project_Member', tv: 0 }, 'group');
    expect(member).toHaveBeenCalledWith('group', 'viewer');
    expect(result.map((idea) => idea.authorName)).toEqual(['Sam Cruz', 'Alex Rivera', null]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['former', 'viewer', 'missing'] } }, select: { id: true, fullName: true } });
  });
});
