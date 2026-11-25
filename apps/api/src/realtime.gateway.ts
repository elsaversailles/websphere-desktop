import { randomUUID } from 'node:crypto';
import { chatMessageSchema } from '@websphere/shared';
import { HttpException, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Namespace, Server, Socket } from 'socket.io';
import type { AckDto, ApiError, CallHostAction, CallParticipant, CallSignal, ClientToServerEvents, ServerToClientEvents } from '@websphere/shared';
import { AppService } from './app.service.js';
import { RedisService } from './redis.service.js';
import { DomainEventsService } from './domain-events.service.js';

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? true, credentials: true }, namespace: '/' })
export class RealtimeGateway implements OnGatewayInit, OnApplicationShutdown {
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  private readonly presence = new Map<string, Set<string>>();
  private readonly activeCalls = new Map<string, { id: string; kind: 'voice' | 'video'; participants: Set<string>; grace?: ReturnType<typeof setTimeout> }>();
  private readonly callHosts = new Map<string, string>();
  private readonly raisedHands = new Map<string, Set<string>>();
  private adapterClients: Redis[] = [];
  constructor(private readonly app: AppService, private readonly redis: RedisService, private readonly events: DomainEventsService) {
    this.events.onNotification((userId, notification) => this.publishNotification(userId, notification));
    this.events.onPollTally((groupId, tally) => this.publishPollTally(groupId, tally));
    this.events.onGroupMembershipRevoked((groupId, userId) => { void this.revokeGroupAccess(groupId, userId).catch((error) => new Logger(RealtimeGateway.name).error('Could not revoke all live project rooms', error)); });
    this.events.onAccountArchived?.((userId) => {
      const audience = this.server.to(`user:${userId}`);
      audience.emit('account:archived');
      audience.disconnectSockets(true);
    });
    this.events.onTaskDeleted?.((projectId, id) => this.publishTaskUpdated(projectId, { projectId, id, deleted: true }));
    this.events.onAdminActivity?.((metric) => this.server.to('administrators').emit('admin:activity', metric));
    this.events.registerPresenceProvider(() => [...this.presence.keys()]);
  }
  async afterInit(server: Server | Namespace) {
    const publisher = this.redis.duplicateClient();
    const subscriber = this.redis.duplicateClient();
    this.adapterClients = [publisher, subscriber];
    await Promise.all([publisher.connect(), subscriber.connect()]);
    const ioServer = 'server' in server ? server.server : server;
    ioServer.adapter(createAdapter(publisher, subscriber));
  }
  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token;
    const authorize = async () => {
      const caller = await this.app.caller(token ? `Bearer ${token}` : undefined);
      if (!socket.connected) return;
      socket.data.caller = caller;
      await socket.join([`user:${caller.id}`, ...(caller.role === 'Administrator' ? ['administrators'] : [])]);
      if (!socket.connected) return;
      this.presence.set(caller.id, new Set([...(this.presence.get(caller.id) ?? []), socket.id]));
      socket.on('disconnecting', () => { void this.removeSocketFromCalls(socket); });
    };
    const disconnect = (error: unknown) => {
      if ((error instanceof HttpException ? error.getResponse() as { code?: string } : null)?.code === 'ACCOUNT_ARCHIVED') socket.emit('account:archived');
      socket.disconnect(true);
    };
    const ready = authorize();
    socket.use((_, next) => {
      void ready.then(() => this.app.validateSocketCaller(socket.data.caller)).then(() => next()).catch(disconnect);
    });
    try { await ready; } catch (error) { disconnect(error); }
  }
  publishPollTally(groupId: string, tally: unknown) { this.server.to(`group:${groupId}`).emit('poll:tally', tally); }
  /**
   * A kicked member's live sockets are still in the group room and would keep receiving its chat
   * broadcasts until they reloaded. Force them out of the group (and any active call) and tell the
   * client it was removed so it can navigate away immediately.
   */
  private async revokeGroupAccess(groupId: string, userId: string) {
    this.activeCalls.get(groupId)?.participants.delete(userId);
    const userRoom = `user:${userId}`;
    this.server.in(userRoom).socketsLeave(`group:${groupId}`);
    const callers = await this.server.in(userRoom).fetchSockets();
    for (const caller of callers) {
      if (caller.rooms.has(`call:${groupId}`)) await this.removeCallParticipant(groupId, caller.id);
    }
    this.server.in(userRoom).socketsLeave(`call:${groupId}`);
    this.server.to(userRoom).emit('group:removed', { groupId });
    const projects = await this.app.prisma.project.findMany({ where: { groupId }, select: { id: true } });
    for (const project of projects) this.server.in(userRoom).socketsLeave(`project:${project.id}`);
  }
  publishTaskUpdated(projectId: string, task: unknown) {
    this.server.to(`project:${projectId}`).emit('task:updated', task);
    this.server.to('administrators').emit('admin:activity', 'projects');
  }
  publishNotification(userId: string, notification: unknown) { this.server.to(`user:${userId}`).emit('notification:new', notification); }
  handleDisconnect(socket: Socket) { const userId = socket.data.caller?.id; if (!userId) return; const ids = this.presence.get(userId); ids?.delete(socket.id); if (!ids?.size) this.presence.delete(userId); }
  @SubscribeMessage('group:join') groupJoin(@ConnectedSocket() socket: Socket, @MessageBody() groupId: string) { return this.ack(async () => { this.assertAuthenticated(socket); if (!groupId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group ID is required' }, 400); await this.app.member(groupId, socket.data.caller.id); await socket.join(`group:${groupId}`); }); }
  @SubscribeMessage('project:join') projectJoin(@ConnectedSocket() socket: Socket, @MessageBody() projectId: string) { return this.ack(async () => { this.assertAuthenticated(socket); if (!projectId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Project ID is required' }, 400); await this.app.projectMember(projectId, socket.data.caller.id); await socket.join(`project:${projectId}`); }); }
  @SubscribeMessage('group:leave') leaveGroupRoom(@ConnectedSocket() socket: Socket, @MessageBody() groupId: string) {
    return this.ack(async () => { this.assertAuthenticated(socket); await socket.leave(`group:${groupId}`); });
  }
  @SubscribeMessage('project:leave') leaveProjectRoom(@ConnectedSocket() socket: Socket, @MessageBody() projectId: string) {
    return this.ack(async () => { this.assertAuthenticated(socket); await socket.leave(`project:${projectId}`); });
  }
  @SubscribeMessage('chat:send') chatSend(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; body: string }) { return this.ack(async () => { this.assertAuthenticated(socket); const parsed = chatMessageSchema.safeParse(body); if (!parsed.success) throw new HttpException({ code: 'VALIDATION_FAILED', message: parsed.error.issues[0].message }, 400); const messageBody = parsed.data.body; const senderId = socket.data.caller.id; await this.app.member(body.groupId, senderId); const message = await this.app.prisma.chatMessage.create({ data: { groupId: body.groupId, senderId, body: messageBody } }); this.server.to(`group:${body.groupId}`).emit('chat:message', message); await this.notifyGroupMessage(body.groupId, senderId); }); }

  /**
   * Tells every other member of the group that a new message landed, naming the group and the
   * sender so a notification is actionable on its own. Best-effort: a failed lookup must not fail
   * the send that already succeeded and broadcast.
   */
  private async notifyGroupMessage(groupId: string, senderId: string) {
    try {
      const [group, sender, members] = await Promise.all([
        this.app.prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
        this.app.prisma.user.findUnique({ where: { id: senderId }, select: { fullName: true } }),
        this.app.prisma.groupMember.findMany({ where: { groupId, userId: { not: senderId } }, select: { userId: true } }),
      ]);
      const recipients = members.map((member) => member.userId);
      if (!recipients.length) return;
      const groupName = group?.name ?? 'your group';
      const senderName = sender?.fullName ?? 'A member';
      await this.app.notify(recipients, 'group_activity', `${senderName} sent a new message in ${groupName}.`, groupId, 'chat');
    } catch { /* notification is a side effect; never fail the delivered message over it */ }
  }
  @SubscribeMessage('sync:request') async reconcile(@ConnectedSocket() socket: Socket, @MessageBody() body: { projectId: string }) { await this.app.projectMember(body.projectId, socket.data.caller.id); const tasks = await this.app.prisma.task.findMany({ where: { projectId: body.projectId }, include: { assignments: { where: { active: true } } } }); return { projectId: body.projectId, tasks }; }
  @SubscribeMessage('call:join') async callJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; kind: 'voice' | 'video'; muted?: boolean; cameraEnabled?: boolean; resumeId?: string }): Promise<AckDto & { callId?: string; participants?: CallParticipant[]; hostSocketId?: string; raisedHandSocketIds?: string[] }> {
    try {
      this.assertAuthenticated(socket);
      if (!body?.groupId || !['voice', 'video'].includes(body.kind)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'A group and call type are required' }, 400);
      if (body.muted !== undefined && typeof body.muted !== 'boolean') throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Invalid microphone state' }, 400);
      await this.app.member(body.groupId, socket.data.caller.id);
      const room = `call:${body.groupId}`;
      const alreadyJoined = socket.rooms.has(room);
      const userId = String(socket.data.caller.id);
      const active = this.activeCalls.get(body.groupId);
      if (body.resumeId && (!active || active.id !== body.resumeId || !active.participants.has(userId))) {
        throw new HttpException({ code: 'CALL_ENDED', message: 'That call is no longer available.', statusCode: 409 }, 409);
      }
      const roomSockets = (await this.server.in(room).fetchSockets()).filter((member) => member.id !== socket.id);
      const duplicate = roomSockets.find((member) => member.data.caller?.id === userId);
      if (duplicate && !body.resumeId) throw new HttpException({ code: 'CALL_ALREADY_JOINED', message: 'You are already in this call on another device.' }, 409);
      if (duplicate) await this.removeCallParticipant(body.groupId, duplicate.id, true);
      const members = roomSockets.filter((member) => member.id !== duplicate?.id);
      if (members.length >= 6) throw new HttpException({ code: 'CALL_FULL', message: 'This call has reached its six-participant limit' }, 409);
      if (body.resumeId && this.activeCalls.get(body.groupId)?.id !== body.resumeId) throw new HttpException({ code: 'CALL_ENDED', message: 'That call is no longer available.' }, 409);
      const call = this.activeCalls.get(body.groupId) ?? { id: randomUUID(), kind: body.kind, participants: new Set<string>() };
      const starting = !this.activeCalls.has(body.groupId);
      this.activeCalls.set(body.groupId, call);
      if (call.grace) clearTimeout(call.grace);
      call.grace = undefined;
      call.participants.add(userId);
      let profilesById = new Map<string, { fullName: string; avatarUrl: string | null }>();
      const identity = (userId: string) => profilesById.get(userId) ?? {};
      try {
        const profiles = await this.app.prisma.user.findMany({ where: { id: { in: [socket.data.caller.id, ...members.map((member) => String(member.data.caller?.id ?? ''))] } }, select: { id: true, fullName: true, avatarUrl: true, preference: { select: { profileVisibility: true } } } });
        profilesById = new Map(profiles.map((profile) => [profile.id, { fullName: profile.fullName, avatarUrl: profile.preference?.profileVisibility === false ? null : profile.avatarUrl }]));
      } catch { /* A missing display name must not prevent joining a call. */ }
      const participants = members.map((member) => ({ socketId: member.id, userId: String(member.data.caller?.id ?? ''), ...identity(member.data.caller?.id), muted: member.data.callMuteStates?.[body.groupId] === true, cameraEnabled: member.data.callCameraStates?.[body.groupId] }));
      const muted = body.muted === true;
      socket.data.callMuteStates = { ...socket.data.callMuteStates, [body.groupId]: muted };
      const cameraEnabled = call.kind === 'video' && body.kind === 'video' && body.cameraEnabled !== false;
      socket.data.callCameraStates = { ...socket.data.callCameraStates, [body.groupId]: cameraEnabled };
      await socket.join(room);
      const hostSocketId = this.callHosts.get(body.groupId) ?? socket.id;
      this.callHosts.set(body.groupId, hostSocketId);
      if (starting && !alreadyJoined && !participants.length) {
        void this.notifyGroupCall(body.groupId, socket.data.caller.id, body.kind, profilesById.get(socket.data.caller.id)?.fullName, socket.id);
      }
      if (!alreadyJoined) socket.to(room).emit('call:participant-joined', { groupId: body.groupId, participant: { socketId: socket.id, userId: socket.data.caller.id, ...identity(socket.data.caller.id), muted, cameraEnabled }, hostSocketId });
      return { ok: true, callId: call.id, participants, hostSocketId, raisedHandSocketIds: [...(this.raisedHands.get(body.groupId) ?? [])] };
    } catch (error) { return this.ackError(error); }
  }
  /** Persist invitations so offline group members receive the existing mobile/browser push. */
  private async notifyGroupCall(groupId: string, initiatorId: string, kind: 'voice' | 'video', fullName: string | undefined, initiatorSocketId: string) {
    try {
      const [group, members] = await Promise.all([
        this.app.prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
        this.app.prisma.groupMember.findMany({ where: { groupId, userId: { not: initiatorId } }, select: { userId: true } }),
      ]);
      for (const member of members) this.server.to(`user:${member.userId}`).emit('call:invite', { groupId, kind, initiatorUserId: initiatorId, initiatorSocketId });
      if (members.length) await this.app.notify(members.map((member) => member.userId), 'group_activity', `${fullName || 'A member'} started a ${kind} call in ${group?.name || 'your group'}.`, groupId, 'chat');
    } catch { /* Notification delivery must not interrupt an established call. */ }
  }
  @SubscribeMessage('call:leave') callLeave(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string }) { return this.ack(async () => { this.assertAuthenticated(socket); if (!body?.groupId) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Group ID is required' }, 400); this.activeCalls.get(body.groupId)?.participants.delete(String(socket.data.caller.id)); await this.removeCallParticipant(body.groupId, socket.id); }); }
  @SubscribeMessage('call:signal') async callSignal(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; targetSocketId: string; signal: CallSignal }) { return this.ack(async () => { this.assertAuthenticated(socket); if (!body?.groupId || !body?.targetSocketId || !body.signal || !['offer', 'answer', 'ice-candidate'].includes(body.signal.type)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Invalid call signal' }, 400); const room = `call:${body.groupId}`; if (!socket.rooms.has(room)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Join the call before signaling' }, 403); const recipients = await this.server.in(room).fetchSockets(); if (!recipients.some((recipient) => recipient.id === body.targetSocketId)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Call participant is unavailable' }, 403); this.server.to(body.targetSocketId).emit('call:signal', { groupId: body.groupId, fromSocketId: socket.id, signal: body.signal }); }); }
  @SubscribeMessage('call:screen-share') callScreenShare(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; sharing: boolean }) { return this.ack(async () => { this.assertAuthenticated(socket); if (!body?.groupId || typeof body.sharing !== 'boolean' || !socket.rooms.has(`call:${body.groupId}`)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Join the call before changing presentation state' }, 403); socket.to(`call:${body.groupId}`).emit('call:screen-share', { groupId: body.groupId, socketId: socket.id, sharing: body.sharing }); }); }
  @SubscribeMessage('call:camera-state') callCameraState(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; enabled: boolean }) { return this.ack(async () => {
    this.assertAuthenticated(socket);
    const room = `call:${body?.groupId}`;
    if (!body?.groupId || typeof body.enabled !== 'boolean' || !socket.rooms.has(room)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Join the call before changing camera state' }, 403);
    socket.data.callCameraStates = { ...socket.data.callCameraStates, [body.groupId]: body.enabled };
    socket.to(room).emit('call:camera-state', { groupId: body.groupId, socketId: socket.id, enabled: body.enabled });
  }); }
  @SubscribeMessage('call:mute-state') callMuteState(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; muted: boolean }) { return this.ack(async () => {
    this.assertAuthenticated(socket);
    const room = `call:${body?.groupId}`;
    if (!body?.groupId || typeof body.muted !== 'boolean' || !socket.rooms.has(room)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Join the call before changing microphone state' }, 403);
    socket.data.callMuteStates = { ...socket.data.callMuteStates, [body.groupId]: body.muted };
    socket.to(room).emit('call:mute-state', { groupId: body.groupId, socketId: socket.id, muted: body.muted });
  }); }
  @SubscribeMessage('call:raise-hand') callRaiseHand(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; raised: boolean }) { return this.ack(async () => {
    this.assertAuthenticated(socket);
    const room = `call:${body?.groupId}`;
    if (!body?.groupId || typeof body.raised !== 'boolean' || !socket.rooms.has(room)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Join the call before raising your hand' }, 403);
    const hands = this.raisedHands.get(body.groupId) ?? new Set<string>();
    if (body.raised) hands.add(socket.id);
    else hands.delete(socket.id);
    if (hands.size) this.raisedHands.set(body.groupId, hands);
    else this.raisedHands.delete(body.groupId);
    this.server.to(room).emit('call:raise-hand', { groupId: body.groupId, socketId: socket.id, raised: body.raised });
  }); }
  @SubscribeMessage('call:host-action') callHostAction(@ConnectedSocket() socket: Socket, @MessageBody() body: { groupId: string; action: CallHostAction; targetSocketId?: string }) { return this.ack(async () => {
    this.assertAuthenticated(socket);
    const room = `call:${body?.groupId}`;
    if (!body?.groupId || !['mute-all', 'remove-participant', 'end-call'].includes(body.action) || this.callHosts.get(body.groupId) !== socket.id || !socket.rooms.has(room)) throw new HttpException({ code: 'RBAC_FORBIDDEN', message: 'Only the meeting host can use this control' }, 403);
    if (body.action === 'mute-all') { socket.to(room).emit('call:mute-request', { groupId: body.groupId }); return; }
    if (body.action === 'end-call') { this.clearActiveCall(body.groupId); this.server.to(room).emit('call:ended', { groupId: body.groupId }); void this.notifyCallEnded(body.groupId); const members = await this.server.in(room).fetchSockets(); await Promise.all(members.map((member) => member.leave(room))); this.callHosts.delete(body.groupId); this.raisedHands.delete(body.groupId); return; }
    if (!body.targetSocketId || body.targetSocketId === socket.id) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Choose another participant to remove' }, 400);
    const target = (await this.server.in(room).fetchSockets()).find((member) => member.id === body.targetSocketId);
    if (!target) throw new HttpException({ code: 'NOT_FOUND', message: 'That participant has already left' }, 404);
    this.activeCalls.get(body.groupId)?.participants.delete(String(target.data.caller?.id));
    this.server.to(target.id).emit('call:removed', { groupId: body.groupId });
    await this.removeCallParticipant(body.groupId, target.id);
  }); }

  async onApplicationShutdown() {
    for (const id of this.activeCalls.keys()) this.clearActiveCall(id);
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
  private async removeCallParticipant(groupId: string, socketId: string, disconnected = false) {
    const room = `call:${groupId}`;
    const members = await this.server.in(room).fetchSockets();
    if (!disconnected && !members.some((member) => member.id === socketId)) return;
    await this.server.in(socketId).socketsLeave(room);
    this.server.to(room).emit('call:participant-left', { groupId, socketId });
    this.server.to(room).emit('call:screen-share', { groupId, socketId, sharing: false });
    const hands = this.raisedHands.get(groupId);
    if (hands?.delete(socketId)) this.server.to(room).emit('call:raise-hand', { groupId, socketId, raised: false });
    if (hands && !hands.size) this.raisedHands.delete(groupId);
    if (this.callHosts.get(groupId) !== socketId) return;
    const remaining = await this.server.in(room).fetchSockets();
    const nextHost = remaining[0]?.id ?? null;
    if (nextHost) this.callHosts.set(groupId, nextHost);
    else {
      this.callHosts.delete(groupId);
      const active = this.activeCalls.get(groupId);
      if (disconnected && active) {
        if (active.grace) clearTimeout(active.grace);
        active.grace = setTimeout(() => {
          if (this.activeCalls.get(groupId) !== active || this.callHosts.has(groupId)) return;
          this.clearActiveCall(groupId);
          void this.notifyCallEnded(groupId);
        }, 25_000);
        active.grace.unref();
      } else {
        this.clearActiveCall(groupId);
        void this.notifyCallEnded(groupId);
      }
    }
    this.server.to(room).emit('call:host-changed', { groupId, hostSocketId: nextHost });
  }
  private clearActiveCall(groupId: string) {
    const active = this.activeCalls.get(groupId);
    if (active?.grace) clearTimeout(active.grace);
    this.activeCalls.delete(groupId);
  }
  private async notifyCallEnded(groupId: string) {
    try {
      const members = await this.app.prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } });
      for (const member of members) this.server.to(`user:${member.userId}`).emit('call:ended', { groupId });
    } catch { /* Call cleanup must still finish if notification lookup is unavailable. */ }
  }
  private async removeSocketFromCalls(socket: Socket) {
    const rooms = [...socket.rooms].filter((room) => room.startsWith('call:'));
    await Promise.all(rooms.map((room) => this.removeCallParticipant(room.slice(5), socket.id, true)));
  }
}
