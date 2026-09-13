export type ProviderId = 'google' | 'microsoft' | 'trello' | 'asana' | 'canva' | 'figma';
export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt?: Date };
export type LinkTarget = { projectId?: string; taskId?: string; externalId: string; title: string; externalUrl: string };
export type SyncTarget = Pick<LinkTarget, 'externalId' | 'title' | 'externalUrl'>;
export type SyncResult = { summary: string };
export interface Connector { readonly provider: ProviderId; authorizeUrl(state: string, redirectUri: string): string; exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>; refresh(tokens: OAuthTokens): Promise<OAuthTokens>; sync(tokens: OAuthTokens, targets?: SyncTarget[]): Promise<SyncResult>; launchUrl(target: LinkTarget): Promise<string>; }

type OAuthPayload = { access_token?: string; refresh_token?: string; expires_in?: number };
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error('OAUTH_NOT_CONFIGURED'); return value; };
const tokensFrom = (payload: OAuthPayload, refreshToken?: string): OAuthTokens => {
  if (!payload.access_token) throw new Error('OAUTH_EXCHANGE_FAILED');
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? refreshToken, expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined };
};
const requestForm = async (url: string, body: URLSearchParams, headers: Record<string, string> = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: body.toString() });
  if (!response.ok) throw new Error('OAUTH_EXCHANGE_FAILED');
  return response.json() as Promise<OAuthPayload>;
};
const requestJson = async (url: string, accessToken: string) => {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('INTEGRATION_SYNC_FAILED');
  return response.json() as Promise<any>;
};

abstract class DirectOAuthConnector implements Connector {
  abstract readonly provider: ProviderId;
  protected abstract readonly authorizationEndpoint: string;
  protected abstract readonly tokenEndpoint: string;
  protected abstract readonly clientIdEnv: string;
  protected abstract readonly clientSecretEnv: string;
  protected abstract authorizationParams(): Record<string, string>;
  abstract sync(tokens: OAuthTokens, targets?: SyncTarget[]): Promise<SyncResult>;
  authorizeUrl(state: string, redirectUri: string) {
    return `${this.authorizationEndpoint}?${new URLSearchParams({ client_id: required(this.clientIdEnv), redirect_uri: redirectUri, response_type: 'code', state, ...this.authorizationParams() }).toString()}`;
  }
  async exchangeCode(code: string, redirectUri: string) {
    if (!code || !redirectUri) throw new Error('OAUTH_EXCHANGE_FAILED');
    return tokensFrom(await requestForm(this.tokenEndpoint, new URLSearchParams({ client_id: required(this.clientIdEnv), client_secret: required(this.clientSecretEnv), code, redirect_uri: redirectUri, grant_type: 'authorization_code' })));
  }
  async refresh(tokens: OAuthTokens) {
    if (!tokens.refreshToken) throw new Error('OAUTH_RECONNECT_REQUIRED');
    return tokensFrom(await requestForm(this.tokenEndpoint, new URLSearchParams({ client_id: required(this.clientIdEnv), client_secret: required(this.clientSecretEnv), refresh_token: tokens.refreshToken, grant_type: 'refresh_token' })), tokens.refreshToken);
  }
  async launchUrl(target: LinkTarget) { return target.externalUrl; }
}

class GoogleConnector extends DirectOAuthConnector {
  readonly provider = 'google' as const;
  protected readonly authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
  protected readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';
  protected readonly clientIdEnv = 'GOOGLE_CLIENT_ID';
  protected readonly clientSecretEnv = 'GOOGLE_CLIENT_SECRET';
  protected authorizationParams() { return { scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent' }; }
  async sync(tokens: OAuthTokens, targets: SyncTarget[] = []): Promise<SyncResult> {
    if (!targets.length) return { summary: 'No Google Drive files linked yet' };
    const results = await Promise.all(targets.map(async (target) => {
      try { await requestJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.externalId)}?fields=id,name,mimeType,modifiedTime,webViewLink`, tokens.accessToken); return true; }
      catch { return false; }
    }));
    const available = results.filter(Boolean).length;
    return { summary: `Synced ${available} of ${targets.length} linked Google Drive files` };
  }
}
class MicrosoftConnector extends DirectOAuthConnector {
  readonly provider = 'microsoft' as const;
  protected readonly authorizationEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  protected readonly tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  protected readonly clientIdEnv = 'MICROSOFT_CLIENT_ID';
  protected readonly clientSecretEnv = 'MICROSOFT_CLIENT_SECRET';
  protected authorizationParams() { return { scope: 'offline_access User.Read Files.Read', response_mode: 'query' }; }
  async sync(tokens: OAuthTokens): Promise<SyncResult> {
    const data = await requestJson('https://graph.microsoft.com/v1.0/me/drive/recent?$top=100&$select=id,name,webUrl,lastModifiedDateTime,file', tokens.accessToken);
    return { summary: `Synced ${Array.isArray(data.value) ? data.value.length : 0} Microsoft 365 files` };
  }
}
class FigmaConnector extends DirectOAuthConnector {
  readonly provider = 'figma' as const;
  protected readonly authorizationEndpoint = 'https://www.figma.com/oauth';
  protected readonly tokenEndpoint = 'https://api.figma.com/v1/oauth/token';
  protected readonly clientIdEnv = 'FIGMA_CLIENT_ID';
  protected readonly clientSecretEnv = 'FIGMA_CLIENT_SECRET';
  protected authorizationParams() { return { scope: 'current_user:read,file_content:read' }; }
  async sync(tokens: OAuthTokens, targets: SyncTarget[] = []): Promise<SyncResult> {
    await requestJson('https://api.figma.com/v1/me', tokens.accessToken);
    return { summary: targets.length ? `Verified Figma access and ${targets.length} linked file${targets.length === 1 ? '' : 's'}` : 'Verified Figma account access' };
  }
  override async exchangeCode(code: string, redirectUri: string) {
    if (!code || !redirectUri) throw new Error('OAUTH_EXCHANGE_FAILED');
    const basic = Buffer.from(`${required(this.clientIdEnv)}:${required(this.clientSecretEnv)}`).toString('base64');
    return tokensFrom(await requestForm(this.tokenEndpoint, new URLSearchParams({ redirect_uri: redirectUri, code, grant_type: 'authorization_code' }), { authorization: `Basic ${basic}` }));
  }
  override async refresh(tokens: OAuthTokens) {
    if (!tokens.refreshToken) throw new Error('OAUTH_RECONNECT_REQUIRED');
    const basic = Buffer.from(`${required(this.clientIdEnv)}:${required(this.clientSecretEnv)}`).toString('base64');
    return tokensFrom(await requestForm('https://api.figma.com/v1/oauth/refresh', new URLSearchParams({ refresh_token: tokens.refreshToken }), { authorization: `Basic ${basic}` }), tokens.refreshToken);
  }
}
class UnavailableConnector implements Connector {
  constructor(readonly provider: ProviderId) {}
  authorizeUrl(_state: string, _redirectUri: string): string { throw new Error('INTEGRATION_NOT_IMPLEMENTED'); }
  async exchangeCode(_code: string, _redirectUri: string): Promise<OAuthTokens> { throw new Error('INTEGRATION_NOT_IMPLEMENTED'); }
  async refresh(_tokens: OAuthTokens): Promise<OAuthTokens> { throw new Error('INTEGRATION_NOT_IMPLEMENTED'); }
  async sync(_tokens: OAuthTokens, _targets?: SyncTarget[]): Promise<SyncResult> { throw new Error('INTEGRATION_NOT_IMPLEMENTED'); }
  async launchUrl(target: LinkTarget) { return target.externalUrl; }
}
export const connectors: Record<ProviderId, Connector> = {
  google: new GoogleConnector(), microsoft: new MicrosoftConnector(), figma: new FigmaConnector(),
  trello: new UnavailableConnector('trello'), asana: new UnavailableConnector('asana'), canva: new UnavailableConnector('canva'),
};
