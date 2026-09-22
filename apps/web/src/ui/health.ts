/**
 * Shared semantic colour scale for the dashboard.
 *
 * The scale runs green → blue → amber → red, where green means "coasting
 * nicely" and red means "needs attention". Tone codes match the existing
 * badge modifier classes in styles.css (`.bdg.g`, `.bdg.ac`, `.bdg.y`, `.bdg.r`)
 * so the same token can drive badges, progress bars, date chips and calendar dots.
 */
export type Tone = 'g' | 'ac' | 'y' | 'r';

export type Health = { tone: Tone; label: string };

const TONE_RANK: Record<Tone, number> = { g: 0, ac: 1, y: 2, r: 3 };

/** Returns whichever tone signals the most urgency. */
export function worstTone(a: Tone | undefined, b: Tone): Tone {
  if (!a) return b;
  return TONE_RANK[b] > TONE_RANK[a] ? b : a;
}

/**
 * Project completion → health.
 * More of the work done is healthier; a barely-started project reads as risk.
 * An explicit lifecycle status wins over the derived progress label.
 */
export function projectHealth(progress: number, status?: string | null): Health {
  if (status === 'completed') return { tone: 'g', label: 'Completed' };
  if (status === 'archived') return { tone: 'ac', label: 'Archived' };
  if (status === 'on_hold') return { tone: 'y', label: 'On Hold' };
  if (progress >= 100) return { tone: 'g', label: 'Completed' };
  if (progress >= 80) return { tone: 'g', label: 'Almost Done' };
  if (progress >= 50) return { tone: 'ac', label: 'Active' };
  if (progress >= 25) return { tone: 'y', label: 'In Progress' };
  if (progress > 0) return { tone: 'r', label: 'Just Started' };
  return { tone: 'r', label: 'Not Started' };
}

/** Task priority → health. High priority is the thing most likely to hurt you. */
export function priorityHealth(priority?: string | null): Health {
  if (priority === 'high') return { tone: 'r', label: 'High' };
  if (priority === 'low') return { tone: 'ac', label: 'Normal' };
  return { tone: 'y', label: 'Medium' };
}

/** Task status → health, so status badges read the same way as everything else. */
export function taskStatusHealth(status?: string | null): Health {
  if (status === 'completed') return { tone: 'g', label: 'Completed' };
  if (status === 'for_review') return { tone: 'ac', label: 'For Review' };
  if (status === 'ongoing') return { tone: 'y', label: 'Ongoing' };
  return { tone: 'r', label: 'Pending' };
}

/** Whole days from today until `date`. Negative means the date has passed. */
export function daysUntil(date: string | Date): number {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export type DeadlineHealth = Health & { days: number };

/** Deadline proximity → health. Imminent or missed is red, comfortably far is green. */
export function deadlineHealth(deadline?: string | Date | null): DeadlineHealth | null {
  if (!deadline) return null;
  const days = daysUntil(deadline);
  if (days < 0) return { tone: 'r', label: 'Overdue', days };
  if (days <= 3) return { tone: 'r', label: 'Urgent', days };
  if (days <= 8) return { tone: 'y', label: 'Soon', days };
  if (days <= 14) return { tone: 'ac', label: 'On Track', days };
  return { tone: 'g', label: 'Scheduled', days };
}

/** Human countdown for a deadline, e.g. "3 days left" or "2 days overdue". */
export function deadlineCountdown(days: number): string {
  if (days === 0) return 'Due today';
  if (days === 1) return '1 day left';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `${days} days left`;
}

/** Stable `YYYY-MM-DD` key so calendar lookups ignore time-of-day and timezone drift. */
export function dateKey(date: string | Date): string {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

const AVATAR_TONES = ['ac', 'g', 'y', 'r', 'v', 'tl'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** Deterministic avatar colour so the same person always keeps the same chip. */
export function avatarTone(seed: string): AvatarTone {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 1) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Compact relative time for activity feeds. */
export function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
