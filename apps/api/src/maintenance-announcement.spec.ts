import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service.js';

const admin = { id: 'admin-1', role: 'Administrator' as const, tv: 0 };

function fixture(active = false) {
  const notify = vi.fn().mockResolvedValue({ ok: true, delivered: 2 });
  const upsert = vi.fn().mockResolvedValue({});
  const log = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(AppService.prototype) as AppService;
  Object.assign(service, {
    admin: vi.fn().mockResolvedValue(undefined),
    maintenanceStatus: vi.fn().mockResolvedValue({ active }),
    prisma: { user: { findMany: vi.fn().mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]) }, systemSetting: { upsert } },
    notify,
    audit: { log },
  });
  return { service, notify, upsert, log };
}

describe('maintenance announcement', () => {
  it('notifies active users and records the scheduled start as already announced', async () => {
    const { service, notify, upsert, log } = fixture();
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const result = await service.announceMaintenance(admin, { startsAt, message: 'WebSphere will be unavailable for maintenance.' });
    expect(result).toEqual({ startsAt, notified: 2 });
    expect(notify).toHaveBeenCalledWith(['user-1', 'user-2'], 'announcement', 'WebSphere will be unavailable for maintenance.', 'maintenance', 'system');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'maintenanceSchedule' }, update: { value: expect.objectContaining({ startsAt, message: 'WebSphere will be unavailable for maintenance.', notifiedAt: expect.any(String) }), updatedBy: admin.id } }));
    expect(log).toHaveBeenCalled();
  });

  it('rejects a past start and an already active maintenance window', async () => {
    const { service, notify, upsert } = fixture();
    await expect(service.announceMaintenance(admin, { startsAt: new Date(Date.now() - 1000).toISOString(), message: 'Maintenance' })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    const active = fixture(true);
    await expect(active.service.announceMaintenance(admin, { startsAt: new Date(Date.now() + 3_600_000).toISOString(), message: 'Maintenance' })).rejects.toThrow();
    expect(active.notify).not.toHaveBeenCalled();
  });
});
