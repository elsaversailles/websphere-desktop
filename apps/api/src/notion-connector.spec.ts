import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectors } from './connectors.js';

describe('Notion connector', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('builds the authorization URL with the callback and state', () => {
    vi.stubEnv('NOTION_CLIENT_ID', 'notion-client');
    const url = new URL(connectors.notion.authorizeUrl('state-value', 'https://example.com/callback'));
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'notion-client', response_type: 'code', owner: 'user', redirect_uri: 'https://example.com/callback', state: 'state-value' });
  });

  it('exchanges and refreshes tokens with Notion basic authentication', async () => {
    vi.stubEnv('NOTION_CLIENT_ID', 'client');
    vi.stubEnv('NOTION_CLIENT_SECRET', 'secret');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await connectors.notion.exchangeCode('code', 'https://example.com/callback')).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { authorization: `Basic ${Buffer.from('client:secret').toString('base64')}` }, body: JSON.stringify({ grant_type: 'authorization_code', code: 'code', redirect_uri: 'https://example.com/callback' }) });
    await connectors.notion.refresh({ accessToken: 'old', refreshToken: 'refresh' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh' });
  });

  it('verifies an authorized connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    expect(await connectors.notion.sync({ accessToken: 'access' })).toEqual({ summary: 'Notion connection verified' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.notion.com/v1/users/me', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer access' }) }));
  });
});
