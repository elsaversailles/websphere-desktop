import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const HOUR = 3_600_000;
const leader = { id: 'leader-1', role: 'Project_Leader', tv: 0 } as any;
const member = { id: 'member-1', role: 'Project_Member', tv: 0 } as any;

/** A service wired to spies; `poll` is what ideaPoll.findUniqueOrThrow returns. */
function serviceWith(poll: Record<string, unknown> = {}, { closeCount = 1, running = [] as unknown[] } = {}) {
  const base = { id: 'poll-1', groupId: 'group-1', open: true, closesAt: null, closedAt: null, closedBy: null, options: [{ id: 'opt-1', ideaId: 'idea-1', label: 'Idea 1', votes: [] }], ...poll };
  const prisma = {
    ideaPoll: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(base),
      findMany: vi.fn().mockResolvedValue(running),
      updateMany: vi.fn().mockResolvedValue({ count: closeCount }),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'poll-new', ...data, options: [] })),
    },
    idea: { findMany: vi.fn().mockResolvedValue([{ id: 'idea-1', title: 'One' }, { id: 'idea-2', title: 'Two' }]) },
    group: { findUnique: vi.fn().mockResolvedValue({ name: 'Capstone' }) },
    groupMember: { findMany: vi.fn().mockResolvedValue([{ userId: 'leader-1' }, { userId: 'member-1' }]) },
    vote: { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
  };
  const service = Object.create(AppService.prototype) as any;
  const notify = vi.fn().mockResolvedValue({ ok: true });
  const emitPollTally = vi.fn();
  Object.assign(service, { prisma, notify, events: { emitPollTally }, member: vi.fn().mockResolvedValue({}) });
  return { service: service as AppService & Record<string, any>, prisma, notify, emitPollTally };
}

describe('timed group voting', () => {
  it('records a vote while the window is still open', async () => {
    const { service, prisma } = serviceWith({ closesAt: new Date(Date.now() + HOUR) });

    await service.vote(member, 'poll-1', 'opt-1');

    expect(prisma.vote.upsert).toHaveBeenCalledOnce();
    expect(prisma.ideaPoll.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a vote after the deadline, closes the poll as timed out, and tells the group once', async () => {
    const closesAt = new Date(Date.now() - 1000);
    const { service, prisma, notify, emitPollTally } = serviceWith({ closesAt });

    await expect(service.vote(member, 'poll-1', 'opt-1')).rejects.toMatchObject({ status: 409 });

    expect(prisma.vote.upsert).not.toHaveBeenCalled();
    expect(prisma.ideaPoll.updateMany).toHaveBeenCalledWith({ where: { id: 'poll-1', open: true }, data: { open: false, closedAt: closesAt, closedBy: null } });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][2]).toBe('Voting time is up in “Capstone” — see the results');
    expect(emitPollTally).toHaveBeenCalledWith('group-1', expect.objectContaining({ open: false }));
  });

  it('refuses a vote on a poll the leader already closed', async () => {
    const { service, prisma } = serviceWith({ open: false, closedBy: 'leader-1', closedAt: new Date() });

    await expect(service.vote(member, 'poll-1', 'opt-1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.vote.upsert).not.toHaveBeenCalled();
  });

  it('only the caller that actually flips the poll announces it (racing closes stay quiet)', async () => {
    const { service, notify, emitPollTally } = serviceWith({}, { closeCount: 0 });

    expect(await service.closePollRecord('poll-1', null)).toBe(false);

    expect(notify).not.toHaveBeenCalled();
    expect(emitPollTally).not.toHaveBeenCalled();
  });

  it('lets a leader close early, recording who closed it and notifying every member', async () => {
    const { service, prisma, notify } = serviceWith({ closesAt: new Date(Date.now() + 5 * HOUR) });

    const result = await service.closePoll(leader, 'poll-1');

    expect((service as any).member).toHaveBeenCalledWith('group-1', 'leader-1', true);
    expect(prisma.ideaPoll.updateMany.mock.calls[0][0].data).toMatchObject({ open: false, closedBy: 'leader-1' });
    expect(notify.mock.calls[0][0]).toEqual(['leader-1', 'member-1']);
    expect(notify.mock.calls[0][2]).toBe('Voting in “Capstone” was closed by the group leader');
    expect(result).toHaveProperty('pollId', 'poll-1');
  });

  it('does not let a non-leader close the vote', async () => {
    const { service, prisma } = serviceWith();
    (service as any).member = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(service.closePoll(member, 'poll-1')).rejects.toMatchObject({ status: 403 });
    expect(prisma.ideaPoll.updateMany).not.toHaveBeenCalled();
  });

  it('the timer sweep closes every poll past its deadline as a timeout at the deadline itself', async () => {
    const closesAt = new Date(Date.now() - 60_000);
    const { service, prisma } = serviceWith();
    prisma.ideaPoll.findMany.mockResolvedValue([{ id: 'poll-a', open: true, closesAt }, { id: 'poll-b', open: true, closesAt }]);

    expect(await service.closeExpiredPolls()).toBe(2);

    expect(prisma.ideaPoll.findMany.mock.calls[0][0].where).toMatchObject({ open: true, closesAt: { lte: expect.any(Date) } });
    expect(prisma.ideaPoll.updateMany.mock.calls.map((call: any[]) => call[0].where.id)).toEqual(['poll-a', 'poll-b']);
    expect(prisma.ideaPoll.updateMany.mock.calls[0][0].data).toEqual({ open: false, closedAt: closesAt, closedBy: null });
  });

  it('reports a past-deadline poll as closed by timeout even before the sweep has caught up', async () => {
    const closesAt = new Date(Date.now() - 1000);
    const { service } = serviceWith({ closesAt });

    const tally = await service.tally('poll-1');

    expect(tally).toMatchObject({ open: false, closedReason: 'expired', closesAt, closedAt: closesAt });
  });
});

describe('starting a timed vote', () => {
  it('sets the deadline from the chosen duration and tells the other members when it closes', async () => {
    const { service, prisma, notify } = serviceWith();
    const before = Date.now();

    await service.openPoll(leader, 'group-1', { ideaIds: ['idea-1', 'idea-2'], durationHours: 12 });

    const { closesAt } = prisma.ideaPoll.create.mock.calls[0][0].data;
    expect(closesAt.getTime() - before).toBeGreaterThanOrEqual(12 * HOUR);
    expect(closesAt.getTime() - before).toBeLessThan(12 * HOUR + 5000);
    expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({ groupId: 'group-1', userId: { not: 'leader-1' } });
    expect(notify.mock.calls[0][2]).toBe('A vote opened in “Capstone” — voting closes in 12 hours');
  });

  it('leaves the vote open-ended when no duration is given', async () => {
    const { service, prisma, notify } = serviceWith();

    await service.openPoll(leader, 'group-1', { ideaIds: ['idea-1', 'idea-2'], durationHours: null });

    expect(prisma.ideaPoll.create.mock.calls[0][0].data.closesAt).toBeNull();
    expect(notify.mock.calls[0][2]).toBe('A vote opened in “Capstone”');
  });

  it('refuses a second vote while one is still running', async () => {
    const { service, prisma } = serviceWith({}, { running: [{ id: 'poll-1', open: true, closesAt: new Date(Date.now() + HOUR) }] });

    await expect(service.openPoll(leader, 'group-1', { ideaIds: ['idea-1', 'idea-2'] })).rejects.toMatchObject({ status: 409 });
    expect(prisma.ideaPoll.create).not.toHaveBeenCalled();
  });

  it('allows a new vote once the previous one has timed out', async () => {
    const closesAt = new Date(Date.now() - 1000);
    const { service, prisma } = serviceWith({}, { running: [{ id: 'poll-1', open: true, closesAt }] });

    await service.openPoll(leader, 'group-1', { ideaIds: ['idea-1', 'idea-2'], durationHours: 1 });

    expect(prisma.ideaPoll.updateMany).toHaveBeenCalledWith({ where: { id: 'poll-1', open: true }, data: { open: false, closedAt: closesAt, closedBy: null } });
    expect(prisma.ideaPoll.create).toHaveBeenCalledOnce();
  });
});
