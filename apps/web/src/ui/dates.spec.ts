import { describe, expect, it } from 'vitest';
import { dateOnlyKey, daysBetweenCalendarDates, localDateFromKey } from './dates';

describe('calendar dates', () => {
  it('keeps the stored deadline day when constructing a local display date', () => {
    const stored = '2026-10-20T00:00:00.000Z';
    expect(dateOnlyKey(stored)).toBe('2026-10-20');
    const displayed = localDateFromKey(dateOnlyKey(stored));
    expect([displayed.getFullYear(), displayed.getMonth() + 1, displayed.getDate()]).toEqual([2026, 10, 20]);
  });

  it('compares calendar days across daylight saving changes', () => {
    expect(daysBetweenCalendarDates('2026-03-07', '2026-03-09')).toBe(2);
  });
});
