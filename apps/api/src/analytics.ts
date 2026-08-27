export type AnalyticsTask = { id: string; status: string; deadline?: Date | null; startedAt?: Date | null; completedAt?: Date | null; expectedDurationHrs?: number | null; assigneeId?: string | null };
export const completionRate = (completed: number, total: number) => completed / Math.max(total, 1);
export const overallEfficiency = (onTimeCompleted: number, totalCompleted: number) => onTimeCompleted / Math.max(totalCompleted, 1);
export const riskLevel = (score: number) => score < 40 ? 'on_track' : score <= 70 ? 'at_risk' : 'critical';
export function riskScore(remainingWorkVsTimeLeft: number, normalizedVelocity: number, normalizedOverdueBlocked: number, weights = [45, 30, 25]) {
  return Math.max(0, Math.min(100, weights[0] * remainingWorkVsTimeLeft + weights[1] * (1 - normalizedVelocity) + weights[2] * normalizedOverdueBlocked));
}
export function projectAnalytics(tasks: AnalyticsTask[], deadline?: Date | null, now = new Date()) {
  const done = tasks.filter((task) => task.status === 'completed');
  const onTime = done.filter((task) => !task.deadline || (task.completedAt && task.completedAt <= task.deadline));
  const remaining = tasks.length - done.length;
  const windowDays = 30;
  const velocity = done.filter((task) => task.completedAt && task.completedAt >= new Date(now.getTime() - windowDays * 86400000)).length / windowDays;
  const predictedCompletion = new Date(now.getTime() + Math.ceil(remaining / Math.max(velocity, 0.01)) * 86400000);
  const overdue = tasks.filter((task) => task.status !== 'completed' && task.deadline && task.deadline < now).length;
  const timeLeft = deadline ? Math.max(1, (deadline.getTime() - now.getTime()) / 86400000) : Math.max(1, remaining);
  const score = riskScore(Math.min(1, remaining / timeLeft), Math.min(1, velocity), tasks.length ? overdue / tasks.length : 0);
  const bottlenecks = tasks.filter((task) => task.expectedDurationHrs && task.startedAt).map((task) => {
    const actual = ((task.completedAt ?? now).getTime() - task.startedAt!.getTime()) / 36e5;
    return { taskId: task.id, expectedDuration: task.expectedDurationHrs, actualDuration: actual, delayDays: Math.max(0, (actual - task.expectedDurationHrs!) / 24), blastRadius: 0 };
  }).filter((b) => b.delayDays > 0);
  return { taskCompletionRate: completionRate(done.length, tasks.length), overallEfficiency: overallEfficiency(onTime.length, done.length), riskScore: score, riskLevel: riskLevel(score), predictedCompletion, deltaDays: deadline ? Math.ceil((predictedCompletion.getTime() - deadline.getTime()) / 86400000) : null, bottlenecks, velocity, remaining };
}
export function recommendations(level: string, bottlenecks: unknown[]) { const actions: string[] = []; if (level === 'critical') actions.push('Schedule an immediate project review', 'Reassign blocked work or add member support'); if (level === 'at_risk') actions.push('Review the deadline and rebalance assignments'); if (bottlenecks.length) actions.push('Resolve identified bottlenecks before starting dependent work'); return actions; }
