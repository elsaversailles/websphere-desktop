export type ActivityMetric = 'projects' | 'users';
export type ActivityPeriod = 'weekly' | 'monthly' | 'six-months';

export function reportingDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIME_ZONE ?? 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map((part) => parts.find((item) => item.type === part)?.value).join('-');
}

export function activityRanges(period: ActivityPeriod, today: string) {
  const end = new Date(today + 'T00:00:00Z');
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  return Array.from({ length: period === 'weekly' ? 7 : period === 'monthly' ? 30 : 6 }, (_, index) => {
    const date = new Date(end);
    if (period === 'six-months') {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      const last = new Date(date);
      last.setUTCMonth(last.getUTCMonth() + 1, 0);
      return { start: dayKey(date), end: index === 5 ? today : dayKey(last), label: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) };
    }
    date.setUTCDate(date.getUTCDate() - ((period === 'weekly' ? 6 : 29) - index));
    return { start: dayKey(date), end: dayKey(date), label: date.toLocaleDateString('en-US', period === 'weekly' ? { weekday: 'short', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  });
}

export function activityPoints(ranges: ReturnType<typeof activityRanges>, samples: Array<{ date: string; count: number }>) {
  let index = 0;
  let value: number | null = null;
  return ranges.map((range) => {
    while (index < samples.length && samples[index].date <= range.end) {
      value = samples[index].count;
      index += 1;
    }
    return { label: range.label, value };
  });
}

export function projectActivityPoints(ranges: ReturnType<typeof activityRanges>, projects: Set<string>[]) {
  return ranges.map(({ start, end, label }) => ({
    label,
    value: projects.filter((dates) => [...dates].some((date) => date >= start && date <= end)).length,
  }));
}
