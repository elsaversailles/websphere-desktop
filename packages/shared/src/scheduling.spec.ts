import { describe, expect, it } from 'vitest';
import { sameScheduleDate, scheduleDateErrors, schedulingDay } from './scheduling.js';

// Manila is already November 9 while the server's UTC day is still November 8.
const now = new Date('2026-11-08T16:30:00Z');

describe('schedule date validation', () => {
  it('uses the app timezone at the UTC day boundary', () => {
    expect(schedulingDay(now)).toBe('2026-11-09');
    expect(schedulingDay(now, 'America/Los_Angeles')).toBe('2026-11-08');
    expect(scheduleDateErrors(undefined, '2026-11-08', { now })).toEqual({ end: 'End date cannot be in the past.' });
  });

  it('accepts today, equal start/end dates and a past start with a future deadline', () => {
    expect(scheduleDateErrors('2026-11-09', '2026-11-09', { now })).toEqual({});
    expect(scheduleDateErrors('2026-10-01', '2026-11-10', { now })).toEqual({});
  });

  it('rejects a reversed range even when both dates are in the future', () => {
    expect(scheduleDateErrors('2026-11-20', '2026-11-10', { now, endLabel: 'Due date' })).toEqual({ end: 'Due date must be on or after the start date.' });
  });

  it('keeps optional dates optional and accepts cleared dates', () => {
    expect(scheduleDateErrors(undefined, undefined, { now })).toEqual({});
    expect(scheduleDateErrors(null, null, { now })).toEqual({});
  });

  it.each(['not-a-date', new Date(NaN)])('reports malformed dates: %s', (invalid) => {
    expect(scheduleDateErrors(invalid, invalid, { now })).toEqual({ start: 'Enter a valid start date.', end: 'Enter a valid end date.' });
  });

  it('compares event timestamps as instants, including timezone offsets', () => {
    expect(scheduleDateErrors('2026-11-09T01:00:00+08:00', '2026-11-08T17:30:00Z', { kind: 'datetime', now })).toEqual({});
    expect(scheduleDateErrors('2026-11-08T17:00:00Z', '2026-11-09T00:45:00+08:00', { kind: 'datetime', endLabel: 'End time', now })).toEqual({ end: 'End time must be on or after the start time.' });
  });

  it('rejects past event times with and without an end', () => {
    expect(scheduleDateErrors('2026-11-08T16:00:00Z', null, { kind: 'datetime', now })).toEqual({ start: 'Event start cannot be in the past.' });
    expect(scheduleDateErrors('2026-11-08T16:00:00Z', '2026-11-08T16:29:59Z', { kind: 'datetime', endLabel: 'End time', now })).toEqual({ end: 'End time cannot be in the past.' });
  });

  it('accepts an ongoing event and an event exactly at the present instant', () => {
    expect(scheduleDateErrors('2026-11-08T16:00:00Z', '2026-11-08T17:00:00Z', { kind: 'datetime', now })).toEqual({});
    expect(scheduleDateErrors(now, now, { kind: 'datetime', now })).toEqual({});
  });

  it('recognizes unchanged stored dates and cleared optional endpoints', () => {
    expect(sameScheduleDate('2026-11-09', new Date('2026-11-09'))).toBe(true);
    expect(sameScheduleDate('', null)).toBe(true);
    expect(sameScheduleDate(undefined, null)).toBe(true);
    expect(sameScheduleDate('2026-11-09', '2026-11-10')).toBe(false);
    expect(sameScheduleDate('2026-11-09T01:00:00+08:00', '2026-11-08T17:00:00Z', 'datetime')).toBe(true);
  });
});
