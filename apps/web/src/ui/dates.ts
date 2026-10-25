/** Project and task deadlines are calendar dates stored as UTC-midnight DateTimes. */
export function dateOnlyKey(value: string | Date): string {
  const text = value instanceof Date ? value.toISOString() : value;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match) throw new Error('Invalid calendar date');
  return match[1];
}

export function localDateKey(value = new Date()): string {
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function localDateFromKey(key: string): Date {
  const [year, month, day] = dateOnlyKey(key).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateOnly(value?: string | Date | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return 'Not set';
  return localDateFromKey(dateOnlyKey(value)).toLocaleDateString(undefined, options);
}

export function daysBetweenCalendarDates(first: string, second: string): number {
  const utcDay = (key: string) => {
    const [year, month, day] = dateOnlyKey(key).split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return utcDay(second) - utcDay(first);
}
