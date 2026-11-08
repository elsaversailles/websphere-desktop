export type AnalyticsTask = { id: string; status: string; startDate?: Date | null; deadline?: Date | null; createdAt?: Date | null; assignedAt?: Date | null; startedAt?: Date | null; completedAt?: Date | null; expectedDurationHrs?: number | null; assigneeId?: string | null };
export type TaskDependencyEdge = { prerequisiteId: string; dependentId: string };
export type TaskScheduleMetrics = { expectedDays: number | null; actualDays: number | null; delayDays: number };
const dayMilliseconds = 86_400_000;

function endOfUtcDay(value: Date) {
  const end = new Date(value);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function plannedDurationDays(start: Date, end: Date) {
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(1, Math.floor((endDay - startDay) / dayMilliseconds) + 1);
}

/** Uses task dates and status events already captured by the product to derive schedule delay. */
export function taskScheduleMetrics(task: AnalyticsTask, now = new Date()): TaskScheduleMetrics {
  const plannedStart = task.startDate ?? task.assignedAt ?? task.createdAt ?? null;
  const expectedDays = task.expectedDurationHrs
    ? task.expectedDurationHrs / 24
    : plannedStart && task.deadline ? plannedDurationDays(plannedStart, task.deadline) : null;
  const actualStart = task.startedAt ?? (task.status === 'pending' ? null : task.assignedAt ?? task.createdAt ?? plannedStart);
  const actualEnd = task.completedAt ?? now;
  const actualDays = actualStart ? Math.max(0, (actualEnd.getTime() - actualStart.getTime()) / dayMilliseconds) : null;
  const scheduleDelayDays = task.deadline ? Math.max(0, (actualEnd.getTime() - endOfUtcDay(task.deadline).getTime()) / dayMilliseconds) : 0;
  const durationDelayDays = actualDays !== null && expectedDays !== null ? Math.max(0, actualDays - expectedDays) : 0;
  return { expectedDays, actualDays, delayDays: Math.max(scheduleDelayDays, durationDelayDays) };
}
export function blastRadius(taskId: string, dependencies: TaskDependencyEdge[], tasks: AnalyticsTask[]): number {
  const downstream = new Set<string>();
  const queue = [taskId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of dependencies) {
      if (edge.prerequisiteId === current && !downstream.has(edge.dependentId)) { downstream.add(edge.dependentId); queue.push(edge.dependentId); }
    }
  }
  const affectedMembers = new Set(tasks.filter((task) => downstream.has(task.id) && task.assigneeId).map((task) => task.assigneeId));
  return downstream.size + affectedMembers.size;
}
export const completionRate = (completed: number, total: number) => completed / Math.max(total, 1);
export const overallEfficiency = (onTimeCompleted: number, totalCompleted: number) => onTimeCompleted / Math.max(totalCompleted, 1);
export const riskLevel = (score: number) => score < 40 ? 'on_track' : score <= 70 ? 'at_risk' : 'critical';
export function riskScore(remainingWorkVsTimeLeft: number, normalizedVelocity: number, normalizedOverdueBlocked: number, weights = [45, 30, 25]) {
  return Math.max(0, Math.min(100, weights[0] * remainingWorkVsTimeLeft + weights[1] * (1 - normalizedVelocity) + weights[2] * normalizedOverdueBlocked));
}
export function projectAnalytics(tasks: AnalyticsTask[], deadline?: Date | null, now = new Date(), dependencies: TaskDependencyEdge[] = []) {
  const done = tasks.filter((task) => task.status === 'completed');
  const onTime = done.filter((task) => !task.deadline || (task.completedAt && task.completedAt <= task.deadline));
  const remaining = tasks.length - done.length;
  const windowDays = 30;
  const velocity = done.filter((task) => task.completedAt && task.completedAt >= new Date(now.getTime() - windowDays * 86400000)).length / windowDays;
  const predictedCompletion = new Date(now.getTime() + Math.ceil(remaining / Math.max(velocity, 0.01)) * 86400000);
  const overdue = tasks.filter((task) => task.status !== 'completed' && task.deadline && task.deadline < now).length;
  const timeLeft = deadline ? Math.max(1, (deadline.getTime() - now.getTime()) / 86400000) : Math.max(1, remaining);
  const score = riskScore(Math.min(1, remaining / timeLeft), Math.min(1, velocity), tasks.length ? overdue / tasks.length : 0);
  const bottlenecks = tasks.map((task) => {
    const timing = taskScheduleMetrics(task, now);
    return { taskId: task.id, expectedDuration: (timing.expectedDays ?? 0) * 24, actualDuration: (timing.actualDays ?? 0) * 24, delayDays: timing.delayDays, blastRadius: blastRadius(task.id, dependencies, tasks) };
  }).filter((b) => b.delayDays > 0);
  return { taskCompletionRate: completionRate(done.length, tasks.length), overallEfficiency: overallEfficiency(onTime.length, done.length), riskScore: score, riskLevel: riskLevel(score), predictedCompletion, deltaDays: deadline ? Math.ceil((predictedCompletion.getTime() - deadline.getTime()) / 86400000) : null, bottlenecks, velocity, remaining };
}
export function recommendations(level: string, bottlenecks: unknown[]) { const actions: string[] = []; if (level === 'critical') actions.push('Schedule an immediate project review', 'Reassign blocked work or add member support'); if (level === 'at_risk') actions.push('Review the deadline and rebalance assignments'); if (bottlenecks.length) actions.push('Resolve identified bottlenecks before starting dependent work'); return actions; }
