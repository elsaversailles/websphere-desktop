import { afterEach, describe, expect, it, vi } from 'vitest';

const webPush = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: webPush }));

import { PushService } from './push.service.js';

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    notificationPreference: { findUnique: vi.fn().mockResolvedValue({ pushEnabled: true }) },
    pushSubscription: { findMany: vi.fn().mockResolvedValue([{ id: 'subscription-1', endpoint: 'https://push.example/subscription', p256dh: 'key', auth: 'auth' }]), delete: vi.fn() },
    mobilePushToken: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
  };
  const config = { get: vi.fn((key: string) => ({ VAPID_SUBJECT: 'mailto:notifications@example.edu', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private' }[key])) };
  return new PushService(prisma as any, config as any, ...(Object.values(overrides) as []));
}

describe('PushService', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
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

  it('sends the same notification to a registered mobile device', async () => {
    webPush.sendNotification.mockResolvedValue(undefined);
    const service = serviceWith();
    const prisma = (service as any).prisma;
    prisma.mobilePushToken.findMany.mockResolvedValue([{ token: 'ExpoPushToken[device1]' }]);
    const send = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'ok', id: 'ticket-1' }] }) });
    vi.stubGlobal('fetch', send);

    await service.deliver({ id: 'notification-1', userId: 'user-1', message: 'You were assigned a task.', relatedId: 'task-1', relatedType: 'task' });

    expect(send).toHaveBeenCalledWith('https://exp.host/--/api/v2/push/send', expect.objectContaining({ method: 'POST' }));
    const messages = JSON.parse(send.mock.calls[0][1].body);
    expect(messages).toEqual([expect.objectContaining({ to: 'ExpoPushToken[device1]', body: 'You were assigned a task.', data: { notificationId: 'notification-1', relatedId: 'task-1', relatedType: 'task' } })]);
  });

  it('removes mobile tokens rejected by Expo as unregistered', async () => {
    webPush.sendNotification.mockResolvedValue(undefined);
    const service = serviceWith();
    const prisma = (service as any).prisma;
    prisma.mobilePushToken.findMany.mockResolvedValue([{ token: 'ExpoPushToken[olddevice]' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }));

    await service.deliver({ id: 'notification-1', userId: 'user-1', message: 'A task changed.' });

    expect(prisma.mobilePushToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'ExpoPushToken[olddevice]' } });
  });
});
