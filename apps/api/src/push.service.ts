import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { ConfigService } from './config.service.js';
import { PrismaService } from './prisma.service.js';

export type PushNotification = { id: string; userId: string; message: string; relatedId?: string | null; relatedType?: string | null };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  configured() {
    return Boolean(this.config.get('VAPID_SUBJECT') && this.config.get('VAPID_PUBLIC_KEY') && this.config.get('VAPID_PRIVATE_KEY'));
  }

  publicConfig() {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY');
    return this.configured() && publicKey ? { enabled: true, publicKey } : { enabled: false as const };
  }

  private configureVapid() {
    const subject = this.config.get('VAPID_SUBJECT');
    const publicKey = this.config.get('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get('VAPID_PRIVATE_KEY');
    if (!subject || !publicKey || !privateKey) return false;
    webpush.setVapidDetails(subject.includes(':') ? subject : `mailto:${subject}`, publicKey, privateKey);
    return true;
  }

  async deliver(notification: PushNotification) {
    const preference = await this.prisma.notificationPreference.findUnique({ where: { userId: notification.userId }, select: { pushEnabled: true } });
    if (preference?.pushEnabled === false) return;
    await Promise.all([this.deliverWeb(notification), this.deliverMobile(notification)]);
  }

  private async deliverWeb(notification: PushNotification) {
    if (!this.configureVapid()) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId: notification.userId } });
    const payload = JSON.stringify({ title: 'WebSphere', body: notification.message, url: '/', notificationId: notification.id, relatedId: notification.relatedId, relatedType: notification.relatedType });
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60 });
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: subscription.id } });
          return;
        }
        this.logger.warn(`Push delivery failed for subscription ${subscription.id}: ${error?.statusCode ?? 'unknown error'}`);
      }
    }));
  }

  private async deliverMobile(notification: PushNotification) {
    const devices = await this.prisma.mobilePushToken.findMany({ where: { userId: notification.userId } });
    for (let offset = 0; offset < devices.length; offset += 100) {
      const batch = devices.slice(offset, offset + 100);
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(batch.map(({ token }) => ({
            to: token,
            title: 'WebSphere',
            body: notification.message,
            sound: 'default',
            channelId: 'notifications',
            data: { notificationId: notification.id, relatedId: notification.relatedId, relatedType: notification.relatedType },
          }))),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json() as { data?: { status: string; message?: string; details?: { error?: string } }[]; errors?: { message?: string }[] };
        if (result.errors?.length || !Array.isArray(result.data) || result.data.length !== batch.length) {
          throw new Error(result.errors?.[0]?.message ?? 'Invalid Expo push response');
        }
        await Promise.all(result.data.map(async (ticket, index) => {
          if (ticket.status === 'ok') return;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            await this.prisma.mobilePushToken.deleteMany({ where: { token: batch[index].token } });
          } else {
            this.logger.warn(`Mobile push rejected: ${ticket.details?.error ?? ticket.message ?? 'unknown error'}`);
          }
        }));
      } catch (error: any) {
        this.logger.warn(`Mobile push delivery failed: ${error?.message ?? 'unknown error'}`);
      }
    }
  }
}
