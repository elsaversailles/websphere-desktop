import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@websphere/shared';
import { AppService } from './app.service.js';

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? true, credentials: true }, namespace: '/' })
export class RealtimeGateway {
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  private readonly presence = new Map<string, Set<string>>();
  constructor(private readonly app: AppService) {}
  async handleConnection(socket: Socket) { try { const token = socket.handshake.auth?.token; const caller = await this.app.caller(token ? `Bearer ${token}` : undefined); socket.data.caller = caller; this.presence.set(caller.id, new Set([...(this.presence.get(caller.id) ?? []), socket.id])); } catch { socket.disconnect(true); } }
  publishPollTally(groupId: string, tally: unknown) { this.server.to(`group:${groupId}`).emit('poll:tally', tally); }
  handleDisconnect(socket: Socket) { const userId = socket.data.caller?.id; if (!userId) return; const ids = this.presence.get(userId); ids?.delete(socket.id); if (!ids?.size) this.presence.delete(userId); }
  @SubscribeMessage('group:join') async groupJoin(@ConnectedSocket() socket: Socket, @MessageBody() groupId: string) { await this.app.member(groupId, socket.data.caller.id); await socket.join(`group:${groupId}`); return { ok: true }; }
  @SubscribeMessage('project:join') async projectJoin(@ConnectedSocket() socket: Socket, @MessageBody() projectId: string) { await this.app.projectMember(projectId, socket.data.caller.id); await socket.join(`project:${projectId}`); return { ok: true }; }
  @SubscribeMessage('chat:send') async chatSend(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; body: string }) { await this.app.member(body.groupId, socket.data.caller.id); const message = await this.app.prisma.chatMessage.create({ data: { groupId: body.groupId, senderId: socket.data.caller.id, body: body.body } }); this.server.to(`group:${body.groupId}`).emit('chat:message', message); return { ok: true }; }
  @SubscribeMessage('sync:request') async reconcile(@ConnectedSocket() socket: Socket, @MessageBody() body: { projectId: string }) { await this.app.projectMember(body.projectId, socket.data.caller.id); const tasks = await this.app.prisma.task.findMany({ where: { projectId: body.projectId }, include: { assignments: { where: { active: true } } } }); return { projectId: body.projectId, tasks }; }
}
