import { useState } from 'react';
import { dateOnlyKey, localDateKey } from './dates';

const MONTHS = Array.from({ length: 12 }, (_, index) => new Date(2024, index, 1).toLocaleDateString(undefined, { month: 'short' }));

type DateFieldProps = {
  name: string;
  label: string;
  type?: 'date' | 'datetime-local';
  defaultValue?: string;
  required?: boolean;
  id?: string;
};

/** Keeps the native day picker and adds direct month/year jumps beside it. */
export function DateField({ name, label, type = 'date', defaultValue = '', required = false, id }: DateFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const selected = value ? dateOnlyKey(value) : localDateKey();
  const [year, month] = selected.split('-').map(Number);
  const currentYear = new Date().getFullYear();
  const startYear = Math.min(2000, year - 10, currentYear - 10);
  const endYear = Math.max(2100, year + 10, currentYear + 20);

  function moveTo(nextYear: number, nextMonth: number) {
    const day = value ? Number(dateOnlyKey(value).slice(8, 10)) : 1;
    const lastDay = new Date(nextYear, nextMonth, 0).getDate();
    const nextDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
    const time = type === 'datetime-local' ? value.slice(10) || 'T09:00' : '';
    setValue(`${nextDate}${time}`);
  }

  return <div className="date-field">
    <div className="date-field-jump">
      <select className="legacy-select" value={month} aria-label={`${label} month`} onChange={(event) => moveTo(year, Number(event.target.value))}>
        {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </select>
      <select className="legacy-select" value={year} aria-label={`${label} year`} onChange={(event) => moveTo(Number(event.target.value), month)}>
        {Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
    <input id={id} className="ifield" name={name} type={type} required={required} value={value} onChange={(event) => setValue(event.target.value)} aria-label={label} />
  </div>;
}
