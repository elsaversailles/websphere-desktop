import { describe, expect, it } from 'vitest';
import { projectAnalytics, taskScheduleMetrics } from './analytics.js';

describe('schedule-derived bottlenecks', () => {
  const now = new Date('2026-11-08T00:00:00.000Z');

  it('derives a delayed task from existing start and deadline dates without an effort estimate', () => {
    const timing = taskScheduleMetrics({
      id: 'task-1', status: 'ongoing', startDate: new Date('2026-11-01T00:00:00.000Z'), deadline: new Date('2026-11-03T00:00:00.000Z'), startedAt: new Date('2026-11-01T00:00:00.000Z'),
    }, now);

    expect(timing.expectedDays).toBe(3);
    expect(timing.actualDays).toBe(7);
    expect(timing.delayDays).toBeGreaterThan(4);
  });

  it('flags overdue pending work using its planned schedule even before it is started', () => {
    const analytics = projectAnalytics([{
      id: 'task-1', status: 'pending', createdAt: new Date('2026-11-01T00:00:00.000Z'), deadline: new Date('2026-11-03T00:00:00.000Z'), assigneeId: 'member-1',
    }], null, now);

    expect(analytics.bottlenecks).toEqual([expect.objectContaining({ taskId: 'task-1', delayDays: expect.any(Number) })]);
    expect(analytics.bottlenecks[0]!.delayDays).toBeGreaterThan(4);
  });

  it('still honors an explicit duration estimate when one exists', () => {
    const timing = taskScheduleMetrics({
      id: 'task-1', status: 'completed', expectedDurationHrs: 24, createdAt: new Date('2026-11-01T00:00:00.000Z'), completedAt: new Date('2026-11-04T00:00:00.000Z'),
    }, now);

    expect(timing.expectedDays).toBe(1);
    expect(timing.delayDays).toBe(2);
  });
});
