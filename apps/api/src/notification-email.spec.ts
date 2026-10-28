import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

function fixture(disabled = false) {
  const create = vi.fn().mockImplementation(async ({ data }) => ({ id: `notification-${data.userId}`, ...data }));
  const findMany = vi.fn().mockResolvedValue(disabled ? [{ userId: 'user-2', tasks: false, groupActivity: false }] : []);
  const enqueueNotificationEmail = vi.fn().mockResolvedValue(undefined);
  const emitNotification = vi.fn();
  const deliver = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    prisma: { notification: { create }, notificationPreference: { findMany } },
    jobs: { enqueueNotificationEmail },
    events: { emitNotification },
    push: { deliver },
    logger: { error: vi.fn() },
  });
  return { service, create, findMany, enqueueNotificationEmail, emitNotification, deliver };
}

describe('notification email queueing', () => {
  it('queues one email per new eligible notification', async () => {
    const { service, enqueueNotificationEmail, emitNotification, deliver } = fixture();
    const result = await service.notify(['user-1', 'user-2', 'user-1'], 'task_assignment', 'Task assigned');
    expect(result.delivered).toBe(2);
    expect(enqueueNotificationEmail).toHaveBeenCalledTimes(2);
    expect(enqueueNotificationEmail).toHaveBeenCalledWith('notification-user-1');
    expect(enqueueNotificationEmail).toHaveBeenCalledWith('notification-user-2');
    expect(emitNotification).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', type: 'task_assignment' }));
  });

  it('does not queue email when the notification category is disabled', async () => {
    const { service, enqueueNotificationEmail } = fixture(true);
    const result = await service.notify(['user-1', 'user-2'], 'task_assignment', 'Task assigned');
    expect(result.delivered).toBe(1);
    expect(enqueueNotificationEmail).toHaveBeenCalledTimes(1);
    expect(enqueueNotificationEmail).toHaveBeenCalledWith('notification-user-1');
  });

  it('delivers system announcements despite the group activity preference', async () => {
    const { service, enqueueNotificationEmail } = fixture(true);
    const result = await service.notify(['user-1', 'user-2'], 'announcement', 'Maintenance begins soon', 'maintenance', 'system');
    expect(result.delivered).toBe(2);
    expect(enqueueNotificationEmail).toHaveBeenCalledTimes(2);
  });

  it('keeps the in-app notification when queueing email fails', async () => {
    const { service, enqueueNotificationEmail, emitNotification } = fixture();
    enqueueNotificationEmail.mockRejectedValue(new Error('Redis unavailable'));
    const result = await service.notify(['user-1'], 'announcement', 'New announcement');
    expect(result.delivered).toBe(1);
    expect(emitNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps assignment alerts within the database message limit for long task/project titles', async () => {
    const { service, create, deliver } = fixture();
    await service.notify(['user-1'], 'task_assignment', `You were assigned “${'A'.repeat(180)}” in “${'B'.repeat(180)}”`, 'task-1', 'task');
    expect(create.mock.calls[0][0].data.message.length).toBeLessThanOrEqual(191);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ relatedId: 'task-1', relatedType: 'task' }));
  });
});
