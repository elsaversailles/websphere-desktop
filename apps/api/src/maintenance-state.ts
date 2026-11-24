export function maintenanceState(mode: unknown, schedule: unknown, now = new Date()) {
  const setting = mode as { enabled?: boolean } | null;
  const raw = schedule as { startsAt?: string } | null;
  const requestedStart = raw?.startsAt ? new Date(raw.startsAt) : null;
  const startsAt = requestedStart && Number.isFinite(+requestedStart) ? requestedStart : null;
  return {
    active: mode === true || setting?.enabled === true || Boolean(startsAt && startsAt <= now),
    scheduledStart: startsAt?.toISOString() ?? null,
  };
}
