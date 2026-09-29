import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import { categoryLabel, statusLabel, type SupportTicketRecord } from './ticketStatus';

/** The requester's view of their own tickets: current status, the admin's reply, and live updates when either changes. */
export function SupportRequestsPage({ notify, focusedTicketId }: { notify: (message: string) => void; focusedTicketId?: string }) {
  const [tickets, setTickets] = useState<SupportTicketRecord[] | null>(null);
  const refresh = useCallback(async () => { setTickets(await request<SupportTicketRecord[]>('/support/tickets')); }, []);

  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [refresh, notify]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('notification:new', () => { void refresh().catch(() => undefined); });
    return () => { socket.disconnect(); };
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
