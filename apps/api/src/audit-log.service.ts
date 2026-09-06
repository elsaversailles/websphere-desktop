import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

export type AuditSeverity = 'info' | 'warning' | 'error';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(module: string, activity: string, severity: AuditSeverity, description: string, actorId?: string) {
    try {
      await (this.prisma as any).auditLog.create({ data: { module, activity, severity, description, actorId } });
    } catch {
      // Audit logging must never break the primary request flow.
    }
  }
}
