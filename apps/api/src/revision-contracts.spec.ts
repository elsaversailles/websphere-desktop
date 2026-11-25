import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { identifyResourceLink } from '@websphere/shared';
import { maintenanceState } from './maintenance-state.js';
import { activityPoints, activityRanges } from './admin-activity.js';
import { workflowBuckets } from './workflow-reporting.js';
import { AppController } from './app.controller.js';
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

  it('filters projects by the same task progress shown on their status badges before paging', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'review', group: null, members: [] }]);
    const count = vi.fn().mockResolvedValue(1);
    const groupBy = vi.fn()
      .mockResolvedValueOnce([
        { projectId: 'review', status: 'completed', _count: { _all: 3 } },
        { projectId: 'review', status: 'pending', _count: { _all: 1 } },
        { projectId: 'ongoing', status: 'ongoing', _count: { _all: 1 } },
      ])
      .mockResolvedValue([]);
    const service = Object.create(AppService.prototype) as any;
    service.prisma = { project: { findMany, count }, task: { groupBy } };
    await service.projectList({ id: 'member' }, { page: 2, pageSize: 10, progressStatus: 'for_review' });
    const filtered = { id: { in: ['review'] }, AND: { status: { notIn: ['on_hold', 'archived'] } } };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining(filtered) }));
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining(filtered) });
    expect(groupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { project: expect.objectContaining({ members: { some: { userId: 'member' } } }) } }));
  });

  it('keeps unavailable administrator history empty until the first known count', () => {
    const ranges = activityRanges('weekly', '2026-11-24');
    expect(activityPoints(ranges, [{ date: '2026-11-22', count: 12 }, { date: '2026-11-24', count: 13 }]).map((point) => point.value)).toEqual([null, null, null, null, 12, 12, 13]);
  });

  it('reports the total active projects above distinct changes in each chart period', async () => {
    const oldProject = { createdAt: new Date('2026-01-01T00:00:00Z'), activityDays: [], tasks: [], workflow: [], linkedResources: [] };
    const timestamp = (value: string) => ({ createdAt: new Date(value) });
    const findMany = vi.fn().mockResolvedValue([
      {
        ...oldProject,
        activityDays: [{ date: '2026-11-24' }, { date: '2026-11-25' }],
        tasks: [timestamp('2026-11-24T16:00:00Z')],
        workflow: [timestamp('2026-11-24T15:59:59Z'), timestamp('2026-11-24T16:10:00Z')],
      },
      { ...oldProject, linkedResources: [timestamp('2026-11-24T16:20:00Z')] },
      oldProject,
    ]);
    const count = vi.fn().mockResolvedValue(5);
    const service = Object.assign(Object.create(AppService.prototype), {
      prisma: { project: { count, findMany } },
    }) as AppService;
    const admin = { id: 'admin', role: 'Administrator' as const, tv: 0 };
    vi.stubEnv('APP_TIME_ZONE', 'Asia/Manila');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    try {
      const weekly = await service.adminActivity(admin, 'projects', 'weekly');
      expect(weekly.current).toBe(5);
      expect(weekly.points.map(({ value }) => value)).toEqual([0, 0, 0, 0, 0, 1, 2]);
      const sixMonths = await service.adminActivity(admin, 'projects', 'six-months');
      expect(sixMonths.current).toBe(5);
      expect(sixMonths.points.at(-1)).toEqual({ label: 'Nov', value: 2 });
      expect(count).toHaveBeenCalledWith({ where: { status: 'active' } });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: 'active' }),
      }));
      const query = findMany.mock.calls[0][0];
      expect(query.select).not.toHaveProperty('members');
      expect(query.where.OR.some((filter: object) => 'members' in filter)).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it('records a new project membership as activity and leaves repeat requests idempotent', async () => {
    const membership = { id: 'membership', userId: 'member-2', projectId: 'project-1', role: 'Project_Member' };
    const createMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const markActivity = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      projectMember: { createMany, findUniqueOrThrow: vi.fn().mockResolvedValue(membership) },
      projectActivityDay: { createMany: markActivity },
    };
    const emitAdminActivity = vi.fn();
    const service = Object.assign(Object.create(AppService.prototype), {
      prisma: {
        project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ groupId: 'group-1' }) },
        $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      },
      projectMember: vi.fn().mockResolvedValue({ role: 'Project_Leader' }),
      member: vi.fn().mockResolvedValue({ role: 'Project_Member' }),
      events: { emitAdminActivity },
    }) as AppService;
    const leader = { id: 'leader', role: 'Project_Leader' as const, tv: 0 };
    await expect(service.addProjectMember(leader, 'project-1', 'member-2')).resolves.toEqual(membership);
    await expect(service.addProjectMember(leader, 'project-1', 'member-2')).resolves.toEqual(membership);
    expect(markActivity).toHaveBeenCalledTimes(1);
    expect(markActivity).toHaveBeenCalledWith({
      data: { projectId: 'project-1', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      skipDuplicates: true,
    });
    expect(emitAdminActivity.mock.calls).toEqual([['projects']]);
  });

  it('detects allowed URL services and rejects unlisted and invalid URLs', () => {
    expect(identifyResourceLink('https://www.canva.com/design/abc')).toMatchObject({ provider: 'canva' });
    expect(identifyResourceLink('https://canva.com.example.edu/?next=https://canva.com')).toBeNull();
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

  it('reports a selected calendar week and includes members at zero progress in overall efficiency', async () => {
    const service = Object.create(AppService.prototype) as any;
    service.projectMember = vi.fn().mockResolvedValue({});
    const start = new Date('2026-11-15T16:00:00Z');
    const findEvents = vi.fn().mockResolvedValue([
      { actorId: 'ada', type: 'task_completed', createdAt: start, taskId: 'task-1' },
      { actorId: 'ada', type: 'task_completed', createdAt: new Date(+start + 1000), taskId: 'task-1' },
    ]);
    const assignments = vi.fn().mockResolvedValue([{ assigneeId: 'ada', task: { status: 'completed' } }]);
    const memberIds = ['ada', 'ben', 'cam'];
    service.prisma = {
      projectMember: { findMany: vi.fn().mockResolvedValue(memberIds.map((id) => ({ userId: id, role: 'Project_Member', user: { fullName: id }, project: { group: null } }))) },
      taskAssignment: { findMany: assignments },
      workflowEvent: { findMany: findEvents },
    };
    vi.stubEnv('APP_TIME_ZONE', 'Asia/Manila');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    try {
      const report = await service.workflowReport({ id: 'ada' }, 'project-1', 'weekly', '2026-11-19');
      expect(report).toMatchObject({
        start: '2026-11-16', end: '2026-11-23',
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        totals: [1, 0, 0, 0, 0, 0, 0], tasksCompleted: 1, overallEfficiency: 33,
      });
      expect(report.members.map(({ performance }: { performance: number }) => performance)).toEqual([100, 0, 0]);
      expect(findEvents).toHaveBeenCalledWith(expect.objectContaining({ where: {
        projectId: 'project-1', createdAt: { gte: start, lt: new Date('2026-11-22T16:00:00Z') },
      } }));
      assignments.mockResolvedValueOnce(memberIds.map((assigneeId) => ({ assigneeId, task: { status: 'completed' } })));
      await expect(service.workflowReport({ id: 'ada' }, 'project-1', 'weekly', '2026-11-19')).resolves.toMatchObject({ overallEfficiency: 100 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it('uses local day hours and month-bounded weeks for calendar-aligned reports', () => {
    const daily = workflowBuckets('daily', '2026-11-25', '2026-11-25', 'Asia/Manila', true);
    expect(daily.buckets.map((bucket) => bucket.label)).toEqual(['12am', '6am', '12pm', '6pm']);
    expect(daily.buckets[0].start.toISOString()).toBe('2026-11-24T16:00:00.000Z');
    const monthly = workflowBuckets('monthly', '2026-02-15', '2026-03-01', 'Asia/Manila', true);
    expect(monthly.buckets[0].start.toISOString()).toBe('2026-01-31T16:00:00.000Z');
    expect(monthly.buckets.at(-1)?.end.toISOString()).toBe('2026-02-28T16:00:00.000Z');
    expect(monthly.buckets.every((bucket, index) => index === 0 || +monthly.buckets[index - 1].end === +bucket.start)).toBe(true);
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

  it('accepts a 100-character calendar note and rejects a longer one', async () => {
    const caller = { id: 'ada' };
    const saveCalendarNote = vi.fn().mockResolvedValue(undefined);
    const controller = Object.assign(Object.create(AppController.prototype), {
      caller: vi.fn().mockResolvedValue(caller),
      app: { saveCalendarNote },
    }) as AppController;
    const date = '2026-11-24';
    const body = 'x'.repeat(100);
    await controller.saveNote('Bearer token', date, { body });
    await expect(controller.saveNote('Bearer token', date, { body: body + 'x' })).rejects.toMatchObject({ status: 400 });
    expect(saveCalendarNote).toHaveBeenCalledTimes(1);
    expect(saveCalendarNote).toHaveBeenCalledWith(caller, date, body);
  });
});
