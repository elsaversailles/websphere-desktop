export const SCHEDULING_TIME_ZONE = 'Asia/Manila';
export type ScheduleDate = string | Date | null | undefined;
export type ScheduleKind = 'date' | 'datetime';
export type ScheduleErrors = Partial<Record<'start' | 'end', string>>;

/** Date-only deadlines expire at the end of the app's local day, not at UTC midnight. */
export function schedulingDay(now = new Date(), timeZone = SCHEDULING_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function scheduleValue(value: ScheduleDate, kind: ScheduleKind): string | number | null {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return NaN;
  return kind === 'date' ? date.toISOString().slice(0, 10) : date.getTime();
}

export function sameScheduleDate(first: ScheduleDate, second: ScheduleDate, kind: ScheduleKind = 'date'): boolean {
  return scheduleValue(first, kind) === scheduleValue(second, kind);
}

/** Shared by date fields and API mutations; an event without an end uses its start as its scheduled time. */
export function scheduleDateErrors(start: ScheduleDate, end: ScheduleDate, options: {
  kind?: ScheduleKind; endLabel?: string; now?: Date; timeZone?: string;
} = {}): ScheduleErrors {
  const { kind = 'date', endLabel = 'End date', now = new Date(), timeZone = SCHEDULING_TIME_ZONE } = options;
  const first = scheduleValue(start, kind);
  const last = scheduleValue(end, kind);
  const errors: ScheduleErrors = {};
  if (typeof first === 'number' && Number.isNaN(first)) errors.start = 'Enter a valid start date.';
  if (typeof last === 'number' && Number.isNaN(last)) errors.end = `Enter a valid ${endLabel.toLowerCase()}.`;
  if (Object.keys(errors).length) return errors;
  if (first !== null && last !== null && last < first) errors.end = `${endLabel} must be on or after the start ${kind === 'date' ? 'date' : 'time'}.`;
  const earliest = kind === 'date' ? schedulingDay(now, timeZone) : now.getTime();
  if (!errors.end && last !== null && last < earliest) errors.end = `${endLabel} cannot be in the past.`;
  if (kind === 'datetime' && last === null && first !== null && first < earliest) errors.start = 'Event start cannot be in the past.';
  return errors;
}
