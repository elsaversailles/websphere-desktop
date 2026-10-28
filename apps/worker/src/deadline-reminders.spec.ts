import { describe, expect, it, vi } from 'vitest';
import { calendarDay, reminderPhase, scanDeadlineReminders } from './deadline-reminders.js';

function fixture() {
  const task = { id: 'task-1', createdBy: 'creator-1', title: 'Report', deadline: new Date('2026-10-28T00:00:00Z'), assignments: [{ assigneeId: 'assigned-1' }], project: { title: 'Capstone' } };
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
  const scan = (iso = '2026-10-28T00:00:00Z') => scanDeadlineReminders(prisma as any, queue as any, new Date(iso), 'Asia/Manila');
  return { prisma, queue, task, stored, jobs, scan };
}

describe('task deadline reminders', () => {
  it('sends a separate due-today reminder even immediately after yesterday’s advance reminder', async () => {
    const { scan, stored, jobs } = fixture();
    await scan('2026-10-27T15:59:00Z'); // Oct 27, 23:59 Manila
    await scan('2026-10-27T16:01:00Z'); // Oct 28, 00:01 Manila
    expect([...stored.values()].map((note) => note.message)).toEqual(['Task “Report” is due tomorrow.', 'Task “Report” is due today.']);
    expect(jobs.size).toBe(2);
    expect([...stored.values()].every((note) => note.userId === 'assigned-1' && note.type === 'deadline_reminder' && note.relatedType === 'task')).toBe(true);
  });

  it('reuses the notification and delivery job across repeated/parallel scans', async () => {
    const { scan, stored, jobs, queue } = fixture();
    await Promise.all([scan(), scan(), scan('2026-10-28T08:00:00Z')]);
    expect(stored.size).toBe(1);
    expect(jobs.size).toBe(1);
    expect(queue.add).toHaveBeenCalledWith('deliver', expect.any(Object), expect.objectContaining({ jobId: [...stored.keys()][0], removeOnComplete: { age: 604800 }, attempts: 5 }));
  });

  it('recovers notification delivery if a scan is interrupted after persisting the reminder', async () => {
    const { scan, stored, jobs, queue } = fixture();
    queue.add.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(scan()).rejects.toThrow('Redis unavailable');
    await scan();
    expect(stored.size).toBe(1);
    expect(jobs.size).toBe(1);
  });

  it('reminds only the active responsible user, falling back to the creator when unassigned', async () => {
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

  it('does not send reminders for completed tasks, missing dates, or dates further in the future', async () => {
    const { scan, task, stored, prisma } = fixture();
    prisma.task.findMany.mockResolvedValueOnce([]);
    await scan();
    task.deadline = null as any;
    await scan();
    task.deadline = new Date('2026-11-04');
    await scan();
    expect(stored.size).toBe(0);
  });

  it('respects task notification preferences', async () => {
    const { scan, stored, queue, prisma } = fixture();
    prisma.notificationPreference.findUnique.mockResolvedValue({ tasks: false } as any);
    await scan();
    expect(stored.size).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sends an overdue alert on the following local day, separate from the due-day reminder', async () => {
    const { scan, stored } = fixture();
    await scan();
    await scan('2026-10-28T16:01:00Z');
    expect([...stored.values()].map((note) => note.type)).toEqual(['deadline_reminder', 'delay_risk']);
  });

  it('uses the configured timezone without shifting date-only task deadlines', () => {
    expect(calendarDay(new Date('2026-10-27T16:01:00Z'), 'Asia/Manila')).toBe('2026-10-28');
    expect(calendarDay(new Date('2026-10-28T01:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-27');
    expect(reminderPhase(new Date('2026-10-28T00:00:00Z'), '2026-10-28')).toBe('today');
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
