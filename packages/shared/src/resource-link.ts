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

export const unsupportedResourceLinkMessage = 'Use an HTTPS share link from a supported website.';

function parseHttpsResourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function isHttpsResourceLink(value: string) {
  return parseHttpsResourceUrl(value) !== null;
}

const standaloneSites = [
  ['Canva', ['canva.com'], 'canva'],
  ['Figma', ['figma.com'], null],
  ['Adobe Express', ['express.adobe.com'], null],
  ['Miro', ['miro.com'], null],
  ['Trello', ['trello.com'], 'trello'],
  ['Asana', ['asana.com'], 'asana'],
  ['Notion', ['notion.so', 'notion.site', 'notion.com'], 'notion'],
  ['GitHub', ['github.com'], null],
  ['GitLab', ['gitlab.com'], null],
  ['Google Colab', ['colab.research.google.com', 'colab.google'], 'google'],
  ['Replit', ['replit.com', 'repl.it'], null],
  ['CodePen', ['codepen.io'], null],
  ['Google Drive', ['drive.google.com'], 'google'],
  ['Zotero', ['zotero.org'], null],
  ['Mendeley', ['mendeley.com'], null],
  ['Lucidchart', ['lucidchart.com'], null],
  ['Draw.io', ['draw.io', 'diagrams.net'], null],
] as const;

const googleEditors = {
  document: ['Google Docs', 'google-docs'],
  spreadsheets: ['Google Sheets', 'google-sheets'],
  presentation: ['Google Slides', 'google-slides'],
} as const;

const microsoftEditors = {
  w: ['Microsoft Word', 'microsoft-word'],
  x: ['Microsoft Excel', 'microsoft-excel'],
  p: ['Microsoft PowerPoint', 'microsoft-powerpoint'],
} as const;

/** Recognize approved sites by URL components, without resolving or fetching the link. */
export function identifyResourceLink(value: string, microsoftToolHint?: string | null) {
  const url = parseHttpsResourceUrl(value);
  if (!url || url.port) return null;
  const host = url.hostname.replace(/\.$/, '');
  const domain = (name: string) => host === name || host.endsWith(`.${name}`);
  const path = url.pathname.toLowerCase();
  if (host === 'docs.google.com') {
    const editor = /^\/(?:a\/[^/]+\/)?(document|spreadsheets|presentation)(?:\/|$)/.exec(path)?.[1] as keyof typeof googleEditors | undefined;
    if (!editor) return null;
    const [name, toolKind] = googleEditors[editor];
    return { provider: 'google' as const, name, toolKind };
  }
  const officeHosts: Record<string, keyof typeof microsoftEditors> = {
    'word.cloud.microsoft': 'w', 'word.office.com': 'w', 'word.new': 'w',
    'excel.cloud.microsoft': 'x', 'excel.office.com': 'x', 'excel.new': 'x',
    'powerpoint.cloud.microsoft': 'p', 'powerpoint.office.com': 'p', 'powerpoint.new': 'p',
  };
  const officeApp = Object.hasOwn(officeHosts, host) ? officeHosts[host] : undefined;
  const officeShare = host === '1drv.ms' || host === 'onedrive.live.com' || domain('sharepoint.com') || host === 'office.live.com';
  if (officeApp || officeShare) {
    const shareApp = /^\/(?::([wxp]):|([wxp]))\//.exec(path);
    const file = url.searchParams.get('file') ?? path;
    const extensionApp = /\.docx?$/i.test(file) ? 'w' : /\.xls[xm]?$/i.test(file) ? 'x' : /\.ppt[xm]?$/i.test(file) ? 'p' : undefined;
    const hintedApp = microsoftToolHint === 'microsoft-word' ? 'w' : microsoftToolHint === 'microsoft-excel' ? 'x' : undefined;
    const shareEditor = (shareApp?.[1] || shareApp?.[2]) as keyof typeof microsoftEditors | undefined;
    const editor = officeApp ?? shareEditor ?? extensionApp ?? hintedApp;
    if (!editor) return null;
    const [name, toolKind] = microsoftEditors[editor];
    return { provider: 'microsoft' as const, name, toolKind };
  }
  if (host === 'lucid.app' && /^\/lucidchart(?:\/|$)/.test(path)) return { provider: null, name: 'Lucidchart', toolKind: null };
  const site = standaloneSites.find(([, domains]) => domains.some(domain));
  if (!site) return null;
  const [name, , provider] = site;
  return { provider, name, toolKind: null };
}
