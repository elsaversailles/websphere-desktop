import { deadlineHealth } from './health';

export function upcomingDeadlines<T extends { deadline?: string | null }>(tasks: T[], today: string) {
  return tasks
    .filter((task) => task.deadline)
    .map((task) => ({ task, health: deadlineHealth(task.deadline, today)! }))
    .filter(({ health }) => health.days <= 14)
    .sort((a, b) => a.health.days - b.health.days);
}
