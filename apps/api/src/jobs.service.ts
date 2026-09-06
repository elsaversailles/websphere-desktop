import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from './config.service.js';

@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly recomputeAnalytics: Queue;

  constructor(config: ConfigService) {
    this.recomputeAnalytics = new Queue('recompute-analytics', { connection: { url: config.get('REDIS_URL') } });
  }

  async enqueueAnalyticsRecompute(projectId: string) {
    // Idempotent per (entity, window): one job id per project per 5-minute window collapses bursts of workflow events.
    const window = Math.floor(Date.now() / (5 * 60_000));
    await this.recomputeAnalytics.add('recompute', { projectId }, { jobId: `analytics:${projectId}:${window}` });
  }

  async onApplicationShutdown() {
    await this.recomputeAnalytics.close();
  }
}
