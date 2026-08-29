import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from './config.service.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
  }

  async ping() {
    if (this.client.status === 'wait') await this.client.connect();
    return this.client.ping();
  }

  private async connected() {
    if (this.client.status === 'wait') await this.client.connect();
  }

  async set(key: string, value: string, expiresInSeconds: number) {
    await this.connected();
    await this.client.set(key, value, 'EX', expiresInSeconds);
  }

  async take(key: string) {
    await this.connected();
    return this.client.getdel(key);
  }

  async get(key: string) {
    await this.connected();
    return this.client.get(key);
  }

  async delete(...keys: string[]) {
    if (!keys.length) return 0;
    await this.connected();
    return this.client.del(...keys);
  }

  async addToSet(key: string, value: string, expiresInSeconds: number) {
    await this.connected();
    await this.client.sadd(key, value);
    await this.client.expire(key, expiresInSeconds);
  }

  async removeFromSet(key: string, value: string) {
    await this.connected();
    await this.client.srem(key, value);
  }

  async setMembers(key: string) {
    await this.connected();
    return this.client.smembers(key);
  }

  async incrementWithExpiry(key: string, expiresInSeconds: number) {
    await this.connected();
    const results = await this.client.multi().incr(key).expire(key, expiresInSeconds).exec();
    return Number(results?.[0]?.[1]);
  }

  duplicateClient() {
    return this.client.duplicate({ lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
