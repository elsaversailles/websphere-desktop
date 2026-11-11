import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';
import { createHash } from 'node:crypto';

const leader = { id: 'leader', role: 'Project_Leader' as const, tv: 0 };

function fixture() {
  const idea: any = { id: 'idea-a', groupId: 'group-1', title: 'Winning idea', body: 'Description', status: 'submitted' };
  const poll: any = { id: 'poll-1', groupId: 'group-1', open: false, closesAt: null, options: [
    { id: 'option-a', ideaId: 'idea-a', label: 'Winning idea', contentHash: createHash('sha256').update(JSON.stringify(['Winning idea', 'Description', 'Academic Project'])).digest('hex'), votes: [{ id: 'vote-1' }, { id: 'vote-2' }] },
    { id: 'option-b', ideaId: 'idea-b', label: 'Other idea', votes: [{ id: 'vote-3' }] },
  ] };
  const prisma: any = {
    idea: { findFirst: vi.fn(async ({ where }: any) => where.id === idea.id && where.groupId === idea.groupId ? idea : null), update: vi.fn(async () => ({})) },
    ideaPoll: { findFirst: vi.fn(async () => poll), findUniqueOrThrow: vi.fn(async () => poll), updateMany: vi.fn(async () => ({ count: 0 })) },
    groupMember: { findMany: vi.fn(async () => [{ userId: 'leader' }, { userId: 'member' }]) },
    project: { create: vi.fn(async ({ data }: any) => ({ id: 'project-1', ...data })) },
    vote: { upsert: vi.fn(async () => ({})) },
  };
  prisma.$transaction = vi.fn(async (operation: any) => operation(prisma));
  const service: any = Object.assign(Object.create(AppService.prototype), { prisma, member: vi.fn(async () => ({})) });
  return { service, prisma, poll, idea };
}

describe('approval before creating a project from an idea', () => {
  it('rejects direct requests without a poll or while voting remains open', async () => {
    const { service, prisma, poll } = fixture();
    prisma.ideaPoll.findFirst.mockResolvedValueOnce(null);
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ status: 409 });
    poll.open = true;
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ status: 409 });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('rejects zero votes and ties', async () => {
    const { service, prisma, poll } = fixture();
    poll.options.forEach((option: any) => { option.votes = []; });
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ response: { code: 'VOTE_NO_WINNER' } });
    poll.options.forEach((option: any) => { option.votes = [{ id: 'vote' }]; });
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ response: { code: 'VOTE_NO_WINNER' } });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('rejects non-winning, rejected, already-selected, and other-group ideas', async () => {
    const { service, prisma, idea } = fixture();
    idea.id = 'idea-b';
    await expect(service.begin(leader, 'group-1', 'idea-b')).rejects.toMatchObject({ response: { code: 'IDEA_NOT_APPROVED' } });
    idea.id = 'idea-a'; idea.status = 'rejected';
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ status: 409 });
    idea.status = 'selected';
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ status: 409 });
    idea.status = 'submitted';
    await expect(service.begin(leader, 'other-group', 'idea-a')).rejects.toMatchObject({ status: 404 });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('rejects non-leaders even for a winning idea', async () => {
    const { service, prisma } = fixture();
    service.member.mockRejectedValueOnce(new Error('forbidden'));
    await expect(service.begin({ ...leader, id: 'member' }, 'group-1', 'idea-a')).rejects.toThrow('forbidden');
    expect(service.member).toHaveBeenCalledWith('group-1', 'member', true);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('creates the winning project and marks its idea selected within one serializable transaction', async () => {
    const { service, prisma } = fixture();
    await expect(service.begin(leader, 'group-1', 'idea-a')).resolves.toMatchObject({ id: 'project-1', ideaId: 'idea-a' });
    expect(prisma.idea.update).toHaveBeenCalledWith({ where: { id: 'idea-a' }, data: { status: 'selected' } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('rechecks the poll inside the transaction and rejects a newer poll', async () => {
    const { service, prisma, poll } = fixture();
    prisma.ideaPoll.findFirst.mockResolvedValueOnce(poll).mockResolvedValueOnce({ ...poll, id: 'newer' });
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ status: 409 });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('rejects a vote when the poll closes before its transaction', async () => {
    const { service, prisma, poll } = fixture();
    prisma.ideaPoll.findUniqueOrThrow.mockResolvedValueOnce({ ...poll, open: true }).mockResolvedValueOnce(poll);
    await expect(service.vote(leader, 'poll-1', 'option-a')).rejects.toMatchObject({ status: 409 });
    expect(prisma.vote.upsert).not.toHaveBeenCalled();
  });

  it('rejects a winning idea whose title changed after the vote', async () => {
    const { service, prisma, idea } = fixture();
    idea.title = 'Changed after voting';
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ response: { code: 'IDEA_CHANGED' } });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('rejects changed descriptions and older votes without a verified snapshot', async () => {
    const { service, prisma, idea, poll } = fixture();
    idea.body = 'Changed after voting';
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ response: { code: 'IDEA_CHANGED' } });
    idea.body = 'Description'; poll.options[0].contentHash = null;
    await expect(service.begin(leader, 'group-1', 'idea-a')).rejects.toMatchObject({ response: { code: 'IDEA_CHANGED' } });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('prevents revising an idea that has already been put to a vote', async () => {
    const { service, prisma, idea } = fixture();
    idea.authorId = leader.id;
    prisma.idea.findUniqueOrThrow = vi.fn(async () => idea);
    prisma.pollOption = { findFirst: vi.fn(async () => ({ id: 'option-a' })) };
    await expect(service.reviseIdea(leader, idea.id, { title: 'Changed title', body: 'Changed content' })).rejects.toMatchObject({ response: { code: 'IDEA_IN_VOTE' } });
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });
});
