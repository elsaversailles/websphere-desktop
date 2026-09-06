import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@websphere/shared';
import { PrismaService } from './prisma.service.js';
import { IS_PUBLIC_KEY } from './auth.decorators.js';

type AuthenticatedRequest = { user?: { role: Role } };

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role === 'Administrator') return true;
    const setting = await (this.prisma as any).systemSetting.findUnique({ where: { key: 'maintenanceMode' } }).catch(() => null);
    const enabled = setting?.value === true || setting?.value?.enabled === true;
    if (enabled) throw new ServiceUnavailableException({ code: 'MAINTENANCE_MODE', message: 'WebSphere is temporarily unavailable for maintenance. Please try again shortly.' });
    return true;
  }
}
