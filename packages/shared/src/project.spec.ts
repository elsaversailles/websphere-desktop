import { describe, expect, it } from 'vitest';
import { projectSchema } from './index.js';

const assigneeId = 'clw00000000000000000000001';
const project = { title: 'Research', description: 'Project scope', memberIds: [assigneeId] };

describe('project creation task contract', () => {
  it('keeps initial assignments in the parsed request and trims task titles', () => {
    const result = projectSchema.parse({ ...project, initialTasks: [{ assigneeId, title: '  Write chapter 1  ' }], deadline: '2026-11-08' });
    expect(result.initialTasks).toEqual([{ assigneeId, title: 'Write chapter 1' }]);
    expect(result.deadline).toEqual(new Date('2026-11-08'));
  });

  it('keeps clients that create projects without initial tasks compatible', () => {
    expect(projectSchema.parse(project).initialTasks).toEqual([]);
  });

  it.each(['', ' ', 'X', 'X'.repeat(181)])('rejects invalid task titles before creating a project: %j', (title) => {
    expect(projectSchema.safeParse({ ...project, initialTasks: [{ assigneeId, title }] }).success).toBe(false);
  });

  it('rejects invalid assignee IDs', () => {
    expect(projectSchema.safeParse({ ...project, initialTasks: [{ assigneeId: 'invalid', title: 'Write chapter 1' }] }).success).toBe(false);
  });
});
