import { useEffect, useId, useRef } from 'react';
import { agendaCategory, agendaProject, editableAgendaEvent, type CalendarAgendaItem, type CalendarEvent } from './calendar';
import { formatDateOnly } from './dates';

export function CalendarAgendaModal({ day, items, loading, error, onClose, onEdit, onRetry }: {
  day: Date;
  items: CalendarAgendaItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={dialog} className="modal-box calendar-agenda-modal" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-ttl calendar-agenda-header"><h2 id={titleId}>Agenda for {day.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h2><button className="modal-close" type="button" autoFocus onClick={onClose} aria-label="Close daily agenda">×</button></div>
    <div className="calendar-agenda-body" aria-busy={loading}>
      {loading ? <p role="status">Loading agendas…</p> : error ? <div className="calendar-error" role="alert">{error} <button type="button" onClick={onRetry}>Retry</button></div> : items.length ? <ul className="calendar-agenda-list">
        {items.map((item) => {
          const project = agendaProject(item);
          return <li className="calendar-agenda-entry" key={`${item.kind}-${item.type}-${item.id}`}>
            <div className="calendar-agenda-entry-heading"><span className={`bdg ${item.kind === 'hint' ? 'r' : 'ac'}`}>{agendaCategory(item)}</span>{editableAgendaEvent(item) ? <button type="button" className="btn-o btn-sm" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>Edit event</button> : null}</div>
            <h3>{item.title}</h3>
            {item.kind === 'event' && item.description ? <p>{item.description}</p> : null}
            <dl>{project ? <div><dt>Project</dt><dd>{project}</dd></div> : null}<div><dt>{item.kind === 'hint' ? 'Deadline' : 'Starts'}</dt><dd><time dateTime={item.at}>{item.kind === 'hint' ? formatDateOnly(item.at) : new Date(item.at).toLocaleString()}</time></dd></div>{item.kind === 'event' && item.endAt ? <div><dt>Ends</dt><dd><time dateTime={item.endAt}>{new Date(item.endAt).toLocaleString()}</time></dd></div> : null}</dl>
          </li>;
        })}
      </ul> : <p className="calendar-agenda-empty">You have no agenda for this date.</p>}
    </div>
    <div className="modal-acts calendar-agenda-footer"><button className="btn-o" type="button" onClick={onClose}>Close</button></div>
  </dialog>;
}
