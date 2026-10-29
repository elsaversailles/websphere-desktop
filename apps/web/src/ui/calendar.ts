import { dateOnlyKey, localDateKey } from './dates';

type CalendarProject = { id: string; title: string };
export type CalendarEvent = { id: string; title: string; type: string; startAt: string; endAt?: string | null; projectId?: string | null; project?: CalendarProject | null; source?: string; description?: string | null };
export type CalendarHint = { id: string; title: string; type: string; deadline: string; project?: CalendarProject | null };
export type CalendarTaskNotification = { id: string; message: string; type: string; relatedId?: string | null; createdAt: string };
export type CalendarData = { events: CalendarEvent[]; hints: CalendarHint[]; notifications?: CalendarTaskNotification[] };
export type CalendarAgendaItem = (CalendarEvent & { kind: 'event'; at: string }) | (CalendarHint & { kind: 'hint'; at: string });

export function calendarItems(data: CalendarData): CalendarAgendaItem[] {
  return [...data.events.map((event) => ({ ...event, at: event.startAt, kind: 'event' as const })), ...data.hints.map((hint) => ({ ...hint, at: hint.deadline, kind: 'hint' as const }))];
}

/** Deadlines keep their stored calendar date; timed events use the user's local calendar. */
export function agendaForDay(items: CalendarAgendaItem[], day: Date): CalendarAgendaItem[] {
  const key = localDateKey(day);
  return items.filter((item) => (item.kind === 'hint' ? dateOnlyKey(item.at) : localDateKey(new Date(item.at))) === key)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'hint' ? -1 : 1;
      return (a.kind === 'event' ? new Date(a.at).getTime() - new Date(b.at).getTime() : 0) || a.title.localeCompare(b.title);
    });
}

export function agendaCategory(item: CalendarAgendaItem): string {
  if (item.type === 'maintenance') return 'Maintenance';
  if (item.type === 'task_deadline') return 'Task deadline';
  if (item.type === 'project_deadline') return 'Project deadline';
  if (item.kind === 'event' && item.source === 'outlook') return 'Outlook event';
  return item.type.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function agendaProject(item: CalendarAgendaItem): string | null {
  return item.project?.title ?? (item.type === 'project_deadline' ? item.title : null);
}

export function editableAgendaEvent(item: CalendarAgendaItem): item is CalendarAgendaItem & CalendarEvent {
  return item.kind === 'event' && item.source !== 'system' && item.source !== 'outlook';
}
