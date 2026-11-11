import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { Server } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway.js';

const { io } = createRequire(new URL('../../web/package.json', import.meta.url))('socket.io-client');
const clients: any[] = [];
let http: HttpServer | undefined;
let server: Server | undefined;

afterEach(async () => {
  clients.splice(0).forEach((client) => client.disconnect());
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (http?.listening) await new Promise<void>((resolve) => http!.close(() => resolve()));
  server = undefined; http = undefined;
});

describe('microphone state over Socket.IO', () => {
  it('synchronizes both directions and restores a muted participant when it rejoins', async () => {
    http = createServer();
    server = new Server(http);
    const events = { onNotification: vi.fn(), onPollTally: vi.fn(), onGroupMembershipRevoked: vi.fn(), registerPresenceProvider: vi.fn() };
    const gateway = new RealtimeGateway({ member: vi.fn().mockResolvedValue({}) } as any, {} as any, events as any);
    gateway.server = server.of('/') as any;
    server.on('connection', (socket) => {
      socket.data.caller = { id: socket.handshake.auth.userId };
      socket.on('call:join', (body, ack) => { void gateway.callJoin(socket as any, body).then(ack); });
      socket.on('call:mute-state', (body, ack) => { void gateway.callMuteState(socket as any, body).then(ack); });
    });
    await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as { port: number }).port;
    const connect = async (userId: string) => {
      const socket = io(`http://127.0.0.1:${port}`, { auth: { userId }, transports: ['websocket'], forceNew: true });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      return socket;
    };
    const mobile = await connect('mobile');
    const web = await connect('web');
    expect(await mobile.emitWithAck('call:join', { groupId: 'group', kind: 'voice', muted: false })).toMatchObject({ ok: true });
    expect(await web.emitWithAck('call:join', { groupId: 'group', kind: 'voice', muted: false })).toMatchObject({ ok: true, participants: [{ userId: 'mobile', muted: false }] });

    const webSeesMute = new Promise<any>((resolve) => web.once('call:mute-state', resolve));
    expect(await mobile.emitWithAck('call:mute-state', { groupId: 'group', muted: true })).toMatchObject({ ok: true });
    expect(await webSeesMute).toMatchObject({ socketId: mobile.id, muted: true });

    const mobileSeesMute = new Promise<any>((resolve) => mobile.once('call:mute-state', resolve));
    expect(await web.emitWithAck('call:mute-state', { groupId: 'group', muted: true })).toMatchObject({ ok: true });
    expect(await mobileSeesMute).toMatchObject({ socketId: web.id, muted: true });

    const mobileSeesUnmute = new Promise<any>((resolve) => mobile.once('call:mute-state', resolve));
    await web.emitWithAck('call:mute-state', { groupId: 'group', muted: false });
    expect(await mobileSeesUnmute).toMatchObject({ socketId: web.id, muted: false });

    const seesRejoin = new Promise<any>((resolve) => mobile.once('call:participant-joined', resolve));
    web.disconnect();
    const rejoinedWeb = await connect('web');
    const join = await rejoinedWeb.emitWithAck('call:join', { groupId: 'group', kind: 'voice', muted: true });
    expect(join).toMatchObject({ ok: true, participants: expect.arrayContaining([expect.objectContaining({ userId: 'mobile', muted: true })]) });
    expect(await seesRejoin).toMatchObject({ participant: { socketId: rejoinedWeb.id, userId: 'web', muted: true } });
  }, 10000);
});
