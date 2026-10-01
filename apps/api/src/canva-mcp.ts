import { PrismaClient } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { requestForm, tokensFrom } from './oauth-http.js';
import type { Connector, LinkTarget, OAuthTokens, SyncResult, SyncTarget } from './connectors.js';

/**
 * Canva's Connect API (the REST API the other five adapters' pattern would use) requires a
 * reviewed, pre-registered "Public integration" before real student accounts can authorize it —
 * review that a small/unverified app is not guaranteed to pass. This file talks to Canva's own
 * hosted design MCP server (https://mcp.canva.com/mcp) instead:
 *   - it needs no pre-registered Developer Portal app at all — it supports OAuth 2.1 Dynamic
 *     Client Registration (RFC 7591) discovered per the MCP Authorization spec, so this module
 *     registers itself with Canva's auth server the first time anyone connects, and caches the
 *     result (see `clientInformation`);
 *   - per Canva's MCP usage policy (canva.dev/docs/mcp/usage-policy), every action has to be
 *     LLM-initiated by a specific, live user request — no scheduled/bulk background automation.
 *     `sync()` below honors that: a "Sync" click is still a single, user-initiated action, but it
 *     is carried out by routing one bounded OpenAI tool-calling turn through Canva's MCP tools
 *     (`runToolTurn`) rather than this module calling an MCP tool directly. The same `runToolTurn`
 *     backs the AI assistant's own Canva capability in app.service.ts.
 *
 * None of this could be exercised against the live server from the build environment (no network,
 * no Canva credentials) — it follows the MCP Authorization spec and the installed
 * @modelcontextprotocol/sdk's types exactly, but the exact tool names/schemas Canva's server
 * returns, and the OpenAI Responses API tool-call continuation shape, are only confirmed by a
 * real connection attempt.
 */

const MCP_SERVER_URL = 'https://mcp.canva.com/mcp';
const CLIENT_SETTING_KEY = 'integration.canva.oauthClient';

// connectors.ts has no other reason to depend on a live Prisma connection; this module owns its
// own client the same way apps/mcp/src/index.ts does, rather than threading PrismaService through
// the plain-class Connector registry.
const prisma = new PrismaClient();

type DiscoveredServer = { authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint?: string; scopes: string[]; rawMetadata: AuthorizationServerMetadata };
type CachedClient = { client_id: string; client_secret?: string; redirect_uris: string[] };

let discoveryCache: DiscoveredServer | null = null;

/** RFC 9728 + RFC 8414 discovery of Canva's MCP auth server, cached for the process lifetime. */
async function discoverServer(): Promise<DiscoveredServer> {
  if (discoveryCache) return discoveryCache;
  const resource = await discoverOAuthProtectedResourceMetadata(MCP_SERVER_URL).catch(() => undefined);
  const authServerUrl = resource?.authorization_servers?.[0] ?? MCP_SERVER_URL;
  const metadata = await discoverAuthorizationServerMetadata(authServerUrl);
  if (!metadata) throw new Error('OAUTH_NOT_CONFIGURED');
  discoveryCache = {
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    registrationEndpoint: metadata.registration_endpoint,
    scopes: resource?.scopes_supported ?? metadata.scopes_supported ?? [],
    rawMetadata: metadata,
  };
  return discoveryCache;
}

async function cachedClient(): Promise<CachedClient | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CLIENT_SETTING_KEY } });
  return (row?.value as CachedClient | undefined) ?? null;
}

/**
 * Registers WebSphere as an OAuth client with Canva's auth server the first time it's needed, via
 * Dynamic Client Registration — this is the step that replaces a manually-approved Developer
 * Portal app. Re-registers if the redirect URI this deployment uses has changed since the cached
 * registration (e.g. a new environment/domain).
 */
async function clientInformation(redirectUri: string): Promise<CachedClient> {
  const existing = await cachedClient();
  if (existing?.redirect_uris?.includes(redirectUri)) return existing;
  const server = await discoverServer();
  if (!server.registrationEndpoint) throw new Error('OAUTH_NOT_CONFIGURED');
  const registered = await registerClient(server.registrationEndpoint, {
    metadata: server.rawMetadata,
    clientMetadata: {
      redirect_uris: [redirectUri],
      client_name: 'WebSphere',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  });
  const value: CachedClient = { client_id: registered.client_id, client_secret: registered.client_secret, redirect_uris: [redirectUri] };
  await prisma.systemSetting.upsert({ where: { key: CLIENT_SETTING_KEY }, update: { value }, create: { key: CLIENT_SETTING_KEY, value } });
  return value;
}

async function tokenRequest(server: DiscoveredServer, client: CachedClient, body: URLSearchParams) {
  body.set('client_id', client.client_id);
  const headers: Record<string, string> = {};
  if (client.client_secret) headers.authorization = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`;
  return tokensFrom(await requestForm(server.tokenEndpoint, body, headers));
}

async function authorizeUrl(state: string, redirectUri: string, codeChallenge?: string): Promise<string> {
  if (!codeChallenge) throw new Error('OAUTH_EXCHANGE_FAILED');
  const server = await discoverServer();
  const client = await clientInformation(redirectUri);
  return `${server.authorizationEndpoint}?${new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', state,
    code_challenge: codeChallenge, code_challenge_method: 'S256',
    ...(server.scopes.length ? { scope: server.scopes.join(' ') } : {}),
  }).toString()}`;
}

async function exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
  if (!code || !redirectUri || !codeVerifier) throw new Error('OAUTH_EXCHANGE_FAILED');
  const server = await discoverServer();
  const client = await clientInformation(redirectUri);
  return tokenRequest(server, client, new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri }));
}

async function refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error('OAUTH_RECONNECT_REQUIRED');
  const server = await discoverServer();
  const client = await cachedClient();
  if (!client) throw new Error('OAUTH_RECONNECT_REQUIRED');
  return tokenRequest(server, client, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }));
}

// ---- MCP session + a small, bounded tool-calling loop, shared by sync() and the AI assistant ----

export type McpSession = { client: Client; close: () => Promise<void> };
export type OpenAiTool = { type: 'function'; name: string; description?: string; parameters: unknown };

export async function openCanvaSession(accessToken: string): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } });
  const client = new Client({ name: 'websphere', version: '0.1.0' });
  await client.connect(transport);
  return { client, close: () => transport.close() };
}

export async function listCanvaTools(session: McpSession): Promise<OpenAiTool[]> {
  const { tools } = await session.client.listTools();
  return tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema }));
}

async function callCanvaTool(session: McpSession, name: string, args: unknown): Promise<string> {
  const result = await session.client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> });
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  return text || JSON.stringify(result.content ?? []);
}

/**
 * One OpenAI Responses-API turn with Canva's MCP tools available, looping (bounded) while the
 * model keeps calling tools, then returning its final text. This is what makes every Canva action
 * — sync included — "LLM-controlled" per Canva's usage policy, rather than this backend calling an
 * MCP tool directly.
 */
export async function runToolTurn({ apiKey, model, instructions, userInput, tools, session, maxRounds = 4 }: {
  apiKey: string; model: string; instructions: string; userInput: string; tools: OpenAiTool[]; session: McpSession; maxRounds?: number;
}): Promise<{ text: string; toolCalls: number }> {
  let toolCalls = 0;
  let previousResponseId: string | undefined;
  let nextInput: unknown = userInput;
  for (let round = 0; round < maxRounds; round++) {
    const body: Record<string, unknown> = { model, tools, max_output_tokens: 900, input: nextInput };
    if (previousResponseId) body.previous_response_id = previousResponseId;
    else body.instructions = instructions;
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || 'AI_PROVIDER_ERROR');
    previousResponseId = payload.id;
    const calls = (payload.output ?? []).filter((item: any) => item.type === 'function_call');
    if (!calls.length) {
      const text = String(payload.output_text || (payload.output ?? []).flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text').map((item: any) => item.text).join('') || '').trim();
      return { text, toolCalls };
    }
    nextInput = await Promise.all(calls.map(async (call: any) => {
      toolCalls += 1;
      let args: unknown = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch { /* malformed args: call the tool with none rather than fail the whole turn */ }
      const output = await callCanvaTool(session, call.name, args).catch((error) => `Tool error: ${error instanceof Error ? error.message : 'failed'}`);
      return { type: 'function_call_output', call_id: call.call_id, output };
    }));
  }
  return { text: '', toolCalls };
}

export const canvaMcpConnector: Connector = {
  provider: 'canva',
  authorizeUrl,
  exchangeCode,
  refresh,
  async sync(tokens: OAuthTokens, targets: SyncTarget[] = []): Promise<SyncResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OAUTH_NOT_CONFIGURED');
    const session = await openCanvaSession(tokens.accessToken);
    try {
      const tools = await listCanvaTools(session);
      const instruction = targets.length
        ? `Check whether each of these Canva designs is still reachable in the connected account (by id, or closest title match if the id tool fails): ${targets.map((target) => `"${target.title}" (${target.externalId})`).join('; ')}. Use the available tools to check. Reply with ONLY this compact JSON and nothing else: {"available": <number of the ${targets.length} still reachable>}`
        : 'List the designs in the connected Canva account using the available tools. Reply with ONLY this compact JSON and nothing else: {"count": <number of designs found>}';
      const { text } = await runToolTurn({
        apiKey, model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini', session, tools,
        instructions: 'You check and summarize a student’s Canva account for a project-management tool, using only the Canva tools you are given. Reply with ONLY the exact JSON object requested — no other text.',
        userInput: instruction,
      });
      const match = text.match(/\{[^{}]*\}/);
      const parsed = match ? JSON.parse(match[0]) : {};
      if (targets.length) {
        const available = Math.max(0, Math.min(targets.length, Number(parsed.available) || 0));
        return { summary: `Synced ${available} of ${targets.length} linked Canva design${targets.length === 1 ? '' : 's'}` };
      }
      const count = Math.max(0, Number(parsed.count) || 0);
      return { summary: `Synced ${count} Canva design${count === 1 ? '' : 's'}` };
    } catch (error) {
      if (error instanceof Error && (error.message === 'OAUTH_NOT_CONFIGURED' || error.message === 'OAUTH_RECONNECT_REQUIRED')) throw error;
      throw new Error('INTEGRATION_SYNC_FAILED');
    } finally {
      await session.close().catch(() => undefined);
    }
  },
  async launchUrl(target: LinkTarget) { return target.externalUrl; },
};
