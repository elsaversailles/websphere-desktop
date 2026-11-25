export const workflowPeriods = ['daily', 'weekly', 'monthly'] as const;
export type WorkflowPeriod = (typeof workflowPeriods)[number];

export function workflowDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function workflowPeriodStart(period: WorkflowPeriod, key: string) {
  const date = new Date(`${key}T00:00:00Z`);
  if (period === 'monthly') date.setUTCDate(1);
  if (period === 'weekly') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return workflowDateKey(date);
}

export function shiftWorkflowPeriod(period: WorkflowPeriod, key: string, amount: number) {
  const date = new Date(`${key}T00:00:00Z`);
  if (period === 'monthly') date.setUTCMonth(date.getUTCMonth() + amount, 1);
  else date.setUTCDate(date.getUTCDate() + amount * (period === 'weekly' ? 7 : 1));
  return workflowDateKey(date);
}
