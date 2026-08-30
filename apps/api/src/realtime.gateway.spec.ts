import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway.js';

const socket = (caller?: { id: string }) => ({
  id: 'socket-1', data: { caller }, handshake: { auth: {} }, join: vi.fn(), leave: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })), rooms: new Set<string>(['socket-1']), disconnect: vi.fn(),
}) as any;

describe('RealtimeGateway room authorization', () => {
  it('installs the Redis adapter on the underlying Socket.IO server for a namespace gateway', async () => {
    const publisher = { connect: vi.fn().mockResolvedValue(undefined) };
    const subscriber = { connect: vi.fn().mockResolvedValue(undefined) };
    const redis = { duplicateClient: vi.fn().mockReturnValueOnce(publisher).mockReturnValueOnce(subscriber) };
    const installAdapter = vi.fn();
    const namespace = { adapter: {}, server: { adapter: installAdapter } };
    const gateway = new RealtimeGateway({} as any, redis as any);

    await gateway.afterInit(namespace as any);

    expect(publisher.connect).toHaveBeenCalledOnce();
    expect(subscriber.connect).toHaveBeenCalledOnce();
    expect(installAdapter).toHaveBeenCalledWith(expect.any(Function));
  });

  it('disconnects a socket whose JWT cannot be authenticated', async () => {
    const app = { caller: vi.fn().mockRejectedValue(new Error('invalid')) };
    const gateway = new RealtimeGateway(app as any, {} as any);
    const client = socket();
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('joins only an authorized group room and acknowledges success', async () => {
    const app = { member: vi.fn().mockResolvedValue({}) };
    const gateway = new RealtimeGateway(app as any, {} as any);
    const client = socket({ id: 'user-1' });
    await expect(gateway.groupJoin(client, 'group-1')).resolves.toEqual({ ok: true });
    expect(app.member).toHaveBeenCalledWith('group-1', 'user-1');
    expect(client.join).toHaveBeenCalledWith('group:group-1');
  });

  it('returns a structured negative acknowledgement when project scope is denied', async () => {
    const app = { projectMember: vi.fn().mockRejectedValue(new ForbiddenException({ code: 'RBAC_FORBIDDEN', message: 'Denied' })) };
    const gateway = new RealtimeGateway(app as any, {} as any);
    const result = await gateway.projectJoin(socket({ id: 'user-1' }), 'project-1');
    expect(result).toEqual({ ok: false, error: { code: 'RBAC_FORBIDDEN', message: 'Denied' } });
  });

  it('creates an authorized group call and notifies the group without exposing a media stream to the server', async () => {
    const groupEmit = vi.fn();
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue([]) })), to: vi.fn(() => ({ emit: groupEmit })) } as any;
    const client = socket({ id: 'user-1' });

    const result = await gateway.callJoin(client, { groupId: 'group-1', kind: 'video' });

    expect(result).toEqual({ ok: true, participants: [] });
    expect(client.join).toHaveBeenCalledWith('call:group-1');
    expect(gateway.server.to).toHaveBeenCalledWith('group:group-1');
    expect(groupEmit).toHaveBeenCalledWith('call:invite', expect.objectContaining({ groupId: 'group-1', kind: 'video' }));
  });

  it('rejects a seventh participant before joining the call room', async () => {
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any);
    gateway.server = { in: vi.fn(() => ({ fetchSockets: vi.fn().mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({ id: `socket-${index}`, data: { caller: { id: `user-${index}` } } }))) })) } as any;
    const client = socket({ id: 'user-7' });

    const result = await gateway.callJoin(client, { groupId: 'group-1', kind: 'voice' });

    expect(result).toEqual({ ok: false, error: { code: 'CALL_FULL', message: 'This call has reached its six-participant limit' } });
    expect(client.join).not.toHaveBeenCalled();
  });
});
