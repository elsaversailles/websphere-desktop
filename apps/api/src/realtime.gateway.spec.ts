import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';

const socket = (caller?: { id: string }) => ({
  id: caller?.id.replace('user-', 'socket-') ?? 'socket-1', data: { caller }, handshake: { auth: {} }, connected: true, on: vi.fn(), use: vi.fn(), emit: vi.fn(), join: vi.fn(), leave: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })), rooms: new Set<string>(['socket-1']), disconnect: vi.fn(),
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

  it('creates a call and delivers invitations once through authorized user rooms', async () => {
    const emit = vi.fn();
    const app = {
      member: vi.fn().mockResolvedValue({}),
      notify: vi.fn().mockResolvedValue({}),
      prisma: {
        group: { findUnique: vi.fn().mockResolvedValue({ name: 'Team' }) },
        groupMember: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-2' }]) },
      },
    };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([]) })), to: vi.fn(() => ({ emit })) } as any;
    const client = socket({ id: 'user-1' });
    const result = await gateway.callJoin(client, { groupId: 'group-1', kind: 'video' });

    expect(result).toEqual({ ok: true, callId: expect.any(String), participants: [], hostSocketId: 'socket-1', raisedHandSocketIds: [] });
    expect(client.join).toHaveBeenCalledWith('call:group-1');
    await vi.waitFor(() => expect(emit).toHaveBeenCalledOnce());
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-2');
    expect(emit).toHaveBeenCalledWith('call:invite', expect.objectContaining({ groupId: 'group-1', kind: 'video' }));
  });

  it('delivers the archive signal and disconnects only the affected user room', () => {
    const typedEvents = { ...events, onAccountArchived: vi.fn() };
    const gateway = new RealtimeGateway({} as any, {} as any, typedEvents);
    const emit = vi.fn();
    const disconnectSockets = vi.fn();
    gateway.server = { to: vi.fn(() => ({ emit, disconnectSockets })) } as any;
    const archived = typedEvents.onAccountArchived.mock.calls[0][0];
    archived('archived-user');
    expect(gateway.server.to).toHaveBeenCalledOnce();
    expect(gateway.server.to).toHaveBeenCalledWith('user:archived-user');
    expect(emit).toHaveBeenCalledWith('account:archived');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('shares microphone state with the call and includes it for later joiners', async () => {
    const emit = vi.fn();
    const client = socket({ id: 'user-1' });
    client.rooms.add('call:group-1');
    client.to = vi.fn(() => ({ emit }));
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any, events);
    await expect(gateway.callMuteState(client, { groupId: 'group-1', muted: true })).resolves.toEqual({ ok: true });
    expect(emit).toHaveBeenCalledWith('call:mute-state', { groupId: 'group-1', socketId: 'socket-1', muted: true });
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([client]) })), to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const joiner = socket({ id: 'user-2' });
    const result = await gateway.callJoin(joiner, { groupId: 'group-1', kind: 'voice' });
    expect(result.participants).toEqual([{ socketId: 'socket-1', userId: 'user-1', muted: true, cameraEnabled: undefined }]);
    await expect(gateway.callMuteState(joiner, { groupId: 'group-1', muted: true })).resolves.toMatchObject({ ok: false });
  });

  it('announces a reconnecting participant with its current microphone state', async () => {
    const emit = vi.fn();
    const client = socket({ id: 'user-1' });
    client.to = vi.fn(() => ({ emit }));
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any, events);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([]) })), to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    await expect(gateway.callJoin(client, { groupId: 'group-1', kind: 'voice', muted: true })).resolves.toMatchObject({ ok: true });
    expect(client.data.callMuteStates['group-1']).toBe(true);
    expect(emit).toHaveBeenCalledWith('call:participant-joined', expect.objectContaining({ participant: expect.objectContaining({ socketId: 'socket-1', muted: true }) }));
    await expect(gateway.callJoin(client, { groupId: 'group-1', kind: 'voice', muted: 'true' as any })).resolves.toMatchObject({ ok: false });
  });

  it('shares camera state and supplies it to participants joining later', async () => {
    const emit = vi.fn();
    const client = socket({ id: 'user-1' });
    client.rooms.add('call:group-1');
    client.to = vi.fn(() => ({ emit }));
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any, events);
    await expect(gateway.callCameraState(client, { groupId: 'group-1', enabled: false })).resolves.toEqual({ ok: true });
    expect(emit).toHaveBeenCalledWith('call:camera-state', { groupId: 'group-1', socketId: 'socket-1', enabled: false });
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([client]) })), to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const joiner = socket({ id: 'user-2' });
    const result = await gateway.callJoin(joiner, { groupId: 'group-1', kind: 'video' });
    expect(result.participants?.[0].cameraEnabled).toBe(false);
    await expect(gateway.callCameraState(joiner, { groupId: 'group-1', enabled: true })).resolves.toMatchObject({ ok: false });
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

  it('evicts a kicked member from the group, call, and project rooms and tells their client', async () => {
    const gateway = new RealtimeGateway({ prisma: { project: { findMany: vi.fn().mockResolvedValue([{ id: 'project-1' }]) } } } as any, {} as any, events);
    const onGroupMembershipRevoked = events.onGroupMembershipRevoked.mock.calls.at(-1)?.[0] as (groupId: string, userId: string) => void;
    const socketsLeave = vi.fn();
    const emit = vi.fn();
    gateway.server = { in: vi.fn(() => ({ socketsLeave, fetchSockets: vi.fn().mockResolvedValue([]) })), to: vi.fn(() => ({ emit })) } as any;

    onGroupMembershipRevoked('group-1', 'user-9');
    await vi.waitFor(() => expect(socketsLeave).toHaveBeenCalledWith('project:project-1'));

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


describe('call invitation notifications and identities', () => {
  it('includes names when signaling beats the roster and notifies absent members only on call creation', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const groupEmit = vi.fn();
    const app = {
      member: vi.fn().mockResolvedValue({}), notify,
      prisma: {
        user: { findMany: vi.fn().mockResolvedValue([{ id: 'user-1', fullName: 'Ada Lovelace' }, { id: 'user-2', fullName: 'Grace Hopper' }]) },
        group: { findUnique: vi.fn().mockResolvedValue({ name: 'Capstone' }) },
        groupMember: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-2' }]) },
      },
    };
    const fetchSockets = vi.fn().mockResolvedValue([]);
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    gateway.server = { in: vi.fn(() => ({ fetchSockets })), to: vi.fn(() => ({ emit: groupEmit })) } as any;
    const client = socket({ id: 'user-1' });
    const participantEmit = vi.fn();
    client.to = vi.fn(() => ({ emit: participantEmit }));
    await expect(gateway.callJoin(client, { groupId: 'group-1', kind: 'voice' })).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-2');
    expect(notify).toHaveBeenCalledWith(['user-2'], 'group_activity', 'Ada Lovelace started a voice call in Capstone.', 'group-1', 'chat');
    expect(participantEmit).toHaveBeenCalledWith('call:participant-joined', expect.objectContaining({ participant: expect.objectContaining({ fullName: 'Ada Lovelace' }) }));
    fetchSockets.mockResolvedValue([client]);
    const joiner = socket({ id: 'user-2' });
    const result = await gateway.callJoin(joiner, { groupId: 'group-1', kind: 'voice' });
    expect(result.participants?.[0]).toMatchObject({ userId: 'user-1', fullName: 'Ada Lovelace' });
    expect(notify).toHaveBeenCalledOnce();
  });
});


describe('chat message bounds', () => {
  it('accepts 10,000 characters and rejects 10,001 before persisting or broadcasting', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'message' });
    const app = { member: vi.fn().mockResolvedValue({}), prisma: { chatMessage: { create } } };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    const emit = vi.fn();
    gateway.server = { to: vi.fn(() => ({ emit })) } as any;
    const client = socket({ id: 'user-1' });
    await expect(gateway.chatSend(client, { groupId: 'group', body: 'a'.repeat(10000) })).resolves.toEqual({ ok: true });
    await expect(gateway.chatSend(client, { groupId: 'group', body: 'a'.repeat(10001) })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('includes public profile avatars in the roster and hides private profile avatars', async () => {
    const app = { member: vi.fn().mockResolvedValue({}), prisma: { user: { findMany: vi.fn().mockResolvedValue([
      { id: 'user-1', fullName: 'Public', avatarUrl: '/public.png', preference: { profileVisibility: true } },
      { id: 'user-2', fullName: 'Private', avatarUrl: '/private.png', preference: { profileVisibility: false } },
    ]) } } };
    const gateway = new RealtimeGateway(app as any, {} as any, events);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([socket({ id: 'user-1' }), socket({ id: 'user-2' })]) })) } as any;
    const result = await gateway.callJoin(socket({ id: 'user-3' }), { groupId: 'group', kind: 'voice' });
    expect(result.participants).toEqual([
      expect.objectContaining({ userId: 'user-1', fullName: 'Public', avatarUrl: '/public.png' }),
      expect.objectContaining({ userId: 'user-2', fullName: 'Private', avatarUrl: null }),
    ]);
  });

});
