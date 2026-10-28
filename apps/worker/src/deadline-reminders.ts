import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';

type ReminderPhase = 'upcoming' | 'today' | 'overdue';

export function calendarDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Task/project due dates are date-only values encoded as UTC midnight, not instant deadlines. */
export function reminderPhase(deadline: Date, today: string): ReminderPhase | null {
  const dueDay = deadline.toISOString().slice(0, 10);
  if (dueDay < today) return 'overdue';
  if (dueDay === today) return 'today';
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return dueDay === tomorrow ? 'upcoming' : null;
}

export async function scanDeadlineReminders(prisma: PrismaClient, dispatchQueue: Pick<Queue, 'add'>, now = new Date(), timeZone = process.env.APP_TIME_ZONE ?? 'Asia/Manila') {
  const today = calendarDay(now, timeZone);
  const short = (title: string, max: number) => title.length > max ? `${title.slice(0, max - 1)}…` : title;

  async function notify(userId: string, relatedId: string, relatedType: 'task' | 'project', deadline: Date, phase: ReminderPhase, message: string) {
    const preference = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (relatedType === 'task' ? preference?.tasks === false : preference?.deadlines === false) return;
    const type = phase === 'overdue' ? 'delay_risk' : 'deadline_reminder';
    // A distinct, stable primary key for each recipient/date/phase prevents both parallel-scan
    // duplicates and an advance reminder suppressing the due-day reminder. No schema migration.
    const id = `deadline-${createHash('sha256').update(JSON.stringify([userId, relatedType, relatedId, deadline.toISOString().slice(0, 10), today, phase])).digest('hex')}`;
    const notification = await prisma.notification.upsert({ where: { id }, update: {}, create: { id, userId, type, message, relatedId, relatedType } });
    // Re-enqueue safely after an interrupted scan. Retain completed jobs longer than the day
    // represented by the ID, so repeated scans cannot resend a delivered reminder.
    await dispatchQueue.add('deliver', { notificationId: notification.id, reminder: { deadline: deadline.toISOString(), day: today, timeZone } }, {
      jobId: notification.id, attempts: 5, backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 7 * 86_400 }, removeOnFail: { age: 30 * 86_400 },
    });
  }

  const [administrators, tasks, projects] = await Promise.all([
    prisma.user.findMany({ where: { role: 'Administrator', status: 'active' }, select: { id: true } }),
    prisma.task.findMany({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: { assignments: { where: { active: true } }, project: { select: { title: true } } } }),
    prisma.project.findMany({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: { members: true } }),
  ]);
  for (const task of tasks) {
    if (!task.deadline) continue;
    const phase = reminderPhase(task.deadline, today);
    if (!phase) continue;
    const suffix = phase === 'today' ? 'is due today.' : phase === 'upcoming' ? 'is due tomorrow.' : 'is overdue.';
    // Until assigned, responsibility falls to the task creator. Reassignment uses active rows only.
    const responsible = task.assignments.length ? task.assignments.map((assignment) => assignment.assigneeId) : [task.createdBy];
    for (const userId of new Set(responsible)) await notify(userId, task.id, 'task', task.deadline, phase, `Task “${short(task.title, 100)}” ${suffix}`);
    for (const admin of administrators) {
      if (!responsible.includes(admin.id)) await notify(admin.id, task.id, 'task', task.deadline, phase, `Task “${short(task.title, 100)}” in “${short(task.project.title, 45)}” ${suffix}`);
    }
  }
  for (const project of projects) {
    if (!project.deadline) continue;
    const phase = reminderPhase(project.deadline, today);
    if (!phase) continue;
    const suffix = phase === 'today' ? 'is due today.' : phase === 'upcoming' ? 'is due tomorrow.' : 'has passed its deadline.';
    for (const userId of new Set(project.members.map((member) => member.userId))) await notify(userId, project.id, 'project', project.deadline, phase, `Project “${short(project.title, 140)}” ${suffix}`);
  }
}
