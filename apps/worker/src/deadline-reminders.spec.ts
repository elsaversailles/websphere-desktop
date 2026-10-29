import { describe, expect, it, vi } from 'vitest';
import { getNextMillis } from 'bullmq';
import { calendarDay, reminderPhase, reminderSlot, scanDeadlineReminders, scheduleDeadlineReminders } from './deadline-reminders.js';

function fixture() {
  const task = { id: 'task-1', status: 'pending', createdBy: 'creator-1', title: 'Report', deadline: new Date('2026-10-28T00:00:00Z'), assignments: [{ assigneeId: 'assigned-1' }], project: { title: 'Capstone' } };
  const stored = new Map<string, any>();
  const jobs = new Map<string, any>();
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockImplementation(async () => [task]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    notification: { upsert: vi.fn().mockImplementation(async ({ where, create }) => { if (!stored.has(where.id)) stored.set(where.id, create); return stored.get(where.id); }) },
  };
  const queue = { add: vi.fn().mockImplementation(async (_name, data, options) => { jobs.set(options.jobId, data); }) };
  const scan = (iso = '2026-10-28T02:00:00Z') => scanDeadlineReminders(prisma as any, queue as any, new Date(iso), 'Asia/Manila');
  return { prisma, queue, task, stored, jobs, scan };
}

describe('task deadline reminders', () => {
  it('replaces the legacy scans with a timezone-aware 10 AM and 8 PM schedule', async () => {
    const queue = { removeRepeatable: vi.fn().mockResolvedValue(true), add: vi.fn().mockResolvedValue({}) };
    await scheduleDeadlineReminders(queue as any, 'Asia/Manila');
    expect(queue.removeRepeatable).toHaveBeenCalledWith('hourly-scan', { every: 3_600_000 }, 'deadline-scan-hourly');
    expect(queue.removeRepeatable).toHaveBeenCalledWith('five-minute-scan', { every: 300_000 }, 'deadline-scan-five-minute');
    expect(queue.add).toHaveBeenCalledWith('twice-daily-scan', {}, expect.objectContaining({ repeat: { pattern: '0 10,20 * * *', tz: 'Asia/Manila' }, jobId: 'deadline-scan-twice-daily' }));
  });

  it('calculates the next runs as 10 AM, 8 PM, then 10 AM the following day in Manila', () => {
    const repeat = { pattern: '0 10,20 * * *', tz: 'Asia/Manila' };
    const morning = getNextMillis(new Date('2026-10-28T01:59:00Z').getTime(), repeat)!;
    const evening = getNextMillis(morning, repeat)!;
    const tomorrow = getNextMillis(evening, repeat)!;
    expect([morning, evening, tomorrow].map((at) => new Date(at).toISOString())).toEqual([
      '2026-10-28T02:00:00.000Z', '2026-10-28T12:00:00.000Z', '2026-10-29T02:00:00.000Z',
    ]);
  });

  it('sends separate morning and evening task reminders even when both have the same wording', async () => {
    const { scan, stored, jobs } = fixture();
    await scan('2026-10-28T02:00:00Z'); // 10 AM Manila
    await scan('2026-10-28T12:00:00Z'); // 8 PM Manila
    expect(stored.size).toBe(2);
    expect([...stored.values()].map((note) => note.message)).toEqual(['Task “Report” is due today.', 'Task “Report” is due today.']);
    expect([...jobs.values()].map((job) => job.reminder.slot)).toEqual(['10:00', '20:00']);
  });

  it('reuses the notification and delivery job across repeated/parallel scans within a slot', async () => {
    const { scan, stored, jobs, queue } = fixture();
    await Promise.all([scan(), scan(), scan('2026-10-28T02:05:00Z')]);
    expect(stored.size).toBe(1);
    expect(jobs.size).toBe(1);
    expect(queue.add).toHaveBeenCalledWith('deliver', expect.any(Object), expect.objectContaining({ jobId: [...stored.keys()][0], removeOnComplete: { age: 604800 }, attempts: 5 }));
  });

  it('does not duplicate a slot after a due-date change', async () => {
    const { scan, task, stored, jobs } = fixture();
    await scan();
    task.deadline = new Date('2026-11-08');
    await scan();
    expect(stored.size).toBe(1);
    expect(jobs.size).toBe(1);
    await scan('2026-10-28T12:00:00Z');
    expect(stored.size).toBe(2);
    expect([...stored.values()][1].message).toContain('Nov 8, 2026');
  });

  it('recovers notification delivery if a scan is interrupted after persisting the reminder', async () => {
    const { scan, stored, jobs, queue } = fixture();
    queue.add.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(scan()).rejects.toThrow('Redis unavailable');
    await scan();
    expect(stored.size).toBe(1);
    expect(jobs.size).toBe(1);
  });

  it('reminds the active assignee, falling back to the creator when unassigned', async () => {
    const { scan, task, stored, prisma } = fixture();
    task.assignments = [{ assigneeId: 'replacement-1' }];
    await scan();
    expect([...stored.values()].map((note) => note.userId)).toEqual(['replacement-1']);
    stored.clear();
    task.assignments = [];
    await scan();
    expect([...stored.values()].map((note) => note.userId)).toEqual(['creator-1']);
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { not: 'completed' }, deadline: { not: null } }, include: expect.objectContaining({ assignments: { where: { active: true } } }) }));
  });

  it('stops reminders after completion or date removal', async () => {
    const { scan, task, stored } = fixture();
    task.status = 'completed';
    await scan();
    task.status = 'pending';
    task.deadline = null as any;
    await scan();
    expect(stored.size).toBe(0);
  });

  it('reminds every day even when the due date is more than a day away', async () => {
    const { scan, task, stored } = fixture();
    task.deadline = new Date('2026-11-08');
    await scan();
    await scan('2026-10-28T12:00:00Z');
    await scan('2026-10-29T02:00:00Z');
    expect(stored.size).toBe(3);
    expect([...stored.values()].every((note) => note.message === 'Task “Report” is due on Nov 8, 2026.')).toBe(true);
  });

  it.each(['2026-10-28T01:59:00Z', '2026-10-28T03:00:00Z', '2026-10-28T11:59:00Z', '2026-10-28T13:00:00Z', '2026-10-28T16:00:00Z'])('does not scan outside the reminder delivery hours (%s)', async (now) => {
    const { scan, prisma, stored } = fixture();
    await scan(now);
    expect(stored.size).toBe(0);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('respects task notification preferences', async () => {
    const { scan, stored, queue, prisma } = fixture();
    prisma.notificationPreference.findUnique.mockResolvedValue({ tasks: false } as any);
    await scan();
    expect(stored.size).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sends tomorrow, due-day, and overdue reminders on their respective local dates', async () => {
    const { scan, stored } = fixture();
    await scan('2026-10-27T12:00:00Z');
    await scan();
    await scan('2026-10-29T02:00:00Z');
    expect([...stored.values()].map((note) => note.type)).toEqual(['deadline_reminder', 'deadline_reminder', 'delay_risk']);
    expect([...stored.values()].map((note) => note.message)).toEqual(['Task “Report” is due tomorrow.', 'Task “Report” is due today.', 'Task “Report” is overdue.']);
  });

  it('uses the configured timezone without shifting date-only task deadlines', () => {
    expect(calendarDay(new Date('2026-10-27T16:01:00Z'), 'Asia/Manila')).toBe('2026-10-28');
    expect(reminderSlot(new Date('2026-10-28T02:00:00Z'), 'Asia/Manila')).toBe('10:00');
    expect(reminderSlot(new Date('2026-10-28T12:00:00Z'), 'Asia/Manila')).toBe('20:00');
    expect(reminderSlot(new Date('2026-10-28T17:00:00Z'), 'America/Los_Angeles')).toBe('10:00');
    expect(reminderPhase(new Date('2026-10-28T00:00:00Z'), '2026-10-28')).toBe('today');
  });

  it('keeps project deadline reminders once per day', async () => {
    const { scan, prisma, stored } = fixture();
    prisma.task.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([{ id: 'project-1', title: 'Capstone', deadline: new Date('2026-10-28'), members: [{ userId: 'member-1' }] }] as any);
    await scan();
    await scan('2026-10-28T12:00:00Z');
    expect(stored.size).toBe(1);
    expect([...stored.values()][0].relatedType).toBe('project');
  });

  it('keeps the due-day wording and database size limit even for long titles', async () => {
    const { scan, task, prisma, stored } = fixture();
    task.title = 'A'.repeat(180);
    task.project.title = 'B'.repeat(180);
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }] as any);
    await scan();
    for (const note of stored.values()) {
      expect(note.message.length).toBeLessThanOrEqual(191);
      expect(note.message).toContain('is due today.');
    }
  });
});
