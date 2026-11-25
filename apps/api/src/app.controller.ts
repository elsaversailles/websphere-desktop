import { Body, Controller, Delete, Get, Header, Headers, HttpException, Ip, Param, Patch, Post, Put, Query, Redirect, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { accountDeleteSchema, adminGeneralSettingsSchema, aiAskSchema, announcementSchema, calendarEventSchema, deactivationRequestSchema, ideaSchema, loginSchema, maintenanceAnnouncementSchema, mobilePushTokenSchema, notificationPreferencesSchema, passwordChangeSchema, passwordForgotSchema, passwordResetSchema, pollCreateSchema, pollExtendSchema, profileUpdateSchema, pushSubscriptionSchema, pushUnsubscribeSchema, registrationOtpRequestSchema, projectSchema, projectUpdateSchema, resourceLinkSchema, resourceUpdateSchema, signedInTicketSchema, taskEditSchema, taskSchema, ticketUpdateSchema, taskStatusSchema, verifiedRegisterSchema } from '@websphere/shared';
import { AppService } from './app.service.js';
import { LocalStorageService } from './local-storage.service.js';
import { RedisService } from './redis.service.js';
import { GroupScope, ProjectScope, Public, Roles } from './auth.decorators.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { TurnService } from './turn.service.js';
import { googleStartSchema, googleExchangeSchema, recoveryVerifySchema, recoveryCompleteSchema, publicSupportTicketSchema } from '@websphere/shared';

// A single failing field (the common case — e.g. a blank or disposable email) surfaces its own
// message directly, so "Email is required" reaches the user instead of a generic banner; multiple
// failures fall back to the generic summary since picking just one would be misleading.
const parse = <Schema extends z.ZodTypeAny>(schema: Schema, value: unknown): z.output<Schema> => { const result = schema.safeParse(value); if (!result.success) { const fields = Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0] ?? 'body'), issue.message])); const message = result.error.issues.length === 1 ? result.error.issues[0].message : 'One or more fields are invalid'; throw new HttpException({ code: 'VALIDATION_FAILED', message, fields }, 400); } return result.data; };
const securitySettingsSchema = z.object({
  sessionTimeoutMinutes: z.number().int().min(5).max(480).optional(),
  inactiveAccountAlerts: z.object({
    enabled: z.boolean(),
    recipientEmail: z.string().trim().max(320),
    inactivityDays: z.number().int().min(7).max(365),
  }).superRefine((value, context) => { if (value.enabled && !z.string().email().safeParse(value.recipientEmail).success) context.addIssue({ code: z.ZodIssueCode.custom, path: ['recipientEmail'], message: 'Enter a valid recipient email address' }); }).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one security setting' });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  q: z.string().trim().max(180).optional(),
  sort: z.enum(['recent', 'title', 'deadline']).optional(),
});
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) => {
  const normalized = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+normalized) && normalized.toISOString().slice(0, 10) === date;
}, 'Enter a valid calendar date');

@Controller()
export class AppController {
  constructor(private readonly app: AppService, private readonly storage: LocalStorageService, private readonly redis: RedisService, private readonly realtime: RealtimeGateway, private readonly turn: TurnService) {}
  private caller(auth?: string) { return this.app.caller(auth); }
  @Public() @Get('health') async health() { await this.app.prisma.$queryRaw`SELECT 1`; await this.redis.ping(); return { ok: true, database: 'up', redis: 'up', timestamp: new Date().toISOString() }; }
  @Public() @Get('maintenance') maintenance() { return this.app.maintenanceStatus(); }
  @Public() @Get('settings/general') generalSettings() { return this.app.generalSettings(); }
  @Public() @Post('auth/registration/otp') registrationOtp(@Body() body: unknown) { return this.app.sendRegistrationOtp(parse(registrationOtpRequestSchema, body).email); }
  @Public() @Post(['users', 'auth/register']) register(@Body() body: unknown) { return this.app.register(parse(verifiedRegisterSchema, body)); }
  @Public() @Post('auth/login') login(@Body() body: unknown) { const input = parse(loginSchema, body); return this.app.login(input.email, input.password, false, input.clientType); }
  @Public() @Post('auth/admin/login') adminLogin(@Body() body: unknown) { const input = parse(loginSchema, body); return this.app.login(input.email, input.password, true, input.clientType); }
  @Public() @Post('auth/refresh') refresh(@Body('refresh') refresh: string) { return this.app.refreshToken(refresh); }
  @Public() @Get('auth/session-valid') async sessionValid(@Headers('authorization') auth?: string) { await this.app.caller(auth, { touchSession: false }); return { ok: true }; }
  @Post('auth/logout') async logout(@Headers('authorization') auth?: string) { return this.app.logout(await this.caller(auth)); }
  @Public() @Post('auth/password/change') async change(@Headers('authorization') auth: string, @Body() body: unknown) { const input = parse(passwordChangeSchema, body); return this.app.changePassword(await this.app.caller(auth, { allowLocked: true }), input.oldPassword, input.password, input.confirm); }
  @Get('auth/session-policy') async sessionPolicy() { return this.app.sessionPolicy(); }
  @Public() @Post('auth/password/forgot') forgot(@Body() body: unknown) { return this.app.forgot(parse(passwordForgotSchema, body).email); }
  @Public() @Post('auth/password/recovery') recovery(@Body() body: unknown) {
    return this.app.requestPasswordRecovery(parse(passwordForgotSchema, body).email);
  }
  @Public() @Post('auth/password/recovery/verify') verifyRecovery(@Body() body: unknown) {
    const input = parse(recoveryVerifySchema, body);
    return this.app.verifyPasswordRecovery(input.email, input.verificationId, input.verificationCode);
  }
  @Public() @Post('auth/password/recovery/complete') completeRecovery(@Body() body: unknown) {
    const input = parse(recoveryCompleteSchema, body);
    return this.app.completePasswordRecovery(input.email, input.token, input.password, input.confirm, input.clientType);
  }
  @Public() @Post('auth/google/start') startGoogle(@Headers('authorization') auth: string, @Body() body: unknown) {
    return this.app.startGoogle(parse(googleStartSchema, body), auth);
  }
  @Public() @Redirect() @Get('auth/google/callback') async googleCallback(@Query('state') state?: string, @Query('code') code?: string) {
    return { url: await this.app.finishGoogle(state, code), statusCode: 302 };
  }
  @Public() @Post('auth/google/exchange') exchangeGoogle(@Headers('authorization') auth: string, @Body() body: unknown) {
    const input = parse(googleExchangeSchema, body);
    return this.app.exchangeGoogle(input.code, input.verifier, auth);
  }
  @Public() @Post('auth/deactivation-request') deactivationRequest(@Body() body: unknown) { const input = parse(deactivationRequestSchema, body); return this.app.requestAccountDeactivation(input.email, input.reason); }
  @Public() @Post('auth/password/reset') reset(@Body() body: unknown) { const input = parse(passwordResetSchema, body); return this.app.resetPassword(input.token, input.password, input.confirm); }
  @Public() @Redirect() @Get('auth/email-change/confirm') async confirmEmailChange(@Query('token') token?: string) { try { await this.app.confirmEmailChange(token ?? ''); return { url: this.app.emailChangeReturnUrl('confirmed'), statusCode: 302 }; } catch { return { url: this.app.emailChangeReturnUrl('invalid'), statusCode: 302 }; } }
  @Get('users/me') async me(@Headers('authorization') auth: string) { return this.app.me(await this.caller(auth)); }
  @Patch('users/me') async updateMe(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.updateMe(await this.caller(auth), parse(profileUpdateSchema, body)); }
  @Delete('users/me') async deleteMe(@Headers('authorization') auth: string, @Body() body: unknown) { const input = parse(accountDeleteSchema, body); return this.app.deleteMyAccount(await this.caller(auth), input.password); }
  @Post('users/me/avatar') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async avatar(@Headers('authorization') auth: string, @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer }) { if (!file) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Choose an avatar image', fields: { file: 'required' } }, 400); const avatarUrl = await this.storage.saveAvatar(file); return this.app.updateMe(await this.caller(auth), { avatarUrl }); }
  @Delete('users/me/avatar') async removeAvatar(@Headers('authorization') auth: string) { return this.app.updateMe(await this.caller(auth), { avatarUrl: null }); }
  @Public() @Get('uploads/:fileName') async upload(@Param('fileName') fileName: string) { return new StreamableFile(await this.storage.readPublicFile(fileName)); }

  @Post('groups') async createGroup(@Headers('authorization') auth: string, @Body('name') name: string) { return this.app.createGroup(await this.caller(auth), name); }
  @Post('groups/join') async joinGroup(@Headers('authorization') auth: string, @Body('code') code: string) { return this.app.joinGroup(await this.caller(auth), code); }
  @Get('groups/search') async searchGroups(@Headers('authorization') auth: string, @Query('q') query = '') { return this.app.searchGroupChats(await this.caller(auth), query); }
  @Get('groups') async groups(@Headers('authorization') auth: string) { return this.app.groups(await this.caller(auth)); }
  @GroupScope() @Get('groups/:id') async group(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.group(await this.caller(auth), id); }
  @GroupScope() @Post('groups/:id/members') async addMember(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: { userId?: string; email?: string }) { const caller = await this.caller(auth); if (body.email) return this.app.addGroupMemberByEmail(caller, id, body.email.trim().toLowerCase()); if (body.userId) return this.app.addGroupMember(caller, id, body.userId); throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Provide a member email address or user ID' }, 400); }
  @GroupScope() @Delete('groups/:id/members/:userId') async removeMember(@Headers('authorization') auth: string, @Param() p: any) { return this.app.removeGroupMember(await this.caller(auth), p.id, p.userId); }
  @GroupScope() @Post('groups/:id/members/:userId/demote') async demoteMember(@Headers('authorization') auth: string, @Param() p: any) { return this.app.demoteGroupMember(await this.caller(auth), p.id, p.userId); }
  @GroupScope() @Post('groups/:id/members/:userId/promote') async promoteMember(@Headers('authorization') auth: string, @Param() p: any) { return this.app.promoteGroupMember(await this.caller(auth), p.id, p.userId); }
  @GroupScope() @Post('groups/:id/chat/:action') async chatState(@Headers('authorization') auth: string, @Param() p: any) { if (!['read', 'unread', 'hide', 'delete'].includes(p.action)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Invalid chat action' }, 400); return this.app.setChatState(await this.caller(auth), p.id, p.action); }
  @GroupScope() @Post('groups/:id/leave') async leaveGroup(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.leaveGroup(await this.caller(auth), id); }
  @GroupScope() @Get('groups/:id/hub') async hub(@Headers('authorization') auth: string, @Param('id') id: string) { const caller = await this.caller(auth); const membership = await this.app.member(id, caller.id); const [group, ideas, messages, poll] = await Promise.all([this.app.group(caller, id), this.app.ideas(caller, id), this.app.prisma.chatMessage.findMany({ where: { groupId: id, ...(membership.chatDeletedAt ? { createdAt: { gt: membership.chatDeletedAt } } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 }), this.app.prisma.ideaPoll.findFirst({ where: { groupId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } })]); return { group, ideas, messages, poll: poll ? await this.app.pollResults(caller, poll.id) : null }; }
  @GroupScope() @Get('groups/:id/messages') async messages(@Headers('authorization') auth: string, @Param('id') id: string, @Query('cursor') cursor?: string, @Query('q') query?: string) { const caller = await this.caller(auth); const membership = await this.app.member(id, caller.id); const term = query?.trim(); return this.app.prisma.chatMessage.findMany({ where: { groupId: id, ...(membership.chatDeletedAt ? { createdAt: { gt: membership.chatDeletedAt } } : {}), ...(cursor ? { id: { lt: cursor } } : {}), ...(term ? { body: { contains: term } } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 }); }
  @GroupScope() @Get('groups/:id/realtime/ice-servers') async iceServers(@Headers('authorization') auth: string, @Param('id') id: string) { const caller = await this.caller(auth); await this.app.member(id, caller.id); return { iceServers: this.turn.iceServers(caller.id) }; }

  @GroupScope() @Post('groups/:id/ideas') async idea(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.idea(await this.caller(auth), id, parse(ideaSchema, body)); }
  @GroupScope() @Get('groups/:id/ideas') async ideas(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.ideas(await this.caller(auth), id); }
  @Patch('ideas/:id') async revise(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.reviseIdea(await this.caller(auth), id, parse(ideaSchema, body)); }
  @Post('ideas/:id/reject') async rejectIdea(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.rejectIdea(await this.caller(auth), id); }
  @Delete('ideas/:id') async deleteIdea(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.deleteIdea(await this.caller(auth), id); }
  @GroupScope() @Post('groups/:id/ideas/merge') async mergeIdeas(@Headers('authorization') auth: string, @Param('id') id: string, @Body('ideaIds') ideaIds: string[]) { return this.app.mergeIdeas(await this.caller(auth), id, ideaIds); }
  @GroupScope() @Post('groups/:id/polls') async poll(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.openPoll(await this.caller(auth), id, parse(pollCreateSchema, body)); }
  @Post('polls/:id/close') async closePoll(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.closePoll(await this.caller(auth), id); }
  @Post('polls/:id/extend') async extendPoll(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.extendPoll(await this.caller(auth), id, parse(pollExtendSchema, body)); }
  @Delete('polls/:id') async deletePoll(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.deleteFinishedPoll(await this.caller(auth), id); }
  @Post('polls/:id/vote') async vote(@Headers('authorization') auth: string, @Param('id') id: string, @Body('optionId') optionId: string) { const tally = await this.app.vote(await this.caller(auth), id, optionId); this.realtime.publishPollTally(tally.groupId, tally); return tally; }
  @Get('polls/:id/results') async results(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.pollResults(await this.caller(auth), id); }
  @GroupScope('groupId') @Post('groups/:groupId/ideas/:ideaId/begin') async begin(@Headers('authorization') auth: string, @Param() params: any) { return this.app.begin(await this.caller(auth), params.groupId, params.ideaId); }
  @Post('ideas/:id/ai/suggest') async ideaSuggestion(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.suggestIdea(await this.caller(auth), id); }

  @Post('projects') async createProject(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.createProject(await this.caller(auth), parse(projectSchema, body)); }
  @Get('projects') async projects(@Headers('authorization') auth: string) { return this.app.projects(await this.caller(auth)); }
  @Get('projects/options') async projectOptions(@Headers('authorization') auth: string) { return this.app.projectOptions(await this.caller(auth)); }
  @Get('projects/list') async projectList(@Headers('authorization') auth: string, @Query() query: unknown) {
    return this.app.projectList(await this.caller(auth), parse(listQuery.extend({
      status: z.enum(['active', 'completed', 'on_hold', 'archived']).optional(),
      progressStatus: taskStatusSchema.shape.status.optional(),
    }), query));
  }
  @ProjectScope() @Get('projects/:id') async project(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.project(await this.caller(auth), id); }
  @ProjectScope() @Patch('projects/:id') async updateProject(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.updateProject(await this.caller(auth), id, parse(projectUpdateSchema, body)); }
  @ProjectScope() @Delete('projects/:id') async deleteProject(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.deleteProject(await this.caller(auth), id); }
  @ProjectScope() @Patch('projects/:id/status') async statusProject(@Headers('authorization') auth: string, @Param('id') id: string, @Body('status') status: string) { return this.app.updateProject(await this.caller(auth), id, { status }); }
  @ProjectScope() @Get('projects/:id/team') async team(@Headers('authorization') auth: string, @Param('id') id: string) { const project = await this.app.project(await this.caller(auth), id); return project.members; }
  @ProjectScope() @Patch('projects/:id/team/:userId') async updateResponsibility(@Headers('authorization') auth: string, @Param('id') id: string, @Param('userId') userId: string, @Body('responsibility') responsibility: string) { return this.app.updateResponsibility(await this.caller(auth), id, userId, responsibility); }
  @ProjectScope() @Post('projects/:id/members') async addProjectMember(@Headers('authorization') auth: string, @Param('id') id: string, @Body('userId') userId: string) { return this.app.addProjectMember(await this.caller(auth), id, userId); }
  @ProjectScope() @Get('projects/:id/progress') async progress(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.projectProgress(await this.caller(auth), id); }
  @ProjectScope() @Post('projects/:id/tasks') async createTask(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { const created = await this.app.createTask(await this.caller(auth), id, parse(taskSchema, body)); this.realtime.publishTaskUpdated(id, created); return created; }
  @ProjectScope() @Get('projects/:id/tasks/tracker') async tracker(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.tracker(await this.caller(auth), id); }
  @ProjectScope() @Get('projects/:id/tasks/by-member') async byMember(@Headers('authorization') auth: string, @Param('id') projectId: string) { const caller = await this.caller(auth); const project = await this.app.project(caller, projectId); return project.members.map((member: any) => ({ member: member.user, pending: project.tasks.filter((task: any) => task.status === 'pending' && task.assignments.some((a: any) => a.assigneeId === member.userId)).length, ongoing: project.tasks.filter((task: any) => task.status === 'ongoing' && task.assignments.some((a: any) => a.assigneeId === member.userId)).length, for_review: project.tasks.filter((task: any) => task.status === 'for_review' && task.assignments.some((a: any) => a.assigneeId === member.userId)).length, completed: project.tasks.filter((task: any) => task.status === 'completed' && task.assignments.some((a: any) => a.assigneeId === member.userId)).length })); }
  @Get('tasks/mine') async mine(@Headers('authorization') auth: string, @Query() query: any) { return this.app.myTasks(await this.caller(auth), query); }
  @Get('tasks/mine/list') async taskList(@Headers('authorization') auth: string, @Query() query: unknown) {
    return this.app.assignedTaskList(await this.caller(auth), parse(listQuery.extend({ status: taskStatusSchema.shape.status.optional(), projectId: z.string().cuid().optional() }), query));
  }
  @Get('tasks/mine/:id') async assignedTask(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.app.assignedTaskDetail(await this.caller(auth), id);
  }
  @Get('tasks/tracker/page') async trackerPage(@Headers('authorization') auth: string, @Query() query: unknown) {
    const filter = parse(listQuery.extend({
      status: taskStatusSchema.shape.status.optional(), projectId: z.string().cuid().optional(),
      platform: z.enum(['google', 'microsoft', 'trello', 'asana', 'canva', 'notion', 'upload', 'link']).optional(),
    }), query);
    return this.app.taskTracker(await this.caller(auth), filter);
  }
  @Get('tasks/tracker') async taskTracker(@Headers('authorization') auth: string) { return this.app.taskTracker(await this.caller(auth)); }
  @Post('tasks/:id/files') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async attachFile(@Headers('authorization') auth: string, @Param('id') id: string, @Body('status') status: string | undefined, @UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    const caller = await this.caller(auth);
    if (!file) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Choose a file to attach.' }, 400);
    const result = await this.app.attachTaskFile(caller, id, file, parse(taskStatusSchema.shape.status.optional(), status));
    this.realtime.publishTaskUpdated(result.projectId, await this.app.task(caller, id));
    return { ok: true };
  }
  @Get('resources/:id/download') @Header('X-Content-Type-Options', 'nosniff') @Header('Cache-Control', 'private, no-store')
  async downloadTaskFile(@Headers('authorization') auth: string, @Param('id') id: string) {
    const { title, content } = await this.app.downloadTaskFile(await this.caller(auth), id);
    const filename = encodeURIComponent(title).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
    return new StreamableFile(content, { type: 'application/octet-stream', disposition: `attachment; filename*=UTF-8''${filename}` });
  }
  @Post('tasks/:id/resources') async linkTaskResource(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { const caller = await this.caller(auth); const resource = await this.app.linkTaskResource(caller, id, parse(resourceLinkSchema, body)); const task = await this.app.task(caller, id); this.realtime.publishTaskUpdated(task.projectId, task); return resource; }
  @Get('tasks/:id') async task(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.task(await this.caller(auth), id); }
  @Patch('tasks/:id') async updateTask(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { const caller = await this.caller(auth); const updated = await this.app.updateTask(caller, id, parse(taskEditSchema, body)); this.realtime.publishTaskUpdated(updated.projectId, updated); return updated; }
  @Delete('tasks/:id') async deleteTask(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.deleteTask(await this.caller(auth), id); }
  @Post('tasks/:id/assign') async assign(@Headers('authorization') auth: string, @Param('id') id: string, @Body('assigneeId') assigneeId: string) { const result = await this.app.assignTask(await this.caller(auth), id, assigneeId); const task = await this.app.prisma.task.findUnique({ where: { id }, select: { projectId: true } }); if (task) this.realtime.publishTaskUpdated(task.projectId, await this.app.task(await this.caller(auth), id)); return result; }
  @Patch('tasks/:id/status') async taskStatus(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { const caller = await this.caller(auth); const updated = await this.app.taskStatus(caller, id, parse(taskStatusSchema, body).status); this.realtime.publishTaskUpdated(updated.projectId, updated); return updated; }

  @Get('dashboard') async dashboard(@Headers('authorization') auth: string, @Query('compact') compact?: string) { const caller = await this.caller(auth); if (compact === '1') return this.app.compactDashboard(caller); const [projects, tasks, notifications, activity, online, announcements, milestones] = await Promise.all([this.app.projects(caller), this.app.myTasks(caller, { sort: 'assigned' }), this.app.notifications(caller), this.app.activityFeed(caller, 8), this.app.onlineTeammates(caller, 8), this.app.eventAnnouncements(caller, 4), this.app.milestones(caller, 5)]); return { glance: { activeProjects: projects.filter((p: any) => p.status === 'active').length, pendingTasks: tasks.filter((t: any) => t.status === 'pending').length, ideasSubmitted: await this.app.prisma.idea.count({ where: { authorId: caller.id } }) }, projects, tasks, unreadNotifications: notifications.filter((item: any) => !item.read).length, notifications: notifications.slice(0, 8), activity, online, announcements, milestones }; }
  @GroupScope() @Post('groups/:id/announcements') async createAnnouncement(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.createAnnouncement(await this.caller(auth), id, parse(announcementSchema, body)); }
  @Get('system-announcements') async systemAnnouncements(@Headers('authorization') auth: string) { return this.app.systemAnnouncements(await this.caller(auth)); }
  @Get('announcements') async announcements(@Headers('authorization') auth: string) { return this.app.announcements(await this.caller(auth)); }
  @Get('event-announcements') async eventAnnouncements(@Headers('authorization') auth: string) { return this.app.eventAnnouncements(await this.caller(auth)); }
  @Get('calendar') async calendar(@Headers('authorization') auth: string, @Query('from') from?: string, @Query('to') to?: string) { return this.app.calendar(await this.caller(auth), from, to); }
  @Get('calendar/notes') async notes(@Headers('authorization') auth: string, @Query('date') date: string) {
    return this.app.calendarNote(await this.caller(auth), parse(dateKeySchema, date));
  }
  @Put('calendar/notes/:date') async saveNote(@Headers('authorization') auth: string, @Param('date') date: string, @Body() body: unknown) {
    return this.app.saveCalendarNote(await this.caller(auth), parse(dateKeySchema, date), parse(z.object({ body: z.string().max(100).trim() }), body).body);
  }
  @Post('calendar/events') async createEvent(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.createCalendarEvent(await this.caller(auth), parse(calendarEventSchema, body)); }
  @Patch('calendar/events/:id') async updateEvent(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.updateCalendarEvent(await this.caller(auth), id, parse(calendarEventSchema.partial(), body)); }
  @Delete('calendar/events/:id') async deleteEvent(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.deleteCalendarEvent(await this.caller(auth), id); }
  @Get('calendar/upcoming') async upcoming(@Headers('authorization') auth: string) { const data = await this.app.calendar(await this.caller(auth)); return data.hints.filter((hint: any) => hint.deadline).sort((a: any, b: any) => +new Date(a.deadline) - +new Date(b.deadline)); }

  @Get('notifications') async notifications(@Headers('authorization') auth: string) { return this.app.notifications(await this.caller(auth)); }
  @Patch('notifications/:id/read') async read(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.markRead(await this.caller(auth), id); }
  @Get('notifications/preferences') async preference(@Headers('authorization') auth: string) { return this.app.preferences(await this.caller(auth)); }
  @Put('notifications/preferences') async setPreference(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.preferences(await this.caller(auth), parse(notificationPreferencesSchema, body)); }
  @Public() @Get('push/config') pushConfig() { return this.app.pushConfig(); }
  @Post('push/subscribe') async subscribe(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.subscribePush(await this.caller(auth), parse(pushSubscriptionSchema, body)); }
  @Delete('push/subscribe') async unsubscribe(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.unsubscribePush(await this.caller(auth), parse(pushUnsubscribeSchema, body).endpoint); }
  @Post('push/mobile-tokens') async registerMobilePush(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.registerMobilePush(await this.caller(auth), parse(mobilePushTokenSchema, body).token); }
  @Delete('push/mobile-tokens') async unregisterMobilePush(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.unregisterMobilePush(await this.caller(auth), parse(mobilePushTokenSchema, body).token); }

  @Post('ai/ask') async ask(@Headers('authorization') auth: string, @Body() body: unknown) { const input = parse(aiAskSchema, body); return this.app.ai(await this.caller(auth), input.prompt, input); }
  @Post('ai/planning') async planning(@Headers('authorization') auth: string, @Body() body: unknown) { const input = parse(aiAskSchema, body); return this.app.ai(await this.caller(auth), input.prompt, input); }
  @Post('ai/ideas/generate') async generate(@Headers('authorization') auth: string, @Body() body: unknown) { const input = parse(aiAskSchema, body); return this.app.ai(await this.caller(auth), input.prompt, input); }
  @Post('ai/recommendations') async aiRecommendations(@Headers('authorization') auth: string, @Body('prompt') prompt: string) { const caller = await this.caller(auth); const tools = await this.app.integrations(caller); return { prompt, recommendations: tools.map((tool: any) => ({ provider: tool.provider, name: tool.name, category: tool.category })) }; }
  @Get('projects/:id/analytics') async analytics(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.analytics(await this.caller(auth), id); }
  @ProjectScope() @Get('projects/:id/analytics/workflow') async projectWorkflow(@Headers('authorization') auth: string, @Param('id') id: string, @Query('period') period?: string, @Query('date') date?: string) {
    return this.app.workflowReport(await this.caller(auth), id, parse(z.enum(['daily', 'weekly', 'monthly']).default('weekly'), period), parse(z.union([dateKeySchema, z.literal('today')]).optional(), date));
  }
  @Get('projects/:id/analytics/trends') async analyticsTrends(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.analyticsTrends(await this.caller(auth), id); }
  @Get('projects/:id/analytics/summary') async analyticsSummary(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.analyticsSummary(await this.caller(auth), id); }
  @Get('projects/:id/analytics/team') async analyticsTeam(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.teamPerformance(await this.caller(auth), id); }
  @Get('projects/:id/analytics/tools') async analyticsTools(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.analyticsToolUsage(await this.caller(auth), id); }
  @Get('projects/:id/risk') async risk(@Headers('authorization') auth: string, @Param('id') id: string) { const data = await this.app.analytics(await this.caller(auth), id); return { riskScore: data.riskScore, riskLevel: data.riskLevel }; }
  @Get('projects/:id/prediction') async prediction(@Headers('authorization') auth: string, @Param('id') id: string) { const data = await this.app.analytics(await this.caller(auth), id); return { predictedCompletion: data.predictedCompletion, deltaDays: data.deltaDays, factors: data.bottlenecks }; }
  @Get('projects/:id/recommendations') async recommendations(@Headers('authorization') auth: string, @Param('id') id: string) { return (await this.app.analytics(await this.caller(auth), id)).recommendations; }

  @Get('integrations/catalog') async catalog(@Headers('authorization') auth: string) { return this.app.integrations(await this.caller(auth)); }
  @Get('integrations/:provider/authorize') async authorize(@Headers('authorization') auth: string, @Param('provider') provider: any, @Query('redirectUri') redirectUri: string) { return this.app.oauthAuthorize(await this.caller(auth), provider, redirectUri); }
  @Public() @Redirect() @Get('integrations/:provider/callback') async callback(@Param('provider') provider: any, @Query('code') code: string, @Query('state') state: string) { const completed = await this.app.oauthCallback(provider, code, state); const destination = new URL(completed.returnUrl); destination.searchParams.set('connected', String(provider)); return { url: destination.toString(), statusCode: 302 }; }
  @Get('integrations/connections') async connections(@Headers('authorization') auth: string) { return this.app.integrationConnections(await this.caller(auth)); }
  @Get('integrations/connections/:id/google-picker-token') async googlePickerToken(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.googlePickerToken(await this.caller(auth), id); }
  @Post('integrations/connections/:id/sync') async sync(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.syncIntegration(await this.caller(auth), id); }
  @Post('integrations/connections/:id/launch') async launchIntegration(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.launchIntegration(await this.caller(auth), id); }
  @Delete('integrations/connections/:id') async disconnect(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.disconnectIntegration(await this.caller(auth), id); }
  @Post('resources/:id/launch') async launchResource(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.launchResource(await this.caller(auth), id); }
  @Patch('resources/:id') async updateResource(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { const caller = await this.caller(auth); const updated = await this.app.updateLinkedResource(caller, id, parse(resourceUpdateSchema, body)); this.realtime.publishTaskUpdated(updated.projectId, await this.app.task(caller, updated.taskId)); return updated; }
  @Post('support/tickets') async ticket(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.ticket(await this.caller(auth), parse(signedInTicketSchema, body)); }
  @Public() @Post('support/public-tickets') publicTicket(@Ip() ip: string, @Body() body: unknown) { return this.app.publicTicket(parse(publicSupportTicketSchema, body), ip); }
  @Get('support/tickets') async myTickets(@Headers('authorization') auth: string) { return this.app.myTickets(await this.caller(auth)); }
  @Roles('Administrator') @Patch('admin/support/tickets/:id') async updateTicket(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.updateTicket(await this.caller(auth), id, parse(ticketUpdateSchema, body)); }
  @Roles('Administrator') @Get('admin/activity/:metric') async activity(@Headers('authorization') auth: string, @Param('metric') metric: string, @Query('period') period?: string) {
    return this.app.adminActivity(await this.caller(auth), parse(z.enum(['users', 'projects']), metric), parse(z.enum(['weekly', 'monthly', 'six-months']).default('weekly'), period));
  }
  @Roles('Administrator') @Get('admin/monitoring') async monitoring(@Headers('authorization') auth: string) { return this.app.monitoring(await this.caller(auth)); }
  @Roles('Administrator') @Get('admin/support/tickets') async supportTickets(@Headers('authorization') auth: string) { return this.app.adminSupportTickets(await this.caller(auth)); }
  @Roles('Administrator') @Get('admin/users') async users(@Headers('authorization') auth: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('q') q?: string) { return this.app.adminUsers(await this.caller(auth), Number(page) || 1, Number(pageSize) || 10, q); }
  @Roles('Administrator') @Get('admin/users/archived') async archivedUsers(@Headers('authorization') auth: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('q') q?: string) { return this.app.adminArchivedUsers(await this.caller(auth), Number(page) || 1, Number(pageSize) || 10, q); }
  @Roles('Administrator') @Patch('admin/users/:id') async adminUser(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: unknown) { return this.app.adminUpdateUser(await this.caller(auth), id, body); }
  @Roles('Administrator') @Post('admin/users/:id/archive') async archiveUser(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.adminArchiveUser(await this.caller(auth), id); }
  @Roles('Administrator') @Post('admin/users/:id/restore') async restoreUser(@Headers('authorization') auth: string, @Param('id') id: string) { return this.app.adminRestoreUser(await this.caller(auth), id); }
  @Roles('Administrator') @Get('admin/logs') async logs(@Headers('authorization') auth: string) { const caller = await this.caller(auth); await this.app.admin(caller); return this.app.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } }); }
  @Roles('Administrator') @Get('admin/security-settings') async securitySettings(@Headers('authorization') auth: string) { return this.app.securitySettings(await this.caller(auth)); }
  @Roles('Administrator') @Put('admin/security-settings') async updateSecuritySettings(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.updateSecuritySettings(await this.caller(auth), parse(securitySettingsSchema, body)); }
  @Roles('Administrator') @Get('admin/general-settings') async adminGeneralSettings(@Headers('authorization') auth: string) { return this.app.generalSettings(await this.caller(auth)); }
  @Roles('Administrator') @Put('admin/general-settings') async updateGeneralSettings(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.updateGeneralSettings(await this.caller(auth), parse(adminGeneralSettingsSchema, body)); }
  @Roles('Administrator') @Post('admin/release/check') async checkRelease(@Headers('authorization') auth: string) { return this.app.checkForUpdates(await this.caller(auth)); }
  @Roles('Administrator') @Get('admin/system-notices') async systemNotices(@Headers('authorization') auth: string) { return this.app.systemNotices(await this.caller(auth)); }
  @Roles('Administrator') @Post('admin/system-notices/read') async readSystemNotices(@Headers('authorization') auth: string) { return this.app.markSystemNoticesRead(await this.caller(auth)); }
  @Roles('Administrator') @Get('admin/backups') async backups(@Headers('authorization') auth: string) { return this.app.databaseBackups(await this.caller(auth)); }
  @Roles('Administrator') @Post('admin/backups') async backup(@Headers('authorization') auth: string) { return this.app.createDatabaseBackup(await this.caller(auth)); }
  @Roles('Administrator') @Get('admin/backups/:fileName/download') async downloadBackup(@Headers('authorization') auth: string, @Param('fileName') fileName: string) { const { backup, content } = await this.app.databaseBackupFile(await this.caller(auth), fileName); return new StreamableFile(content, { type: 'application/json', disposition: `attachment; filename="${backup.fileName}"` }); }
  @Roles('Administrator') @Get('admin/settings') async settings(@Headers('authorization') auth: string) { const caller = await this.caller(auth); await this.app.admin(caller); return this.app.prisma.systemSetting.findMany(); }
  @Roles('Administrator') @Post('admin/maintenance/announcement') async announceMaintenance(@Headers('authorization') auth: string, @Body() body: unknown) { return this.app.announceMaintenance(await this.caller(auth), parse(maintenanceAnnouncementSchema, body)); }
  @Roles('Administrator') @Put('admin/settings') async setSettings(@Headers('authorization') auth: string, @Body() body: Record<string, unknown>) {
    const caller = await this.caller(auth);
    await this.app.admin(caller);
    const settings = body.maintenanceMode === false && !Object.prototype.hasOwnProperty.call(body, 'maintenanceSchedule')
      ? { ...body, maintenanceSchedule: null }
      : body;
    const changes = Object.entries(settings).map(([key, value]) => {
      const storedValue = value === null ? Prisma.JsonNull : value;
      return this.app.prisma.systemSetting.upsert({ where: { key }, update: { value: storedValue, updatedBy: caller.id }, create: { key, value: storedValue, updatedBy: caller.id } });
    });
    return this.app.prisma.$transaction(changes);
  }
}
