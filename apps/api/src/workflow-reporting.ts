import { shiftWorkflowPeriod, workflowPeriodStart, type WorkflowPeriod } from '@websphere/shared';

export function workflowBuckets(period: WorkflowPeriod, date: string, today: string, timeZone: string, calendarAligned: boolean) {
  const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  function instant(day: string, hour = 0) {
    const wallClock = Date.parse(`${day}T00:00:00Z`) + hour * 3600000;
    function offsetAt(value: number) {
      const name = offsetFormatter.formatToParts(value).find((part) => part.type === 'timeZoneName')?.value;
      const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
      return offset ? (offset[1] === '-' ? -1 : 1) * (+offset[2] * 60 + +offset[3]) * 60000 : 0;
    }
    const estimated = wallClock - offsetAt(wallClock);
    return new Date(wallClock - offsetAt(estimated));
  }

  const dayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
  const dateAtUtc = (key: string) => new Date(`${key}T00:00:00Z`);
  const start = calendarAligned ? workflowPeriodStart(period, date)
    : shiftWorkflowPeriod('daily', today, period === 'daily' ? 0 : period === 'weekly' ? -6 : -29);
  const end = calendarAligned ? shiftWorkflowPeriod(period, start, 1) : shiftWorkflowPeriod('daily', today, 1);
  const buckets: Array<{ start: Date; end: Date; label: string; detail?: string }> = [];
  if (period === 'daily') {
    const width = calendarAligned ? 6 : 4;
    const legacyHour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone });
    for (let hour = 0; hour < 24; hour += width) {
      const bucketStart = instant(start, hour);
      buckets.push({
        start: bucketStart, end: instant(start, hour + width),
        label: calendarAligned ? `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}` : legacyHour.format(bucketStart),
      });
    }
  } else {
    for (let key = start; key < end; ) {
      const byWeek = calendarAligned && period === 'monthly';
      if (byWeek && key > today) break;
      const nextWeek = shiftWorkflowPeriod('weekly', workflowPeriodStart('weekly', key), 1);
      const next = byWeek ? (nextWeek < end ? nextWeek : end) : shiftWorkflowPeriod('daily', key, 1);
      buckets.push({
        start: instant(key), end: instant(next),
        label: byWeek ? `Week ${buckets.length + 1}` : period === 'weekly' ? weekday.format(dateAtUtc(key)) : dayLabel.format(dateAtUtc(key)),
        ...(byWeek ? { detail: dayLabel.formatRange(dateAtUtc(key), dateAtUtc(shiftWorkflowPeriod('daily', next, -1))) } : {}),
      });
      key = next;
    }
  }
  return { start, end, buckets };
}
