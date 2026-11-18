import { expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';
it('reads only the caller’s delivered system announcements without changing unread state', async () => {
  const findMany = vi.fn().mockResolvedValue([{ id: 'n', relatedId: 'maintenance', message: 'Scheduled maintenance', createdAt: new Date() }]);
  const service = Object.assign(Object.create(AppService.prototype), { prisma: { notification: { findMany } } }) as AppService;
  expect(await service.systemAnnouncements({ id: 'u', role: 'Project_Member', tv: 0 })).toEqual([expect.objectContaining({ title: 'WebSphere maintenance', body: 'Scheduled maintenance' })]);
  expect(findMany).toHaveBeenCalledWith({ where: { userId: 'u', type: 'announcement', relatedType: 'system' }, orderBy: { createdAt: 'desc' }, take: 100 });
});
