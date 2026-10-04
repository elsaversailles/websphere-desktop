import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';

const socket = (caller?: { id: string }) => ({
  id: 'socket-1', data: { caller }, handshake: { auth: {} }, join: vi.fn(), leave: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })), rooms: new Set<string>(['socket-1']), disconnect: vi.fn(),
}) as any;

const events = { onNotification: vi.fn(), onPollTally: vi.fn(), onGroupMembershipRevoked: vi.fn(), registerPresenceProvider: vi.fn() } as any;

describe('RealtimeGateway room authorization', () => {
  it('installs the Redis adapter on the underlying Socket.IO server for a namespace gateway', async () => {
    const publisher = { connect: vi.fn().mockResolvedValue(undefined) };
    const subscriber = { connect: vi.fn().mockResolvedValue(undefined) };
    const redis = { duplicateClient: vi.fn().mockReturnValueOnce(publisher).mockReturnValueOnce(subscriber) };
    const installAdapter = vi.fn();
    const namespace = { adapter: {}, server: { adapter: installAdapter } };
    const gateway = new RealtimeGateway({} as any, redis as any, events);

    await gateway.afterInit(namespace as any);

    expect(publisher.connect).toHaveBeenCalledOnce();
    expect(subscriber.connect).toHaveBeenCalledOnce();
    expect(installAdapter).toHaveBeenCalledWith(expect.any(Function));
  });

  it('reports connected users through the presence provider and drops them on disconnect', async () => {
    const presenceEvents = { onNotification: vi.fn(), onPollTally: vi.fn(), onGroupMembershipRevoked: vi.fn(), registerPresenceProvider: vi.fn() } as any;
    const app = { caller: vi.fn().mockResolvedValue({ id: 'user-1' }) };
    const gateway = new RealtimeGateway(app as any, {} as any, presenceEvents);
    const readPresence = presenceEvents.registerPresenceProvider.mock.calls[0][0] as () => string[];

    expect(readPresence()).toEqual([]);

    const client = socket({ id: 'user-1' });
    client.handshake.auth = { token: 'valid' };
    await gateway.handleConnection(client);
    expect(readPresence()).toEqual(['user-1']);

    gateway.handleDisconnect(client);
    expect(readPresence()).toEqual([]);
  });

  it('disconnects a socket whose JWT cannot be authenticated', async () => {
    const app = { caller: vi.fn().mockRejectedValue(new Error('invalid')) };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    const client = socket();
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('joins only an authorized group room and acknowledges success', async () => {
    const app = { member: vi.fn().mockResolvedValue({}) };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    const client = socket({ id: 'user-1' });
    await expect(gateway.groupJoin(client, 'group-1')).resolves.toEqual({ ok: true });
    expect(app.member).toHaveBeenCalledWith('group-1', 'user-1');
    expect(client.join).toHaveBeenCalledWith('group:group-1');
  });

  it('returns a structured negative acknowledgement when project scope is denied', async () => {
    const app = { projectMember: vi.fn().mockRejectedValue(new ForbiddenException({ code: 'RBAC_FORBIDDEN', message: 'Denied' })) };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    const result = await gateway.projectJoin(socket({ id: 'user-1' }), 'project-1');
    expect(result).toEqual({ ok: false, error: { code: 'RBAC_FORBIDDEN', message: 'Denied' } });
  });

  it('creates an authorized group call and notifies the group without exposing a media stream to the server', async () => {
    const groupEmit = vi.fn();
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any, events);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([]) })), to: vi.fn(() => ({ emit: groupEmit })) } as any;
    const client = socket({ id: 'user-1' });

    const result = await gateway.callJoin(client, { groupId: 'group-1', kind: 'video' });

    expect(result).toEqual({ ok: true, participants: [], hostSocketId: 'socket-1', raisedHandSocketIds: [] });
    expect(client.join).toHaveBeenCalledWith('call:group-1');
    expect(gateway.server.to).toHaveBeenCalledWith('group:group-1');
    expect(groupEmit).toHaveBeenCalledWith('call:invite', expect.objectContaining({ groupId: 'group-1', kind: 'video' }));
  });

  it('broadcasts a chat message and notifies the other group members by name', async () => {
    const groupEmit = vi.fn();
    const notify = vi.fn().mockResolvedValue({ ok: true });
    const app = {
      member: vi.fn().mockResolvedValue({}),
      notify,
      prisma: {
        chatMessage: { create: vi.fn().mockResolvedValue({ id: 'msg-1', groupId: 'group-1', senderId: 'user-1', body: 'hi' }) },
        group: { findUnique: vi.fn().mockResolvedValue({ name: 'Capstone Team' }) },
        user: { findUnique: vi.fn().mockResolvedValue({ fullName: 'Ada Lovelace' }) },
        groupMember: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-2' }, { userId: 'user-3' }]) },
      },
    };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    gateway.server = { to: vi.fn(() => ({ emit: groupEmit })) } as any;
    const client = socket({ id: 'user-1' });

    const result = await gateway.chatSend(client, { groupId: 'group-1', body: ' hi ' });

    expect(result).toEqual({ ok: true });
    expect(gateway.server.to).toHaveBeenCalledWith('group:group-1');
    expect(groupEmit).toHaveBeenCalledWith('chat:message', expect.objectContaining({ id: 'msg-1' }));
    // The sender is excluded from the recipient query, and the message names the group + sender.
    expect(app.prisma.groupMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId: 'group-1', userId: { not: 'user-1' } } }));
    expect(notify).toHaveBeenCalledWith(['user-2', 'user-3'], 'group_activity', 'Ada Lovelace sent a new message in Capstone Team.', 'group-1', 'chat');
  });

  it('still delivers the chat message when the follow-up notification lookup fails', async () => {
    const groupEmit = vi.fn();
    const app = {
      member: vi.fn().mockResolvedValue({}),
      notify: vi.fn(),
      prisma: {
        chatMessage: { create: vi.fn().mockResolvedValue({ id: 'msg-2' }) },
        group: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
        user: { findUnique: vi.fn() },
        groupMember: { findMany: vi.fn() },
      },
    };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    gateway.server = { to: vi.fn(() => ({ emit: groupEmit })) } as any;

    const result = await gateway.chatSend(socket({ id: 'user-1' }), { groupId: 'group-1', body: 'hey' });

    expect(result).toEqual({ ok: true });
    expect(groupEmit).toHaveBeenCalledWith('chat:message', expect.objectContaining({ id: 'msg-2' }));
    expect(app.notify).not.toHaveBeenCalled();
  });

  it('evicts a kicked member from the group and call rooms and tells their client', () => {
    const gateway = new RealtimeGateway({} as any, {} as any, events);
    const onGroupMembershipRevoked = events.onGroupMembershipRevoked.mock.calls.at(-1)?.[0] as (groupId: string, userId: string) => void;
    const socketsLeave = vi.fn();
    const emit = vi.fn();
    gateway.server = { in: vi.fn(() => ({ socketsLeave })), to: vi.fn(() => ({ emit })) } as any;

    onGroupMembershipRevoked('group-1', 'user-9');

    expect(gateway.server.in).toHaveBeenCalledWith('user:user-9');
    expect(socketsLeave).toHaveBeenCalledWith('group:group-1');
    expect(socketsLeave).toHaveBeenCalledWith('call:group-1');
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-9');
    expect(emit).toHaveBeenCalledWith('group:removed', { groupId: 'group-1' });
  });

  it('rejects a seventh participant before joining the call room', async () => {
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any, events);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({ id: `socket-${index}`, data: { caller: { id: `user-${index}` } } }))) })) } as any;
    const client = socket({ id: 'user-7' });

    const result = await gateway.callJoin(client, { groupId: 'group-1', kind: 'voice' });

    expect(result).toEqual({ ok: false, error: { code: 'CALL_FULL', message: 'This call has reached its six-participant limit' } });
    expect(client.join).not.toHaveBeenCalled();
  });
});
