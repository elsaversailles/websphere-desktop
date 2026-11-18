export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: { text: string; indent: number; number?: number }[] };

/** Parse the simple markdown used by assistant replies, keeping list numbering across nested items. */
export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const normalised = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?strong>/gi, '**')
    .replace(/<\/?b>/gi, '**').replace(/<\/?em>/gi, '*').replace(/<[^>]+>/g, '');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { kind: 'list' }> | null = null;
  const counters = new Map<number, number>();
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (const raw of normalised.split('\n')) {
    const line = raw.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^#{1,4}\s+(.*)$/) ?? line.match(/^\*\*(.+)\*\*:?$/);
    if (heading) {
      flushParagraph(); flushList(); counters.clear();
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    const indent = (raw.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
    const ordered = line.match(/^(\d+)[.)]\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (ordered || bullet) {
      flushParagraph();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) { flushList(); list = { kind: 'list', ordered: isOrdered, items: [] }; }
      for (const level of counters.keys()) if (level > indent || (!isOrdered && level === indent)) counters.delete(level);
      if (ordered) {
        const marker = Number(ordered[1]);
        // Markdown permits every marker to be 1; explicit non-one starts remain respected.
        const number = counters.has(indent) ? counters.get(indent)! + 1 : marker;
        counters.set(indent, number);
        list.items.push({ text: ordered[2], indent, number });
      } else if (bullet) list.items.push({ text: bullet[1], indent });
      continue;
    }
    flushList(); counters.clear(); paragraph.push(line);
  }
  flushParagraph(); flushList();
  return blocks;
}
