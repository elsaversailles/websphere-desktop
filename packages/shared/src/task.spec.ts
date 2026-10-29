import { describe, expect, it } from 'vitest';
import { taskEditSchema, taskSchema } from './index.js';

describe('task scheduling contract', () => {
  it('accepts a planned start date without requiring a description', () => {
    expect(taskSchema.parse({ title: 'Write chapter 1', startDate: '2026-10-29', deadline: '2026-11-08' })).toEqual({
      title: 'Write chapter 1', description: '', startDate: new Date('2026-10-29'), deadline: new Date('2026-11-08'), priority: 'medium',
    });
  });

  it('continues accepting descriptions from existing clients', () => {
    expect(taskSchema.parse({ title: 'Write chapter 1', description: '  Existing details  ' }).description).toBe('Existing details');
  });

  it('allows tasks without planned dates', () => {
    expect(taskSchema.parse({ title: 'Write chapter 1' })).not.toHaveProperty('startDate');
  });

  it('does not add a description or status when editing scheduling fields', () => {
    const result = taskEditSchema.parse({ startDate: '2026-10-30', deadline: '2026-11-09' });
    expect(result).toEqual({ startDate: new Date('2026-10-30'), deadline: new Date('2026-11-09') });
  });

  it('allows clearing both planned dates', () => {
    expect(taskEditSchema.parse({ startDate: null, deadline: null })).toEqual({ startDate: null, deadline: null });
  });

  it('does not apply create defaults when reassigning an existing task', () => {
    const assigneeId = 'clw00000000000000000000001';
    expect(taskEditSchema.parse({ assigneeId })).toEqual({ assigneeId });
  });

  it.each(['startDate', 'deadline'])('rejects an invalid %s', (field) => {
    expect(taskSchema.safeParse({ title: 'Write chapter 1', [field]: 'not-a-date' }).success).toBe(false);
    expect(taskEditSchema.safeParse({ [field]: 'not-a-date' }).success).toBe(false);
  });

  it('does not let scheduling edits overwrite the actual work-start timestamp', () => {
    expect(taskEditSchema.safeParse({ startedAt: '2026-10-30' }).success).toBe(false);
  });
});
