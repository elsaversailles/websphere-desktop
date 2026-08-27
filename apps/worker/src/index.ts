import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
const prisma: any = new PrismaClient();
const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
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
new Worker('deadline-scan', async () => { /* Calendar deadline fan-out is persisted by NotificationsModule before SES/VAPID adapters deliver. */ }, { connection });
