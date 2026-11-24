/** Validate the selected file tool without trusting suffix lookalike domains. */
export function resourceLinkError(value: string, provider?: string | null, toolKind?: string | null): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return 'Paste a valid HTTPS share link.'; }
  if (url.protocol !== 'https:' || url.username || url.password) return 'Use an HTTPS share link without embedded credentials.';
  const host = url.hostname.toLowerCase();
  const domain = (name: string) => host === name || host.endsWith(`.${name}`);
  let valid = false;
  if (provider === 'google') {
    valid = toolKind === 'google-forms'
      ? host === 'forms.gle' || host === 'docs.google.com' && url.pathname.startsWith('/forms/')
      : (!toolKind || toolKind === 'google-docs') && host === 'docs.google.com' && url.pathname.startsWith('/document/');
  } else if (provider === 'microsoft' && (!toolKind || toolKind === 'microsoft-word' || toolKind === 'microsoft-excel')) {
    valid = host === '1drv.ms' || host === 'onedrive.live.com' || domain('sharepoint.com') || host === 'office.live.com' || host === 'word.cloud.microsoft' || host === 'excel.cloud.microsoft';
    if (toolKind === 'microsoft-word' && (host === 'excel.cloud.microsoft' || /\.(xlsx?|xlsm)$/i.test(url.pathname) || host === '1drv.ms' && /^\/x\//.test(url.pathname))) valid = false;
    if (toolKind === 'microsoft-excel' && (host === 'word.cloud.microsoft' || /\.docx?$/i.test(url.pathname) || host === '1drv.ms' && /^\/w\//.test(url.pathname))) valid = false;
  } else if (!toolKind && provider === 'trello') valid = domain('trello.com');
  else if (!toolKind && provider === 'asana') valid = domain('asana.com');
  return valid ? null : 'This link does not match the selected tool. Use a Google Docs, Google Forms, Word, Excel, Trello, or Asana share link.';
}

/** Identify a display label from a parsed HTTPS URL. Any verified link may still be academic work. */
export function identifyResourceLink(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const domain = (name: string) => host === name || host.endsWith(`.${name}`);
  const path = url.pathname.toLowerCase();
  const label = <P extends string, K extends string | null>(provider: P, name: string, toolKind: K) => ({ provider, name, toolKind });
  if (domain('canva.com')) return label('canva', 'Canva', null);
  if (domain('notion.so') || domain('notion.site')) return label('notion', 'Notion', null);
  if (domain('trello.com')) return label('trello', 'Trello', null);
  if (domain('asana.com')) return label('asana', 'Asana', null);
  if (host === 'forms.gle' || (host === 'docs.google.com' && path.startsWith('/forms/'))) return label('google', 'Google Forms', 'google-forms');
  if (host === 'docs.google.com' && path.startsWith('/document/')) return label('google', 'Google Docs', 'google-docs');
  if (host === 'drive.google.com' || host === 'docs.google.com') return label('google', 'Google Drive & Docs', null);
  if (host === 'word.cloud.microsoft' || (host === '1drv.ms' && path.startsWith('/w/'))) return label('microsoft', 'Microsoft Word', 'microsoft-word');
  if (host === 'excel.cloud.microsoft' || (host === '1drv.ms' && path.startsWith('/x/'))) return label('microsoft', 'Microsoft Excel', 'microsoft-excel');
  if (host === '1drv.ms' || host === 'onedrive.live.com' || domain('sharepoint.com') || host === 'office.live.com') return label('microsoft', 'Microsoft 365', null);
  return { provider: null, name: 'External link', toolKind: null };
}
