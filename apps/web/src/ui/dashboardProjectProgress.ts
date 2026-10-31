import type { Health } from './health';

const TASK_PROGRESS: Record<string, number> = {
  pending: 0,
  ongoing: 50,
  for_review: 75,
  completed: 100,
};

/** Average task auto-progress; lifecycle states remain visible for closed or paused projects. */
export function dashboardProjectProgress(tasks: Array<{ status: string }>, projectStatus?: string | null): { progress: number; health: Health } {
  const average = tasks.length ? tasks.reduce((total, task) => total + (TASK_PROGRESS[task.status] ?? 0), 0) / tasks.length : 0;
  // Rounding must not make an unfinished project look complete.
  const progress = average < 100 ? Math.min(99, Math.round(average)) : 100;
  let health: Health;
  if (projectStatus === 'completed') health = { tone: 'g', label: 'Completed' };
  else if (projectStatus === 'archived') health = { tone: 'ac', label: 'Archived' };
  else if (projectStatus === 'on_hold') health = { tone: 'y', label: 'On Hold' };
  else if (average === 100) health = { tone: 'g', label: 'Completed' };
  else if (average >= 75) health = { tone: 'ac', label: 'For Review' };
  else if (average > 0) health = { tone: 'y', label: 'In Progress' };
  else health = { tone: 'r', label: 'Not Started' };
  return { progress, health };
}
