import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

function setup() {
  const service = Object.create(AppService.prototype) as AppService;
  const member = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const projectUpdate = vi.fn().mockResolvedValue({ count: 2 });
  const findUnique = vi.fn().mockResolvedValue({ role: 'Project_Leader' });
  const prisma = { group: { findUnique: vi.fn().mockResolvedValue({ name: 'Capstone' }) }, $queryRaw: vi.fn().mockResolvedValue([]), groupRoleHistory: { upsert: vi.fn() }, groupMember: { update, findUnique }, projectMember: { updateMany: projectUpdate }, $transaction: async (fn: any) => fn(prisma) };
  Object.assign(service, { member, prisma, notify: vi.fn().mockResolvedValue(undefined) });
  return { service, member, update, projectUpdate, findUnique };
}
const caller = { id: 'alice' } as any;

describe('group chat preferences and leadership', () => {
  it('stores a deleted chat only on the caller’s membership', async () => {
    const { service, member, update } = setup();
    await service.setChatState(caller, 'group', 'hide');
    expect(member).toHaveBeenCalledWith('group', 'alice');
    expect(update).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 'group', userId: 'alice' } }, data: { chatHiddenAt: expect.any(Date), chatUnread: false } });
  });
  it('deletes history for the caller while preserving the group', async () => {
    const { service, member, update } = setup();
    await service.setChatState(caller, 'group', 'delete');
    expect(member).toHaveBeenCalledWith('group', 'alice');
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({ chatHiddenAt: expect.any(Date), chatDeletedAt: data.chatHiddenAt, chatUnread: false });
    await service.setChatState(caller, 'group', 'read');
    expect(update.mock.calls[1][0].data).not.toHaveProperty('chatDeletedAt');
  });
  it('does not expose deleted messages in group search', async () => {
    const service = Object.create(AppService.prototype) as AppService;
    const cutoff = new Date('2026-01-02T00:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      { id: 'old', name: 'Old group', members: [{ chatDeletedAt: cutoff }], messages: [{ body: 'secret', createdAt: new Date('2026-01-01T00:00:00Z') }] },
      { id: 'new', name: 'New group', members: [{ chatDeletedAt: cutoff }], messages: [{ body: 'secret new', createdAt: new Date('2026-01-03T00:00:00Z') }] },
      { id: 'named', name: 'Secret group', members: [{ chatDeletedAt: cutoff }], messages: [{ body: 'secret', createdAt: new Date('2026-01-01T00:00:00Z') }] },
    ]);
    Object.assign(service, { prisma: { group: { findMany } } });
    expect(await service.searchGroupChats(caller, 'secret')).toEqual([
      expect.objectContaining({ id: 'new', messageMatch: 'secret new' }),
      expect.objectContaining({ id: 'named', messageMatch: null }),
    ]);
  });
  it('marks unread and clears that state when reopened', async () => {
    const { service, update } = setup();
    await service.setChatState(caller, 'group', 'unread');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { chatUnread: true } }));
    await service.setChatState(caller, 'group', 'read');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { chatHiddenAt: null, chatUnread: false } }));
  });
  it('requires a group leader and a target member before promoting', async () => {
    const { service, findUnique, update, projectUpdate } = setup();
    await service.promoteGroupMember(caller, 'group', 'bob');
    expect(projectUpdate).toHaveBeenCalledWith({ where: { userId: 'bob', project: { groupId: 'group' } }, data: { role: 'Project_Leader' } });
    expect(findUnique).toHaveBeenNthCalledWith(1, { where: { groupId_userId: { groupId: 'group', userId: 'alice' } } });
    expect(findUnique).toHaveBeenNthCalledWith(2, { where: { groupId_userId: { groupId: 'group', userId: 'bob' } } });
    expect(update).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 'group', userId: 'bob' } }, data: { role: 'Project_Leader' } });
    expect((service as any).notify).toHaveBeenCalledWith(['bob'], expect.anything(), expect.stringContaining('Capstone'), 'group', 'group');
  });
  it('does not promote when the caller lacks leader permission', async () => {
    const { service, findUnique, update } = setup();
    findUnique.mockResolvedValueOnce({ role: 'Project_Member' });
    await expect(service.promoteGroupMember(caller, 'group', 'bob')).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });
  it('honors an earlier group promotion for a member of that group’s project', async () => {
    const service = Object.create(AppService.prototype) as AppService;
    Object.assign(service, { prisma: { projectMember: { findUnique: vi.fn().mockResolvedValue({ userId: 'bob', role: 'Project_Member', project: { group: { members: [{ userId: 'bob', role: 'Project_Leader' }] } } }) } } });
    await expect(service.projectMember('project', 'bob', true)).resolves.toMatchObject({ role: 'Project_Leader' });
  });

  it('does not grant leader access in an unrelated project or without project membership', async () => {
    const service = Object.create(AppService.prototype) as AppService;
    const findUnique = vi.fn().mockResolvedValueOnce({ userId: 'bob', role: 'Project_Member', project: { group: { members: [] } } }).mockResolvedValueOnce(null);
    Object.assign(service, { prisma: { projectMember: { findUnique } } });
    await expect(service.projectMember('unrelated', 'bob', true)).rejects.toMatchObject({ status: 403 });
    await expect(service.projectMember('not-a-member', 'bob', true)).rejects.toMatchObject({ status: 403 });
  });

});
