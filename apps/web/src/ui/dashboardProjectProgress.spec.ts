import { describe, expect, it } from 'vitest';
import { dashboardProjectProgress } from './dashboardProjectProgress';

describe('dashboard project progress', () => {
  it.each([
    ['pending', 0, 'Not Started', 'r'],
    ['ongoing', 50, 'In Progress', 'y'],
    ['for_review', 75, 'For Review', 'ac'],
    ['completed', 100, 'Completed', 'g'],
  ])('reflects a task marked %s', (status, progress, label, tone) => {
    expect(dashboardProjectProgress([{ status }], 'active')).toEqual({ progress, health: { label, tone } });
  });

  it('averages the progress of all project tasks', () => {
    expect(dashboardProjectProgress([{ status: 'pending' }, { status: 'ongoing' }, { status: 'for_review' }, { status: 'completed' }], 'active'))
      .toEqual({ progress: 56, health: { label: 'In Progress', tone: 'y' } });
  });

  it('handles projects with no tasks and preserves explicit project lifecycle states', () => {
    expect(dashboardProjectProgress([], 'active')).toEqual({ progress: 0, health: { label: 'Not Started', tone: 'r' } });
    expect(dashboardProjectProgress([{ status: 'ongoing' }], 'on_hold')).toEqual({ progress: 50, health: { label: 'On Hold', tone: 'y' } });
  });

  it('does not round unfinished work up to completion', () => {
    const tasks = [...Array.from({ length: 200 }, () => ({ status: 'completed' })), { status: 'for_review' }];
    expect(dashboardProjectProgress(tasks, 'active')).toEqual({ progress: 99, health: { label: 'For Review', tone: 'ac' } });
  });

  it('derives completion from tasks even when the stored project status is active', () => {
    expect(dashboardProjectProgress([{ status: 'completed' }, { status: 'completed' }], 'active'))
      .toEqual({ progress: 100, health: { label: 'Completed', tone: 'g' } });
  });

  it('reflects reopened and newly added tasks without retaining a stale completed label', () => {
    expect(dashboardProjectProgress([{ status: 'ongoing' }], 'completed'))
      .toEqual({ progress: 50, health: { label: 'In Progress', tone: 'y' } });
    expect(dashboardProjectProgress([{ status: 'completed' }, { status: 'pending' }], 'completed'))
      .toEqual({ progress: 50, health: { label: 'In Progress', tone: 'y' } });
  });
});
