import { describe, expect, it } from 'vitest';
import { agendaCategory, agendaForDay, agendaProject, calendarItems, editableAgendaEvent, type CalendarData } from './calendar';

const day = new Date(2026, 10, 5);
const at = (hour: number) => new Date(2026, 10, 5, hour).toISOString();
const data: CalendarData = {
  events: [
    { id: 'meeting', title: 'Research meeting', type: 'meeting', startAt: at(14), endAt: at(15), project: { id: 'project-1', title: 'Research' } },
    { id: 'maintenance', title: 'System maintenance', type: 'maintenance', source: 'system', startAt: at(10), description: 'Database upgrade' },
    { id: 'different-day', title: 'Tomorrow meeting', type: 'meeting', startAt: new Date(2026, 10, 6, 10).toISOString() },
  ],
  hints: [
    { id: 'task-1', title: 'Write chapter 1', type: 'task_deadline', deadline: '2026-11-05T00:00:00.000Z', project: { id: 'project-1', title: 'Research' } },
    { id: 'task-2', title: 'Write chapter 2', type: 'task_deadline', deadline: '2026-11-05T00:00:00.000Z', project: { id: 'project-2', title: 'Capstone' } },
  ],
};

describe('daily calendar agenda', () => {
  it('groups all agendas for the selected day and orders deadlines before timed events', () => {
    const items = calendarItems(data);
    const originalOrder = items.map((item) => item.id);
    const agenda = agendaForDay(items, day);
    expect(agenda.map((item) => item.id)).toEqual(['task-1', 'task-2', 'maintenance', 'meeting']);
    expect(items.map((item) => item.id)).toEqual(originalOrder);
    expect(agenda.find((item) => item.id === 'meeting')).toMatchObject({ endAt: at(15), project: { title: 'Research' } });
  });

  it('keeps deadline calendar dates separate from instant-based meeting and maintenance dates', () => {
    const items = calendarItems({ events: [{ id: 'midnight', title: 'Early meeting', type: 'meeting', startAt: new Date(2026, 10, 5, 0, 15).toISOString() }], hints: data.hints });
    expect(agendaForDay(items, day)).toHaveLength(3);
    expect(agendaForDay(items, new Date(2026, 10, 4))).toEqual([]);
    expect(agendaForDay(items, new Date(2026, 10, 6))).toEqual([]);
  });

  it('returns an empty agenda for a date with no activities', () => {
    expect(agendaForDay(calendarItems(data), new Date(2026, 10, 7))).toEqual([]);
  });

  it('identifies task projects and maintenance without treating system schedules as editable events', () => {
    const items = calendarItems(data);
    const task = items.find((item) => item.id === 'task-1')!;
    const maintenance = items.find((item) => item.id === 'maintenance')!;
    const meeting = items.find((item) => item.id === 'meeting')!;
    expect(agendaCategory(task)).toBe('Task deadline');
    expect(agendaProject(task)).toBe('Research');
    expect(agendaCategory(maintenance)).toBe('Maintenance');
    expect(editableAgendaEvent(maintenance)).toBe(false);
    expect(editableAgendaEvent(task)).toBe(false);
    expect(editableAgendaEvent(meeting)).toBe(true);
  });

  it('keeps synced Outlook events read-only and names project deadlines clearly', () => {
    const items = calendarItems({ events: [{ id: 'outlook', title: 'Meeting', type: 'meeting', startAt: at(16), source: 'outlook' }], hints: [{ id: 'project-1', title: 'Research', type: 'project_deadline', deadline: '2026-11-05' }] });
    expect(editableAgendaEvent(items[0])).toBe(false);
    expect(agendaCategory(items[0])).toBe('Outlook event');
    expect(agendaCategory(items[1])).toBe('Project deadline');
    expect(agendaProject(items[1])).toBe('Research');
  });
});
