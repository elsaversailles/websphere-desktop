import { HttpException, OnApplicationShutdown } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Namespace, Server, Socket } from 'socket.io';
import type { AckDto, ApiError, CallParticipant, CallSignal, ClientToServerEvents, ServerToClientEvents } from '@websphere/shared';
import { AppService } from './app.service.js';
import { RedisService } from './redis.service.js';
import { DomainEventsService } from './domain-events.service.js';

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? true, credentials: true }, namespace: '/' })
export class RealtimeGateway implements OnGatewayInit, OnApplicationShutdown {
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  private readonly presence = new Map<string, Set<string>>();
  private adapterClients: Redis[] = [];
  constructor(private readonly app: AppService, private readonly redis: RedisService, private readonly events: DomainEventsService) {
    this.events.onNotification((userId, notification) => this.publishNotification(userId, notification));
  }
  async afterInit(server: Server | Namespace) {
    const publisher = this.redis.duplicateClient();
    const subscriber = this.redis.duplicateClient();
    this.adapterClients = [publisher, subscriber];
    await Promise.all([publisher.connect(), subscriber.connect()]);
    const ioServer = 'server' in server ? server.server : server;
    ioServer.adapter(createAdapter(publisher, subscriber));
  }
  async handleConnection(socket: Socket) { try { const token = socket.handshake.auth?.token; const caller = await this.app.caller(token ? `Bearer ${token}` : undefined); socket.data.caller = caller; this.presence.set(caller.id, new Set([...(this.presence.get(caller.id) ?? []), socket.id])); await socket.join(`user:${caller.id}`); } catch { socket.disconnect(true); } }
  publishPollTally(groupId: string, tally: unknown) { this.server.to(`group:${groupId}`).emit('poll:tally', tally); }
  publishTaskUpdated(projectId: string, task: unknown) { this.server.to(`project:${projectId}`).emit('task:updated', task); }
  publishNotification(userId: string, notification: unknown) { this.server.to(`user:${userId}`).emit('notification:new', notification); }
  handleDisconnect(socket: Socket) { const userId = socket.data.caller?.id; if (!userId) return; for (const room of socket.rooms) if (room.startsWith('call:')) socket.to(room).emit('call:participant-left', { groupId: room.slice(5), socketId: socket.id }); const ids = this.presence.get(userId); ids?.delete(socket.id); if (!ids?.size) this.presence.delete(userId); }
  @SubscribeMessage('group:join') groupJoin(@ConnectedSocket() socket: Socket, @MessageBody() groupId: string) { return this.ack(async () => { this.assertAuthenticated(socket); if (!groupId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group ID is required' }, 400); await this.app.member(groupId, socket.data.caller.id); await socket.join(`group:${groupId}`); }); }
  @SubscribeMessage('project:join') projectJoin(@ConnectedSocket() socket: Socket, @MessageBody() projectId: string) { return this.ack(async () => { this.assertAuthenticated(socket); if (!projectId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Project ID is required' }, 400); await this.app.projectMember(projectId, socket.data.caller.id); await socket.join(`project:${projectId}`); }); }
  @SubscribeMessage('chat:send') chatSend(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; body: string }) { return this.ack(async () => { this.assertAuthenticated(socket); const messageBody = body?.body?.trim(); if (!body?.groupId || !messageBody) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group and message are required' }, 400); await this.app.member(body.groupId, socket.data.caller.id); const message = await this.app.prisma.chatMessage.create({ data: { groupId: body.groupId, senderId: socket.data.caller.id, body: messageBody } }); this.server.to(`group:${body.groupId}`).emit('chat:message', message); }); }
  @SubscribeMessage('sync:request') async reconcile(@ConnectedSocket() socket: Socket, @MessageBody() body: { projectId: string }) { await this.app.projectMember(body.projectId, socket.data.caller.id); const tasks = await this.app.prisma.task.findMany({ where: { projectId: body.projectId }, include: { assignments: { where: { active: true } } } }); return { projectId: body.projectId, tasks }; }
  @SubscribeMessage('call:join') async callJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; kind: 'voice' | 'video' }): Promise<AckDto & { participants?: CallParticipant[] }> {
    try {
      this.assertAuthenticated(socket);
      if (!body?.groupId || !['voice', 'video'].includes(body.kind)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'A group and call type are required' }, 400);
      await this.app.member(body.groupId, socket.data.caller.id);
      const room = `call:${body.groupId}`;
      const members = await this.server.in(room).fetchSockets();
      if (members.length >= 6) throw new HttpException({ code: 'CALL_FULL', message: 'This call has reached its six-participant limit' }, 409);
      const participants = members.map((member) => ({ socketId: member.id, userId: String(member.data.caller?.id ?? '') }));
      await socket.join(room);
      if (!participants.length) this.server.to(`group:${body.groupId}`).emit('call:invite', { groupId: body.groupId, kind: body.kind, initiatorSocketId: socket.id, initiatorUserId: socket.data.caller.id });
      socket.to(room).emit('call:participant-joined', { groupId: body.groupId, participant: { socketId: socket.id, userId: socket.data.caller.id } });
      return { ok: true, participants };
    } catch (error) { return this.ackError(error); }
  }
  @SubscribeMessage('call:leave') callLeave(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string }) { return this.ack(async () => { this.assertAuthenticated(socket); if (!body?.groupId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group ID is required' }, 400); await socket.leave(`call:${body.groupId}`); socket.to(`call:${body.groupId}`).emit('call:participant-left', { groupId: body.groupId, socketId: socket.id }); }); }
  @SubscribeMessage('call:signal') async callSignal(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; targetSocketId: string; signal: CallSignal }) { return this.ack(async () => { this.assertAuthenticated(socket); if (!body?.groupId || !body?.targetSocketId || !body.signal || !['offer', 'answer', 'ice-candidate'].includes(body.signal.type)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Invalid call signal' }, 400); const room = `call:${body.groupId}`; if (!socket.rooms.has(room)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Join the call before signaling' }, 403); const recipients = await this.server.in(room).fetchSockets(); if (!recipients.some((recipient) => recipient.id === body.targetSocketId)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Call participant is unavailable' }, 403); this.server.to(body.targetSocketId).emit('call:signal', { groupId: body.groupId, fromSocketId: socket.id, signal: body.signal }); }); }

  async onApplicationShutdown() {
    await Promise.all(this.adapterClients.map(async (client) => {
      if (client.status !== 'end') await client.quit();
    }));
  }

  private assertAuthenticated(socket: Socket) {
    if (!socket.data.caller) throw new HttpException({ code: 'AUTH_UNAUTHENTICATED', message: 'Socket authentication is required' }, 401);
  }

  private async ack(action: () => Promise<void>): Promise<AckDto> {
    try {
      await action();
      return { ok: true };
    } catch (error) {
      return this.ackError(error);
    }
  }
  private ackError(error: unknown): AckDto {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const body = typeof response === 'string' ? { code: 'SOCKET_ERROR', message: response } : response as ApiError;
      return { ok: false, error: { code: body.code ?? 'SOCKET_ERROR', message: body.message ?? 'Socket request failed', ...(body.fields ? { fields: body.fields } : {}) } };
    }
    return { ok: false, error: { code: 'SOCKET_ERROR', message: 'Socket request failed' } };
  }
}
