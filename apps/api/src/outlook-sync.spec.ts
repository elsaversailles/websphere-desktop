import { describe, expect, it, vi, afterEach } from 'vitest';
import { AppService } from './app.service.js';
import * as connectorModule from './connectors.js';

/**
 * reconcileOutlook() is exercised in isolation: connectionTokens() and notify() are stubbed on the
 * instance, and the Microsoft connector's fetchCalendar() is spied so no real Graph call is made.
 * The focus is the reconcile behaviour — create, update, cancel, notifications, and delta persistence.
 */
function serviceWith(prisma: any) {
  const service = Object.create(AppService.prototype) as any;
  Object.assign(service, {
    prisma,
    // Decryption/refresh is covered elsewhere; here we just hand reconcile a usable token.
    connectionTokens: vi.fn().mockResolvedValue({ accessToken: 'graph-token' }),
    notify: vi.fn().mockResolvedValue({ ok: true, delivered: 1 }),
  });
  return service as AppService & { notify: ReturnType<typeof vi.fn> };
}

const connection = { id: 'conn-1', userId: 'user-1', provider: 'microsoft', deltaLink: null, tool: { name: 'Microsoft 365' } };

function calendarEventStore() {
  const rows = new Map<string, any>();
  const key = (where: any) => `${where.ownerId_source_externalId.ownerId}|${where.ownerId_source_externalId.source}|${where.ownerId_source_externalId.externalId}`;
  return {
    rows,
    findUnique: vi.fn(async ({ where }: any) => rows.get(key(where)) ?? null),
    create: vi.fn(async ({ data }: any) => { const row = { id: `evt-${rows.size + 1}`, ...data }; rows.set(`${data.ownerId}|${data.source}|${data.externalId}`, row); return row; }),
    update: vi.fn(async ({ where, data }: any) => { const existing = rows.get(key(where)); const row = { ...existing, ...data }; rows.set(key(where), row); return row; }),
    delete: vi.fn(async ({ where }: any) => { const row = rows.get(key(where)); rows.delete(key(where)); return row; }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('reconcileOutlook', () => {
  it('creates owner-private events, notifies, and persists the delta link', async () => {
    vi.spyOn(connectorModule.connectors.microsoft as any, 'fetchCalendar').mockResolvedValue({
      events: [{ externalId: 'o1', title: 'Standup', startAt: new Date('2026-05-01T09:00:00Z'), endAt: new Date('2026-05-01T09:30:00Z'), cancelled: false }],
      deltaLink: 'https://graph/delta?token=next',
    });
    const calendarEvent = calendarEventStore();
    const toolConnection = { update: vi.fn().mockResolvedValue({}) };
    const service = serviceWith({ calendarEvent, toolConnection });

    const result = await service.reconcileOutlook(connection);

    expect(result).toMatchObject({ created: 1, updated: 0, cancelled: 0 });
    const created = calendarEvent.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ ownerId: 'user-1', source: 'outlook', externalId: 'o1', projectId: null, type: 'meeting' });
    expect(service.notify).toHaveBeenCalledWith(['user-1'], 'outlook', expect.stringContaining('Standup'), expect.any(String), 'calendar_event');
    expect(toolConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: { deltaLink: 'https://graph/delta?token=next' } }));
  });

  it('updates an existing event only when its details changed', async () => {
    const calendarEvent = calendarEventStore();
    calendarEvent.rows.set('user-1|outlook|o1', { id: 'evt-1', ownerId: 'user-1', source: 'outlook', externalId: 'o1', title: 'Standup', startAt: new Date('2026-05-01T09:00:00Z'), endAt: new Date('2026-05-01T09:30:00Z') });
    vi.spyOn(connectorModule.connectors.microsoft as any, 'fetchCalendar').mockResolvedValue({
      events: [{ externalId: 'o1', title: 'Standup (moved)', startAt: new Date('2026-05-01T10:00:00Z'), endAt: new Date('2026-05-01T10:30:00Z'), cancelled: false }],
      deltaLink: 'd2',
    });
    const service = serviceWith({ calendarEvent, toolConnection: { update: vi.fn().mockResolvedValue({}) } });

    const result = await service.reconcileOutlook(connection);

    expect(result).toMatchObject({ created: 0, updated: 1, cancelled: 0 });
    expect(service.notify).toHaveBeenCalledWith(['user-1'], 'outlook', expect.stringContaining('updated'), 'evt-1', 'calendar_event');
  });

  it('deletes a cancelled event and notifies, but ignores cancellations it never mirrored', async () => {
    const calendarEvent = calendarEventStore();
    calendarEvent.rows.set('user-1|outlook|o1', { id: 'evt-1', ownerId: 'user-1', source: 'outlook', externalId: 'o1', title: 'Review', startAt: new Date('2026-05-02T09:00:00Z') });
    vi.spyOn(connectorModule.connectors.microsoft as any, 'fetchCalendar').mockResolvedValue({
      events: [
        { externalId: 'o1', title: 'Review', startAt: new Date(0), cancelled: true },
        { externalId: 'ghost', title: 'Unknown', startAt: new Date(0), cancelled: true },
      ],
      deltaLink: 'd3',
    });
    const service = serviceWith({ calendarEvent, toolConnection: { update: vi.fn().mockResolvedValue({}) } });

    const result = await service.reconcileOutlook(connection);

    expect(result).toMatchObject({ created: 0, updated: 0, cancelled: 1 });
    expect(calendarEvent.delete).toHaveBeenCalledTimes(1);
    expect(service.notify).toHaveBeenCalledWith(['user-1'], 'outlook', expect.stringContaining('cancelled'), 'evt-1', 'calendar_event');
  });

  it('reports up to date and skips the delta update when nothing changed', async () => {
    vi.spyOn(connectorModule.connectors.microsoft as any, 'fetchCalendar').mockResolvedValue({ events: [], deltaLink: null });
    const calendarEvent = calendarEventStore();
    const toolConnection = { update: vi.fn().mockResolvedValue({}) };
    const service = serviceWith({ calendarEvent, toolConnection });

    const result = await service.reconcileOutlook(connection);

    expect(result).toMatchObject({ created: 0, updated: 0, cancelled: 0, summary: 'Outlook calendar up to date' });
    expect(service.notify).not.toHaveBeenCalled();
    expect(toolConnection.update).not.toHaveBeenCalled();
  });
});

/** disconnectIntegration() uses a $transaction; the fake collects the operation descriptors it builds. */
function disconnectService(found: any) {
  const ops: any[] = [];
  const op = (table: string, kind: string) => (args: any) => { const descriptor = { table, kind, args }; ops.push(descriptor); return descriptor; };
  const service = Object.create(AppService.prototype) as any;
  Object.assign(service, {
    prisma: {
      toolConnection: { findFirst: vi.fn().mockResolvedValue(found), delete: op('toolConnection', 'delete') },
      toolUsage: { deleteMany: op('toolUsage', 'deleteMany') },
      linkedResource: { deleteMany: op('linkedResource', 'deleteMany') },
      calendarEvent: { deleteMany: op('calendarEvent', 'deleteMany') },
      $transaction: vi.fn(async (operations: any[]) => operations),
    },
    ops,
  });
  return service as AppService & { prisma: any; ops: any[] };
}

const caller = { id: 'user-1', role: 'Project_Member', tv: 0 } as any;

describe('disconnectIntegration', () => {
  it('removes a Microsoft connection, its dependents, and the mirrored Outlook events', async () => {
    const service = disconnectService({ id: 'conn-1', userId: 'user-1', provider: 'microsoft', tool: { name: 'Microsoft 365' } });

    await expect(service.disconnectIntegration(caller, 'conn-1')).resolves.toEqual({ ok: true, platform: 'Microsoft 365' });

    const tables = service.ops.map((op) => `${op.table}.${op.kind}`);
    expect(tables).toEqual(['toolUsage.deleteMany', 'linkedResource.deleteMany', 'toolConnection.delete', 'calendarEvent.deleteMany']);
    const calendarDelete = service.ops.find((op) => op.table === 'calendarEvent');
    expect(calendarDelete.args).toEqual({ where: { ownerId: 'user-1', source: 'outlook' } });
  });

  it('does not touch calendar events when disconnecting a non-Microsoft provider', async () => {
    const service = disconnectService({ id: 'conn-2', userId: 'user-1', provider: 'trello', tool: { name: 'Trello' } });

    await service.disconnectIntegration(caller, 'conn-2');

    expect(service.ops.some((op) => op.table === 'calendarEvent')).toBe(false);
  });

  it('rejects disconnecting a connection the caller does not own', async () => {
    const service = disconnectService(null);
    await expect(service.disconnectIntegration(caller, 'missing')).rejects.toMatchObject({ status: 404 });
  });
});
