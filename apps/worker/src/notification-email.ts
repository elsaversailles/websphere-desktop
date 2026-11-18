import type { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));
}

export function brandedEmailHtml(content: string, env: NodeJS.ProcessEnv = process.env) {
  const logo = new URL('/email-logo.png', (env.WEB_ORIGIN ?? 'https://websphere.cloud').split(',')[0].trim()).toString();
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><p><img src="${logo}" width="48" height="48" alt="" style="vertical-align:middle;border-radius:10px"> <strong>WebSphere</strong></p>${content}</div>`;
}

export async function deliverNotificationEmail(prisma: PrismaClient, notificationId: string, env: NodeJS.ProcessEnv = process.env) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: { user: { select: { email: true, status: true, role: true, preference: { select: { emailEnabled: true } } } } },
  });
  if (!notification || notification.user.status !== 'active' || notification.user.preference?.emailEnabled === false) return;

  // Recheck queued mail: membership may have ended after the reminder was queued.
  if (notification.user.role !== 'Administrator' && notification.relatedId && ['task', 'project'].includes(notification.relatedType ?? '')) {
    const userId = notification.userId;
    const access = await prisma.project.findFirst({ where: { ...(notification.relatedType === 'project' ? { members: { some: { userId } } } : {}), OR: [{ groupId: null }, { group: { members: { some: { userId } } } }], ...(notification.relatedType === 'task' ? { tasks: { some: { id: notification.relatedId } } } : { id: notification.relatedId }) }, select: { id: true } });
    if (!access) return;
  }
  const { SES_HOST: host, SES_USER: user, SES_PASSWORD: pass, SES_FROM: from } = env;
  if (!host || !user || !pass || !from) throw new Error('SES SMTP configuration is incomplete');
  const port = Number(env.SES_PORT ?? 587);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({
    from: { name: 'WebSphere', address: from },
    to: notification.user.email,
    subject: notification.type === 'deadline_reminder' && notification.relatedType === 'task' ? 'WebSphere task deadline reminder' : 'New WebSphere notification',
    text: `${notification.message}\n\nOpen WebSphere to view your notifications.`,
    html: brandedEmailHtml(`<p>${escapeHtml(notification.message).replace(/\n/g, '<br>')}</p><p>Open WebSphere to view your notifications.</p>`, env),
  });
}
