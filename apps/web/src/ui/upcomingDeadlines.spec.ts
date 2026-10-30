import { expect, it } from 'vitest';
import { upcomingDeadlines } from './upcomingDeadlines';

it('includes completed November deadlines within 14 days and sorts across all tasks', () => {
  const tasks = [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `later-${index}`, deadline: '2026-12-01', status: 'pending' })),
    { id: 'nov-8', deadline: '2026-11-08', status: 'completed' },
    { id: 'oct-30', deadline: '2026-10-30', status: 'ongoing' },
    { id: 'nov-7', deadline: '2026-11-07', status: 'completed' },
  ];
  expect(upcomingDeadlines(tasks, '2026-10-30').map(({ task }) => task.id)).toEqual(['oct-30', 'nov-7', 'nov-8']);
});
