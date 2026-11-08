import { describe, expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

function fixture(body = 'Existing project details') {
  const caller = { id: 'author-1', role: 'Project_Leader', tv: 0 } as const;
  const idea = { id: 'idea-1', authorId: caller.id, title: 'Research project', body, category: 'Academic Project', status: 'submitted' };
  const prisma = { idea: {
    create: vi.fn(async ({ data }) => ({ id: idea.id, ...data })),
    findUniqueOrThrow: vi.fn(async () => idea),
    update: vi.fn(async ({ data }) => ({ ...idea, ...data })),
    delete: vi.fn(async () => idea),
  } };
  const service = Object.assign(Object.create(AppService.prototype), {
    prisma, caller: vi.fn(async () => caller), member: vi.fn(async () => ({})),
  }) as AppService;
  const controller = new AppController(service, {} as any, {} as any, {} as any, {} as any);
  return { controller, prisma };
}

describe('title-only idea submission', () => {
  it('accepts a title through the request schema and saves an idea without requiring details', async () => {
    const { controller, prisma } = fixture();
    await expect(controller.idea('author', 'group-1', { title: '  Campus project  ' })).resolves.toMatchObject({
      title: 'Campus project', body: '', category: 'Academic Project', groupId: 'group-1', authorId: 'author-1', readinessScore: expect.any(Number),
    });
    expect(prisma.idea.create).toHaveBeenCalledOnce();
  });

  it('keeps accepting details supplied by existing clients and merged ideas', async () => {
    const { controller } = fixture();
    await expect(controller.idea('author', 'group-1', { title: 'Campus project', body: '  Project details  ' })).resolves.toMatchObject({ body: 'Project details' });
  });

  it('rejects an idea title longer than 50 characters', async () => {
    const { controller, prisma } = fixture();

    await expect(controller.idea('author', 'group-1', { title: 'a'.repeat(51) })).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
    expect(prisma.idea.create).not.toHaveBeenCalled();
  });

  it('preserves existing details when a revision only changes the title', async () => {
    const { controller } = fixture();
    await expect(controller.revise('author', 'idea-1', { title: 'Updated project' })).resolves.toMatchObject({
      title: 'Updated project', body: 'Existing project details', status: 'refined',
    });
  });

  it('allows revising a title-only idea while leaving its details empty', async () => {
    const { controller } = fixture('');
    await expect(controller.revise('author', 'idea-1', { title: 'Updated project', body: '' })).resolves.toMatchObject({
      title: 'Updated project', body: '', status: 'refined', readinessScore: expect.any(Number),
    });
  });

  it('deletes an unselected idea for its author', async () => {
    const { controller, prisma } = fixture();

    await expect(controller.deleteIdea('author', 'idea-1')).resolves.toMatchObject({ id: 'idea-1' });
    expect(prisma.idea.delete).toHaveBeenCalledWith({ where: { id: 'idea-1' } });
  });
});
