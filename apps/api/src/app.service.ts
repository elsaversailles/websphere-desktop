import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { completionRate, projectAnalytics, recommendations } from './analytics.js';
import { CryptoService, validatePassword } from './security.js';
import { PrismaService } from './prisma.service.js';
import { ConfigService } from './config.service.js';
import { RedisService } from './redis.service.js';

const Role = { Administrator: 'Administrator', Project_Leader: 'Project_Leader', Project_Member: 'Project_Member' } as const;
const ProjectRole = { Project_Leader: 'Project_Leader', Project_Member: 'Project_Member' } as const;
const WorkflowEventType = { status_change: 'status_change', task_completed: 'task_completed', assignment_change: 'assignment_change' } as const;
const NotificationType = { task_assignment: 'task_assignment' } as const;
type Role = (typeof Role)[keyof typeof Role];
type TaskStatus = 'pending' | 'ongoing' | 'completed';
type ProviderId = 'google' | 'microsoft' | 'trello' | 'asana' | 'canva' | 'figma';
type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
const fail = (code: string, message: string, status: number = HttpStatus.BAD_REQUEST, fields?: Record<string, string>): never => { throw new HttpException({ code, message, ...(fields ? { fields } : {}) }, status); };
type Caller = { id: string; role: Role; tv: number };

@Injectable()
export class AppService {
  readonly prisma: any;

  private readonly accessSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;
  private readonly crypto: CryptoService;
  private readonly config: ConfigService;
  private readonly redis: RedisService;

  constructor(prisma: PrismaService, config: ConfigService, crypto: CryptoService, redis: RedisService) {
    this.prisma = prisma;
    this.accessSecret = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET'));
    this.refreshSecret = new TextEncoder().encode(config.get('JWT_REFRESH_SECRET'));
    this.crypto = crypto;
    this.config = config;
    this.redis = redis;
  }
  private refreshKey(jti: string) { return `auth:refresh:${jti}`; }
  private usedRefreshKey(jti: string) { return `auth:refresh:used:${jti}`; }
  private userRefreshKey(userId: string) { return `auth:refresh:user:${userId}`; }
  private failedLoginKey(userId: string) { return `auth:login-failures:${userId}`; }
  private resetKey(token: string) { return `auth:password-reset:${token}`; }
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
  async caller(header?: string): Promise<Caller> { if (!header?.startsWith('Bearer ')) fail('AUTH_UNAUTHENTICATED', 'A valid access token is required', 401); try { const verified = await jwtVerify(header!.slice(7), this.accessSecret); const user = await this.prisma.user.findUnique({ where: { id: verified.payload.sub } }); if (!user || user.status !== 'active' || user.tokenVersion !== Number(verified.payload.tv)) fail('AUTH_UNAUTHENTICATED', 'Session is invalid', 401); return { id: user.id, role: user.role, tv: user.tokenVersion }; } catch (error) { if (error instanceof HttpException) throw error; return fail('AUTH_UNAUTHENTICATED', 'A valid access token is required', 401); } }
  async register(input: any) { const policy = validatePassword(input.password); if (!policy.ok) fail('VALIDATION_FAILED', `Password policy failed: ${policy.reason}`, 400, { password: policy.reason }); const exists = await this.prisma.user.findUnique({ where: { email: input.email } }); if (exists) fail('EMAIL_IN_USE', 'Email is already in use', 409, { email: 'already in use' }); const user = await this.prisma.user.create({ data: { ...input, passwordHash: await hash(input.password), password: undefined } as any }); return { user: this.publicUser(user), ...(await this.issue(user)) }; }
  async login(email: string, password: string, admin = false) { const user = await this.prisma.user.findUnique({ where: { email } }); if (user?.status === 'locked') fail('ACCOUNT_LOCKED', 'Account is locked; use the email reset path', 423); if (!user || !(await verify(user.passwordHash, password))) { if (user) { const failures = await this.redis.incrementWithExpiry(this.failedLoginKey(user.id), this.config.get('LOGIN_WINDOW_SECONDS')); const locked = failures >= this.config.get('LOGIN_MAX_ATTEMPTS'); await this.prisma.user.update({ where: { id: user.id }, data: locked ? { failedLogins: failures, status: 'locked', lockedAt: new Date() } : { failedLogins: failures } }); if (locked) fail('ACCOUNT_LOCKED', 'Account is locked; use the email reset path', 423); } fail('AUTH_INVALID_CREDENTIALS', 'Invalid email or password', 401); } if (user.status !== 'active') fail('AUTH_UNAUTHENTICATED', 'Account is inactive', 401); if (admin && user.role !== Role.Administrator) fail('ADMIN_UNAUTHORIZED', 'Administrator access is required', 403); await Promise.all([this.redis.delete(this.failedLoginKey(user.id)), this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0 } })]); return { user: this.publicUser(user), ...(await this.issue(user)) }; }
  async refreshToken(token: string) { try { const verified = await jwtVerify(token, this.refreshSecret); const subject = verified.payload.sub; if (!subject) fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); const jti = String(verified.payload.jti); const stored = await this.redis.take(this.refreshKey(jti)); if (!stored) { if (await this.redis.get(this.usedRefreshKey(jti))) await this.prisma.user.update({ where: { id: subject }, data: { tokenVersion: { increment: 1 } } }); fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); } const record = JSON.parse(stored!) as { userId: string }; if (record.userId !== subject) fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); const ttl = this.refreshTtlSeconds(); await Promise.all([this.redis.set(this.usedRefreshKey(jti), '1', ttl), this.redis.removeFromSet(this.userRefreshKey(record.userId), jti)]); const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } }); return this.issue(user); } catch (error) { if (error instanceof HttpException) throw error; return fail('AUTH_UNAUTHENTICATED', 'Refresh token is invalid', 401); } }
  private async removeRefreshSessions(userId: string) { const key = this.userRefreshKey(userId); const jtis = await this.redis.setMembers(key); await this.redis.delete(...jtis.map((jti) => this.refreshKey(jti)), key); }
  async logout(user: Caller) { await this.removeRefreshSessions(user.id); await this.prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } }); return { ok: true }; }
  async changePassword(user: Caller, oldPassword: string, password: string, confirm: string) { if (password !== confirm) fail('VALIDATION_FAILED', 'Password confirmation does not match', 400, { confirm: 'mismatch' }); const entity = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }); if (entity.status === 'locked') fail('ACCOUNT_LOCKED', 'Use the email reset path for locked accounts', 423); if (!(await verify(entity.passwordHash, oldPassword))) fail('PASSWORD_INCORRECT', 'Current password is incorrect'); const policy = validatePassword(password); if (!policy.ok) fail('VALIDATION_FAILED', `Password policy failed: ${policy.reason}`); await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(password), tokenVersion: { increment: 1 } } }); return { ok: true }; }
  async forgot(email: string) { const user = await this.prisma.user.findUnique({ where: { email } }); if (user?.status === 'locked') { const token = randomBytes(32).toString('hex'); await this.redis.set(this.resetKey(token), user.id, this.config.get('PASSWORD_RESET_TTL_SECONDS')); } return { ok: true }; } // Email delivery is handled by the notifications worker.
  async resetPassword(token: string, password: string, confirm: string) { const userId = await this.redis.take(this.resetKey(token)); if (!userId) fail('AUTH_UNAUTHENTICATED', 'Reset token is invalid or expired', 401); const lockedUserId = userId!; if (password !== confirm) fail('VALIDATION_FAILED', 'Password confirmation does not match'); const policy = validatePassword(password); if (!policy.ok) fail('VALIDATION_FAILED', `Password policy failed: ${policy.reason}`); await Promise.all([this.removeRefreshSessions(lockedUserId), this.redis.delete(this.failedLoginKey(lockedUserId)), this.prisma.user.update({ where: { id: lockedUserId }, data: { passwordHash: await hash(password), status: 'active', lockedAt: null, failedLogins: 0, tokenVersion: { increment: 1 } } })]); return { ok: true }; }
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
  async project(caller: Caller, id: string) { await this.projectMember(id, caller.id); return this.prisma.project.findUniqueOrThrow({ where: { id }, include: { group: true, members: { include: { user: { select: { id: true, fullName: true } } } }, tasks: { include: { assignments: { where: { active: true } } } } } }); }
  async updateProject(caller: Caller, id: string, input: any) { await this.projectMember(id, caller.id, true); const { memberIds, ...data } = input; return this.prisma.project.update({ where: { id }, data }); }
  async projectProgress(caller: Caller, id: string) { await this.projectMember(id, caller.id); const project = await this.prisma.project.findUniqueOrThrow({ where: { id }, include: { tasks: true } }); const analytics = projectAnalytics(project.tasks, project.deadline); return { progress: completionRate(project.tasks.filter((t) => t.status === 'completed').length, project.tasks.length), onTrack: analytics.riskLevel === 'on_track', ...analytics }; }
  async createTask(caller: Caller, projectId: string, input: any) { await this.projectMember(projectId, caller.id, true); return this.prisma.task.create({ data: { ...input, projectId, createdBy: caller.id } }); }
  async task(caller: Caller, id: string) { const task = await this.prisma.task.findUniqueOrThrow({ where: { id }, include: { assignments: { where: { active: true } }, project: true } }); await this.projectMember(task.projectId, caller.id); return task; }
  async updateTask(caller: Caller, id: string, input: any) { const task = await this.task(caller, id); await this.projectMember(task.projectId, caller.id, true); return this.prisma.task.update({ where: { id }, data: input }); }
  async assignTask(caller: Caller, id: string, assigneeId: string) { const task = await this.task(caller, id); await this.projectMember(task.projectId, caller.id, true); await this.projectMember(task.projectId, assigneeId); await this.prisma.$transaction([this.prisma.taskAssignment.updateMany({ where: { taskId: id, active: true }, data: { active: false } }), this.prisma.taskAssignment.create({ data: { taskId: id, assigneeId, assignerId: caller.id } }), this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId: id, actorId: caller.id, type: WorkflowEventType.assignment_change, toValue: assigneeId } })]); return this.notify([assigneeId], NotificationType.task_assignment, `You were assigned “${task.title}”`, id, 'task'); }
  async taskStatus(caller: Caller, id: string, status: TaskStatus) { const task = await this.task(caller, id); const assignment = await this.prisma.taskAssignment.findFirst({ where: { taskId: id, assigneeId: caller.id, active: true } }); if (!assignment) fail('RBAC_FORBIDDEN', 'Only the active assignee can change task status', 403); const now = new Date(); const updated = await this.prisma.task.update({ where: { id }, data: { status, ...(status === 'ongoing' && !task.startedAt ? { startedAt: now } : {}), ...(status === 'completed' ? { completedAt: now } : {}) } }); await this.prisma.workflowEvent.create({ data: { projectId: task.projectId, taskId: id, actorId: caller.id, type: status === 'completed' ? WorkflowEventType.task_completed : WorkflowEventType.status_change, fromValue: task.status, toValue: status } }); return updated; }
  async myTasks(caller: Caller, filter: any) { return this.prisma.task.findMany({ where: { assignments: { some: { assigneeId: caller.id, active: true } }, ...(filter.projectId ? { projectId: filter.projectId } : {}), ...(filter.status ? { status: filter.status } : {}) }, orderBy: filter.sort === 'deadline' ? { deadline: 'asc' } : { createdAt: 'desc' } }); }
  async tracker(caller: Caller, projectId: string) { await this.projectMember(projectId, caller.id); const tasks = await this.prisma.task.findMany({ where: { projectId } }); const counts = Object.fromEntries(['pending', 'ongoing', 'completed'].map((status) => [status, tasks.filter((task) => task.status === status).length])); return { ...counts, total: tasks.length, progress: completionRate(counts.completed, tasks.length) }; }
  async idea(caller: Caller, groupId: string, input: any) { await this.member(groupId, caller.id); return this.prisma.idea.create({ data: { ...input, groupId, authorId: caller.id } }); }
  async ideas(caller: Caller, groupId: string) { await this.member(groupId, caller.id); return this.prisma.idea.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' } }); }
  async reviseIdea(caller: Caller, id: string, input: any) { const idea = await this.prisma.idea.findUniqueOrThrow({ where: { id } }); if (idea.authorId !== caller.id || idea.status === 'selected') fail('RBAC_FORBIDDEN', 'Only the author can revise an unselected idea', 403); return this.prisma.idea.update({ where: { id }, data: { ...input, status: 'refined' } }); }
  async openPoll(caller: Caller, groupId: string, ideaIds: string[]) { await this.member(groupId, caller.id); const ideas = await this.prisma.idea.findMany({ where: { id: { in: ideaIds }, groupId } }); if (ideas.length !== ideaIds.length) fail('VALIDATION_FAILED', 'Every poll option must be a group idea'); return this.prisma.ideaPoll.create({ data: { groupId, createdBy: caller.id, options: { create: ideas.map((idea) => ({ ideaId: idea.id, label: idea.title })) } }, include: { options: true } }); }
  async vote(caller: Caller, pollId: string, optionId: string) { const poll = await this.prisma.ideaPoll.findUniqueOrThrow({ where: { id: pollId }, include: { options: true } }); await this.member(poll.groupId, caller.id); if (!poll.open || !poll.options.some((option) => option.id === optionId)) fail('VALIDATION_FAILED', 'Poll is closed or option is invalid'); await this.prisma.vote.upsert({ where: { pollId_voterId: { pollId, voterId: caller.id } }, update: { optionId }, create: { pollId, optionId, voterId: caller.id } }); return this.tally(pollId); }
  async tally(pollId: string, viewerId?: string) { const [poll, viewerVote] = await Promise.all([this.prisma.ideaPoll.findUniqueOrThrow({ where: { id: pollId }, include: { options: { include: { _count: { select: { votes: true } } } } } }), viewerId ? this.prisma.vote.findUnique({ where: { pollId_voterId: { pollId, voterId: viewerId } }, select: { optionId: true } }) : Promise.resolve(null)]); return { pollId, groupId: poll.groupId, open: poll.open, viewerOptionId: viewerVote?.optionId ?? null, options: poll.options.map((option) => ({ optionId: option.id, ideaId: option.ideaId, label: option.label, votes: option._count.votes })) }; }
  async pollResults(caller: Caller, pollId: string) { const poll = await this.prisma.ideaPoll.findUniqueOrThrow({ where: { id: pollId }, select: { groupId: true } }); await this.member(poll.groupId, caller.id); return this.tally(pollId, caller.id); }
  async begin(caller: Caller, groupId: string, ideaId: string) { await this.member(groupId, caller.id, true); const idea = await this.prisma.idea.findFirst({ where: { id: ideaId, groupId } }); if (!idea) fail('NOT_FOUND', 'Idea does not belong to group', 404); if (idea.status === 'selected') fail('VALIDATION_FAILED', 'Idea has already been selected'); const project = await this.prisma.project.create({ data: { groupId, ideaId, title: idea.title, description: idea.body, createdBy: caller.id, members: { create: { userId: caller.id, role: ProjectRole.Project_Leader } } } }); await this.prisma.idea.update({ where: { id: ideaId }, data: { status: 'selected' } }); return project; }
  async calendar(caller: Caller, from?: string, to?: string) { const events = await this.prisma.calendarEvent.findMany({ where: { ownerId: caller.id, ...(from || to ? { startAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) } }); const projects = await this.prisma.project.findMany({ where: { members: { some: { userId: caller.id } }, deadline: { not: null } }, select: { id: true, title: true, deadline: true } }); const tasks = await this.prisma.task.findMany({ where: { project: { members: { some: { userId: caller.id } } }, deadline: { not: null }, status: { not: 'completed' } }, select: { id: true, title: true, deadline: true } }); return { events, hints: [...projects.map((p) => ({ type: 'project_deadline', ...p })), ...tasks.map((t) => ({ type: 'task_deadline', ...t }))] }; }
  async notify(userIds: string[], type: NotificationType, message: string, relatedId?: string, relatedType?: string) { const data = await this.prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type, message, relatedId, relatedType })) }); return { ok: true, delivered: data.count }; }
  async notifications(caller: Caller) { return this.prisma.notification.findMany({ where: { userId: caller.id }, orderBy: { createdAt: 'desc' } }); }
  async markRead(caller: Caller, id: string) { return this.prisma.notification.updateMany({ where: { id, userId: caller.id }, data: { read: true } }); }
  async preferences(caller: Caller, data?: any) { if (data) return this.prisma.notificationPreference.upsert({ where: { userId: caller.id }, update: data, create: { userId: caller.id, ...data } }); return this.prisma.notificationPreference.upsert({ where: { userId: caller.id }, update: {}, create: { userId: caller.id } }); }
  async integrations(caller: Caller) { return this.prisma.connectedTool.findMany({ include: { connections: { where: { userId: caller.id }, select: { id: true, status: true, lastSyncedAt: true } } } }); }
  async oauthAuthorize(caller: Caller, provider: ProviderId, redirectUri: string) { const state = randomBytes(20).toString('hex'); return { state, authorizeUrl: `${this.config.get('WEB_ORIGIN')}/oauth/${provider}?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}` }; }
  async oauthCallback(caller: Caller, provider: ProviderId, code: string) { if (!code) fail('OAUTH_EXCHANGE_FAILED', 'Authorization code is required'); const enc = this.crypto.encrypt(`provider-token:${provider}:${code}`); return this.prisma.toolConnection.upsert({ where: { userId_provider: { userId: caller.id, provider } }, update: { encAccessToken: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, status: 'connected' }, create: { userId: caller.id, provider, encAccessToken: enc.ciphertext, iv: enc.iv, authTag: enc.authTag } }); }
  async ai(caller: Caller, prompt: string, input: any) {
    if (input.parts?.some((part: any) => part.type !== 'text')) fail('AI_INPUT_UNSUPPORTED', 'Only text AI input is supported');
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) fail('AI_NOT_CONFIGURED', 'AI is not configured. Set OPENAI_API_KEY on the API service.', 503);
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
          instructions: 'You are WebSphere AI, a concise and practical assistant for college projects, research, coursework, and team planning. Give actionable, accurate answers. Do not invent project data or claim actions were completed.',
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
  async analytics(caller: Caller, projectId: string) { const project = await this.project(caller, projectId); const stats = projectAnalytics(project.tasks.map((task: any) => ({ ...task, assigneeId: task.assignments[0]?.assigneeId })), project.deadline); return { ...stats, recommendations: recommendations(stats.riskLevel, stats.bottlenecks), tasksCompleted: project.tasks.filter((task: any) => task.status === 'completed').length }; }
  async ticket(caller: Caller, input: any) { return this.prisma.supportTicket.create({ data: { ...input, userId: caller.id } }); }
  async admin(caller: Caller) { if (caller.role !== Role.Administrator) fail('RBAC_FORBIDDEN', 'Administrator access is required', 403); }
}
