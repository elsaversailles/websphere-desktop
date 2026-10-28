import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from './config.service.js';
import { DomainEventsService } from './domain-events.service.js';
import { JobsService } from './jobs.service.js';
import { PrismaService } from './prisma.service.js';
import { PushService } from './push.service.js';

type ScheduledReminder = { deadline: string; day: string; timeZone: string };

/** Relays persisted worker reminders through the same live/mobile/email channels as assignments. */
@Injectable()
export class NotificationDispatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private worker?: Worker;
  private readonly logger = new Logger(NotificationDispatchService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly events: DomainEventsService, private readonly push: PushService, private readonly jobs: JobsService) {}

  onApplicationBootstrap() {
    this.worker = new Worker('notification-dispatch', (job) => this.deliver(job.data.notificationId, job.data.reminder), { connection: { url: this.config.get('REDIS_URL') } });
    this.worker.on('failed', (job, error) => this.logger.error(`Notification dispatch failed: ${job?.id}`, error));
    this.worker.on('error', (error) => this.logger.error('Notification dispatch worker error', error));
  }

  async deliver(notificationId: string, reminder?: ScheduledReminder) {
    if (reminder) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: reminder.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const day = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
      if (day !== reminder.day) return; // A delayed delivery must not send yesterday’s reminder.
    }
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId }, include: { user: { select: { status: true, role: true } } } });
    if (!notification || notification.user.status !== 'active') return;
    if (notification.relatedType === 'task' && notification.relatedId) {
      const task = await this.prisma.task.findUnique({ where: { id: notification.relatedId }, select: { status: true, deadline: true, createdBy: true, assignments: { where: { active: true }, select: { assigneeId: true } } } });
      if (!task || task.status === 'completed' || !task.deadline) return;
      if (reminder && task.deadline.toISOString() !== reminder.deadline) return;
      const responsible = task.assignments.length ? task.assignments.some((assignment) => assignment.assigneeId === notification.userId) : task.createdBy === notification.userId;
      if (!responsible && notification.user.role !== 'Administrator') return;
    }
    // Do not expose the included user record in websocket/push payloads.
    const { user, ...payload } = notification;
    await this.jobs.enqueueNotificationEmail(notification.id);
    this.events.emitNotification(notification.userId, payload);
    await this.push.deliver(payload);
  }

  async onApplicationShutdown() { await this.worker?.close(); }
}
