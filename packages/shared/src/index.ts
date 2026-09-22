import { z } from 'zod';

export const roles = ['Administrator', 'Project_Leader', 'Project_Member'] as const;
export type Role = (typeof roles)[number];
export type ApiError = { code: string; message: string; fields?: Record<string, string> };
export type AckDto = { ok: boolean; error?: ApiError };
export type CallKind = 'voice' | 'video';
export type CallParticipant = { socketId: string; userId: string; fullName?: string };
export type CallSignal = { type: 'offer' | 'answer' | 'ice-candidate'; sdp?: string; candidate?: RTCIceCandidateInit | null };
export type CallHostAction = 'mute-all' | 'remove-participant' | 'end-call';
export type IceServerConfig = { urls: string | string[]; username?: string; credential?: string };

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  institution: z.string().trim().min(2).max(160),
  course: z.string().trim().min(2).max(160),
});
export const registrationOtpRequestSchema = z.object({ email: z.string().trim().email() });
export const verifiedRegisterSchema = registerSchema.extend({
  verificationId: z.string().regex(/^[a-f0-9]{64}$/i),
  verificationCode: z.string().regex(/^\d{6}$/),
});
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4000),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(4000) });
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const passwordChangeSchema = z.object({
  oldPassword: z.string().min(1),
  password: z.string().min(8).max(128),
  confirm: z.string().min(1),
});
export const passwordForgotSchema = z.object({ email: z.string().trim().email() });
export const passwordResetSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(8).max(128),
  confirm: z.string().min(1),
});
export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().optional(),
  institution: z.string().trim().min(2).max(160).optional(),
  course: z.string().trim().min(2).max(160).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one profile field' });
export const projectSchema = z.object({
  groupId: z.string().cuid(), title: z.string().trim().min(2).max(180), description: z.string().trim().min(1),
  startDate: z.coerce.date().optional(), deadline: z.coerce.date().optional(), memberIds: z.array(z.string().cuid()).default([]),
});
export const taskSchema = z.object({
  title: z.string().trim().min(2).max(180), description: z.string().trim().min(1), deadline: z.coerce.date().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'), expectedDurationHrs: z.number().positive().optional(),
});
export const taskStatusSchema = z.object({ status: z.enum(['pending', 'ongoing', 'for_review', 'completed']) });
export const resourceLinkSchema = z.object({
  connectionId: z.string().cuid(),
  title: z.string().trim().min(2).max(180),
  externalUrl: z.string().url().max(4000),
  externalId: z.string().trim().min(1).max(512).optional(),
});
export const resourceUpdateSchema = resourceLinkSchema.extend({
  assigneeId: z.string().cuid().optional(),
  status: z.enum(['pending', 'ongoing', 'for_review', 'completed']).optional(),
});
export const ideaSchema = z.object({ title: z.string().trim().min(2).max(180), body: z.string().trim().min(1) });
export const calendarEventSchema = z.object({ title: z.string().trim().min(2), type: z.enum(['meeting','work_session','presentation','activity']), startAt: z.coerce.date(), endAt: z.coerce.date().optional(), projectId: z.string().cuid().optional() });
export const supportTicketSchema = z.object({ category: z.enum(['account_reactivation','account_deletion','password_concern','bug_report','other']), subject: z.string().trim().min(2), body: z.string().trim().min(1) });
export const aiAskSchema = z.object({ prompt: z.string().trim().min(1).max(12000), scopeType: z.enum(['project','group','idea']).optional(), scopeId: z.string().cuid().optional(), parts: z.array(z.object({ type: z.string() })).optional() });
export const announcementSchema = z.object({ title: z.string().trim().min(2).max(180), body: z.string().trim().min(1), priority: z.enum(['normal','important','urgent']).default('normal') });

export type RegisterDto = z.infer<typeof registerSchema>;
export type VerifiedRegisterDto = z.infer<typeof verifiedRegisterSchema>;
export type PasswordChangeDto = z.infer<typeof passwordChangeSchema>;
export type PasswordResetDto = z.infer<typeof passwordResetSchema>;
export type ProfileUpdateDto = z.infer<typeof profileUpdateSchema>;
export type CreateProjectDto = z.infer<typeof projectSchema>;
export type CreateTaskDto = z.infer<typeof taskSchema>;
export type TaskStatusDto = z.infer<typeof taskStatusSchema>;
export type CreateAnnouncementDto = z.infer<typeof announcementSchema>;
export type ServerToClientEvents = {
  'chat:message': (message: unknown) => void;
  'presence:update': (presence: unknown) => void;
  'task:updated': (task: unknown) => void;
  'poll:tally': (tally: unknown) => void;
  'notification:new': (notification: unknown) => void;
  'activity:new': (activity: unknown) => void;
  'sync:reconcile': (state: unknown) => void;
  'call:invite': (call: { groupId: string; kind: CallKind; initiatorSocketId: string; initiatorUserId: string }) => void;
  'call:participant-joined': (call: { groupId: string; participant: CallParticipant; hostSocketId: string }) => void;
  'call:participant-left': (call: { groupId: string; socketId: string }) => void;
  'call:signal': (signal: { groupId: string; fromSocketId: string; signal: CallSignal }) => void;
  'call:host-changed': (call: { groupId: string; hostSocketId: string | null }) => void;
  'call:screen-share': (call: { groupId: string; socketId: string; sharing: boolean }) => void;
  'call:mute-request': (call: { groupId: string }) => void;
  'call:removed': (call: { groupId: string }) => void;
  'call:ended': (call: { groupId: string }) => void;
  'call:raise-hand': (call: { groupId: string; socketId: string; raised: boolean }) => void;
};
export type ClientToServerEvents = {
  'chat:send': (message: { groupId: string; body: string }, ack: (result: AckDto) => void) => void;
  'group:join': (groupId: string, ack: (result: AckDto) => void) => void;
  'project:join': (projectId: string, ack: (result: AckDto) => void) => void;
  'sync:request': (cursor: { projectId: string; cursor?: string }, ack: (state: unknown) => void) => void;
  'call:join': (call: { groupId: string; kind: CallKind }, ack: (result: AckDto & { participants?: CallParticipant[]; hostSocketId?: string; raisedHandSocketIds?: string[] }) => void) => void;
  'call:leave': (call: { groupId: string }, ack: (result: AckDto) => void) => void;
  'call:signal': (signal: { groupId: string; targetSocketId: string; signal: CallSignal }, ack: (result: AckDto) => void) => void;
  'call:screen-share': (share: { groupId: string; sharing: boolean }, ack: (result: AckDto) => void) => void;
  'call:host-action': (action: { groupId: string; action: CallHostAction; targetSocketId?: string }, ack: (result: AckDto) => void) => void;
  'call:raise-hand': (hand: { groupId: string; raised: boolean }, ack: (result: AckDto) => void) => void;
};

export const apiError = (code: string, message: string, fields?: Record<string, string>): ApiError => ({ code, message, ...(fields ? { fields } : {}) });
