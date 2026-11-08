import { sameScheduleDate, scheduleDateErrors, schedulingDay } from '@websphere/shared';
import { useEffect, useState } from 'react';
import { DateField } from './DateField';

type ScheduleDateFieldsProps = {
  idPrefix: string;
  startLabel?: string;
  endLabel?: string;
  initialStart?: string;
  initialEnd?: string;
  editing?: boolean;
  type?: 'date' | 'datetime-local';
  requiredStart?: boolean;
  fieldClassName?: string;
};

/** Keep both native picker limits and inline errors in sync with the whole schedule. */
export function ScheduleDateFields({ idPrefix, startLabel = 'Start Date', endLabel = 'Due Date', initialStart = '', initialEnd = '', editing = false, type = 'date', requiredStart = false, fieldClassName }: ScheduleDateFieldsProps) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  const kind = type === 'date' ? 'date' : 'datetime';
  const changed = !sameScheduleDate(start, initialStart, kind) || !sameScheduleDate(end, initialEnd, kind);
  const validate = !editing || changed;
  const label = type === 'date' ? (endLabel === 'End Date' ? 'End date' : 'Due date') : 'End time';
  const errors = validate ? scheduleDateErrors(start, end, { kind, endLabel: label, now }) : {};
  const nextMinute = new Date(Math.ceil(now.getTime() / 60_000) * 60_000);
  const localMinimum = new Date(nextMinute.getTime() - nextMinute.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const minimum = type === 'date' ? schedulingDay(now) : localMinimum;
  const endMinimum = validate ? (start && start > minimum ? start : minimum) : undefined;
  const startId = `${idPrefix}-start`;
  const endId = `${idPrefix}-end`;
  return <>
    <div className={`schedule-date-field ${fieldClassName ?? ''}`}><label className="lbl" htmlFor={startId}>{startLabel}</label><DateField id={startId} name={type === 'date' ? 'startDate' : 'startAt'} label={startLabel} type={type} value={start} onValueChange={setStart} min={validate && type === 'datetime-local' && !end ? minimum : undefined} max={validate && end ? end : undefined} error={errors.start} required={requiredStart} showJump={false} /></div>
    <div className={`schedule-date-field ${fieldClassName ?? ''}`}><label className="lbl" htmlFor={endId}>{endLabel}</label><DateField id={endId} name={type === 'date' ? 'deadline' : 'endAt'} label={endLabel} type={type} value={end} onValueChange={setEnd} min={endMinimum} error={errors.end} showJump={false} /></div>
  </>;
}
