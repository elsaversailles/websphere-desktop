import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// canva-mcp.ts talks to three things this suite replaces with test doubles: Canva's MCP auth
// discovery/DCR functions, the MCP Client/transport classes, and Prisma (for the cached DCR
// client row). The goal is to verify the logic this file actually wrote — caching, request
// shapes, the tool-calling loop, summary parsing — not to re-test the SDK or a real network call.

const discoverOAuthProtectedResourceMetadata = vi.fn();
const discoverAuthorizationServerMetadata = vi.fn();
const registerClient = vi.fn();
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, registerClient }));

const listTools = vi.fn();
const callTool = vi.fn();
const connect = vi.fn().mockResolvedValue(undefined);
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({ connect, listTools, callTool })),
}));

const transportClose = vi.fn().mockResolvedValue(undefined);
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({ close: transportClose })),
}));

const systemSettingFindUnique = vi.fn();
const systemSettingUpsert = vi.fn();
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({ systemSetting: { findUnique: systemSettingFindUnique, upsert: systemSettingUpsert } })),
}));

const { canvaMcpConnector, openCanvaSession, listCanvaTools, runToolTurn } = await import('./canva-mcp.js');

const authServerMetadata = { authorization_endpoint: 'https://auth.canva.com/authorize', token_endpoint: 'https://auth.canva.com/token', registration_endpoint: 'https://auth.canva.com/register', response_types_supported: ['code'] };

function mockDiscovery(scopes: string[] = ['design:read']) {
  discoverOAuthProtectedResourceMetadata.mockResolvedValue({ resource: 'https://mcp.canva.com/mcp', authorization_servers: ['https://auth.canva.com'], scopes_supported: scopes });
  discoverAuthorizationServerMetadata.mockResolvedValue(authServerMetadata);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDiscovery();
  systemSettingFindUnique.mockResolvedValue(null);
  systemSettingUpsert.mockResolvedValue({});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Canva MCP OAuth (authorize/exchange/refresh)', () => {
  it('registers a client via Dynamic Client Registration on the first authorize, and caches it', async () => {
    registerClient.mockResolvedValue({ client_id: 'dcr-client', redirect_uris: ['https://api.example.edu/integrations/canva/callback'] });

    const url = await canvaMcpConnector.authorizeUrl('state-1', 'https://api.example.edu/integrations/canva/callback', 'challenge-1');

    expect(registerClient).toHaveBeenCalledOnce();
    expect(registerClient.mock.calls[0][0]).toBe(authServerMetadata.registration_endpoint);
    expect(registerClient.mock.calls[0][1].clientMetadata.redirect_uris).toEqual(['https://api.example.edu/integrations/canva/callback']);
    expect(systemSettingUpsert).toHaveBeenCalledOnce();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(authServerMetadata.authorization_endpoint);
    expect(parsed.searchParams.get('client_id')).toBe('dcr-client');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    // RFC 8707 resource indicator — Canva's /authorize rejects requests missing this (see
    // the module doc comment); must be the server's own canonical resource value.
    expect(parsed.searchParams.get('resource')).toBe('https://mcp.canva.com/mcp');
    expect(parsed.searchParams.get('scope')).toBe('profile:read design:meta:read design:content:read design:content:write asset:read');
  });

  it('reuses the cached DCR client instead of registering again for the same redirect URI', async () => {
    systemSettingFindUnique.mockResolvedValue({ value: { client_id: 'cached-client', redirect_uris: ['https://api.example.edu/integrations/canva/callback'] } });

    const url = await canvaMcpConnector.authorizeUrl('state-1', 'https://api.example.edu/integrations/canva/callback', 'challenge-1');

    expect(registerClient).not.toHaveBeenCalled();
    expect(new URL(url).searchParams.get('client_id')).toBe('cached-client');
  });

  it('re-registers when the deployment’s redirect URI has changed since the cached registration', async () => {
    systemSettingFindUnique.mockResolvedValue({ value: { client_id: 'old-client', redirect_uris: ['https://old.example.edu/integrations/canva/callback'] } });
    registerClient.mockResolvedValue({ client_id: 'new-client', redirect_uris: ['https://api.example.edu/integrations/canva/callback'] });

    const url = await canvaMcpConnector.authorizeUrl('state-1', 'https://api.example.edu/integrations/canva/callback', 'challenge-1');

    expect(registerClient).toHaveBeenCalledOnce();
    expect(new URL(url).searchParams.get('client_id')).toBe('new-client');
  });

  it('refuses to build an authorize URL without a PKCE challenge', async () => {
    await expect(canvaMcpConnector.authorizeUrl('state-1', 'https://api.example.edu/cb')).rejects.toThrow('OAUTH_EXCHANGE_FAILED');
    expect(registerClient).not.toHaveBeenCalled();
  });

  it('exchanges the code with the discovered token endpoint, as a public (no-secret) client', async () => {
    systemSettingFindUnique.mockResolvedValue({ value: { client_id: 'dcr-client', redirect_uris: ['https://api.example.edu/cb'] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600 }) }));

    const tokens = await canvaMcpConnector.exchangeCode('auth-code', 'https://api.example.edu/cb', 'verifier-1');

    expect(tokens).toEqual({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresAt: expect.any(Date) });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe(authServerMetadata.token_endpoint);
    expect(init.headers.authorization).toBeUndefined();
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('client_id')).toBe('dcr-client');
    expect(body.get('resource')).toBe('https://mcp.canva.com/mcp');
  });

  it('sends Basic auth when Canva’s DCR response did include a client secret', async () => {
    systemSettingFindUnique.mockResolvedValue({ value: { client_id: 'dcr-client', client_secret: 'shh', redirect_uris: ['https://api.example.edu/cb'] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok-1' }) }));

    await canvaMcpConnector.exchangeCode('auth-code', 'https://api.example.edu/cb', 'verifier-1');

    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('dcr-client:shh').toString('base64')}`);
  });

  it('refuses to refresh without a refresh token or without a previously registered client', async () => {
    await expect(canvaMcpConnector.refresh({ accessToken: 'a' })).rejects.toThrow('OAUTH_RECONNECT_REQUIRED');
    systemSettingFindUnique.mockResolvedValue(null);
    await expect(canvaMcpConnector.refresh({ accessToken: 'a', refreshToken: 'r' })).rejects.toThrow('OAUTH_RECONNECT_REQUIRED');
  });

  it('refreshes against the discovered token endpoint using the cached client', async () => {
    systemSettingFindUnique.mockResolvedValue({ value: { client_id: 'dcr-client', redirect_uris: ['https://api.example.edu/cb'] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok-2', expires_in: 60 }) }));

    const tokens = await canvaMcpConnector.refresh({ accessToken: 'old', refreshToken: 'ref-1' });

    expect(tokens.accessToken).toBe('tok-2');
    const body = new URLSearchParams((fetch as any).mock.calls[0][1].body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('ref-1');
  });
});

describe('Canva MCP session helpers', () => {
  it('opens a Streamable HTTP session authenticated with the stored access token', async () => {
    const session = await openCanvaSession('user-token');

    await session.client.listTools?.();
    expect(connect).toHaveBeenCalledOnce();
    await session.close();
    expect(transportClose).toHaveBeenCalledOnce();
  });

  it('maps MCP tools to OpenAI function-tool definitions', async () => {
    listTools.mockResolvedValue({ tools: [{ name: 'list_designs', description: 'Lists designs', inputSchema: { type: 'object' } }] });
    const session = await openCanvaSession('user-token');

    const tools = await listCanvaTools(session);

    expect(tools).toEqual([{ type: 'function', name: 'list_designs', description: 'Lists designs', parameters: { type: 'object' } }]);
  });
});

describe('runToolTurn (the bounded, LLM-controlled tool-calling loop)', () => {
  const tools = [{ type: 'function' as const, name: 'list_designs', description: undefined, parameters: {} }];

  it('returns the model’s text immediately when it calls no tool', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'resp_1', output_text: 'Hello!' }) }));
    const session = await openCanvaSession('token');

    const result = await runToolTurn({ apiKey: 'k', model: 'gpt-4.1-mini', instructions: 'hi', userInput: 'hi', tools, session });

    expect(result).toEqual({ text: 'Hello!', toolCalls: 0 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('executes a function call against the MCP session and sends the output back as a follow-up turn', async () => {
    callTool.mockResolvedValue({ content: [{ type: 'text', text: '{"designs":["a","b"]}' }] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'resp_1', output: [{ type: 'function_call', call_id: 'call_1', name: 'list_designs', arguments: '{}' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'resp_2', output_text: 'You have 2 designs.' }) });
    vi.stubGlobal('fetch', fetchMock);
    const session = await openCanvaSession('token');

    const result = await runToolTurn({ apiKey: 'k', model: 'gpt-4.1-mini', instructions: 'hi', userInput: 'list my designs', tools, session });

    expect(result).toEqual({ text: 'You have 2 designs.', toolCalls: 1 });
    expect(callTool).toHaveBeenCalledWith({ name: 'list_designs', arguments: {} });
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody.previous_response_id).toBe('resp_1');
    expect(secondCallBody.input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: '{"designs":["a","b"]}' }]);
  });

  it('stops after maxRounds even if the model keeps calling tools, rather than looping forever', async () => {
    callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'resp_x', output: [{ type: 'function_call', call_id: 'c', name: 'list_designs', arguments: '{}' }] }) }));
    const session = await openCanvaSession('token');

    const result = await runToolTurn({ apiKey: 'k', model: 'gpt-4.1-mini', instructions: 'hi', userInput: 'hi', tools, session, maxRounds: 2 });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toBe(2);
    expect(result.text).toBe('');
  });

  it('surfaces a tool failure to the model as the call’s output instead of crashing the turn', async () => {
    callTool.mockRejectedValue(new Error('boom'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'resp_1', output: [{ type: 'function_call', call_id: 'call_1', name: 'list_designs', arguments: '{}' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'resp_2', output_text: 'Something went wrong.' }) });
    vi.stubGlobal('fetch', fetchMock);
    const session = await openCanvaSession('token');

    const result = await runToolTurn({ apiKey: 'k', model: 'gpt-4.1-mini', instructions: 'hi', userInput: 'hi', tools, session });

    expect(result.text).toBe('Something went wrong.');
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody.input[0].output).toBe('Tool error: boom');
  });
});

describe('canvaMcpConnector.sync (the user-initiated "Sync" button)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-test'; process.env.OPENAI_MODEL = 'gpt-4.1-mini'; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('reports the design count the model found for an unlinked (first) sync', async () => {
    listTools.mockResolvedValue({ tools: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', output_text: '{"count": 7}' }) }));

    const result = await canvaMcpConnector.sync({ accessToken: 'tok' });

    expect(result).toEqual({ summary: 'Synced 7 Canva designs' });
  });

  it('reports how many of the previously linked designs are still reachable', async () => {
    listTools.mockResolvedValue({ tools: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', output_text: 'Sure, here you go: {"available": 1}' }) }));

    const result = await canvaMcpConnector.sync({ accessToken: 'tok' }, [
      { externalId: 'd1', title: 'Poster', externalUrl: 'https://canva.com/d1' },
      { externalId: 'd2', title: 'Flyer', externalUrl: 'https://canva.com/d2' },
    ]);

    expect(result).toEqual({ summary: 'Synced 1 of 2 linked Canva designs' });
  });

  it('closes the MCP session even when the model call fails', async () => {
    listTools.mockResolvedValue({ tools: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'nope' } }) }));

    await expect(canvaMcpConnector.sync({ accessToken: 'tok' })).rejects.toThrow('INTEGRATION_SYNC_FAILED');
    expect(transportClose).toHaveBeenCalledOnce();
  });

  it('refuses to sync when OPENAI_API_KEY is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(canvaMcpConnector.sync({ accessToken: 'tok' })).rejects.toThrow('OAUTH_NOT_CONFIGURED');
  });

  it('launchUrl just opens the design’s own link — no API call needed', async () => {
    await expect(canvaMcpConnector.launchUrl({ externalId: 'd1', title: 'Poster', externalUrl: 'https://canva.com/d1' })).resolves.toBe('https://canva.com/d1');
  });
});
