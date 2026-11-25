import { projectProgressStatus } from '@websphere/shared';
import type { Health } from './health';

const TASK_PROGRESS: Record<string, number> = {
  pending: 0,
  ongoing: 50,
  for_review: 75,
  completed: 100,
};

/** Average task auto-progress; lifecycle states remain visible for closed or paused projects. */
export function dashboardProjectProgress(tasks: Array<{ status: string }>, projectStatus?: string | null, aggregateAverage?: number): { progress: number; health: Health } {
  const average = aggregateAverage ?? (tasks.length ? tasks.reduce((total, task) => total + (TASK_PROGRESS[task.status] ?? 0), 0) / tasks.length : 0);
  // Rounding must not make an unfinished project look complete.
  const progress = average < 100 ? Math.min(99, Math.round(average)) : 100;
  let health: Health;
  if (projectStatus === 'archived') health = { tone: 'ac', label: 'Archived' };
  else if (projectStatus === 'on_hold') health = { tone: 'y', label: 'On Hold' };
  else health = ({
    completed: { tone: 'g', label: 'Completed' },
    for_review: { tone: 'ac', label: 'For Review' },
    ongoing: { tone: 'y', label: 'In Progress' },
    pending: { tone: 'r', label: 'Not Started' },
  } satisfies Record<string, Health>)[projectProgressStatus(average)];
  return { progress, health };
}
