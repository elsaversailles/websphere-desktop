import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from './markdown';

describe('assistant numbering', () => {
  it('continues repeated Markdown 1 markers across blank lines', () => {
    const lists = parseMarkdownBlocks('Ideas:\n\n1. First\n\n1. Second\n\n1. Third').filter((block) => block.kind === 'list');
    expect(lists.map((list) => list.items[0].number)).toEqual([1, 2, 3]);
  });
  it('retains an explicit starting number and resets at a new section', () => {
    const lists = parseMarkdownBlocks('4. Fourth\n1. Fifth\n\n## Next\n1. First').filter((block) => block.kind === 'list');
    expect(lists.map((list) => list.items.map((item) => item.number))).toEqual([[4, 5], [1]]);
  });
  it('keeps nested numbering independent of the parent list', () => {
    const [list] = parseMarkdownBlocks('1. Parent\n  1. Child\n  1. Child two\n1. Parent two');
    expect(list.kind === 'list' && list.items.map((item) => item.number)).toEqual([1, 1, 2, 2]);
  });
});
