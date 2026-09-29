import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

@Injectable()
export class DomainEventsService extends EventEmitter {
  /**
   * Live presence is owned by the websocket gateway, but HTTP handlers need to read it.
   * The gateway registers a provider here so AppService can ask "who is online?" without
   * depending on the gateway directly (which would close a dependency cycle).
   */
  private presenceProvider: (() => string[]) | null = null;

  emitNotification(userId: string, notification: unknown) {
    this.emit('notification', userId, notification);
  }
  onNotification(listener: (userId: string, notification: unknown) => void) {
    this.on('notification', listener);
  }
  /** Raised when a poll changes without an HTTP vote behind it (opened, closed by the leader, or timed out). */
  emitPollTally(groupId: string, tally: unknown) {
    this.emit('poll-tally', groupId, tally);
  }
  onPollTally(listener: (groupId: string, tally: unknown) => void) {
    this.on('poll-tally', listener);
  }
  registerPresenceProvider(provider: () => string[]) {
    this.presenceProvider = provider;
  }
  /** User IDs with at least one live socket on this instance. Empty when the gateway has not started. */
  onlineUserIds(): string[] {
    return this.presenceProvider?.() ?? [];
  }
}
