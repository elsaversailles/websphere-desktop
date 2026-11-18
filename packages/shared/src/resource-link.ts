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
