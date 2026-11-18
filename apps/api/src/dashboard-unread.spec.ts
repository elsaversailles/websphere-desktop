import { expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';

it('returns all unread notifications even when the dashboard preview is limited to eight', async () => {
  const notifications = Array.from({ length: 15 }, (_, id) => ({ id: String(id), read: id < 3 }));
  const app = {
    caller: vi.fn().mockResolvedValue({ id: 'viewer' }),
    projects: vi.fn().mockResolvedValue([]), myTasks: vi.fn().mockResolvedValue([]),
    notifications: vi.fn().mockResolvedValue(notifications),
    activityFeed: vi.fn().mockResolvedValue([]), onlineTeammates: vi.fn().mockResolvedValue([]),
    eventAnnouncements: vi.fn().mockResolvedValue([]), milestones: vi.fn().mockResolvedValue([]),
    prisma: { idea: { count: vi.fn().mockResolvedValue(0) } },
  };
  const controller = new AppController(app as any, {} as any, {} as any, {} as any, {} as any);
  const result = await controller.dashboard('test');
  expect(result.notifications).toHaveLength(8);
  expect(result.unreadNotifications).toBe(12);
});
