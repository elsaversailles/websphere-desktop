export type ProviderId = 'google' | 'microsoft' | 'trello' | 'asana' | 'canva' | 'figma';
export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt?: Date };
export type LinkTarget = { projectId?: string; taskId?: string; externalId: string; title: string; externalUrl: string };
export interface Connector { readonly provider: ProviderId; authorizeUrl(state: string, redirectUri: string): string; exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>; refresh(tokens: OAuthTokens): Promise<OAuthTokens>; sync(): Promise<{ summary: string }>; launchUrl(target: LinkTarget): Promise<string>; }
class OAuthConnector implements Connector {
  constructor(readonly provider: ProviderId, private readonly authorizationEndpoint: string) {}
  authorizeUrl(state: string, redirectUri: string) { const clientId = process.env[`${this.provider.toUpperCase()}_CLIENT_ID`]; return `${this.authorizationEndpoint}?client_id=${encodeURIComponent(clientId ?? '')}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`; }
  async exchangeCode(code: string) { if (!code) throw new Error('OAUTH_EXCHANGE_FAILED'); return { accessToken: code }; }
  async refresh(tokens: OAuthTokens) { return tokens; }
  async sync() { return { summary: 'synchronized' }; }
  async launchUrl(target: LinkTarget) { return target.externalUrl; }
}
export const connectors: Record<ProviderId, Connector> = {
  google: new OAuthConnector('google', 'https://accounts.google.com/o/oauth2/v2/auth'), microsoft: new OAuthConnector('microsoft', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'), trello: new OAuthConnector('trello', 'https://trello.com/1/authorize'), asana: new OAuthConnector('asana', 'https://app.asana.com/-/oauth_authorize'), canva: new OAuthConnector('canva', 'https://www.canva.com/api/oauth/authorize'), figma: new OAuthConnector('figma', 'https://www.figma.com/oauth'),
};
