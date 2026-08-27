import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@websphere/shared';
import { AppService } from './app.service.js';
import { GROUP_SCOPE_KEY, IS_PUBLIC_KEY, PROJECT_SCOPE_KEY, ROLES_KEY } from './auth.decorators.js';

type AuthenticatedRequest = { headers: { authorization?: string }; user?: { id: string; role: Role; tv: number } };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly app: AppService) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.app.caller(request.headers.authorization);
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user && roles.includes(request.user.role)) return true;
    throw new ForbiddenException({ code: 'RBAC_FORBIDDEN', message: 'Your role does not grant this action' });
  }
}

@Injectable()
export class GroupScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly app: AppService) {}

  async canActivate(context: ExecutionContext) {
    const parameter = this.reflector.getAllAndOverride<string>(GROUP_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (!parameter) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    await this.app.member(request.params[parameter], request.user!.id);
    return true;
  }
}

@Injectable()
export class ProjectScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly app: AppService) {}

  async canActivate(context: ExecutionContext) {
    const parameter = this.reflector.getAllAndOverride<string>(PROJECT_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (!parameter) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    await this.app.projectMember(request.params[parameter], request.user!.id);
    return true;
  }
}
