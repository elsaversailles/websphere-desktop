import { useEffect, useRef, useState } from 'react';
import type { Poll } from './types';

/** Duration choices for a new vote, in hours; `null` leaves it open until the leader closes it. */
export const votingDurations: Array<{ hours: number | null; label: string }> = [
  { hours: 1, label: '1 hour' }, { hours: 3, label: '3 hours' }, { hours: 6, label: '6 hours' }, { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' }, { hours: 48, label: '48 hours' }, { hours: 72, label: '3 days' }, { hours: null, label: 'No time limit' },
];

export function formatRemaining(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * Live state of a group vote: a countdown while it is open, and why it ended once it is closed. The server is the
 * authority on closing, so when the local clock says time is up this asks the caller to refetch (and keeps asking
 * every few seconds in case the local clock runs ahead of the server's).
 */
export function PollStatus({ poll, onExpired }: { poll: Poll; onExpired: () => unknown }) {
  const timed = poll.open && poll.closesAt !== null;
  const [now, setNow] = useState(() => Date.now());
  const lastAsked = useRef(0);
  useEffect(() => {
    if (!timed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [timed]);

  const remaining = timed ? new Date(poll.closesAt as string).getTime() - now : null;
  useEffect(() => {
    if (remaining === null || remaining > 0 || now - lastAsked.current < 5000) return;
    lastAsked.current = now;
    void Promise.resolve(onExpired()).catch(() => undefined);
  }, [remaining, now, onExpired]);

  if (!poll.open) return <span className="bdg r">{poll.closedReason === 'manual' ? 'Closed by leader' : 'Voting time ended'}</span>;
  if (remaining === null) return <span className="bdg g">Open · no time limit</span>;
  if (remaining <= 0) return <span className="bdg y">Closing…</span>;
  return <span className={`bdg ${remaining < 3_600_000 ? 'y' : 'g'}`}>Open · closes in {formatRemaining(remaining)}</span>;
}
