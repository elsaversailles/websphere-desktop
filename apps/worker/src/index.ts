import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
const prisma: any = new PrismaClient();
const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
const deadlineScanQueue = new Queue('deadline-scan', { connection });
void deadlineScanQueue.add('hourly-scan', {}, { repeat: { every: 3_600_000 }, jobId: 'deadline-scan-hourly' });
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
  if (preference && preference.deadlines === false) return;
  const recent = await prisma.notification.findFirst({ where: { userId, type, relatedId, relatedType, createdAt: { gte: new Date(Date.now() - 20 * 3600000) } } });
  if (recent) return;
  await prisma.notification.create({ data: { userId, type, message, relatedId, relatedType } });
}

new Worker('deadline-scan', async () => {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 3600000);
  const tasks = await prisma.task.findMany({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: { assignments: { where: { active: true } } } });
  for (const task of tasks) {
    if (!task.deadline) continue;
    const overdue = task.deadline < now;
    const upcoming = !overdue && task.deadline <= soon;
    if (!overdue && !upcoming) continue;
    for (const assignment of task.assignments) {
      if (overdue) await notifyOnce(assignment.assigneeId, 'delay_risk', `Task “${task.title}” is overdue.`, task.id, 'task');
      else await notifyOnce(assignment.assigneeId, 'deadline_reminder', `Task “${task.title}” is due within 24 hours.`, task.id, 'task');
    }
  }
  const projects = await prisma.project.findMany({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: { members: true } });
  for (const project of projects) {
    if (!project.deadline) continue;
    const overdue = project.deadline < now;
    const upcoming = !overdue && project.deadline <= soon;
    if (!overdue && !upcoming) continue;
    for (const member of project.members) {
      if (overdue) await notifyOnce(member.userId, 'delay_risk', `Project “${project.title}” has passed its deadline.`, project.id, 'project');
      else await notifyOnce(member.userId, 'deadline_reminder', `Project “${project.title}” is due within 24 hours.`, project.id, 'project');
    }
  }
}, { connection });
