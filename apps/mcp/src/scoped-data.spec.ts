import { describe, expect, it, vi } from 'vitest';
import { readScopedData } from './scoped-data.js';
const callerId = 'clw00000000000000000000001';

describe('internal tool data visibility', () => {
  it.each(['listProjects', 'listTasks', 'listIdeas'])('rejects %s with missing caller identity before reading data', async (name) => {
    const findMany = vi.fn();
    await expect(readScopedData({ project: { findMany }, task: { findMany }, idea: { findMany } } as any, name, {})).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each(['listProjects', 'listTasks'])('requires current group membership for %s while allowing independent projects', async (name) => {
    const findMany = vi.fn().mockResolvedValue([]);
    await readScopedData({ project: { findMany }, task: { findMany } } as any, name, { callerId });
    const where = findMany.mock.calls[0][0].where;
    expect(name === 'listTasks' ? where.project : where).toEqual({ members: { some: { userId: callerId } }, OR: [{ groupId: null }, { group: { members: { some: { userId: callerId } } } }] });
  });
  it('keeps the public tools catalog independent of caller-scoped project data', async () => {
    const findMany = vi.fn().mockResolvedValue([{ name: 'Docs' }]);
    await expect(readScopedData({ connectedTool: { findMany } } as any, 'getToolsCatalog', {})).resolves.toEqual([{ name: 'Docs' }]);
  });
});
