import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

@Injectable()
export class DomainEventsService extends EventEmitter {
  emitNotification(userId: string, notification: unknown) {
    this.emit('notification', userId, notification);
  }
  onNotification(listener: (userId: string, notification: unknown) => void) {
    this.on('notification', listener);
  }
}
