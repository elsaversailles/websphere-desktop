import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { CallKind, TicketStatus } from '@websphere/shared';
import { clearSession, getAccessToken, request, saveSession, socketBaseUrl, type Session, type User } from '../api';
import { AiAssistantModal } from './AiAssistantModal';
import { Dashboard } from './Dashboard';
import { avatarTone } from './health';
import { GroupChatPage } from './GroupChatPage';
import { GroupsPage } from './GroupsPage';
import { IdeasPage } from './IdeasPage';
import { ProjectsPage } from './ProjectsPage';
import { SupportRequestsPage } from './SupportRequestsPage';
import { categoryLabel, statusLabel, ticketStatusOptions, type SupportTicketRecord } from './ticketStatus';
import { AdminSettingsPage, CalendarPage, IntegrationsPage, NotificationsPage, ProfilePage, ProjectsAnalyticsPage, TasksPage, TrackerPage } from './LegacyPages';

type Page = 'dashboard' | 'groups' | 'chat' | 'ideas' | 'projects' | 'tasks' | 'workflow' | 'predictive' | 'calendar' | 'tools' | 'tracker' | 'notifications' | 'profile' | 'assistant' | 'admin' | 'accounts' | 'settings' | 'support';
type WorkspaceProps = { session: Session; onSessionChange: (session: Session) => void; onLogout: () => void; notify: (message: string) => void };
type Link = { id: Page; label: string; icon: string };
type NotificationEntry = { id: string; read: boolean; relatedId?: string | null; relatedType?: string | null };

const userSections: Array<{ title: string; links: Link[] }> = [
  { title: 'Main', links: [{ id: 'dashboard', label: 'Dashboard', icon: '⌂' }] },
  { title: 'Groups & Projects', links: [{ id: 'groups', label: 'My Groups', icon: '♧' }, { id: 'chat', label: 'Group Chat', icon: '□' }, { id: 'ideas', label: 'Idea Management', icon: '◇' }, { id: 'projects', label: 'My Projects', icon: '▱' }, { id: 'tasks', label: 'My Tasks', icon: '✓' }] },
  { title: 'Analytics', links: [{ id: 'workflow', label: 'Workflow Analytics', icon: '▥' }, { id: 'predictive', label: 'Predictive Monitoring', icon: '◉' }] },
  { title: 'Tools', links: [{ id: 'calendar', label: 'Calendar', icon: '▦' }, { id: 'tools', label: 'Apps/External Tools', icon: '▦' }, { id: 'tracker', label: 'Task Progress Tracker', icon: '▤' }] },
  { title: 'Account', links: [{ id: 'profile', label: 'Profile & Settings', icon: '♙' }, { id: 'support', label: 'My Support Requests', icon: '?' }] },
];
const adminSections: Array<{ title: string; links: Link[] }> = [
  { title: 'System Admin', links: [{ id: 'admin', label: 'User Activity', icon: '▣' }, { id: 'accounts', label: 'Account Management', icon: '♧' }, { id: 'settings', label: 'System Settings', icon: '◉' }] },
];

export function Workspace({ session, onSessionChange, onLogout, notify }: WorkspaceProps) {
  const administrator = session.role === 'Administrator';
  const [page, setPage] = useState<Page>(administrator ? 'admin' : 'dashboard');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ groupId: string; kind: CallKind } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const sections = administrator ? adminSections : userSections;

  useEffect(() => {
    if (!logoutOpen) return;
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && !loggingOut) setLogoutOpen(false); }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [logoutOpen, loggingOut]);

  /** Hover flyout: mousing over a section header pops its links out beside the sidebar, in the brand gradient. */
  const [flyoutTitle, setFlyoutTitle] = useState<string | null>(null);
  const [flyoutPos, setFlyoutPos] = useState({ top: 0, left: 0 });
  const flyoutHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutSection = sections.find((section) => section.title === flyoutTitle) ?? null;

  function openFlyout(title: string, target: HTMLElement) {
    if (flyoutHideTimer.current) { clearTimeout(flyoutHideTimer.current); flyoutHideTimer.current = null; }
    const rect = target.getBoundingClientRect();
    setFlyoutPos({ top: rect.top, left: rect.right + 8 });
    setFlyoutTitle(title);
  }
  function scheduleCloseFlyout() {
    if (flyoutHideTimer.current) clearTimeout(flyoutHideTimer.current);
    flyoutHideTimer.current = setTimeout(() => setFlyoutTitle(null), 120);
  }
  function cancelCloseFlyout() {
    if (flyoutHideTimer.current) { clearTimeout(flyoutHideTimer.current); flyoutHideTimer.current = null; }
  }
  /** Touch/click fallback for devices without hover: tapping a section toggles its flyout instead of leaving it stuck open. */
  function toggleFlyout(title: string, target: HTMLElement) {
    if (flyoutTitle === title) { setFlyoutTitle(null); return; }
    openFlyout(title, target);
  }
  useEffect(() => {
    if (!flyoutTitle) return;
    function close() { setFlyoutTitle(null); }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [flyoutTitle]);
  useEffect(() => { if (sidebarCollapsed) setFlyoutTitle(null); }, [sidebarCollapsed]);

  function navigate(target: Page) {
    if (target === 'assistant') setAssistantOpen(true);
    else setPage(target);
  }

  function openNotification(notification: NotificationEntry) {
    if (!notification.read) void request(`/notifications/${notification.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    switch (notification.relatedType?.trim().toLowerCase()) {
      case 'group':
      case 'group_chat':
      case 'chat':
        if (notification.relatedId) setSelectedGroupId(notification.relatedId);
        setPage('chat');
        break;
      case 'project': setPage('projects'); break;
      case 'task':
        setSelectedTaskId(notification.relatedId ?? '');
        setPage('tasks');
        break;
      case 'idea': setPage('ideas'); break;
      case 'ticket':
        if (administrator) { setPage('admin'); break; }
        setSelectedTicketId(notification.relatedId ?? '');
        setPage('support');
        break;
      case 'calendar':
      case 'event': setPage('calendar'); break;
      default: setPage('notifications');
    }
  }

  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => {
      void request<Array<{ id: string }>>('/groups').then((groups) => groups.forEach((group) => socket.emit('group:join', group.id, () => undefined))).catch(() => undefined);
    });
    socket.on('call:invite', (event: { groupId: string; kind: CallKind; initiatorUserId: string }) => {
      if (event.initiatorUserId !== session.user.id) setIncomingCall({ groupId: event.groupId, kind: event.kind });
    });
    socket.on('notification:new', (notification: { message?: string }) => { if (notification?.message) notify(notification.message); });
    return () => socket.disconnect();
  }, [session.access, session.user.id, notify]);

  async function logout() {
    setLoggingOut(true);
    try { await request('/auth/logout', { method: 'POST' }); } catch { /* local session is always cleared */ }
    clearSession(); onLogout();
  }

  function updateUser(user: User) {
    const next = { ...session, user };
    saveSession(next);
    onSessionChange(next);
  }

  return <main className="page on">{incomingCall && (page !== 'chat' || incomingCall.groupId !== selectedGroupId) ? <div className="workspace-call-invite call-invite"><span>{incomingCall.kind === 'video' ? 'Video' : 'Voice'} call in progress</span><button className="btn btn-sm" onClick={() => { setSelectedGroupId(incomingCall.groupId); setPage('chat'); }}>Join call</button><button className="btn-o btn-sm" onClick={() => setIncomingCall(null)}>Dismiss</button></div> : null}<div className="layout">
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sb-head"><button className="sb-brand" onClick={() => setPage(administrator ? 'admin' : 'dashboard')}><img className="sb-logo" src="/logo.png" alt="" /><span className="sb-brand-word">WebSphere</span></button><button className="sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'Show sidebar navigation' : 'Hide sidebar navigation'} title={sidebarCollapsed ? 'Show sidebar navigation' : 'Hide sidebar navigation'}><BurgerIcon /></button></div>
      <nav aria-label="Main navigation">{administrator
        // Admins get the menu pinned inline in the sidebar (no hover flyout) so every item is one click away.
        ? sections.map((section) => <div className="sb-inline-sec" key={section.title}><div className="sb-sec-label">{section.title}</div>{section.links.map((link) => <button type="button" className={`sb-item ${page === link.id ? 'on' : ''}`} key={link.id} onClick={() => setPage(link.id)}><span className="sb-ico"><NavIcon page={link.id} /></span><span className="sb-label">{link.label}</span></button>)}</div>)
        : sections.map((section) => {
        const holdsActivePage = section.links.some((link) => link.id === page);
        const isFlyoutOpen = flyoutTitle === section.title;
        return <button
          type="button"
          className={`sb-sec ${holdsActivePage ? 'has-active' : ''} ${isFlyoutOpen ? 'flyout-open' : ''}`}
          key={section.title}
          aria-haspopup="menu"
          aria-expanded={isFlyoutOpen}
          onMouseEnter={(event) => openFlyout(section.title, event.currentTarget)}
          onMouseLeave={scheduleCloseFlyout}
          onFocus={(event) => openFlyout(section.title, event.currentTarget)}
          onBlur={scheduleCloseFlyout}
          onClick={(event) => toggleFlyout(section.title, event.currentTarget)}
        >
          <span>{section.title}</span>
          <ChevronIcon />
        </button>;
      })}</nav>
      {!administrator && flyoutSection ? <div
        className="sb-flyout"
        style={{ top: flyoutPos.top, left: flyoutPos.left }}
        onMouseEnter={cancelCloseFlyout}
        onMouseLeave={scheduleCloseFlyout}
      >
        <div className="sb-flyout-title">{flyoutSection.title}</div>
        <div className="sb-flyout-items">{flyoutSection.links.map((link) => <button className={`sb-item ${page === link.id ? 'on' : ''}`} key={link.id} onClick={() => { setPage(link.id); setFlyoutTitle(null); }}><span className="sb-ico"><NavIcon page={link.id} /></span><span className="sb-label">{link.label}</span></button>)}</div>
      </div> : null}
      <div className="sb-bot"><div className="uchip">{session.user.avatarUrl ? <img className="ava ava-image" src={session.user.avatarUrl} alt={`${session.user.fullName}'s profile picture`} /> : <span className="ava">{initials(session.user.fullName)}</span>}<span className="user-detail"><strong className="u-name">{session.user.fullName}</strong><small className="u-role">{administrator ? 'Administrator' : 'Member'}</small></span></div><button className="logout-btn" onClick={() => setLogoutOpen(true)} title={sidebarCollapsed ? 'Log out' : undefined}><span aria-hidden="true">↪</span><span className="logout-label">Logout</span></button></div>
    </aside>
    {sidebarCollapsed ? <button className="sidebar-reopen" type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Show sidebar navigation" title="Show sidebar navigation"><BurgerIcon /></button> : null}
    <div className="workspace-body"><div className="mobile-header"><span className="sb-brand"><img className="sb-logo" src="/logo.png" alt="" /><span className="sb-brand-word">WebSphere</span></span><select value={page} onChange={(event) => setPage(event.target.value as Page)}>{sections.flatMap((section) => section.links).map((link) => <option key={link.id} value={link.id}>{link.label}</option>)}</select></div><div className="main">
      {page === 'dashboard' ? <Dashboard name={session.user.fullName} notify={notify} onPage={navigate} onNotificationClick={openNotification} /> : null}
      {page === 'groups' ? <GroupsPage selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} onChat={() => setPage('chat')} notify={notify} /> : null}
      {page === 'ideas' ? <IdeasPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} notify={notify} /> : null}
      {page === 'projects' ? <ProjectsPage notify={notify} /> : null}
      {page === 'admin' ? <AdminPage notify={notify} /> : null}
      {page === 'accounts' ? <AdminAccounts notify={notify} /> : null}
      {page === 'chat' ? <GroupChatPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} onIdeas={() => setPage('ideas')} notify={notify} incomingCall={incomingCall?.groupId === selectedGroupId ? incomingCall : null} onIncomingCallHandled={() => setIncomingCall(null)} /> : null}
      {page === 'tasks' ? <TasksPage notify={notify} focusedTaskId={selectedTaskId} /> : null}
      {page === 'workflow' ? <ProjectsAnalyticsPage kind="workflow" notify={notify} /> : null}
      {page === 'predictive' ? <ProjectsAnalyticsPage kind="predictive" notify={notify} /> : null}
      {page === 'calendar' ? <CalendarPage notify={notify} /> : null}
      {page === 'tools' ? <IntegrationsPage notify={notify} /> : null}
      {page === 'tracker' ? <TrackerPage notify={notify} /> : null}
      {page === 'notifications' ? <NotificationsPage notify={notify} onNotificationClick={openNotification} /> : null}
      {page === 'profile' ? <ProfilePage user={session.user} onUserUpdated={updateUser} onSessionInvalidated={() => { clearSession(); onLogout(); }} notify={notify} /> : null}
      {page === 'settings' ? <AdminSettingsPage notify={notify} /> : null}
      {page === 'support' ? <SupportRequestsPage notify={notify} focusedTicketId={selectedTicketId} /> : null}
    </div></div>
  </div>
  <AiAssistantModal open={assistantOpen} onClose={() => setAssistantOpen(false)} notify={notify} />
  {logoutOpen ? <div className="logout-ov" onMouseDown={(event) => { if (event.target === event.currentTarget && !loggingOut) setLogoutOpen(false); }}>
    <div className="logout-box" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
      <span className="logout-mark" aria-hidden="true"><LogoutIcon /></span>
      <h2 id="logout-confirm-title">Are you sure you want to Log out?</h2>
      <div className="logout-acts">
        <button type="button" className="logout-cancel" disabled={loggingOut} onClick={() => setLogoutOpen(false)}>Cancel</button>
        <button type="button" className="logout-confirm" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
      </div>
    </div>
  </div> : null}
  </main>;
}

function AdminPage({ notify }: { notify: (message: string) => void }) {
  type Monitoring = { users: { total: number; active: number; locked: number; suspended: number; newSignups7d: number }; projects: { active: number; completed: number }; activity: { tasksCompleted24h: number; openSupportTickets: number }; health: { database: string; redis: string; overall: string } };
  type SupportTicket = SupportTicketRecord & { user: { fullName: string; email: string } };
  const [data, setData] = useState<Monitoring | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  async function refresh() {
    try {
      const [monitoring, supportTickets] = await Promise.all([request<Monitoring>('/admin/monitoring'), request<SupportTicket[]>('/admin/support/tickets')]);
      setData(monitoring);
      setTickets(supportTickets);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not load administrator data.'); }
  }
  useEffect(() => { void refresh(); }, [notify]);
  return <section className="sp on">
    <div className="ph"><div><h2>User Activity</h2></div></div>
    <div className="krow">{data ? <><Kpi label="Active Projects" value={data.projects.active} /><Kpi label="Active Users" value={data.users.active} /><Kpi label="Flagged Inactive" value={data.users.locked + data.users.suspended} tone="yel" /><Kpi label="System Status" value={data.health.overall === 'up' ? 'Online' : 'Degraded'} tone={data.health.overall === 'up' ? 'grn' : 'red'} /></> : <div className="cc">Loading system activity…</div>}</div>
    <div className="g2"><div className="cc"><div className="cc-head"><h3>System Health</h3></div><Health label="Database" detail="Connected to the WebSphere database" ok={data?.health.database === 'up'} /><Health label="Redis" detail="Session and job queue store" ok={data?.health.redis === 'up'} /><Health label="File Storage" detail="Linux instance storage" ok /></div><div className="cc"><div className="cc-head"><h3>Recent User Activity</h3></div>{data ? <><Health label="New signups (7 days)" detail={`${data.users.newSignups7d} accounts created`} ok /><Health label="Tasks completed (24h)" detail={`${data.activity.tasksCompleted24h} tasks marked complete`} ok /><Health label="Open support tickets" detail={`${data.activity.openSupportTickets} awaiting response`} ok={data.activity.openSupportTickets === 0} /><Health label="Completed projects" detail={`${data.projects.completed} projects completed`} ok /></> : <div className="empty-message">Live audit activity will appear here.</div>}</div></div>
    <section className="cc support-request-queue"><div className="cc-head"><div><h3>Support Requests</h3><span className="support-queue-count">{tickets?.length ?? 0} recent</span></div><button type="button" className="btn-o btn-sm" onClick={() => void refresh()}>Refresh</button></div>{tickets === null ? <div className="empty-message">Loading support requests…</div> : tickets.length ? <div className="support-ticket-list">{tickets.map((ticket) => <AdminTicketCard key={`${ticket.id}-${ticket.updatedAt}`} ticket={ticket} notify={notify} onSaved={() => void refresh()} />)}</div> : <div className="empty-message">New support requests will appear here.</div>}</section>
  </section>;
}

function AdminTicketCard({ ticket, notify, onSaved }: { ticket: SupportTicketRecord & { user: { fullName: string; email: string } }; notify: (message: string) => void; onSaved: () => void }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [response, setResponse] = useState(ticket.response ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = status !== ticket.status || response.trim() !== (ticket.response ?? '');
  async function save() {
    setSaving(true);
    try {
      await request(`/admin/support/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status, response }) });
      notify(`Request set to ${statusLabel(status)}. ${ticket.user.fullName} has been notified.`);
      onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the support request.'); } finally { setSaving(false); }
  }
  return <article className="support-ticket">
    <div className="support-ticket-top"><div><strong>{ticket.subject}</strong><span>{ticket.user.fullName} · {ticket.user.email}</span></div><span className={`support-ticket-status ${ticket.status}`}>{statusLabel(ticket.status)}</span></div>
    <p>{ticket.body}</p>
    <div className="support-ticket-controls">
      <label>Status<select className="legacy-select" value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)} disabled={saving}>{ticketStatusOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}</select></label>
      <label className="support-ticket-reply-field">Reply to user<textarea className="ifield" rows={2} maxLength={2000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Optional message shown with the status update" disabled={saving} /></label>
      <button type="button" className="btn btn-sm" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save & Notify'}</button>
    </div>
    <footer><span>{categoryLabel(ticket.category)}</span><time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString()}</time></footer>
  </article>;
}

type AdminUser = { id: string; fullName: string; email: string; role: string; status: string };
type AdminUsersPage = { users: AdminUser[]; total: number; page: number; pageSize: number; totalPages: number };
const USERS_PAGE_SIZE = 10;

function AdminAccounts({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdminUsersPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void request<AdminUsersPage>(`/admin/users?page=${page}&pageSize=${USERS_PAGE_SIZE}`)
      .then((next) => { if (active) setData(next); })
      .catch((error: Error) => { if (active) notify(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, notify]);
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total ? (page - 1) * USERS_PAGE_SIZE + 1 : 0;
  const rangeEnd = (page - 1) * USERS_PAGE_SIZE + users.length;
  return <section className="sp on"><div className="ph"><div><h2>Account Management</h2></div></div><div className="cc requests-card"><div className="cc-head"><h3>⟳ Requests</h3><button className="btn-o btn-sm" onClick={() => notify('Resolved requests cleared.')}>Clear Resolved</button></div><div className="empty-message">No help requests yet. Requests submitted by users will appear here automatically.</div></div><div className="cc"><div className="cc-head"><h3>All Users</h3>{total ? <span className="user-page-count">{rangeStart}–{rangeEnd} of {total}</span> : null}</div>{users.length ? users.map((user) => <div className="urow" key={user.id}><span className={`ava tone-${avatarTone(user.id)}`}>{initials(user.fullName)}</span><span className="ur-info"><strong className="ur-name">{user.fullName}</strong><small className="ur-email">{user.email} · {user.role}</small></span><span className={`bdg ${user.status === 'active' ? 'g' : 'y'}`}>{user.status}</span></div>) : <div className="empty-message">{loading ? 'Loading accounts…' : 'Registered users will appear here.'}</div>}{totalPages > 1 ? <div className="user-pager"><button type="button" className="btn-o btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span className="user-pager-label">Page {page} of {totalPages}</span><button type="button" className="btn-o btn-sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button></div> : null}</div></section>;
}

function ChevronIcon() { return <svg className="sb-sec-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>; }
function LogoutIcon() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>; }
function BurgerIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>; }
function NavIcon({ page }: { page: Page }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (page === 'dashboard') return <svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>;
  if (page === 'groups' || page === 'accounts') return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (page === 'chat') return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
  if (page === 'projects') return <svg {...common}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
  if (page === 'tasks') return <svg {...common}><path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
  if (page === 'workflow') return <svg {...common}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>;
  if (page === 'predictive' || page === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>;
  if (page === 'calendar') return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
  if (page === 'tools') return <svg {...common}><rect x="2" y="3" width="7" height="7" rx="1"/><rect x="15" y="3" width="7" height="7" rx="1"/><rect x="2" y="14" width="7" height="7" rx="1"/><rect x="15" y="14" width="7" height="7" rx="1"/></svg>;
  if (page === 'tracker') return <svg {...common}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>;
  if (page === 'notifications') return <svg {...common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
  if (page === 'profile') return <svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
  if (page === 'admin') return <svg {...common}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
  if (page === 'support') return <svg {...common}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/></svg>;
  if (page === 'ideas') return <svg {...common}><path d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5z"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function Health({ label, detail, ok = true }: { label: string; detail: string; ok?: boolean }) { return <div className="health-row"><span><strong>{label}</strong><small>{detail}</small></span><span className={`bdg ${ok ? 'g' : 'r'}`}>{ok ? '● Healthy' : '● Attention'}</span></div>; }
function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
