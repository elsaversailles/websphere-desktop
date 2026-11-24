import { workspaceSubscription } from './workspaceSocket';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { categoryLabel, statusLabel, type SupportTicketRecord } from './ticketStatus';

/** The requester's view of their own tickets: current status, the admin's reply, and live updates when either changes. */
export function SupportRequestsPage({ notify, focusedTicketId }: { notify: (message: string) => void; focusedTicketId?: string }) {
  const [tickets, setTickets] = useState<SupportTicketRecord[] | null>(null);
  const refresh = useCallback(async () => { setTickets(await request<SupportTicketRecord[]>('/support/tickets')); }, []);

  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [refresh, notify]);
  useEffect(() => {
    const { socket, on, dispose } = workspaceSubscription();
    on('notification:new', (event: { relatedType?: string }) => { if (event.relatedType === 'ticket') void refresh().catch(() => undefined); });
    return () => { dispose(); };
  }, [refresh]);
  useEffect(() => {
    if (!focusedTicketId || !tickets) return;
    document.getElementById(`ticket-${focusedTicketId}`)?.scrollIntoView({ block: 'center' });
  }, [focusedTicketId, tickets]);

  return <section className="sp on">
    <div className="ph"><div><h2>My Support Requests</h2><div className="ph-sub">Track the concerns and reports you sent to the administrators.</div></div><button type="button" className="btn-o btn-sm" onClick={() => void refresh().catch((error: Error) => notify(error.message))}>Refresh</button></div>
    <section className="cc support-request-queue">
      {tickets === null ? <div className="empty-message">Loading your requests…</div> : tickets.length ? <div className="support-ticket-list">{tickets.map((ticket) => <article className={`support-ticket ${ticket.id === focusedTicketId ? 'focused' : ''}`} id={`ticket-${ticket.id}`} key={ticket.id}>
        <div className="support-ticket-top"><div><strong>{ticket.subject}</strong><span>{categoryLabel(ticket.category)}</span></div><span className={`support-ticket-status ${ticket.status}`}>{statusLabel(ticket.status)}</span></div>
        <p>{ticket.body}</p>
        {ticket.response ? <div className="support-ticket-reply"><small>Administrator reply</small><p>{ticket.response}</p></div> : null}
        <footer><span>Sent <time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString()}</time></span>{ticket.updatedAt !== ticket.createdAt ? <span>Updated <time dateTime={ticket.updatedAt}>{new Date(ticket.updatedAt).toLocaleString()}</time></span> : null}</footer>
      </article>)}</div> : <div className="empty-message">You have not sent any support requests yet. Use the help button on the dashboard to send one.</div>}
    </section>
  </section>;
}


/** Ratings share the support queue so administrators receive the existing ticket alert. */
export function FeedbackPage({ notify }: { notify: (message: string) => void }) {
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!rating || !message.trim()) { setError('Choose a rating and tell us about your experience.'); return; }
    setBusy(true); setError(null);
    try {
      await request('/support/tickets', { method: 'POST', body: JSON.stringify({ category: 'other', subject: `Feedback · ${rating}/5 stars`, body: `Rating: ${rating}/5\n\n${message.trim()}` }) });
      setRating(0); setMessage(''); notify('Feedback sent. You can track it in My Support Requests.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not send feedback.'); }
    finally { setBusy(false); }
  }
  return <section className="sp on"><div className="ph"><div><h2>Feedback</h2><div className="ph-sub">Share your thoughts, suggestions, or concerns about WebSphere.</div></div></div><form className="cc" onSubmit={(event) => void send(event)}>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend className="lbl">Rating</legend><div role="radiogroup" aria-label="Rating" style={{ display: 'flex', gap: 4, marginBottom: 18 }}>{[1,2,3,4,5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} out of 5 stars`} onClick={() => setRating(value)} style={{ border: 0, background: 'transparent', color: value <= rating ? '#c97d10' : '#497b95', fontSize: 32, minWidth: 44, minHeight: 44, cursor: 'pointer' }}>{value <= rating ? '★' : '☆'}</button>)}</div></fieldset>
    <label className="lbl" htmlFor="feedback-message">Your feedback</label><textarea id="feedback-message" className="ifield" rows={5} maxLength={3900} value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} placeholder="Tell us what you think…" required />
    {error ? <p role="alert">{error}</p> : null}<button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send Feedback'}</button>
  </form></section>;
}
