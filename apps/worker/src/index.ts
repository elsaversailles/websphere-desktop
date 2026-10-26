import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import { deliverNotificationEmail } from './notification-email.js';
const prisma: any = new PrismaClient();
const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
const deadlineScanQueue = new Queue('deadline-scan', { connection });
void deadlineScanQueue.add('hourly-scan', {}, { repeat: { every: 3_600_000 }, jobId: 'deadline-scan-hourly' });
const maintenanceScanQueue = new Queue('maintenance-scan', { connection });
void maintenanceScanQueue.add('five-minute-scan', {}, { repeat: { every: 300_000 }, jobId: 'maintenance-scan-five-minute' });
const inactiveAccountScanQueue = new Queue('inactive-account-scan', { connection });
void inactiveAccountScanQueue.add('daily-scan', {}, { repeat: { every: 86_400_000 }, jobId: 'inactive-account-scan-daily' });
const notificationEmailQueue = new Queue('notification-email', { connection });
const statsFor = (tasks: Array<{ status: string; deadline: Date | null; completedAt: Date | null }>, deadline: Date | null) => {
  const completed = tasks.filter((task) => task.status === 'completed');
  const onTime = completed.filter((task) => !task.deadline || (task.completedAt && task.completedAt <= task.deadline));
  const rate = completed.length / Math.max(tasks.length, 1); const velocity = completed.length / 30; const predictedCompletion = new Date(Date.now() + Math.ceil((tasks.length - completed.length) / Math.max(velocity, 0.01)) * 86400000);
  const score = Math.min(100, Math.max(0, 45 * Math.min(1, (tasks.length - completed.length) / Math.max(1, deadline ? (deadline.getTime() - Date.now()) / 86400000 : tasks.length)) + 30 * (1 - Math.min(1, velocity))));
  return { taskCompletionRate: rate, overallEfficiency: onTime.length / Math.max(completed.length, 1), riskScore: score, riskLevel: score < 40 ? 'on_track' : score <= 70 ? 'at_risk' : 'critical', predictedCompletion, deltaDays: deadline ? Math.ceil((predictedCompletion.getTime() - deadline.getTime()) / 86400000) : null, velocity };
};
new Worker('recompute-analytics', async (job) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: job.data.projectId }, include: { tasks: true } });
  const stats = statsFor(project.tasks, project.deadline);
  return prisma.analyticsSnapshot.create({ data: { projectId: project.id, taskCompletionRate: stats.taskCompletionRate, overallEfficiency: stats.overallEfficiency, riskScore: stats.riskScore, riskLevel: stats.riskLevel, predictedCompletion: stats.predictedCompletion, deltaDays: stats.deltaDays, bottlenecks: [], memberPerf: {}, factors: { velocity: stats.velocity } } });
}, { connection });
async function notifyOnce(userId: string, type: string, message: string, relatedId: string, relatedType: string) {
  const preference = await prisma.notificationPreference.findUnique({ where: { userId } });
  const disabled = relatedType === 'task' ? preference?.tasks === false : preference?.deadlines === false;
  if (disabled) return false;
  const recent = await prisma.notification.findFirst({ where: { userId, type, relatedId, relatedType, createdAt: { gte: new Date(Date.now() - 20 * 3600000) } } });
  if (recent) return false;
  const notification = await prisma.notification.create({ data: { userId, type, message, relatedId, relatedType } });
  try {
    await notificationEmailQueue.add('deliver', { notificationId: notification.id }, {
      jobId: notification.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  } catch (error) {
    console.error('Could not queue notification email', { notificationId: notification.id, error });
  }
  return true;
}

new Worker('deadline-scan', async () => {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 3600000);
  const localDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TIME_ZONE ?? 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const today = localDay(now);
  const soonDay = localDay(soon);
  const administrators = await prisma.user.findMany({ where: { role: 'Administrator', status: 'active' }, select: { id: true } });
  const tasks = await prisma.task.findMany({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: { assignments: { where: { active: true } }, project: { select: { title: true } } } });
  for (const task of tasks) {
    if (!task.deadline) continue;
    const deadlineDay = task.deadline.toISOString().slice(0, 10);
    const overdue = deadlineDay < today;
    const dueToday = deadlineDay === today;
    const upcoming = !overdue && deadlineDay <= soonDay;
    if (!overdue && !upcoming) continue;
    for (const assignment of task.assignments) {
      if (overdue) {
        await notifyOnce(assignment.assigneeId, 'delay_risk', `Task “${task.title}” is overdue.`, task.id, 'task');
      }
      else await notifyOnce(assignment.assigneeId, 'deadline_reminder', dueToday ? `Task “${task.title}” is due today.` : `Task “${task.title}” is due within 24 hours.`, task.id, 'task');
    }
    const adminMessage = overdue ? `Task “${task.title}” in “${task.project.title}” is overdue.` : dueToday ? `Task “${task.title}” in “${task.project.title}” is due today.` : `Task “${task.title}” in “${task.project.title}” is due soon.`;
    for (const administrator of administrators) await notifyOnce(administrator.id, overdue ? 'delay_risk' : 'deadline_reminder', adminMessage, task.id, 'task');
  }
  const projects = await prisma.project.findMany({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: { members: true } });
  for (const project of projects) {
    if (!project.deadline) continue;
    const deadlineDay = project.deadline.toISOString().slice(0, 10);
    const overdue = deadlineDay < today;
    const upcoming = !overdue && deadlineDay <= soonDay;
    if (!overdue && !upcoming) continue;
    for (const member of project.members) {
      if (overdue) await notifyOnce(member.userId, 'delay_risk', `Project “${project.title}” has passed its deadline.`, project.id, 'project');
      else await notifyOnce(member.userId, 'deadline_reminder', `Project “${project.title}” is due within 24 hours.`, project.id, 'project');
    }
  }
}, { connection });

/** Activate due maintenance windows and create one advance notice per active user. */
new Worker('maintenance-scan', async () => {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'maintenanceSchedule' } });
  const schedule = setting?.value as { startsAt?: string; notifiedAt?: string } | null;
  if (!schedule?.startsAt) return;
  const startsAt = new Date(schedule.startsAt);
  if (Number.isNaN(startsAt.getTime())) return;
  const now = new Date();
  if (startsAt <= now) {
    await prisma.systemSetting.upsert({ where: { key: 'maintenanceMode' }, update: { value: true }, create: { key: 'maintenanceMode', value: true } });
    return;
  }
  if (!schedule.notifiedAt && startsAt.getTime() - now.getTime() <= 24 * 3600000) {
    const users = await prisma.user.findMany({ where: { status: 'active' }, select: { id: true } });
    await prisma.notification.createMany({ data: users.map((user: { id: string }) => ({ userId: user.id, type: 'announcement', message: `Scheduled maintenance starts ${startsAt.toLocaleString()}. WebSphere will be unavailable while it is in progress.`, relatedId: 'maintenance', relatedType: 'system' })) });
    await prisma.systemSetting.update({ where: { key: 'maintenanceSchedule' }, data: { value: { ...schedule, notifiedAt: now.toISOString() } } });
  }
}, { connection });

type InactiveAccountAlertConfig = { enabled?: boolean; recipientEmail?: string; inactivityDays?: number; lastSentAt?: string };

function escapeHtml(value: string) { return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char)); }

const notificationEmailWorker = new Worker('notification-email', async (job) => {
  await deliverNotificationEmail(prisma, job.data.notificationId as string);
}, { connection });
notificationEmailWorker.on('failed', (job, error) => console.error('Notification email failed', { notificationId: job?.data.notificationId, attemptsMade: job?.attemptsMade, error }));

/** Sends at most one digest per calendar day, after the administrator explicitly enables it. */
new Worker('inactive-account-scan', async () => {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'inactiveAccountAlerts' } });
  const config = setting?.value as InactiveAccountAlertConfig | null;
  const recipient = config?.recipientEmail?.trim();
  const inactivityDays = config?.inactivityDays;
  if (!config?.enabled || !recipient || !Number.isInteger(inactivityDays) || inactivityDays! < 7 || inactivityDays! > 365) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (config.lastSentAt?.slice(0, 10) === today) return;
  const cutoff = new Date(now.getTime() - inactivityDays! * 86_400_000);
  const accounts = await prisma.user.findMany({
    where: { status: 'active', OR: [{ lastLoginAt: { lte: cutoff } }, { lastLoginAt: null, createdAt: { lte: cutoff } }] },
    select: { id: true, fullName: true, email: true, lastLoginAt: true, createdAt: true },
    orderBy: [{ lastLoginAt: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
  if (!accounts.length) return;

  const host = process.env.SES_HOST;
  const user = process.env.SES_USER;
  const pass = process.env.SES_PASSWORD;
  if (!host || !user || !pass) return;
  const port = Number(process.env.SES_PORT ?? 587);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  const rows = accounts.map((account: { fullName: string; email: string; lastLoginAt: Date | null; createdAt: Date }) => {
    const lastSeen = account.lastLoginAt ?? account.createdAt;
    return `<li><strong>${escapeHtml(account.fullName)}</strong> (${escapeHtml(account.email)}) — last sign-in: ${lastSeen.toLocaleDateString()}</li>`;
  }).join('');
  await transport.sendMail({
    from: process.env.SES_FROM ?? 'noreply@example.edu',
    to: recipient,
    subject: `WebSphere inactive-account alert — ${accounts.length} account${accounts.length === 1 ? '' : 's'}`,
    text: `${accounts.length} active WebSphere account(s) have not signed in for at least ${inactivityDays} days.\n\n${accounts.map((account: { fullName: string; email: string; lastLoginAt: Date | null; createdAt: Date }) => `${account.fullName} (${account.email}) — last sign-in: ${(account.lastLoginAt ?? account.createdAt).toLocaleDateString()}`).join('\n')}`,
    html: `<p>${accounts.length} active WebSphere account${accounts.length === 1 ? '' : 's'} have not signed in for at least ${inactivityDays} days.</p><ul>${rows}</ul>`,
  });
  await prisma.systemSetting.update({ where: { key: 'inactiveAccountAlerts' }, data: { value: { ...config, lastSentAt: now.toISOString() } } });
  await prisma.auditLog.create({ data: { module: 'SecuritySettings', activity: 'inactive_account_alert_sent', severity: 'info', description: `Sent inactive-account alert covering ${accounts.length} account(s)` } });
}, { connection });
