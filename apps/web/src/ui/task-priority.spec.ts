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

  it('retains the assigned priority for undated tasks', () => {
    expect(taskPriorityHealth({ status: 'pending', priority: 'high' }, today).label).toBe('High');
    expect(taskPriorityHealth({ status: 'completed', priority: 'low', completedAt: new Date('2026-10-30T12:00:00').toISOString() }, '2026-11-10')).toEqual({ label: 'Low', tone: 'g' });
  });

  it.each([
    ['2026-11-05', 'Low', 'ac'], ['2026-11-02', 'Medium', 'y'], ['2026-11-01', 'High', 'r'],
  ])('preserves both priority and color through every status for deadline %s', (deadline, label, tone) => {
    const completedAt = new Date('2026-10-30T12:00:00').toISOString();
    for (const status of ['pending', 'ongoing', 'for_review', 'completed', 'ongoing', 'pending']) {
      expect(taskPriorityHealth({ deadline, priority: 'medium', status, completedAt: status === 'completed' ? completedAt : null }, today)).toEqual({ label, tone });
    }
  });

  it('does not revert to the assigned priority when the task is completed', () => {
    const task = { deadline: '2026-11-11', priority: 'medium', status: 'completed', completedAt: new Date('2026-10-31T12:00:00').toISOString() };
    expect(taskPriorityHealth(task, '2026-10-31')).toEqual({ label: 'Low', tone: 'ac' });
  });

  it.each([
    ['2026-11-05', 'Low', 'ac'], ['2026-11-02', 'Medium', 'y'], ['2026-11-01', 'High', 'r'],
  ])('keeps the final priority for deadline %s as later days pass', (deadline, label, tone) => {
    const task = { deadline, priority: 'medium', status: 'completed', completedAt: new Date('2026-10-30T12:00:00').toISOString() };
    for (const day of ['2026-10-30', '2026-11-02', '2026-12-01']) {
      expect(taskPriorityHealth(task, day)).toEqual({ label, tone });
    }
  });

  it('resumes deadline urgency after a completed task is reopened', () => {
    const task = { deadline: '2026-11-05', priority: 'medium', status: 'completed', completedAt: new Date('2026-10-30T12:00:00').toISOString() };
    expect(taskPriorityHealth(task, '2026-11-04')).toEqual({ label: 'Low', tone: 'ac' });
    expect(taskPriorityHealth({ ...task, status: 'ongoing', completedAt: null }, '2026-11-04')).toEqual({ label: 'High', tone: 'r' });
  });

  it.each(['00:15:00', '23:45:00'])('uses the local completion day near midnight (%s)', (time) => {
    const completion = new Date(`2026-10-31T${time}`);
    const task = { deadline: '2026-11-05', priority: 'high', status: 'completed', completedAt: completion.toISOString() };
    expect(taskPriorityHealth(task, '2026-12-01')).toEqual({ label: 'Medium', tone: 'y' });
  });

  it.each([undefined, null, 'invalid-date'])('keeps legacy completed tasks stable without a valid completion timestamp (%s)', (completedAt) => {
    expect(taskPriorityHealth({ deadline: '2026-10-30', status: 'completed', priority: 'low', completedAt }, today)).toEqual({ label: 'Low', tone: 'g' });
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
