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

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export type PasswordRequirementId = 'length' | 'symbol' | 'number' | 'sequence';
export type PasswordRequirement = { id: PasswordRequirementId; label: string; met: boolean };
function hasMonotonicRun(password: string) {
  const lower = password.toLowerCase();
  for (let i = 0; i < lower.length - 3; i++) {
    const chars = lower.slice(i, i + 4);
    const deltas = [...chars].slice(1).map((c, n) => c.charCodeAt(0) - chars.charCodeAt(n));
    if (deltas.every((d) => d === 1) || deltas.every((d) => d === -1)) return true;
  }
  return false;
}
/** One entry per rule, so a UI can show live pass/fail per rule as the user types — not just the first failure. */
export function passwordRequirements(password: string): PasswordRequirement[] {
  return [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH },
    { id: 'symbol', label: 'At least one symbol', met: /[^A-Za-z0-9\s]/.test(password) },
    { id: 'number', label: 'At least one number', met: /\d/.test(password) },
    { id: 'sequence', label: 'No obvious sequences (e.g. abcd, 1234)', met: password.length === 0 || !hasMonotonicRun(password) },
  ];
}
/** Server-side gate: the first failing rule's id, matching the field error shape the rest of the API uses. */
export function validatePassword(password: string): { ok: true } | { ok: false; reason: PasswordRequirementId } {
  const failed = passwordRequirements(password).find((requirement) => !requirement.met);
  return failed ? { ok: false, reason: failed.id } : { ok: true };
}

/**
 * Best-effort list of well-known disposable/temporary-inbox providers. Services like these spin
 * up new domains constantly, so this will never be exhaustive — it stops the common, easily
 * guessed ones (the point is raising the bar on throwaway-account abuse, not perfect coverage).
 */
export const disposableEmailDomains = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com', 'burnermail.io',
  'dispostable.com', 'emailondeck.com', 'fakeinbox.com', 'fakemail.net', 'getairmail.com',
  'getnada.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'inboxkitten.com', 'maildrop.cc', 'mailcatch.com', 'mailinator.com', 'mailinator.net',
  'mailnesia.com', 'mailnull.com', 'mintemail.com', 'mohmal.com', 'moakt.com',
  'mytemp.email', 'pokemail.net', 'sharklasers.com', 'spam4.me', 'spamgourmet.com',
  'temp-mail.org', 'tempail.com', 'tempemail.co', 'tempinbox.com', 'tempmail.com',
  'tempmailo.com', 'temporary-mail.net', 'throwawaymail.com', 'trashmail.com', 'trashmail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
]);
function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? disposableEmailDomains.has(domain) : false;
}
/** Trim + require + validate the format, with a distinct message for "blank" vs "malformed". */
const requiredEmail = z.string().trim().min(1, 'Email is required').email('Enter a valid email address');
/** For flows that mint a new email on the account (registration, changing your email) — also
 * refuses known disposable-inbox domains. Not used at login/reset: existing accounts predating
 * this guardrail must still be able to sign in and recover access. */
const newAccountEmail = requiredEmail.refine((email) => !isDisposableEmail(email), { message: 'Disposable or temporary email addresses are not allowed. Please use a permanent email address.' });

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: newAccountEmail,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  institution: z.string().trim().min(2).max(160),
  course: z.string().trim().min(2).max(160),
});
export const registrationOtpRequestSchema = z.object({ email: newAccountEmail });
export const verifiedRegisterSchema = registerSchema.extend({
  verificationId: z.string().regex(/^[a-f0-9]{64}$/i),
  verificationCode: z.string().regex(/^\d{6}$/),
});
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4000),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(4000) });
export const loginSchema = z.object({ email: requiredEmail, password: z.string().min(1, 'Password is required') });
export const passwordChangeSchema = z.object({
  oldPassword: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  confirm: z.string().min(1),
});
export const passwordForgotSchema = z.object({ email: requiredEmail });
export const passwordResetSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  confirm: z.string().min(1),
});
export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: newAccountEmail.optional(),
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
/** `durationHours` is how long members may vote; null/omitted means no time limit (the leader closes it by hand). Up to 30 days. */
export const pollCreateSchema = z.object({ ideaIds: z.array(z.string().min(1)).min(2), durationHours: z.number().positive().max(720).nullable().optional() });
export const supportTicketSchema = z.object({ category: z.enum(['account_reactivation','account_deletion','password_concern','bug_report','other']), subject: z.string().trim().min(2), body: z.string().trim().min(1) });
export const ticketStatuses = ['pending', 'in_progress', 'resolved', 'rejected'] as const;
export type TicketStatus = (typeof ticketStatuses)[number];
/** What people see for each stored ticket status. */
export const ticketStatusLabels: Record<TicketStatus, string> = { pending: 'Ongoing', in_progress: 'In Progress', resolved: 'Completed', rejected: 'Declined' };
export const ticketUpdateSchema = z.object({ status: z.enum(ticketStatuses), response: z.string().trim().max(2000).optional() });
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
