import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

function setup() {
  const service = Object.create(AppService.prototype) as AppService;
  const member = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  Object.assign(service, { member, prisma: { groupMember: { update } } });
  return { service, member, update };
}
const caller = { id: 'alice' } as any;

describe('group chat preferences and leadership', () => {
  it('stores a deleted chat only on the caller’s membership', async () => {
    const { service, member, update } = setup();
    await service.setChatState(caller, 'group', 'hide');
    expect(member).toHaveBeenCalledWith('group', 'alice');
    expect(update).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 'group', userId: 'alice' } }, data: { chatHiddenAt: expect.any(Date), chatUnread: false } });
  });
  it('marks unread and clears that state when reopened', async () => {
    const { service, update } = setup();
    await service.setChatState(caller, 'group', 'unread');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { chatUnread: true } }));
    await service.setChatState(caller, 'group', 'read');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { chatHiddenAt: null, chatUnread: false } }));
  });
  it('requires a group leader and a target member before promoting', async () => {
    const { service, member, update } = setup();
    await service.promoteGroupMember(caller, 'group', 'bob');
    expect(member).toHaveBeenNthCalledWith(1, 'group', 'alice', true);
    expect(member).toHaveBeenNthCalledWith(2, 'group', 'bob');
    expect(update).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 'group', userId: 'bob' } }, data: { role: 'Project_Leader' } });
  });
  it('does not promote when the caller lacks leader permission', async () => {
    const { service, member, update } = setup();
    member.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(service.promoteGroupMember(caller, 'group', 'bob')).rejects.toThrow('Forbidden');
    expect(update).not.toHaveBeenCalled();
  });
});
