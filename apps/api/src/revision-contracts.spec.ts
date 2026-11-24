import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { identifyResourceLink } from '@websphere/shared';
import { maintenanceState } from './maintenance-state.js';
import { activityPoints, activityRanges } from './admin-activity.js';
import { AppService } from './app.service.js';

function recoveryFixture() {
  let now = 0;
  const entries = new Map<string, { value: string; expires: number }>();
  const get = async (key: string) => {
    const entry = entries.get(key);
    return entry && entry.expires > now ? entry.value : null;
  };
  const set = async (key: string, value: string, seconds: number) => { entries.set(key, { value, expires: now + seconds }); };
  const service = Object.create(AppService.prototype) as any;
  const user = { id: 'user-1', email: 'member@example.edu', tokenVersion: 1, role: 'Project_Member', status: 'active', passwordEnabled: true };
  const sendPasswordRecoveryCode = vi.fn().mockResolvedValue(true);
  const issue = vi.fn().mockResolvedValue({ access: 'access', refresh: 'refresh', role: user.role });
  Object.assign(service, {
    prisma: { user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue(user) } },
    redis: {
      get, set, setMembers: async () => [], delete: async (...keys: string[]) => keys.forEach((key) => entries.delete(key)),
      incrementWithExpiry: async (key: string, seconds: number) => { const count = Number(await get(key) ?? 0) + 1; await set(key, String(count), seconds); return count; },
      replaceIfCurrent: async (key: string, expected: string, next?: string, seconds = 0) => {
        if (await get(key) !== expected) return false;
        if (next) await set(key, next, seconds); else entries.delete(key);
        return true;
      },
    },
    config: { get: (key: string) => ({ REGISTRATION_OTP_MAX_ATTEMPTS: 5, REGISTRATION_OTP_MAX_SENDS: 3, REGISTRATION_OTP_SEND_WINDOW_SECONDS: 900 }[key]) },
    email: { sendPasswordRecoveryCode },
    audit: { log: vi.fn() }, issue,
  });
  return { service, user, issue, sendPasswordRecoveryCode, advance: (seconds: number) => { now += seconds; } };
}

describe('five-minute in-app recovery', () => {
  it('replaces old codes, issues a reset-only token and signs in only after a successful password change', async () => {
    const { service, user, issue, sendPasswordRecoveryCode } = recoveryFixture();
    const original = await service.requestPasswordRecovery(user.email);
    const newest = await service.requestPasswordRecovery(user.email);
    expect(newest).toEqual({ ok: true, verificationId: expect.any(String) });
    const [oldCode, newCode] = sendPasswordRecoveryCode.mock.calls.map(([, code]) => code);
    await expect(service.verifyPasswordRecovery(user.email, original.verificationId, oldCode)).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
    const verified = await service.verifyPasswordRecovery(user.email, newest.verificationId, newCode);
    expect(issue).not.toHaveBeenCalled();
    await expect(service.verifyPasswordRecovery(user.email, newest.verificationId, newCode)).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
    await expect(service.completePasswordRecovery(user.email, verified.token, 'Valid!Pass9', 'Valid!Pass9', 'mobile')).resolves.toMatchObject({ access: 'access', user: { id: user.id } });
    expect(issue).toHaveBeenCalledOnce();
    await expect(service.completePasswordRecovery(user.email, verified.token, 'Valid!Pass9', 'Valid!Pass9', 'mobile')).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
  });

  it('expires at 300 seconds and sends no recovery code for a Google-only or archived account', async () => {
    const { service, user, advance, sendPasswordRecoveryCode } = recoveryFixture();
    const challenge = await service.requestPasswordRecovery(user.email);
    advance(300);
    await expect(service.verifyPasswordRecovery(user.email, challenge.verificationId, sendPasswordRecoveryCode.mock.calls[0][1])).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
    user.passwordEnabled = false;
    await service.requestPasswordRecovery(user.email);
    user.status = 'archived';
    user.passwordEnabled = true;
    await service.requestPasswordRecovery(user.email);
    expect(sendPasswordRecoveryCode).toHaveBeenCalledOnce();
  });
});

describe('Google identity exchange', () => {
  it('requires possession of the verifier and never silently links an existing email', async () => {
    const { service, issue, user } = recoveryFixture();
    const verifier = 'e'.repeat(64);
    const code = 'f'.repeat(64);
    await service.redis.set(`auth:google:exchange:${code}`, JSON.stringify({
      flow: { mode: 'register', clientType: 'web', challenge: createHash('sha256').update(verifier).digest('hex') },
      identity: { subject: 'google-subject', email: user.email, fullName: 'Member' },
    }), 60);
    service.prisma.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.email ? user : null));
    await expect(service.exchangeGoogle(code, '0'.repeat(64))).rejects.toMatchObject({ response: { code: 'GOOGLE_EXPIRED' } });
    await expect(service.exchangeGoogle(code, verifier)).rejects.toMatchObject({ response: { code: 'GOOGLE_LINK_REQUIRED' } });
    expect(service.prisma.user.update).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });
});

describe('Google linked sessions', () => {
  it.each(['active', 'archived', 'administrator'] as const)('checks the linked account before issuing a session for %s', async (state) => {
    const { service, issue, user } = recoveryFixture();
    const linked = { ...user, googleSubject: 'google-subject', status: state === 'archived' ? 'archived' : 'active', role: state === 'administrator' ? 'Administrator' : user.role };
    service.prisma.user.findUnique.mockResolvedValue(linked);
    service.prisma.user.update.mockResolvedValue(linked);
    const verifier = 'e'.repeat(64);
    const code = 'f'.repeat(64);
    await service.redis.set(`auth:google:exchange:${code}`, JSON.stringify({
      flow: { mode: 'login', clientType: 'mobile', challenge: createHash('sha256').update(verifier).digest('hex') },
      identity: { subject: linked.googleSubject, email: linked.email, fullName: 'Member' },
    }), 60);
    const result = service.exchangeGoogle(code, verifier);
    if (state === 'active') {
      const session = await result;
      expect(session).toMatchObject({ access: 'access', user: { googleLinked: true } });
      expect(session.user).not.toHaveProperty('googleSubject');
      expect(issue).toHaveBeenCalledWith(linked, undefined, undefined, 'mobile');
    } else {
      const error = state === 'archived' ? 'ACCOUNT_ARCHIVED' : 'ADMIN_UNAUTHORIZED';
      await expect(result).rejects.toMatchObject({ response: { code: error } });
      expect(issue).not.toHaveBeenCalled();
    }
  });
});

it('uses the same database maintenance flag and schedule for status and request enforcement', () => {
  const now = new Date('2026-11-24T08:00:00.000Z');
  expect(maintenanceState(true, null, now)).toEqual({ active: true, scheduledStart: null });
  expect(maintenanceState(false, { startsAt: '2026-11-24T09:00:00.000Z' }, now)).toEqual({ active: false, scheduledStart: '2026-11-24T09:00:00.000Z' });
  expect(maintenanceState(false, { startsAt: '2026-11-24T08:00:00.000Z' }, now).active).toBe(true);
  expect(maintenanceState(false, null, now).active).toBe(false);
});

describe('bounded project views', () => {
  it('uses database skip/take and aggregates statuses for only the returned project IDs', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'p-1', group: null, members: [] }]);
    const groupBy = vi.fn().mockResolvedValue([{ projectId: 'p-1', status: 'ongoing', _count: { _all: 1 } }]);
    const service = Object.create(AppService.prototype) as any;
    service.prisma = { project: { findMany, count: vi.fn().mockResolvedValue(51) }, task: { groupBy } };
    await expect(service.projectList({ id: 'member' }, { page: 3, pageSize: 10, q: 'biology', status: 'active' })).resolves.toMatchObject({ total: 51, page: 3, items: [{ progressAverage: 50 }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10, where: expect.objectContaining({ status: 'active', title: { contains: 'biology' } }) }));
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: { in: ['p-1'] } } }));
  });

  it('keeps unavailable administrator history empty until the first known count', () => {
    const ranges = activityRanges('weekly', '2026-11-24');
    expect(activityPoints(ranges, [{ date: '2026-11-22', count: 12 }, { date: '2026-11-24', count: 13 }]).map((point) => point.value)).toEqual([null, null, null, null, 12, 12, 13]);
  });

  it('detects URL services from the hostname and safely labels unknown HTTPS sites', () => {
    expect(identifyResourceLink('https://www.canva.com/design/abc')).toMatchObject({ provider: 'canva' });
    expect(identifyResourceLink('https://canva.com.example.edu/?next=https://canva.com')).toMatchObject({ provider: null });
    expect(identifyResourceLink('https://canva.com@elsewhere.example.edu/')).toBeNull();
    expect(identifyResourceLink('javascript:alert(1)')).toBeNull();
  });
});

describe('project workflow and personal notes', () => {
  it('weights ongoing work at 50% per task and counts only completed workflow events', async () => {
    const service = Object.create(AppService.prototype) as any;
    const projectId = 'project-1';
    service.projectMember = vi.fn().mockResolvedValue({});
    const findEvents = vi.fn().mockResolvedValue([
      { actorId: 'ada', type: 'status_change', createdAt: new Date(), taskId: 'task-1' },
    ]);
    const taskAssignments = vi.fn().mockResolvedValue([
      { assigneeId: 'ada', task: { status: 'ongoing' } },
      { assigneeId: 'ada', task: { status: 'pending' } },
    ]);
    service.prisma = {
      projectMember: { findMany: vi.fn().mockResolvedValue([{ role: 'Project_Member', userId: 'ada', user: { fullName: 'Ada' }, project: { group: null } }]) },
      workflowEvent: { findMany: findEvents },
      taskAssignment: { findMany: taskAssignments },
    };
    const weekly = await service.workflowReport({ id: 'ada' }, projectId, 'weekly');
    expect(service.projectMember).toHaveBeenCalledWith(projectId, 'ada');
    expect(findEvents).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId, createdAt: { gte: expect.any(Date), lt: expect.any(Date) } } }));
    expect(weekly.labels).toHaveLength(7);
    expect(weekly.members[0]).toMatchObject({ performance: 25, completions: [0, 0, 0, 0, 0, 0, 0] });
    taskAssignments.mockResolvedValueOnce([{ assigneeId: 'ada', task: { status: 'completed' } }, { assigneeId: 'ada', task: { status: 'pending' } }]);
    findEvents.mockResolvedValueOnce([{ actorId: 'ada', type: 'task_completed', createdAt: new Date(), taskId: 'task-1' }]);
    const completed = await service.workflowReport({ id: 'ada' }, projectId, 'weekly');
    expect(completed.members[0]).toMatchObject({ performance: 50, completions: [0, 0, 0, 0, 0, 0, 1] });
  });

  it('reads and writes a note using the account and calendar date together', async () => {
    const service = Object.create(AppService.prototype) as any;
    const findUnique = vi.fn().mockResolvedValue(null);
    const upsert = vi.fn().mockResolvedValue({ date: '2026-11-24', body: 'Draft methodology' });
    service.prisma = { calendarNote: { findUnique, upsert } };
    const caller = { id: 'ada' };
    const scope = { ownerId_date: { ownerId: 'ada', date: '2026-11-24' } };
    await expect(service.calendarNote(caller, '2026-11-24')).resolves.toEqual({ date: '2026-11-24', body: '' });
    await expect(service.saveCalendarNote(caller, '2026-11-24', 'Draft methodology')).resolves.toMatchObject({ body: 'Draft methodology' });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: scope }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: scope, create: { ownerId: 'ada', date: '2026-11-24', body: 'Draft methodology' } }));
  });
});
