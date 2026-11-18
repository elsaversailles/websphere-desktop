import { expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';

it('applies each member’s deletion cutoff to the hub and message search', async () => {
  const cutoff = new Date('2026-01-02T00:00:00Z');
  const findMany = vi.fn().mockResolvedValue([]);
  const app = {
    member: vi.fn().mockResolvedValueOnce({ chatDeletedAt: cutoff }).mockResolvedValueOnce({ chatDeletedAt: cutoff }).mockResolvedValueOnce({ chatDeletedAt: null }),
    group: vi.fn().mockResolvedValue({}), ideas: vi.fn().mockResolvedValue([]),
    prisma: { chatMessage: { findMany }, ideaPoll: { findFirst: vi.fn().mockResolvedValue(null) } },
  };
  const controller = Object.create(AppController.prototype) as AppController;
  Object.assign(controller, { app, caller: vi.fn().mockResolvedValue({ id: 'alice' }) });
  await controller.hub('token', 'group');
  await controller.messages('token', 'group', undefined, 'old');
  await controller.messages('token', 'group');
  expect(findMany.mock.calls[0][0].where).toEqual({ groupId: 'group', createdAt: { gt: cutoff } });
  expect(findMany.mock.calls[1][0].where).toEqual({ groupId: 'group', createdAt: { gt: cutoff }, body: { contains: 'old' } });
  expect(findMany.mock.calls[2][0].where).toEqual({ groupId: 'group' });
});
