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
