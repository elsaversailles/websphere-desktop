import { Fragment, type ReactNode } from 'react';

export function MarkdownText({ source }: { source: string }) {
  const blocks = source.trim().split(/\n{2,}/);
  return <>{blocks.map((block, index) => {
    const lines = block.split('\n');
    if (lines.every((line) => /^[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inline(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>;
    if (lines.every((line) => /^\d+\.\s+/.test(line))) return <ol key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inline(line.replace(/^\d+\.\s+/, ''))}</li>)}</ol>;
    const heading = block.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return <h3 key={index}>{inline(heading[2])}</h3>;
    return <p key={index}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex ? <br /> : null}{inline(line)}</Fragment>)}</p>;
  })}</>;
}

function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>);
}
