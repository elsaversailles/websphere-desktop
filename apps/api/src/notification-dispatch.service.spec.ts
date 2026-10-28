import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationDispatchService } from './notification-dispatch.service.js';

function fixture(status = 'active') {
  const notification = { id: 'reminder-1', userId: 'user-1', type: 'deadline_reminder', message: 'Task “Report” is due today.', relatedId: 'task-1', relatedType: 'task', user: { status, role: 'Project_Member' } };
  const prisma = { notification: { findUnique: vi.fn().mockResolvedValue(notification) }, task: { findUnique: vi.fn().mockResolvedValue({ status: 'pending', deadline: new Date('2026-10-28'), createdBy: 'creator-1', assignments: [{ assigneeId: 'user-1' }] }) } };
  const events = { emitNotification: vi.fn() };
  const push = { deliver: vi.fn().mockResolvedValue(undefined) };
  const jobs = { enqueueNotificationEmail: vi.fn().mockResolvedValue(undefined) };
  const service = new NotificationDispatchService(prisma as any, {} as any, events as any, push as any, jobs as any);
  return { service, prisma, events, push, jobs };
}

describe('scheduled notification delivery', () => {
  afterEach(() => vi.useRealTimers());
  it('relays a due-day reminder to the live calendar/dashboard, mobile push, and email queue', async () => {
    const { service, events, push, jobs } = fixture();
    await service.deliver('reminder-1');
    expect(jobs.enqueueNotificationEmail).toHaveBeenCalledWith('reminder-1');
    expect(events.emitNotification).toHaveBeenCalledWith('user-1', expect.objectContaining({ type: 'deadline_reminder', relatedId: 'task-1' }));
    expect(push.deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', message: 'Task “Report” is due today.' }));
    expect(push.deliver.mock.calls[0][0]).not.toHaveProperty('user');
  });

  it('skips missing notifications and inactive recipients', async () => {
    const { service, prisma, events, push, jobs } = fixture('archived');
    await service.deliver('reminder-1');
    prisma.notification.findUnique.mockResolvedValueOnce(null as any);
    await service.deliver('deleted-reminder');
    expect(events.emitNotification).not.toHaveBeenCalled();
    expect(push.deliver).not.toHaveBeenCalled();
    expect(jobs.enqueueNotificationEmail).not.toHaveBeenCalled();
  });

  it('lets BullMQ retry when email queueing is unavailable', async () => {
    const { service, jobs } = fixture();
    jobs.enqueueNotificationEmail.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.deliver('reminder-1')).rejects.toThrow('Redis unavailable');
  });

  it.each([
    null,
    { status: 'completed', deadline: new Date('2026-10-28'), assignments: [{ assigneeId: 'user-1' }] },
    { status: 'pending', deadline: null, assignments: [{ assigneeId: 'user-1' }] },
    { status: 'pending', deadline: new Date('2026-10-28'), assignments: [{ assigneeId: 'replacement-1' }] },
  ])('suppresses a queued reminder after task deletion, completion, date removal, or reassignment (%j)', async (task) => {
    const { service, prisma, events, push, jobs } = fixture();
    prisma.task.findUnique.mockResolvedValueOnce(task as any);
    await service.deliver('reminder-1');
    expect(events.emitNotification).not.toHaveBeenCalled();
    expect(push.deliver).not.toHaveBeenCalled();
    expect(jobs.enqueueNotificationEmail).not.toHaveBeenCalled();
  });

  it('suppresses queued reminders for a changed due date or a previous calendar day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T04:00:00Z'));
    const { service, events, push, jobs } = fixture();
    await service.deliver('reminder-1', { deadline: '2026-10-29T00:00:00.000Z', day: '2026-10-28', timeZone: 'Asia/Manila' });
    await service.deliver('reminder-1', { deadline: '2026-10-28T00:00:00.000Z', day: '2026-10-27', timeZone: 'Asia/Manila' });
    expect(events.emitNotification).not.toHaveBeenCalled();
    expect(push.deliver).not.toHaveBeenCalled();
    expect(jobs.enqueueNotificationEmail).not.toHaveBeenCalled();
  });
});
