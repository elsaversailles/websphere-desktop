import type { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));
}

export async function deliverNotificationEmail(prisma: PrismaClient, notificationId: string, env: NodeJS.ProcessEnv = process.env) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: { user: { select: { email: true, status: true, preference: { select: { emailEnabled: true } } } } },
  });
  if (!notification || notification.user.status !== 'active' || notification.user.preference?.emailEnabled === false) return;

  const { SES_HOST: host, SES_USER: user, SES_PASSWORD: pass, SES_FROM: from } = env;
  if (!host || !user || !pass || !from) throw new Error('SES SMTP configuration is incomplete');
  const port = Number(env.SES_PORT ?? 587);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({
    from,
    to: notification.user.email,
    subject: notification.type === 'deadline_reminder' && notification.relatedType === 'task' ? 'WebSphere task deadline reminder' : 'New WebSphere notification',
    text: `${notification.message}\n\nOpen WebSphere to view your notifications.`,
    html: `<p>${escapeHtml(notification.message).replace(/\n/g, '<br>')}</p><p>Open WebSphere to view your notifications.</p>`,
  });
}
