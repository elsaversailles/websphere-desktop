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
    if (!this.configureVapid()) return;
    const preference = await this.prisma.notificationPreference.findUnique({ where: { userId: notification.userId }, select: { pushEnabled: true } });
    if (preference?.pushEnabled === false) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId: notification.userId } });
    if (!subscriptions.length) return;
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
}
