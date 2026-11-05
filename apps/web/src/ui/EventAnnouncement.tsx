export type EventAnnouncement = {
  id: string;
  title: string;
  type: string;
  startAt: string;
  endAt?: string | null;
  createdAt: string;
  project?: { id: string; title: string } | null;
  authorName: string;
};

export function EventAnnouncementCard({ event }: { event: EventAnnouncement }) {
  const format = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return <article className="announce-row tone-ac">
    <div className="announce-head"><strong>{event.title}</strong></div>
    <p>{event.type.replaceAll('_', ' ')} · <time dateTime={event.startAt}>{format(event.startAt)}</time>{event.endAt ? <> – <time dateTime={event.endAt}>{format(event.endAt)}</time></> : null}</p>
    <cite>{event.authorName}{event.project ? ` · ${event.project.title}` : ' · Personal event'}</cite>
  </article>;
}
