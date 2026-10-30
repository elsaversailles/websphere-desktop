import { describe, expect, it } from 'vitest';
import { deadlineHealth, taskPriorityHealth } from './health';

describe('deadline-based task priority', () => {
  const today = '2026-10-30';
  it.each([
    ['2026-10-29', 'High'], ['2026-10-30', 'High'], ['2026-11-01', 'High'],
    ['2026-11-02', 'Medium'], ['2026-11-04', 'Medium'], ['2026-11-05', 'Low'],
  ])('classifies %s as %s', (deadline, label) => {
    expect(taskPriorityHealth({ deadline, status: 'pending', priority: 'high' }, today).label).toBe(label);
  });

  it('increases priority as the local date advances', () => {
    const task = { deadline: '2026-11-05T00:00:00.000Z', status: 'ongoing', priority: 'low' };
    expect(['2026-10-30', '2026-11-01', '2026-11-03'].map((day) => taskPriorityHealth(task, day).label)).toEqual(['Low', 'Medium', 'High']);
  });

  it.each([['2026-11-01', 'r'], ['2026-11-02', 'y'], ['2026-11-05', 'ac']])('uses the matching deadline color for %s', (deadline, tone) => {
    expect(taskPriorityHealth({ deadline, status: 'pending' }, today).tone).toBe(tone);
  });

  it('retains the assigned priority for completed and undated tasks', () => {
    expect(taskPriorityHealth({ deadline: '2026-10-30', status: 'completed', priority: 'low' }, today).label).toBe('Low');
    expect(taskPriorityHealth({ status: 'pending', priority: 'high' }, today).label).toBe('High');
  });
});

describe('upcoming deadline status', () => {
  it.each([
    ['2026-10-29', 'Overdue', 'r'], ['2026-10-30', 'Urgent', 'r'],
    ['2026-11-01', 'Urgent', 'r'], ['2026-11-02', 'Due Soon', 'y'],
    ['2026-11-04', 'Due Soon', 'y'], ['2026-11-05', 'On Track', 'ac'],
    ['2026-11-13', 'On Track', 'ac'],
  ])('shows %s as %s with the matching tone', (deadline, label, tone) => {
    expect(deadlineHealth(deadline, '2026-10-30')).toMatchObject({ label, tone });
  });

  it('moves from on track to due soon to urgent as time passes', () => {
    expect(['2026-10-30', '2026-11-01', '2026-11-03'].map((today) => deadlineHealth('2026-11-05', today)?.label)).toEqual(['On Track', 'Due Soon', 'Urgent']);
  });
});
