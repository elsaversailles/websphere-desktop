import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';
import { signedInTicketSchema, publicSupportTicketSchema, ticketUpdateSchema } from '@websphere/shared';

const admin = { id: 'admin-1', role: 'Administrator', tv: 0 } as any;
const member = { id: 'member-1', role: 'Project_Member', tv: 0 } as any;

function serviceWith(ticket: Record<string, unknown> | null) {
  const update = vi.fn().mockImplementation(async ({ data }) => ({ ...ticket, ...data, user: { fullName: 'Himc', email: 'himc@example.com' } }));
  const create = vi.fn().mockImplementation(async ({ data }) => ({ id: 'ticket-1', ...data }));
  const findMany = vi.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
  const notify = vi.fn().mockResolvedValue({ ok: true });
  const log = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    prisma: { supportTicket: { create, update, findUnique: vi.fn().mockResolvedValue(ticket) }, user: { findMany } },
    notify,
    audit: { log },
  });
  return { service, create, update, notify, log };
}

const existing = { id: 'ticket-1', userId: 'member-1', subject: 'Cannot log in', status: 'pending', response: null };

describe('support ticket status updates', () => {
  it('queues signed-out requests without associating an unverified email with an account', async () => {
    const { service, create, notify } = serviceWith(null);
    Object.assign(service, { redis: { incrementWithExpiry: vi.fn().mockResolvedValue(1) } });
    await expect(service.publicTicket({ email: 'PERSON@example.com', category: 'account_reactivation', subject: 'Cannot log in', body: 'Please help' }, '127.0.0.1')).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({ data: { contactEmail: 'person@example.com', category: 'account_reactivation', subject: 'Cannot log in', body: 'Please help' } });
    expect(notify).toHaveBeenCalledOnce();
  });

  it('does not send an in-app notification for a signed-out requester', async () => {
    const { service, notify } = serviceWith({ ...existing, userId: null, contactEmail: 'person@example.com' });
    await service.updateTicket(admin, 'ticket-1', { status: 'resolved' as any });
    expect(notify).not.toHaveBeenCalled();
  });
  it('forwards a new request to every active administrator', async () => {
    const { service, notify } = serviceWith(null);

    await service.ticket(member, { category: 'bug_report', subject: 'Cannot log in', body: 'Details' });

    expect(notify).toHaveBeenCalledTimes(1);
    const [recipients, type, message, relatedId, relatedType] = notify.mock.calls[0];
    expect(recipients).toEqual(['admin-1', 'admin-2']);
    expect(type).toBe('ticket_update');
    expect(message).toContain('Cannot log in');
    expect([relatedId, relatedType]).toEqual(['ticket-1', 'ticket']);
  });

  it.each([
    ['in_progress', 'In Progress'],
    ['resolved', 'Completed'],
    ['rejected', 'Declined'],
  ])('tells the requester when their ticket becomes %s', async (status, label) => {
    const { service, update, notify } = serviceWith(existing);

    await service.updateTicket(admin, 'ticket-1', { status: status as any });

    expect(update.mock.calls[0][0].data).toEqual({ status });
    expect(notify).toHaveBeenCalledWith(['member-1'], 'ticket_update', `Your request “Cannot log in” is now ${label}`, 'ticket-1', 'ticket');
  });

  it('notifies about a reply even when the status is unchanged, and stores it', async () => {
    const { service, update, notify } = serviceWith(existing);

    await service.updateTicket(admin, 'ticket-1', { status: 'pending', response: 'Looking into it' });

    expect(update.mock.calls[0][0].data).toEqual({ status: 'pending', response: 'Looking into it' });
    expect(notify.mock.calls[0][2]).toBe('The administrator replied to your request “Cannot log in”');
  });

  it('stays silent when nothing changed, so saving twice does not spam the requester', async () => {
    const { service, notify, log } = serviceWith({ ...existing, status: 'in_progress', response: 'On it' });

    await service.updateTicket(admin, 'ticket-1', { status: 'in_progress', response: 'On it' });

    expect(notify).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('clears the reply when an empty one is sent', async () => {
    const { service, update } = serviceWith({ ...existing, response: 'Old reply' });

    await service.updateTicket(admin, 'ticket-1', { status: 'pending', response: '' });

    expect(update.mock.calls[0][0].data).toEqual({ status: 'pending', response: null });
  });

  it('rejects non-administrators and unknown tickets', async () => {
    await expect(serviceWith(existing).service.updateTicket(member, 'ticket-1', { status: 'resolved' })).rejects.toMatchObject({ status: 403 });
    await expect(serviceWith(null).service.updateTicket(admin, 'missing', { status: 'resolved' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('support text limits', () => {
  it('preserves longer rated feedback from the existing clients', () => {
    const feedback = { category: 'other', subject: 'Feedback · 4/5 stars', body: 'Rating: 4/5\n\n' + 'x'.repeat(3900) };
    expect(signedInTicketSchema.safeParse(feedback).success).toBe(true);
    expect(signedInTicketSchema.safeParse({ ...feedback, subject: 'Help' }).success).toBe(false);
    expect(publicSupportTicketSchema.safeParse({ ...feedback, email: 'u@example.com' }).success).toBe(false);
  });
  it('accepts 200 characters and rejects 201 for requests and replies', () => {
    const base = { category: 'bug_report', subject: 'Help' };
    for (const length of [200, 201]) {
      const body = 'x'.repeat(length);
      expect(signedInTicketSchema.safeParse({ ...base, body }).success).toBe(length === 200);
      expect(publicSupportTicketSchema.safeParse({ ...base, email: 'user@example.com', body }).success).toBe(length === 200);
      expect(ticketUpdateSchema.safeParse({ status: 'resolved', response: body }).success).toBe(length === 200);
    }
  });
});
