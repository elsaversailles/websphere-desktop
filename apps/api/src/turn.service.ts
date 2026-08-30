import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '@websphere/shared';
import { ConfigService } from './config.service.js';

@Injectable()
export class TurnService {
  constructor(private readonly config: ConfigService) {}

  iceServers(userId: string, now = Date.now()): IceServerConfig[] {
    const host = this.config.get('TURN_HOST');
    const secret = this.config.get('TURN_SHARED_SECRET');
    const stunUrl = this.config.get('TURN_STUN_URL') ?? (host ? `stun:${host}:3478` : 'stun:stun.l.google.com:19302');
    if (!host || !secret) {
      if (this.config.get('NODE_ENV') === 'production') throw new ServiceUnavailableException({ code: 'TURN_UNAVAILABLE', message: 'Call relay service is unavailable' });
      return [{ urls: stunUrl }];
    }
    const expiresAt = Math.floor(now / 1000) + this.config.get('TURN_CREDENTIAL_TTL_SECONDS');
    const username = `${expiresAt}:${userId}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return [
      { urls: stunUrl },
      { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`, `turns:${host}:5349?transport=tcp`], username, credential },
    ];
  }
}
