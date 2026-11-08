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
    expect(projectSchema.parse(project).externalTools).toEqual([]);
  });

  it('allows project creation without a description and preserves descriptions sent by existing clients', () => {
    expect(projectSchema.parse({ title: 'Research' }).description).toBe('');
    expect(projectSchema.parse({ ...project, description: '  Project scope  ' }).description).toBe('Project scope');
  });

  it('accepts every tool together, including Word, Excel and Google Forms', () => {
    const externalTools = ['google', 'word', 'excel', 'forms', 'trello', 'asana'];
    expect(projectSchema.parse({ ...project, externalTools }).externalTools).toEqual(externalTools);
  });

  it('deduplicates selections and rejects unsupported tool values', () => {
    expect(projectSchema.parse({ ...project, externalTools: ['word', 'word', 'excel'] }).externalTools).toEqual(['word', 'excel']);
    expect(projectSchema.safeParse({ ...project, externalTools: ['microsoft'] }).success).toBe(false);
  });

  it.each(['', ' ', 'X', 'X'.repeat(31)])('rejects invalid task titles before creating a project: %j', (title) => {
    expect(projectSchema.safeParse({ ...project, initialTasks: [{ assigneeId, title }] }).success).toBe(false);
  });

  it('accepts a 30-character initial task while keeping project titles independent', () => {
    expect(projectSchema.safeParse({ ...project, title: 'P'.repeat(180), initialTasks: [{ assigneeId, title: 'T'.repeat(30) }] }).success).toBe(true);
  });

  it('rejects invalid assignee IDs', () => {
    expect(projectSchema.safeParse({ ...project, initialTasks: [{ assigneeId: 'invalid', title: 'Write chapter 1' }] }).success).toBe(false);
  });
});
