import { HttpException, OnApplicationShutdown } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Namespace, Server, Socket } from 'socket.io';
import type { AckDto, ApiError, ClientToServerEvents, ServerToClientEvents } from '@websphere/shared';
import { AppService } from './app.service.js';
import { RedisService } from './redis.service.js';

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? true, credentials: true }, namespace: '/' })
export class RealtimeGateway implements OnGatewayInit, OnApplicationShutdown {
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  private readonly presence = new Map<string, Set<string>>();
  private adapterClients: Redis[] = [];
  constructor(private readonly app: AppService, private readonly redis: RedisService) {}
  async afterInit(server: Server | Namespace) {
    const publisher = this.redis.duplicateClient();
    const subscriber = this.redis.duplicateClient();
    this.adapterClients = [publisher, subscriber];
    await Promise.all([publisher.connect(), subscriber.connect()]);
    const ioServer = 'server' in server ? server.server : server;
    ioServer.adapter(createAdapter(publisher, subscriber));
  }
  async handleConnection(socket: Socket) { try { const token = socket.handshake.auth?.token; const caller = await this.app.caller(token ? `Bearer ${token}` : undefined); socket.data.caller = caller; this.presence.set(caller.id, new Set([...(this.presence.get(caller.id) ?? []), socket.id])); } catch { socket.disconnect(true); } }
  publishPollTally(groupId: string, tally: unknown) { this.server.to(`group:${groupId}`).emit('poll:tally', tally); }
  handleDisconnect(socket: Socket) { const userId = socket.data.caller?.id; if (!userId) return; const ids = this.presence.get(userId); ids?.delete(socket.id); if (!ids?.size) this.presence.delete(userId); }
  @SubscribeMessage('group:join') groupJoin(@ConnectedSocket() socket: Socket, @MessageBody() groupId: string) { return this.ack(async () => { this.assertAuthenticated(socket); if (!groupId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group ID is required' }, 400); await this.app.member(groupId, socket.data.caller.id); await socket.join(`group:${groupId}`); }); }
  @SubscribeMessage('project:join') projectJoin(@ConnectedSocket() socket: Socket, @MessageBody() projectId: string) { return this.ack(async () => { this.assertAuthenticated(socket); if (!projectId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Project ID is required' }, 400); await this.app.projectMember(projectId, socket.data.caller.id); await socket.join(`project:${projectId}`); }); }
  @SubscribeMessage('chat:send') chatSend(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; body: string }) { return this.ack(async () => { this.assertAuthenticated(socket); const messageBody = body?.body?.trim(); if (!body?.groupId || !messageBody) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group and message are required' }, 400); await this.app.member(body.groupId, socket.data.caller.id); const message = await this.app.prisma.chatMessage.create({ data: { groupId: body.groupId, senderId: socket.data.caller.id, body: messageBody } }); this.server.to(`group:${body.groupId}`).emit('chat:message', message); }); }
  @SubscribeMessage('sync:request') async reconcile(@ConnectedSocket() socket: Socket, @MessageBody() body: { projectId: string }) { await this.app.projectMember(body.projectId, socket.data.caller.id); const tasks = await this.app.prisma.task.findMany({ where: { projectId: body.projectId }, include: { assignments: { where: { active: true } } } }); return { projectId: body.projectId, tasks }; }

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
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const body = typeof response === 'string' ? { code: 'SOCKET_ERROR', message: response } : response as ApiError;
        return { ok: false, error: { code: body.code ?? 'SOCKET_ERROR', message: body.message ?? 'Socket request failed', ...(body.fields ? { fields: body.fields } : {}) } };
      }
      return { ok: false, error: { code: 'SOCKET_ERROR', message: 'Socket request failed' } };
    }
  }
}
