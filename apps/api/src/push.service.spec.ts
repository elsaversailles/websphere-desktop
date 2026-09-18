import { describe, expect, it, vi } from 'vitest';

const webPush = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: webPush }));

import { PushService } from './push.service.js';

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    notificationPreference: { findUnique: vi.fn().mockResolvedValue({ pushEnabled: true }) },
    pushSubscription: { findMany: vi.fn().mockResolvedValue([{ id: 'subscription-1', endpoint: 'https://push.example/subscription', p256dh: 'key', auth: 'auth' }]), delete: vi.fn() },
  };
  const config = { get: vi.fn((key: string) => ({ VAPID_SUBJECT: 'mailto:notifications@example.edu', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private' }[key])) };
  return new PushService(prisma as any, config as any, ...(Object.values(overrides) as []));
}

describe('PushService', () => {
  it('sends a VAPID notification to each subscribed device', async () => {
    webPush.sendNotification.mockResolvedValue(undefined);
    const service = serviceWith();

    await service.deliver({ id: 'notification-1', userId: 'user-1', message: 'You were assigned a task.', relatedId: 'task-1', relatedType: 'task' });

    expect(webPush.setVapidDetails).toHaveBeenCalledWith('mailto:notifications@example.edu', 'public', 'private');
    expect(webPush.sendNotification).toHaveBeenCalledWith({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }, expect.stringContaining('You were assigned a task.'), { TTL: 3600 });
  });

  it('prunes subscriptions rejected as gone by the push service', async () => {
    webPush.sendNotification.mockRejectedValue({ statusCode: 410 });
    const service = serviceWith();
    const prisma = (service as any).prisma;

    await service.deliver({ id: 'notification-1', userId: 'user-1', message: 'You were assigned a task.' });

    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'subscription-1' } });
  });
});
