import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tests the gating logic AppService.ai() added around Canva: it should only ever attempt Canva's
// MCP tools when the prompt sounds design-related AND the caller has an active connection, and it
// must fall back to the ordinary chat reply whenever that attempt doesn't produce a real action —
// never let a Canva/MCP hiccup break the assistant for everyone else.

const openCanvaSession = vi.fn();
const listCanvaTools = vi.fn();
const runToolTurn = vi.fn();
vi.mock('./canva-mcp.js', () => ({
  openCanvaSession, listCanvaTools, runToolTurn,
  // connectors.ts (imported transitively by app.service.ts) needs this export to exist; nothing
  // in this spec exercises the OAuth/sync paths, so a provider stub is enough.
  canvaMcpConnector: { provider: 'canva', authorizeUrl: vi.fn(), exchangeCode: vi.fn(), refresh: vi.fn(), sync: vi.fn(), launchUrl: vi.fn() },
}));

const { AppService } = await import('./app.service.js');

const caller = { id: 'user-1', role: 'Project_Member', tv: 0 } as any;
const connectedCanva = { id: 'conn-1', userId: 'user-1', provider: 'canva', status: 'connected', encAccessToken: 'enc', iv: 'iv', authTag: 'tag', encRefreshToken: null, refreshIv: null, refreshAuthTag: null, expiresAt: null };

function serviceWith({ connection = null as any, aiInteractionCreate = vi.fn().mockResolvedValue({}) } = {}) {
  const prisma = { toolConnection: { findUnique: vi.fn().mockResolvedValue(connection) }, aiInteraction: { create: aiInteractionCreate } };
  const crypto = { decrypt: vi.fn().mockReturnValue('decrypted-canva-token') };
  const config = { get: vi.fn((key: string) => (key === 'OPENAI_API_KEY' ? 'sk-test' : key === 'OPENAI_MODEL' ? 'gpt-4.1-mini' : undefined)) };
  const service = Object.create(AppService.prototype) as any;
  Object.assign(service, { prisma, crypto, config });
  return { service, prisma, aiInteractionCreate };
}

function stubFetch({ flagged = false, plainText = 'plain answer' } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const href = String(url);
    if (href.includes('/moderations')) return { ok: true, json: async () => ({ results: [{ flagged }] }) };
    if (href.includes('/responses')) return { ok: true, json: async () => ({ output_text: plainText }) };
    throw new Error(`unexpected fetch to ${href}`);
  }));
}

beforeEach(() => { vi.clearAllMocks(); stubFetch(); openCanvaSession.mockResolvedValue({ client: {}, close: vi.fn().mockResolvedValue(undefined) }); listCanvaTools.mockResolvedValue([{ type: 'function', name: 'list_designs', parameters: {} }]); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('AppService.ai() — Canva gating', () => {
  it('never looks up a Canva connection for an ordinary, non-design prompt', async () => {
    const { service, prisma } = serviceWith();

    const result = await service.ai(caller, 'How do I write a literature review?', {});

    expect(prisma.toolConnection.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({ response: 'plain answer', refused: false, grounded: false });
  });

  it('falls back to the plain chat reply when the caller has no Canva connection', async () => {
    const { service, prisma } = serviceWith({ connection: null });

    const result = await service.ai(caller, 'Can you make me a poster for my capstone?', {});

    expect(prisma.toolConnection.findUnique).toHaveBeenCalledOnce();
    expect(openCanvaSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({ response: 'plain answer', grounded: false });
  });

  it('falls back to plain chat when the connection exists but is not active (e.g. expired)', async () => {
    const { service } = serviceWith({ connection: { ...connectedCanva, status: 'expired' } });

    const result = await service.ai(caller, 'design me a flyer', {});

    expect(openCanvaSession).not.toHaveBeenCalled();
    expect(result.grounded).toBe(false);
  });

  it('uses the Canva MCP turn, and marks the interaction grounded, when a tool was actually called', async () => {
    const { service, prisma, aiInteractionCreate } = serviceWith({ connection: connectedCanva });
    runToolTurn.mockResolvedValue({ text: 'Here is your poster: https://canva.com/design/abc', toolCalls: 1 });

    const result = await service.ai(caller, 'Can you design a poster for our project?', { scopeType: 'project', scopeId: 'p1' });

    expect(openCanvaSession).toHaveBeenCalledWith('decrypted-canva-token');
    expect(result).toEqual({ response: 'Here is your poster: https://canva.com/design/abc', refused: false, grounded: true });
    expect(aiInteractionCreate).toHaveBeenCalledWith({ data: { userId: 'user-1', scopeType: 'project', scopeId: 'p1', prompt: 'Can you design a poster for our project?', response: 'Here is your poster: https://canva.com/design/abc', moderated: false } });
    expect(prisma.toolConnection.findUnique).toHaveBeenCalledWith({ where: { userId_provider: { userId: 'user-1', provider: 'canva' } } });
  });

  it('falls back to plain chat when the model chose not to call any Canva tool', async () => {
    const { service } = serviceWith({ connection: connectedCanva });
    runToolTurn.mockResolvedValue({ text: 'Sure, here is some general advice...', toolCalls: 0 });

    const result = await service.ai(caller, 'design me a flyer', {});

    expect(result).toMatchObject({ response: 'plain answer', grounded: false });
  });

  it('falls back to plain chat, without throwing, if opening the Canva MCP session fails', async () => {
    const { service } = serviceWith({ connection: connectedCanva });
    openCanvaSession.mockRejectedValue(new Error('Canva MCP unreachable'));

    const result = await service.ai(caller, 'design me a flyer', {});

    expect(result).toMatchObject({ response: 'plain answer', grounded: false });
  });

  it('still refuses non-academic prompts before ever considering Canva', async () => {
    const { service } = serviceWith({ connection: connectedCanva });
    stubFetch({ flagged: true });

    const result = await service.ai(caller, 'design me a poster for hacking a bank account', {});

    expect(result.refused).toBe(true);
    expect(openCanvaSession).not.toHaveBeenCalled();
  });
});
