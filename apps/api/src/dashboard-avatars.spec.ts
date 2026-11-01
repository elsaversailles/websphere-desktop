import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

describe('dashboard activity avatars', () => {
  it('respects profile photo visibility while retaining the viewer’s own photo', async () => {
    const actors = [
      { id: 'visible', fullName: 'Visible User', avatarUrl: '/visible.png', preference: { profileVisibility: true } },
      { id: 'hidden', fullName: 'Hidden User', avatarUrl: '/hidden.png', preference: { profileVisibility: false } },
      { id: 'viewer', fullName: 'Viewer', avatarUrl: '/viewer.png', preference: { profileVisibility: false } },
    ];
    const prisma = {
      workflowEvent: { findMany: vi.fn(async () => actors.map((actor) => ({ id: actor.id, actorId: actor.id, projectId: 'project', project: { title: 'Project' }, createdAt: new Date() }))) },
      user: { findMany: vi.fn(async () => actors) },
    };
    const service = Object.assign(Object.create(AppService.prototype), { prisma }) as AppService;
    const events = await service.activityFeed({ id: 'viewer' } as any);
    expect(events.map((event: any) => event.actor.avatarUrl)).toEqual(['/visible.png', null, '/viewer.png']);
    expect(events[1].actor).not.toHaveProperty('preference');
  });
});
