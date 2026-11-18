import { parseMarkdownBlocks } from './markdown';
import { Fragment, type ReactNode } from 'react';

export function MarkdownText({ source }: { source: string }) {
  const blocks = parseMarkdownBlocks(source);
  return <>{blocks.map((block, index) => {
    if (block.kind === 'list') {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex} value={item.number} style={item.indent ? { marginLeft: Math.min(item.indent, 12) * 4 } : undefined}>{inline(item.text)}</li>);
      return block.ordered ? <ol key={index} start={block.items[0]?.number}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    if (block.kind === 'heading') return <h3 key={index}>{inline(block.text)}</h3>;
    return <p key={index}>{inline(block.text)}</p>;
  })}</>;
}

function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>);
}
