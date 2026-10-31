type ToolLogoSize = 'xs' | 'sm' | 'md' | 'lg';

const TOOL_ICONS = {
  google: { label: 'Google Drive', src: '/icons/tools/google-drive.png' },
  forms: { label: 'Google Forms', src: '/icons/tools/google-forms.png' },
  microsoft: { label: 'Microsoft 365', src: '/icons/tools/office.svg' },
  word: { label: 'Microsoft Word', src: '/icons/tools/word.svg' },
  excel: { label: 'Microsoft Excel', src: '/icons/tools/excel.svg' },
  canva: { label: 'Canva', src: '/icons/tools/canva.png' },
  trello: { label: 'Trello', src: '/icons/tools/trello.svg' },
  asana: { label: 'Asana', src: '/icons/tools/asana.svg' },
} as const;
type ToolIcon = keyof typeof TOOL_ICONS | 'file';

function normalizedProvider(provider?: string | null, name?: string | null): ToolIcon {
  const value = `${provider ?? ''} ${name ?? ''}`.toLowerCase();
  // Resolve the individual app before the shared Google/Microsoft OAuth provider.
  if (value.includes('word')) return 'word';
  if (value.includes('excel')) return 'excel';
  if (value.includes('forms')) return 'forms';
  if (value.includes('google')) return 'google';
  if (value.includes('microsoft') || value.includes('office') || value.includes('powerpoint')) return 'microsoft';
  if (value.includes('canva')) return 'canva';
  if (value.includes('trello')) return 'trello';
  if (value.includes('asana')) return 'asana';
  return 'file';
}

function FileMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 4h15l10 10v30H13z" fill="#EAF6FC" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="M28 4v11h10M19 23h13M19 30h13M19 37h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3"/></svg>;
}

export function ToolLogo({ provider, name, size = 'md', className = '' }: { provider?: string | null; name?: string | null; size?: ToolLogoSize; className?: string }) {
  const kind = normalizedProvider(provider, name);
  const icon = kind === 'file' ? null : TOOL_ICONS[kind];
  const label = name || icon?.label || 'File';
  return <span className={`tool-logo tool-logo-${kind} tool-logo-${size} ${className}`.trim()} role="img" aria-label={`${label} logo`}>
    {icon ? <img src={icon.src} alt="" draggable={false} /> : <FileMark />}
  </span>;
}
