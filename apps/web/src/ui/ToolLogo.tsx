type ToolLogoSize = 'xs' | 'sm' | 'md' | 'lg';

function normalizedProvider(provider?: string | null, name?: string | null) {
  const value = `${provider ?? ''} ${name ?? ''}`.toLowerCase();
  if (value.includes('google')) return 'google';
  if (value.includes('microsoft') || value.includes('office') || value.includes('word') || value.includes('excel') || value.includes('powerpoint')) return 'microsoft';
  if (value.includes('figma')) return 'figma';
  if (value.includes('canva')) return 'canva';
  if (value.includes('trello')) return 'trello';
  if (value.includes('asana')) return 'asana';
  return 'file';
}

function GoogleDriveMark() {
  return <svg viewBox="0 0 48 42" aria-hidden="true"><path fill="#0F9D58" d="M16.6 1.6 1.7 27.4l7.5 13h15L31.7 27z"/><path fill="#4285F4" d="m16.6 1.6 7.6 13h14.9L31.6 1.6z"/><path fill="#F4B400" d="M24.2 40.4h15L46.7 27H31.7z"/></svg>;
}

function MicrosoftMark() {
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#F25022" d="M2 2h17v17H2z"/><path fill="#7FBA00" d="M21 2h17v17H21z"/><path fill="#00A4EF" d="M2 21h17v17H2z"/><path fill="#FFB900" d="M21 21h17v17H21z"/></svg>;
}

function FigmaMark() {
  return <svg viewBox="0 0 32 48" aria-hidden="true"><path fill="#F24E1E" d="M16 0a8 8 0 0 0 0 16h8a8 8 0 1 0 0-16z"/><path fill="#FF7262" d="M0 0a8 8 0 1 0 0 16h16V0z"/><path fill="#A259FF" d="M0 16a8 8 0 1 0 0 16h16V16z"/><circle cx="24" cy="24" r="8" fill="#1ABCFE"/><path fill="#0ACF83" d="M0 32h16v8a8 8 0 0 1-16 0z"/></svg>;
}

function CanvaMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="canva-gradient" x1="0" x2="1" y1="1" y2="0"><stop stopColor="#00C4CC"/><stop offset="1" stopColor="#7D2AE8"/></linearGradient></defs><circle cx="24" cy="24" r="23" fill="url(#canva-gradient)"/><text x="24" y="30" fill="#fff" fontFamily="Georgia,serif" fontSize="25" fontStyle="italic" fontWeight="700" textAnchor="middle">C</text></svg>;
}

function TrelloMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="8" fill="#0C66E4"/><rect x="10" y="10" width="12" height="27" rx="3" fill="#fff"/><rect x="27" y="10" width="11" height="18" rx="3" fill="#fff"/></svg>;
}

function AsanaMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="14" r="9" fill="#F06A6A"/><circle cx="14" cy="31" r="9" fill="#F06A6A"/><circle cx="34" cy="31" r="9" fill="#F06A6A"/></svg>;
}

function FileMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 4h15l10 10v30H13z" fill="#EAF6FC" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="M28 4v11h10M19 23h13M19 30h13M19 37h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3"/></svg>;
}

export function ToolLogo({ provider, name, size = 'md', className = '' }: { provider?: string | null; name?: string | null; size?: ToolLogoSize; className?: string }) {
  const kind = normalizedProvider(provider, name);
  const label = name || ({ google: 'Google Drive', microsoft: 'Microsoft 365', figma: 'Figma', canva: 'Canva', trello: 'Trello', asana: 'Asana', file: 'File' } as const)[kind];
  const mark = kind === 'google' ? <GoogleDriveMark /> : kind === 'microsoft' ? <MicrosoftMark /> : kind === 'figma' ? <FigmaMark /> : kind === 'canva' ? <CanvaMark /> : kind === 'trello' ? <TrelloMark /> : kind === 'asana' ? <AsanaMark /> : <FileMark />;
  return <span className={`tool-logo tool-logo-${kind} tool-logo-${size} ${className}`.trim()} role="img" aria-label={`${label} logo`}>{mark}</span>;
}
