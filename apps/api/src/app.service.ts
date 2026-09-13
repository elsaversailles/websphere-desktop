import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { completionRate, projectAnalytics, recommendations } from './analytics.js';
import { CryptoService, validatePassword } from './security.js';
import { connectors } from './connectors.js';
import { PrismaService } from './prisma.service.js';
import { ConfigService } from './config.service.js';
import { RedisService } from './redis.service.js';
import { EmailService } from './email.service.js';
import { JobsService } from './jobs.service.js';
import { DomainEventsService } from './domain-events.service.js';
import { AuditLogService } from './audit-log.service.js';

const Role = { Administrator: 'Administrator', Project_Leader: 'Project_Leader', Project_Member: 'Project_Member' } as const;
const ProjectRole = { Project_Leader: 'Project_Leader', Project_Member: 'Project_Member' } as const;
const WorkflowEventType = { status_change: 'status_change', task_completed: 'task_completed', assignment_change: 'assignment_change', progress_activity: 'progress_activity' } as const;
const NotificationType = { task_assignment: 'task_assignment' } as const;
type Role = (typeof Role)[keyof typeof Role];
type TaskStatus = 'pending' | 'ongoing' | 'for_review' | 'completed';
type ProviderId = 'google' | 'microsoft' | 'trello' | 'asana' | 'canva' | 'figma';
type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
const fail = (code: string, message: string, status: number = HttpStatus.BAD_REQUEST, fields?: Record<string, string>): never => { throw new HttpException({ code, message, ...(fields ? { fields } : {}) }, status); };
type Caller = { id: string; role: Role; tv: number };
const taskProgress = (status: string) => status === 'completed' ? 100 : status === 'for_review' ? 75 : status === 'ongoing' ? 50 : 0;

@Injectable()
export class AppService {
  readonly prisma: any;

  private readonly accessSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;
  private readonly crypto: CryptoService;
  private readonly config: ConfigService;
  private readonly redis: RedisService;
  private readonly email: EmailService;
  private readonly jobs: JobsService;
  private readonly events: DomainEventsService;
  private readonly audit: AuditLogService;

  constructor(prisma: PrismaService, config: ConfigService, crypto: CryptoService, redis: RedisService, email: EmailService, jobs: JobsService, events: DomainEventsService, audit: AuditLogService) {
    this.prisma = prisma;
    this.accessSecret = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET'));
    this.refreshSecret = new TextEncoder().encode(config.get('JWT_REFRESH_SECRET'));
    this.crypto = crypto;
    this.config = config;
    this.redis = redis;
    this.email = email;
    this.jobs = jobs;
    this.events = events;
    this.audit = audit;
  }
  private refreshKey(jti: string) { return `auth:refresh:${jti}`; }
  private usedRefreshKey(jti: string) { return `auth:refresh:used:${jti}`; }
  private userRefreshKey(userId: string) { return `auth:refresh:user:${userId}`; }
  private failedLoginKey(userId: string) { return `auth:login-failures:${userId}`; }
  private resetKey(token: string) { return `auth:password-reset:${token}`; }
  private userResetKey(userId: string) { return `auth:password-reset:user:${userId}`; }
  private refreshTtlSeconds() {
    const match = this.config.get('JWT_REFRESH_TTL').match(/^(\d+)(s|m|h|d)$/);
    if (!match) throw new Error('JWT_REFRESH_TTL must use a whole-number s, m, h, or d duration');
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'];
    return Number(match[1]) * unit;
  }
  private async sign(user: { id: string; role: Role; tokenVersion: number }, refresh = false, jti = randomBytes(16).toString('hex')) {
    return new SignJWT({ role: user.role, tv: user.tokenVersion, ...(refresh ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime(refresh ? this.config.get('JWT_REFRESH_TTL') : this.config.get('JWT_ACCESS_TTL')).sign(refresh ? this.refreshSecret : this.accessSecret);
  }
  async issue(user: { id: string; role: Role; tokenVersion: number }) { const jti = randomBytes(16).toString('hex'); const [access, refresh] = await Promise.all([this.sign(user), this.sign(user, true, jti)]); const ttl = this.refreshTtlSeconds(); await Promise.all([this.redis.set(this.refreshKey(jti), JSON.stringify({ userId: user.id }), ttl), this.redis.addToSet(this.userRefreshKey(user.id), jti, ttl)]); return { access, refresh, role: user.role }; }
  async caller(header?: string, options: { allowLocked?: boolean } = {}): Promise<Caller> { if (!header?.startsWith('Bearer ')) fail('AUTH_UNAUTHENTICATED', 'A valid access token is required', 401); try { const verified = await jwtVerify(header!.slice(7), this.accessSecret); const user = await this.prisma.user.findUnique({ where: { id: verified.payload.sub } }); const allowedStatus = user?.status === 'active' || (options.allowLocked && user?.status === 'locked'); if (!user || !allowedStatus || user.tokenVersion !== Number(verified.payload.tv)) fail('AUTH_UNAUTHENTICATED', 'Session is invalid', 401); return { id: user.id, role: user.role, tv: user.tokenVersion }; } catch (error) { if (error instanceof HttpException) throw error; return fail('AUTH_UNAUTHENTICATED', 'A valid access token is required', 401); } }
  async register(input: any) { const policy = validatePassword(input.password); if (!policy.ok) fail('VALIDATION_FAILED', `Password policy failed: ${policy.reason}`, 400, { password: policy.reason }); const exists = await this.prisma.user.findUnique({ where: { email: input.email } }); if (exists) fail('EMAIL_IN_USE', 'Email is already in use', 409, { email: 'already in use' }); const user = await this.prisma.user.create({ data: { ...input, passwordHash: await hash(input.password), password: undefined } as any }); await this.audit.log('AuthModule', 'account_registered', 'info', `New account registered for ${user.email}`, user.id); return { user: this.publicUser(user), ...(await this.issue(user)) }; }
  async login(email: string, password: string, admin = false) { const user = await this.prisma.user.findUnique({ where: { email } }); if (user?.status === 'locked') fail('ACCOUNT_LOCKED', 'Account is locked; use the email reset path', 423); if (!user || !(await verify(user.passwordHash, password))) { if (user) { const failures = await this.redis.incrementWithExpiry(this.failedLoginKey(user.id), this.config.get('LOGIN_WINDOW_SECONDS')); const locked = failures >= this.config.get('LOGIN_MAX_ATTEMPTS'); await this.prisma.user.update({ where: { id: user.id }, data: locked ? { failedLogins: failures, status: 'locked', lockedAt: new Date() } : { failedLogins: failures } }); if (locked) { await this.audit.log('AuthModule', 'account_locked', 'warning', `Account ${user.email} locked after repeated failed logins`, user.id); fail('ACCOUNT_LOCKED', 'Account is locked; use the email reset path', 423); } } await this.audit.log('AuthModule', 'login_failed', 'warning', `Failed login attempt for ${email}`); fail('AUTH_INVALID_CREDENTIALS', 'Invalid email or password', 401); } if (user.status !== 'active') fail('AUTH_UNAUTHENTICATED', 'Account is inactive', 401); if (admin && user.role !== Role.Administrator) { await this.audit.log('AuthModule', 'admin_login_denied', 'warning', `Non-administrator ${user.email} attempted admin login`, user.id); fail('ADMIN_UNAUTHORIZED', 'Administrator access is required', 403); } await Promise.all([this.redis.delete(this.failedLoginKey(user.id)), this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0 } })]); await this.audit.log('AuthModule', admin ? 'admin_login' : 'login', 'info', `${user.email} signed in`, user.id); return { user: this.publicUser(user), ...(await this.issue(user)) }; }
  async refreshToken(token: string) { try { const verified = await jwtVerify(token, this.refreshSecret); const subject = verified.payload.sub; if (!subject) fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); const jti = String(verified.payload.jti); const stored = await this.redis.take(this.refreshKey(jti)); if (!stored) { if (await this.redis.get(this.usedRefreshKey(jti))) await this.prisma.user.update({ where: { id: subject }, data: { tokenVersion: { increment: 1 } } }); fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); } const record = JSON.parse(stored!) as { userId: string }; if (record.userId !== subject) fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); const user = await this.prisma.user.findUnique({ where: { id: record.userId } }); if (!user || user.status !== 'active' || user.tokenVersion !== Number(verified.payload.tv)) { await this.redis.removeFromSet(this.userRefreshKey(record.userId), jti); fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); } const ttl = this.refreshTtlSeconds(); await Promise.all([this.redis.set(this.usedRefreshKey(jti), '1', ttl), this.redis.removeFromSet(this.userRefreshKey(record.userId), jti)]); return this.issue(user); } catch (error) { if (error instanceof HttpException) throw error; return fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); } }
  private async removeRefreshSessions(userId: string) { const key = this.userRefreshKey(userId); const jtis = await this.redis.setMembers(key); await this.redis.delete(...jtis.map((jti) => this.refreshKey(jti)), key); }
  async logout(user: Caller) { await this.removeRefreshSessions(user.id); await this.prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } }); await this.audit.log('AuthModule', 'logout', 'info', 'User signed out and invalidated all sessions', user.id); return { ok: true }; }
  async changePassword(user: Caller, oldPassword: string, password: string, confirm: string) { if (password !== confirm) fail('VALIDATION_FAILED', 'Password confirmation does not match', 400, { confirm: 'mismatch' }); const entity = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }); if (entity.status === 'locked') fail('ACCOUNT_LOCKED', 'Use the email reset path for locked accounts', 423); if (!(await verify(entity.passwordHash, oldPassword))) fail('PASSWORD_INCORRECT', 'Current password is incorrect'); const policy = validatePassword(password); if (!policy.ok) fail('VALIDATION_FAILED', `Password policy failed: ${policy.reason}`, 400, { password: policy.reason }); await this.removeRefreshSessions(user.id); await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(password), tokenVersion: { increment: 1 } } }); return { ok: true }; }
  async forgot(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status !== 'locked') return { ok: true };
    const oldToken = await this.redis.get(this.userResetKey(user.id));
    if (oldToken) await this.redis.delete(this.resetKey(oldToken));
    const token = randomBytes(32).toString('hex');
    const ttl = this.config.get('PASSWORD_RESET_TTL_SECONDS');
    await Promise.all([
      this.redis.set(this.resetKey(token), user.id, ttl),
      this.redis.set(this.userResetKey(user.id), token, ttl),
    ]);
    try {
      const delivered = await this.email.sendPasswordReset(user.email, token);
      return { ok: true, ...(delivered ? {} : { resetToken: token }) };
    } catch (error) {
      await this.redis.delete(this.resetKey(token), this.userResetKey(user.id));
      throw error;
    }
  }
  async resetPassword(token: string, password: string, confirm: string) {
    if (password !== confirm) fail('VALIDATION_FAILED', 'Password confirmation does not match', 400, { confirm: 'mismatch' });
    const policy = validatePassword(password);
    if (!policy.ok) fail('VALIDATION_FAILED', `Password policy failed: ${policy.reason}`, 400, { password: policy.reason });
    const userId = await this.redis.take(this.resetKey(token));
    if (!userId) fail('AUTH_UNAUTHENTICATED', 'Reset token is invalid or expired', 401);
    const lockedUserId = userId!;
    await Promise.all([
      this.removeRefreshSessions(lockedUserId),
      this.redis.delete(this.failedLoginKey(lockedUserId), this.userResetKey(lockedUserId)),
      this.prisma.user.update({ where: { id: lockedUserId }, data: { passwordHash: await hash(password), status: 'active', lockedAt: null, failedLogins: 0, tokenVersion: { increment: 1 } } }),
    ]);
    return { ok: true };
  }
  publicUser(user: any) { const { passwordHash, ...safe } = user; return safe; }
  async me(caller: Caller) { return this.publicUser(await this.prisma.user.findUniqueOrThrow({ where: { id: caller.id } })); }
  async updateMe(caller: Caller, input: any) { if (input.email) { const duplicate = await this.prisma.user.findFirst({ where: { email: input.email, NOT: { id: caller.id } } }); if (duplicate) fail('EMAIL_IN_USE', 'Email is already in use', 409, { email: 'already in use' }); } return this.publicUser(await this.prisma.user.update({ where: { id: caller.id }, data: input })); }
  async member(groupId: string, userId: string, leader = false) { const membership = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }); if (!membership || (leader && membership.role !== ProjectRole.Project_Leader)) fail('RBAC_FORBIDDEN', 'Group membership does not grant this action', 403); return membership; }
  async projectMember(projectId: string, userId: string, leader = false) { const membership = await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } }); if (!membership || (leader && membership.role !== ProjectRole.Project_Leader)) fail('RBAC_FORBIDDEN', 'Project membership does not grant this action', 403); return membership; }
  code() { return `${randomBytes(3).toString('hex').slice(0, 3)}-${randomBytes(3).toString('hex').slice(0, 3)}-${randomBytes(3).toString('hex').slice(0, 3)}`; }
  async createGroup(caller: Caller, name: string) { const group = await this.prisma.group.create({ data: { name, createdBy: caller.id, members: { create: { userId: caller.id, role: ProjectRole.Project_Leader } } } }); let code = this.code(); while (await this.prisma.joinCode.findUnique({ where: { code } })) code = this.code(); await this.prisma.joinCode.create({ data: { groupId: group.id, code, expiresAt: new Date(Date.now() + 30 * 864e5) } }); return { ...group, joinCode: code }; }
  async joinGroup(caller: Caller, code: string) { const entry = await this.prisma.joinCode.findUnique({ where: { code }, include: { group: true } }); if (!entry || !entry.active || (entry.expiresAt && entry.expiresAt < new Date())) fail('INVALID_JOIN_CODE', 'Join code is invalid or expired', 400); await this.prisma.groupMember.upsert({ where: { groupId_userId: { groupId: entry.groupId, userId: caller.id } }, update: {}, create: { groupId: entry.groupId, userId: caller.id } }); return entry.group; }
  async groups(caller: Caller) { return this.prisma.group.findMany({ where: { members: { some: { userId: caller.id } } }, include: { members: { where: { userId: caller.id }, select: { role: true } }, _count: { select: { projects: true, ideas: true } } } }); }
  async group(caller: Caller, id: string) { await this.member(id, caller.id); return this.prisma.group.findUniqueOrThrow({ where: { id }, include: { members: { include: { user: { select: { id: true, fullName: true, avatarUrl: true } } } }, joinCodes: { where: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { id: 'desc' }, take: 1 }, projects: true, ideas: true } }); }
  async addGroupMember(caller: Caller, groupId: string, userId: string) { await this.member(groupId, caller.id); return this.prisma.groupMember.upsert({ where: { groupId_userId: { groupId, userId } }, update: {}, create: { groupId, userId } }); }
  async addGroupMemberByEmail(caller: Caller, groupId: string, email: string) { const user = await this.prisma.user.findUnique({ where: { email } }); if (!user) fail('NOT_FOUND', 'No registered account uses that email address', 404); return this.addGroupMember(caller, groupId, user.id); }
  async removeGroupMember(caller: Caller, groupId: string, userId: string) { await this.member(groupId, caller.id, true); await this.prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId } } }); return { ok: true }; }
  async createProject(caller: Caller, input: any) { await this.member(input.groupId, caller.id); const memberIds = [...new Set([caller.id, ...(input.memberIds ?? [])])]; for (const userId of memberIds) await this.member(input.groupId, userId); return this.prisma.project.create({ data: { ...input, createdBy: caller.id, members: { create: memberIds.map((userId) => ({ userId, role: userId === caller.id ? ProjectRole.Project_Leader : ProjectRole.Project_Member })) } }, include: { members: true } }); }
  async projects(caller: Caller) { return this.prisma.project.findMany({ where: { members: { some: { userId: caller.id } } }, include: { group: true, members: { where: { userId: caller.id } }, tasks: true } }); }
  async project(caller: Caller, id: string) { await this.projectMember(id, caller.id); return this.prisma.project.findUniqueOrThrow({ where: { id }, include: { group: { include: { members: { include: { user: { select: { id: true, fullName: true } } } } } }, members: { include: { user: { select: { id: true, fullName: true } } } }, tasks: { include: { assignments: { where: { active: true } } } } } }); }
  async updateProject(caller: Caller, id: string, input: any) { await this.projectMember(id, caller.id, true); const { memberIds, ...data } = input; return this.prisma.project.update({ where: { id }, data }); }
  async addProjectMember(caller: Caller, projectId: string, userId: string) { await this.projectMember(projectId, caller.id, true); const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { groupId: true } }); await this.member(project.groupId, userId); return this.prisma.projectMember.upsert({ where: { projectId_userId: { projectId, userId } }, update: {}, create: { projectId, userId, role: ProjectRole.Project_Member } }); }
  async updateResponsibility(caller: Caller, projectId: string, userId: string, responsibility: string) { await this.projectMember(projectId, caller.id, true); await this.projectMember(projectId, userId); return this.prisma.projectMember.update({ where: { projectId_userId: { projectId, userId } }, data: { responsibility } }); }
  async projectProgress(caller: Caller, id: string) { await this.projectMember(id, caller.id); const project = await this.prisma.project.findUniqueOrThrow({ where: { id }, include: { tasks: true } }); const analytics = projectAnalytics(project.tasks, project.deadline); return { progress: completionRate(project.tasks.filter((t) => t.status === 'completed').length, project.tasks.length), onTrack: analytics.riskLevel === 'on_track', ...analytics }; }
  async createTask(caller: Caller, projectId: string, input: any) { await this.projectMember(projectId, caller.id, true); return this.prisma.task.create({ data: { ...input, projectId, createdBy: caller.id } }); }
  async task(caller: Caller, id: string) {
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id }, include: { assignments: { where: { active: true } }, project: true } });
    await this.projectMember(task.projectId, caller.id);
    const assignment = task.assignments[0];
    const [assignee, assigner] = assignment ? await Promise.all([this.prisma.user.findUnique({ where: { id: assignment.assigneeId }, select: { id: true, fullName: true } }), this.prisma.user.findUnique({ where: { id: assignment.assignerId }, select: { id: true, fullName: true } })]) : [null, null];
    return { ...task, assignee, assigner, progress: taskProgress(task.status) };
  }
  async updateTask(caller: Caller, id: string, input: any) { const task = await this.task(caller, id); await this.projectMember(task.projectId, caller.id, true); return this.prisma.task.update({ where: { id }, data: input }); }
  async assignTask(caller: Caller, id: string, assigneeId: string) { const task = await this.task(caller, id); await this.projectMember(task.projectId, caller.id, true); await this.projectMember(task.projectId, assigneeId); await this.prisma.$transaction([this.prisma.taskAssignment.updateMany({ where: { taskId: id, active: true }, data: { active: false } }), this.prisma.taskAssignment.create({ data: { taskId: id, assigneeId, assignerId: caller.id } }), this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId: id, actorId: caller.id, type: WorkflowEventType.assignment_change, toValue: assigneeId } })]); await this.jobs.enqueueAnalyticsRecompute(task.projectId); return this.notify([assigneeId], NotificationType.task_assignment, `You were assigned “${task.title}”`, id, 'task'); }
  async taskStatus(caller: Caller, id: string, status: TaskStatus) { const task = await this.task(caller, id); const assignment = await this.prisma.taskAssignment.findFirst({ where: { taskId: id, assigneeId: caller.id, active: true } }); if (!assignment) fail('RBAC_FORBIDDEN', 'Only the active assignee can change task status', 403); const now = new Date(); const updated = await this.prisma.task.update({ where: { id }, data: { status, ...(status === 'ongoing' && !task.startedAt ? { startedAt: now } : {}), ...(status === 'completed' ? { completedAt: now } : {}) } }); await this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId: id, actorId: caller.id, type: status === 'completed' ? WorkflowEventType.task_completed : WorkflowEventType.status_change, fromValue: task.status, toValue: status } }); await this.jobs.enqueueAnalyticsRecompute(task.projectId); return updated; }
  async myTasks(caller: Caller, filter: any) {
    const tasks = await this.prisma.task.findMany({ where: { assignments: { some: { assigneeId: caller.id, active: true } }, ...(filter.projectId ? { projectId: filter.projectId } : {}), ...(filter.status ? { status: filter.status } : {}) }, orderBy: filter.sort === 'deadline' ? { deadline: 'asc' } : { createdAt: 'desc' }, include: { project: { select: { id: true, title: true } }, assignments: { where: { assigneeId: caller.id, active: true }, take: 1 } } });
    const assignerIds = [...new Set(tasks.map((task: any) => task.assignments[0]?.assignerId).filter(Boolean))];
    const assigners = assignerIds.length ? await this.prisma.user.findMany({ where: { id: { in: assignerIds } }, select: { id: true, fullName: true } }) : [];
    const assignerName = (id?: string) => assigners.find((user: any) => user.id === id)?.fullName ?? 'Unassigned';
    return tasks.map((task: any) => ({ ...task, project: task.project, assignedBy: assignerName(task.assignments[0]?.assignerId), progress: taskProgress(task.status) }));
  }
  async tracker(caller: Caller, projectId: string) { await this.projectMember(projectId, caller.id); const tasks = await this.prisma.task.findMany({ where: { projectId } }); const counts = Object.fromEntries(['pending', 'ongoing', 'for_review', 'completed'].map((status) => [status, tasks.filter((task) => task.status === status).length])); return { ...counts, total: tasks.length, progress: completionRate(counts.completed, tasks.length) }; }
  async taskTracker(caller: Caller) {
    const [tasks, connections, workflow, usage] = await Promise.all([
      this.prisma.task.findMany({
        where: { project: { members: { some: { userId: caller.id } } } },
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { id: true, title: true, members: { include: { user: { select: { id: true, fullName: true, avatarUrl: true } } } } } },
          assignments: { where: { active: true } },
          linkedResources: { include: { connection: { include: { tool: true } } }, orderBy: { createdAt: 'desc' } },
          workflow: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.toolConnection.findMany({ where: { userId: caller.id }, include: { tool: true }, orderBy: { lastSyncedAt: 'desc' } }),
      this.prisma.workflowEvent.findMany({ where: { project: { members: { some: { userId: caller.id } } } }, orderBy: { createdAt: 'desc' }, take: 24, include: { task: { select: { id: true, title: true } }, project: { select: { title: true } } } }),
      this.prisma.toolUsage.findMany({ where: { connection: { userId: caller.id } }, orderBy: { createdAt: 'desc' }, take: 24, include: { connection: { include: { tool: true } } } }),
    ]);
    const actorIds = [...new Set(workflow.map((event: any) => event.actorId))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, avatarUrl: true } }) : [];
    const taskItems = tasks.map((task: any) => {
      const resourceDates = task.linkedResources.map((resource: any) => new Date(resource.createdAt).getTime());
      const latest = Math.max(new Date(task.createdAt).getTime(), task.startedAt ? new Date(task.startedAt).getTime() : 0, task.completedAt ? new Date(task.completedAt).getTime() : 0, task.workflow[0] ? new Date(task.workflow[0].createdAt).getTime() : 0, ...resourceDates);
      const callerMembership = task.project.members.find((member: any) => member.userId === caller.id);
      const canUpdateStatus = task.assignments.some((assignment: any) => assignment.assigneeId === caller.id);
      const canAssign = callerMembership?.role === ProjectRole.Project_Leader;
      return {
        id: task.id, title: task.title, description: task.description, deadline: task.deadline, priority: task.priority, status: task.status,
        progress: taskProgress(task.status), createdAt: task.createdAt, latestActivityAt: new Date(latest), project: { id: task.project.id, title: task.project.title },
        resources: task.linkedResources.map((resource: any) => ({ id: resource.id, connectionId: resource.connectionId, title: resource.title, externalUrl: resource.externalUrl, provider: resource.connection.provider, platform: resource.connection.tool.name, category: resource.connection.tool.category, createdAt: resource.createdAt })),
        assignees: task.assignments.map((assignment: any) => task.project.members.find((member: any) => member.userId === assignment.assigneeId)?.user).filter(Boolean),
        canUpdateStatus,
        canAssign,
        canEditResource: canUpdateStatus || canAssign,
        collaborators: task.project.members.map((member: any) => ({ id: member.user.id, fullName: member.user.fullName, avatarUrl: member.user.avatarUrl })),
      };
    });
    const workflowActivity = workflow.map((event: any) => ({
      id: `workflow-${event.id}`, kind: 'workflow', type: event.type, taskTitle: event.task?.title ?? null, projectTitle: event.project.title,
      actor: actors.find((actor: any) => actor.id === event.actorId) ?? null, fromValue: event.fromValue, toValue: event.toValue, createdAt: event.createdAt,
    }));
    const usageActivity = usage.map((event: any) => ({
      id: `usage-${event.id}`, kind: 'integration', action: event.action, platform: event.connection.tool.name, provider: event.connection.provider, createdAt: event.createdAt,
    }));
    return {
      tasks: taskItems,
      connections: connections.map((connection: any) => ({ id: connection.id, provider: connection.provider, platform: connection.tool.name, category: connection.tool.category, status: connection.status, syncState: connection.syncState, lastSyncedAt: connection.lastSyncedAt })),
      activity: [...workflowActivity, ...usageActivity].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 24),
    };
  }
  async linkTaskResource(caller: Caller, taskId: string, input: { connectionId: string; title: string; externalUrl: string }) {
    const task = await this.task(caller, taskId);
    const connection = await this.prisma.toolConnection.findFirst({ where: { id: input.connectionId, userId: caller.id, status: 'connected' }, include: { tool: true } });
    if (!connection) fail('INTEGRATION_UNAVAILABLE', 'Choose one of your connected integrations before linking a file', 400);
    const resource = await this.prisma.linkedResource.create({ data: { connectionId: connection.id, projectId: task.projectId, taskId, externalId: randomBytes(12).toString('hex'), title: input.title, externalUrl: input.externalUrl }, include: { connection: { include: { tool: true } } } });
    await Promise.all([
      this.prisma.toolUsage.create({ data: { connectionId: connection.id, action: `Linked “${resource.title}” to “${task.title}”` } }),
      this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId, actorId: caller.id, type: WorkflowEventType.progress_activity, fromValue: 'resource_linked', toValue: resource.title } }),
    ]);
    return { id: resource.id, connectionId: resource.connectionId, title: resource.title, externalUrl: resource.externalUrl, provider: connection.provider, platform: connection.tool.name, category: connection.tool.category, createdAt: resource.createdAt };
  }
  async updateLinkedResource(caller: Caller, resourceId: string, input: { connectionId: string; title: string; externalUrl: string; assigneeId?: string; status?: TaskStatus }) {
    const resource = await this.prisma.linkedResource.findUniqueOrThrow({ where: { id: resourceId }, include: { task: { include: { assignments: { where: { active: true } }, project: { include: { members: true } } } } } });
    if (!resource.task) fail('VALIDATION_FAILED', 'Only task-linked resources can be edited here', 400);
    const task = resource.task;
    const membership = await this.projectMember(task.projectId, caller.id);
    const activeAssignment = task.assignments[0];
    const isAssignee = activeAssignment?.assigneeId === caller.id;
    const isLeader = membership.role === ProjectRole.Project_Leader;
    if (!isAssignee && !isLeader) fail('RBAC_FORBIDDEN', 'Only the active assignee or project leader can edit this file link', 403);
    if (input.assigneeId && input.assigneeId !== activeAssignment?.assigneeId && !isLeader) fail('RBAC_FORBIDDEN', 'Only the project leader can reassign a task', 403);
    if (input.status && input.status !== task.status && !isAssignee) fail('RBAC_FORBIDDEN', 'Only the active assignee can change task status', 403);
    if (input.assigneeId) await this.projectMember(task.projectId, input.assigneeId);
    const connection = await this.prisma.toolConnection.findFirst({ where: { id: input.connectionId, userId: caller.id, status: 'connected' }, include: { tool: true } });
    if (!connection) fail('INTEGRATION_UNAVAILABLE', 'Choose one of your connected integrations before saving the file link', 400);
    const now = new Date();
    const reassigned = input.assigneeId && input.assigneeId !== activeAssignment?.assigneeId;
    const changedStatus = input.status && input.status !== task.status;
    await this.prisma.$transaction([
      this.prisma.linkedResource.update({ where: { id: resource.id }, data: { connectionId: connection.id, title: input.title, externalUrl: input.externalUrl } }),
      ...(reassigned ? [this.prisma.taskAssignment.updateMany({ where: { taskId: task.id, active: true }, data: { active: false } }), this.prisma.taskAssignment.create({ data: { taskId: task.id, assigneeId: input.assigneeId, assignerId: caller.id } }), this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId: task.id, actorId: caller.id, type: WorkflowEventType.assignment_change, fromValue: activeAssignment?.assigneeId, toValue: input.assigneeId } })] : []),
      ...(changedStatus ? [this.prisma.task.update({ where: { id: task.id }, data: { status: input.status, ...(input.status === 'ongoing' && !task.startedAt ? { startedAt: now } : {}), ...(input.status === 'completed' ? { completedAt: now } : {}) } }), this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId: task.id, actorId: caller.id, type: input.status === 'completed' ? WorkflowEventType.task_completed : WorkflowEventType.status_change, fromValue: task.status, toValue: input.status } })] : []),
    ]);
    await this.prisma.toolUsage.create({ data: { connectionId: connection.id, action: `Updated “${input.title}” linked to “${task.title}”` } });
    if (changedStatus || reassigned) await this.jobs.enqueueAnalyticsRecompute(task.projectId);
    return { ok: true, taskId: task.id, projectId: task.projectId };
  }
  async launchResource(caller: Caller, resourceId: string) {
    const resource = await this.prisma.linkedResource.findUniqueOrThrow({ where: { id: resourceId }, include: { connection: { include: { tool: true } } } });
    if (resource.connection.userId !== caller.id) fail('RBAC_FORBIDDEN', 'This linked file belongs to another user connection', 403);
    if (resource.taskId) await this.task(caller, resource.taskId);
    else if (resource.projectId) await this.projectMember(resource.projectId, caller.id);
    const externalUrl = await connectors[resource.connection.provider as ProviderId].launchUrl({ projectId: resource.projectId ?? undefined, taskId: resource.taskId ?? undefined, externalId: resource.externalId, title: resource.title, externalUrl: resource.externalUrl });
    await this.prisma.toolUsage.create({ data: { connectionId: resource.connectionId, action: `Opened “${resource.title}”` } });
    return { externalUrl, platform: resource.connection.tool.name };
  }
  async syncIntegration(caller: Caller, connectionId: string) {
    const connection = await this.prisma.toolConnection.findFirst({ where: { id: connectionId, userId: caller.id }, include: { tool: true } });
    if (!connection || connection.status !== 'connected') fail('INTEGRATION_UNAVAILABLE', 'This integration is not connected', 400);
    let result: { summary: string } = { summary: 'synchronized' };
    try { result = await connectors[connection.provider as ProviderId].sync(); }
    catch { fail('INTEGRATION_SYNC_FAILED', `Could not sync ${connection.tool.name}. Try again shortly.`, 502); }
    const updated = await this.prisma.toolConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date(), syncState: result.summary } });
    await this.prisma.toolUsage.create({ data: { connectionId: connection.id, action: `Synced ${connection.tool.name}` } });
    return { ...updated, platform: connection.tool.name, summary: result.summary };
  }
  async idea(caller: Caller, groupId: string, input: any) { await this.member(groupId, caller.id); return this.prisma.idea.create({ data: { ...input, groupId, authorId: caller.id } }); }
  async ideas(caller: Caller, groupId: string) { await this.member(groupId, caller.id); return this.prisma.idea.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' } }); }
  async reviseIdea(caller: Caller, id: string, input: any) { const idea = await this.prisma.idea.findUniqueOrThrow({ where: { id } }); if (idea.authorId !== caller.id || idea.status === 'selected') fail('RBAC_FORBIDDEN', 'Only the author can revise an unselected idea', 403); return this.prisma.idea.update({ where: { id }, data: { ...input, status: 'refined' } }); }
  async rejectIdea(caller: Caller, id: string) { const idea = await this.prisma.idea.findUniqueOrThrow({ where: { id } }); if (idea.authorId !== caller.id || idea.status === 'selected') fail('RBAC_FORBIDDEN', 'Only the author can reject an unselected idea', 403); return this.prisma.idea.update({ where: { id }, data: { status: 'rejected' } }); }
  async mergeIdeas(caller: Caller, groupId: string, ideaIds: string[]) {
    await this.member(groupId, caller.id);
    const ideas = await this.prisma.idea.findMany({ where: { id: { in: ideaIds }, groupId } });
    if (ideas.length < 2) fail('VALIDATION_FAILED', 'Choose at least two group ideas to merge');
    const prompt = `Merge these related academic project ideas into a single, coherent idea. Respond with a short title on the first line and a combined description below.\n\n${ideas.map((idea: any, index: number) => `Idea ${index + 1} — ${idea.title}: ${idea.body}`).join('\n\n')}`;
    const result = await this.ai(caller, prompt, { scopeType: 'group', scopeId: groupId });
    const [firstLine, ...rest] = result.response.split('\n').filter((line: string) => line.trim().length);
    return { title: (firstLine ?? ideas[0].title).replace(/^title:\s*/i, '').trim(), body: rest.join('\n').trim() || result.response, refused: result.refused, sourceIdeaIds: ideas.map((idea: any) => idea.id) };
  }
  async openPoll(caller: Caller, groupId: string, ideaIds: string[]) { await this.member(groupId, caller.id); const ideas = await this.prisma.idea.findMany({ where: { id: { in: ideaIds }, groupId } }); if (ideas.length !== ideaIds.length) fail('VALIDATION_FAILED', 'Every poll option must be a group idea'); return this.prisma.ideaPoll.create({ data: { groupId, createdBy: caller.id, options: { create: ideas.map((idea) => ({ ideaId: idea.id, label: idea.title })) } }, include: { options: true } }); }
  async vote(caller: Caller, pollId: string, optionId: string) { const poll = await this.prisma.ideaPoll.findUniqueOrThrow({ where: { id: pollId }, include: { options: true } }); await this.member(poll.groupId, caller.id); if (!poll.open || !poll.options.some((option) => option.id === optionId)) fail('VALIDATION_FAILED', 'Poll is closed or option is invalid'); await this.prisma.vote.upsert({ where: { pollId_voterId: { pollId, voterId: caller.id } }, update: { optionId }, create: { pollId, optionId, voterId: caller.id } }); return this.tally(pollId); }
  async tally(pollId: string, viewerId?: string) { const [poll, viewerVote] = await Promise.all([this.prisma.ideaPoll.findUniqueOrThrow({ where: { id: pollId }, include: { options: { include: { votes: { include: { voter: { select: { id: true, fullName: true } } } } } } } }), viewerId ? this.prisma.vote.findUnique({ where: { pollId_voterId: { pollId, voterId: viewerId } }, select: { optionId: true } }) : Promise.resolve(null)]); return { pollId, groupId: poll.groupId, open: poll.open, viewerOptionId: viewerVote?.optionId ?? null, options: poll.options.map((option) => ({ optionId: option.id, ideaId: option.ideaId, label: option.label, votes: option.votes.length, voters: option.votes.map((vote: any) => ({ userId: vote.voter.id, fullName: vote.voter.fullName })) })) }; }
  async pollResults(caller: Caller, pollId: string) { const poll = await this.prisma.ideaPoll.findUniqueOrThrow({ where: { id: pollId }, select: { groupId: true } }); await this.member(poll.groupId, caller.id); return this.tally(pollId, caller.id); }
  async begin(caller: Caller, groupId: string, ideaId: string) { await this.member(groupId, caller.id, true); const idea = await this.prisma.idea.findFirst({ where: { id: ideaId, groupId } }); if (!idea) fail('NOT_FOUND', 'Idea does not belong to group', 404); if (idea.status === 'selected') fail('VALIDATION_FAILED', 'Idea has already been selected'); const members = await this.prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } }); const project = await this.prisma.project.create({ data: { groupId, ideaId, title: idea.title, description: idea.body, createdBy: caller.id, members: { create: members.map((member) => ({ userId: member.userId, role: member.userId === caller.id ? ProjectRole.Project_Leader : ProjectRole.Project_Member })) } } }); await this.prisma.idea.update({ where: { id: ideaId }, data: { status: 'selected' } }); return project; }
  async calendar(caller: Caller, from?: string, to?: string) { const events = await this.prisma.calendarEvent.findMany({ where: { ownerId: caller.id, ...(from || to ? { startAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) } }); const projects = await this.prisma.project.findMany({ where: { members: { some: { userId: caller.id } }, deadline: { not: null } }, select: { id: true, title: true, deadline: true } }); const tasks = await this.prisma.task.findMany({ where: { project: { members: { some: { userId: caller.id } } }, deadline: { not: null }, status: { not: 'completed' } }, select: { id: true, title: true, deadline: true } }); return { events, hints: [...projects.map((p) => ({ type: 'project_deadline', ...p })), ...tasks.map((t) => ({ type: 'task_deadline', ...t }))] }; }
  async createCalendarEvent(caller: Caller, input: any) { if (input.projectId) await this.projectMember(input.projectId, caller.id); return this.prisma.calendarEvent.create({ data: { ...input, ownerId: caller.id } }); }
  private async calendarEventAccess(caller: Caller, id: string) { const event = await this.prisma.calendarEvent.findUniqueOrThrow({ where: { id } }); if (event.projectId) await this.projectMember(event.projectId, caller.id); else if (event.ownerId !== caller.id) fail('RBAC_FORBIDDEN', 'Only the event owner or project members can modify this event', 403); return event; }
  async updateCalendarEvent(caller: Caller, id: string, input: any) { await this.calendarEventAccess(caller, id); return this.prisma.calendarEvent.update({ where: { id }, data: input }); }
  async deleteCalendarEvent(caller: Caller, id: string) { await this.calendarEventAccess(caller, id); return this.prisma.calendarEvent.delete({ where: { id } }); }
  async notify(userIds: string[], type: NotificationType, message: string, relatedId?: string, relatedType?: string) {
    const created = await Promise.all(userIds.map((userId) => this.prisma.notification.create({ data: { userId, type, message, relatedId, relatedType } })));
    for (const notification of created) this.events.emitNotification(notification.userId, notification);
    return { ok: true, delivered: created.length };
  }
  async notifications(caller: Caller) { return this.prisma.notification.findMany({ where: { userId: caller.id }, orderBy: { createdAt: 'desc' } }); }
  async markRead(caller: Caller, id: string) { return this.prisma.notification.updateMany({ where: { id, userId: caller.id }, data: { read: true } }); }
  async preferences(caller: Caller, data?: any) { if (data) return this.prisma.notificationPreference.upsert({ where: { userId: caller.id }, update: data, create: { userId: caller.id, ...data } }); return this.prisma.notificationPreference.upsert({ where: { userId: caller.id }, update: {}, create: { userId: caller.id } }); }
  async integrations(caller: Caller) { return this.prisma.connectedTool.findMany({ include: { connections: { where: { userId: caller.id }, select: { id: true, status: true, lastSyncedAt: true } } } }); }
  private oauthStateKey(state: string) { return `oauth:state:${state}`; }
  async oauthAuthorize(caller: Caller, provider: ProviderId, redirectUri: string) {
    const state = randomBytes(20).toString('hex');
    await this.redis.set(this.oauthStateKey(state), JSON.stringify({ userId: caller.id, provider, redirectUri }), 600);
    const authorizeUrl = connectors[provider].authorizeUrl(state, redirectUri);
    return { state, authorizeUrl };
  }
  async oauthCallback(caller: Caller, provider: ProviderId, code: string, state: string, redirectUri: string) {
    if (!code || !state) fail('OAUTH_EXCHANGE_FAILED', 'Authorization code and state are required');
    const stored = await this.redis.take(this.oauthStateKey(state));
    if (!stored) fail('OAUTH_EXCHANGE_FAILED', 'OAuth state is invalid or expired');
    const record = JSON.parse(stored!) as { userId: string; provider: ProviderId; redirectUri: string };
    if (record.userId !== caller.id || record.provider !== provider) fail('OAUTH_EXCHANGE_FAILED', 'OAuth state does not match this request');
    let tokens;
    try { tokens = await connectors[provider].exchangeCode(code, redirectUri || record.redirectUri); }
    catch { fail('OAUTH_EXCHANGE_FAILED', 'The provider rejected the authorization code'); }
    const enc = this.crypto.encrypt(tokens!.accessToken);
    const encRefresh = tokens!.refreshToken ? this.crypto.encrypt(tokens!.refreshToken) : null;
    return this.prisma.toolConnection.upsert({
      where: { userId_provider: { userId: caller.id, provider } },
      update: { encAccessToken: enc.ciphertext, encRefreshToken: encRefresh?.ciphertext, iv: enc.iv, authTag: enc.authTag, status: 'connected', expiresAt: tokens!.expiresAt },
      create: { userId: caller.id, provider, encAccessToken: enc.ciphertext, encRefreshToken: encRefresh?.ciphertext, iv: enc.iv, authTag: enc.authTag, expiresAt: tokens!.expiresAt },
    });
  }
  private static readonly NON_ACADEMIC_PATTERNS = [/\bhack(ing)?\b.*\b(bank|account|password|network)\b/i, /\bmake\b.*\b(bomb|explosive|weapon)\b/i, /\bcheat(ing)?\b.*\b(exam|test|spouse|partner)\b/i, /\b(illegal drugs?|buy drugs)\b/i, /\bself[- ]harm\b/i];
  private looksNonAcademic(prompt: string) { return AppService.NON_ACADEMIC_PATTERNS.some((pattern) => pattern.test(prompt)); }
  private async moderate(prompt: string, apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/moderations', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ input: prompt }) });
      if (!response.ok) return false;
      const payload: any = await response.json().catch(() => ({}));
      return Boolean(payload?.results?.[0]?.flagged);
    } catch { return false; }
  }
  async ai(caller: Caller, prompt: string, input: any) {
    if (input.parts?.some((part: any) => part.type !== 'text')) fail('AI_INPUT_UNSUPPORTED', 'Only text AI input is supported');
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) fail('AI_NOT_CONFIGURED', 'AI is not configured. Set OPENAI_API_KEY on the API service.', 503);
    const flagged = await this.moderate(prompt, apiKey!);
    const nonAcademic = !flagged && this.looksNonAcademic(prompt);
    if (flagged || nonAcademic) {
      const response = 'I can only help with academic, project, and coursework-related requests. Please rephrase your question to focus on your studies, project work, or team planning.';
      await this.prisma.aiInteraction.create({ data: { userId: caller.id, scopeType: input.scopeType, scopeId: input.scopeId, prompt, response, moderated: true } });
      return { response, refused: true, grounded: false };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response = '';
    try {
      const providerResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.get('OPENAI_MODEL'),
          instructions: 'You are WebSphere AI, a concise and practical assistant for college projects, research, coursework, and team planning. Give actionable, accurate answers. Do not invent project data or claim actions were completed. Only answer academic, project, and coursework related requests; politely decline anything else.',
          input: prompt,
          max_output_tokens: 900
        })
      });
      const payload: any = await providerResponse.json().catch(() => ({}));
      if (!providerResponse.ok) fail('AI_PROVIDER_ERROR', payload?.error?.message || 'The AI provider could not complete the request.', 502);
      response = String(payload.output_text || payload.output?.flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text').map((item: any) => item.text).join('') || '').trim();
      if (!response) fail('AI_PROVIDER_ERROR', 'The AI provider returned no text.', 502);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      fail('AI_PROVIDER_ERROR', error instanceof Error && error.name === 'AbortError' ? 'The AI request timed out.' : 'Unable to reach the AI provider.', 502);
    } finally { clearTimeout(timeout); }
    await this.prisma.aiInteraction.create({ data: { userId: caller.id, scopeType: input.scopeType, scopeId: input.scopeId, prompt, response, moderated: false } });
    return { response, refused: false, grounded: false };
  }
  async analytics(caller: Caller, projectId: string) {
    const project = await this.project(caller, projectId);
    const taskIds = project.tasks.map((task: any) => task.id);
    const dependencies = taskIds.length ? await this.prisma.taskDependency.findMany({ where: { OR: [{ prerequisiteId: { in: taskIds } }, { dependentId: { in: taskIds } }] }, select: { prerequisiteId: true, dependentId: true } }) : [];
    const stats = projectAnalytics(project.tasks.map((task: any) => ({ ...task, assigneeId: task.assignments[0]?.assigneeId })), project.deadline, new Date(), dependencies);
    return { ...stats, recommendations: recommendations(stats.riskLevel, stats.bottlenecks), tasksCompleted: project.tasks.filter((task: any) => task.status === 'completed').length };
  }
  async analyticsTrends(caller: Caller, projectId: string) {
    const project = await this.project(caller, projectId);
    const now = new Date();
    const weeks = Array.from({ length: 6 }, (_, index) => 5 - index).map((weeksAgo) => {
      const start = new Date(now.getTime() - (weeksAgo + 1) * 7 * 86400000);
      const end = new Date(now.getTime() - weeksAgo * 7 * 86400000);
      const completed = project.tasks.filter((task: any) => task.completedAt && task.completedAt >= start && task.completedAt < end).length;
      const total = project.tasks.filter((task: any) => task.createdAt < end).length;
      return { periodStart: start, periodEnd: end, tasksCompleted: completed, progress: completionRate(project.tasks.filter((task: any) => task.status === 'completed' && task.completedAt && task.completedAt < end).length, total) };
    });
    const improving = weeks.length > 1 && weeks[weeks.length - 1].tasksCompleted >= weeks[0].tasksCompleted;
    return { periods: weeks, trend: improving ? 'improving' : 'declining' };
  }
  async analyticsSummary(caller: Caller, projectId: string) {
    const stats = await this.analytics(caller, projectId);
    const summary = `This project has completed ${Math.round(stats.taskCompletionRate * 100)}% of its tasks with ${Math.round(stats.overallEfficiency * 100)}% on-time delivery. Current risk level is ${stats.riskLevel.replace('_', ' ')}${stats.bottlenecks.length ? ` with ${stats.bottlenecks.length} bottleneck${stats.bottlenecks.length === 1 ? '' : 's'} detected` : ''}.`;
    return { summary, recommendations: stats.recommendations, riskLevel: stats.riskLevel, taskCompletionRate: stats.taskCompletionRate, overallEfficiency: stats.overallEfficiency };
  }
  async ticket(caller: Caller, input: any) { return this.prisma.supportTicket.create({ data: { ...input, userId: caller.id } }); }
  async admin(caller: Caller) { if (caller.role !== Role.Administrator) fail('RBAC_FORBIDDEN', 'Administrator access is required', 403); }
  async adminUpdateUser(caller: Caller, targetId: string, data: any) {
    await this.admin(caller);
    const updated = await this.prisma.user.update({ where: { id: targetId }, data });
    if (data.status) await this.audit.log('AdminModule', 'account_lifecycle_change', 'info', `Administrator set account ${updated.email} status to ${data.status}`, caller.id);
    if (data.role) await this.audit.log('AdminModule', 'account_role_change', 'info', `Administrator set account ${updated.email} role to ${data.role}`, caller.id);
    return updated;
  }
  async monitoring(caller: Caller) {
    await this.admin(caller);
    const since24h = new Date(Date.now() - 24 * 3600000);
    const since7d = new Date(Date.now() - 7 * 24 * 3600000);
    const [totalUsers, activeUsers, lockedUsers, suspendedUsers, activeProjects, completedProjects, newSignups7d, tasksCompleted24h, openTickets, dbHealthy, redisHealthy] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'locked' } }),
      this.prisma.user.count({ where: { status: 'suspended' } }),
      this.prisma.project.count({ where: { status: 'active' } }),
      this.prisma.project.count({ where: { status: 'completed' } }),
      this.prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.task.count({ where: { status: 'completed', completedAt: { gte: since24h } } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['pending', 'in_progress'] } } }),
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then(() => true).catch(() => false),
    ]);
    return {
      users: { total: totalUsers, active: activeUsers, locked: lockedUsers, suspended: suspendedUsers, newSignups7d },
      projects: { active: activeProjects, completed: completedProjects },
      activity: { tasksCompleted24h, openSupportTickets: openTickets },
      health: { database: dbHealthy ? 'up' : 'down', redis: redisHealthy ? 'up' : 'down', overall: dbHealthy && redisHealthy ? 'up' : 'degraded' },
    };
  }
}
