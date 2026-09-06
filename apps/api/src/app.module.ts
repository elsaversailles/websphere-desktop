import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { LocalStorageService } from './local-storage.service.js';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { ConfigService } from './config.service.js';
import { CryptoService } from './security.js';
import { EmailService } from './email.service.js';
import { TurnService } from './turn.service.js';
import { JobsService } from './jobs.service.js';
import { DomainEventsService } from './domain-events.service.js';
import { AuditLogService } from './audit-log.service.js';
import { MaintenanceGuard } from './maintenance.guard.js';
import { GroupScopeGuard, JwtAuthGuard, ProjectScopeGuard, RolesGuard } from './auth.guards.js';
@Module({ controllers: [AppController], providers: [AppService, RealtimeGateway, LocalStorageService, PrismaService, RedisService, ConfigService, CryptoService, EmailService, TurnService, JobsService, DomainEventsService, AuditLogService, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: MaintenanceGuard }, { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: GroupScopeGuard }, { provide: APP_GUARD, useClass: ProjectScopeGuard }] }) export class AppModule {}
