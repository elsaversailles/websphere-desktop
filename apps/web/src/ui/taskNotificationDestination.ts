type TaskForNotification = { projectId: string; assignments: Array<{ assigneeId: string }> };

/** A task update belongs in My Tasks only while the recipient is an active assignee. */
export function taskNotificationDestination(task: TaskForNotification, userId: string): 'tasks' | 'projects' {
  return task.assignments.some((assignment) => assignment.assigneeId === userId) ? 'tasks' : 'projects';
}
