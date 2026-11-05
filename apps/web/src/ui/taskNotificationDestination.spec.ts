import { describe, expect, it } from 'vitest';
import { taskNotificationDestination } from './taskNotificationDestination';

describe('task status notification destination', () => {
  it('opens a teammate’s task in the project list', () => {
    expect(taskNotificationDestination({ projectId: 'project-1', assignments: [{ assigneeId: 'teammate' }] }, 'me')).toBe('projects');
  });
  it('opens the recipient’s active assignment in My Tasks', () => {
    expect(taskNotificationDestination({ projectId: 'project-1', assignments: [{ assigneeId: 'teammate' }, { assigneeId: 'me' }] }, 'me')).toBe('tasks');
  });
  it('opens an unassigned task in its project', () => {
    expect(taskNotificationDestination({ projectId: 'project-1', assignments: [] }, 'me')).toBe('projects');
  });
});
