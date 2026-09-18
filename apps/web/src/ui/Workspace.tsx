import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { CallKind } from '@websphere/shared';
import { clearSession, getAccessToken, request, saveSession, socketBaseUrl, type Session, type User } from '../api';
import { AiAssistantModal } from './AiAssistantModal';
import { Dashboard } from './Dashboard';
import { GroupChatPage } from './GroupChatPage';
import { GroupsPage } from './GroupsPage';
import { IdeasPage } from './IdeasPage';
import { ProjectsPage } from './ProjectsPage';
import { TrelloMonitoringPage } from './TrelloMonitoringPage';
import { AdminSettingsPage, CalendarPage, IntegrationsPage, NotificationsPage, ProfilePage, ProjectsAnalyticsPage, TasksPage, TrackerPage } from './LegacyPages';

type Page = 'dashboard' | 'groups' | 'chat' | 'ideas' | 'projects' | 'tasks' | 'workflow' | 'predictive' | 'calendar' | 'tools' | 'trello' | 'tracker' | 'notifications' | 'profile' | 'assistant' | 'admin' | 'accounts' | 'settings';
type WorkspaceProps = { session: Session; onSessionChange: (session: Session) => void; onLogout: () => void; notify: (message: string) => void };
type Link = { id: Page; label: string; icon: string };
type NotificationEntry = { id: string; read: boolean; relatedId?: string | null; relatedType?: string | null };

const userSections: Array<{ title: string; links: Link[] }> = [
  { title: 'Main', links: [{ id: 'dashboard', label: 'Dashboard', icon: '⌂' }] },
  { title: 'Groups & Projects', links: [{ id: 'groups', label: 'My Groups', icon: '♧' }, { id: 'chat', label: 'Group Chat', icon: '□' }, { id: 'ideas', label: 'Idea Management', icon: '◇' }, { id: 'projects', label: 'My Projects', icon: '▱' }, { id: 'tasks', label: 'My Tasks', icon: '✓' }] },
  { title: 'Analytics', links: [{ id: 'workflow', label: 'Workflow Analytics', icon: '▥' }, { id: 'predictive', label: 'Predictive Monitoring', icon: '◉' }] },
  { title: 'Tools', links: [{ id: 'calendar', label: 'Calendar', icon: '▦' }, { id: 'tools', label: 'Apps/External Tools', icon: '▦' }, { id: 'trello', label: 'Trello Monitoring', icon: '▦' }, { id: 'tracker', label: 'Task Progress Tracker', icon: '▤' }] },
  { title: 'Account', links: [{ id: 'profile', label: 'Profile & Settings', icon: '♙' }] },
];
const adminSections: Array<{ title: string; links: Link[] }> = [
  { title: 'System Admin', links: [{ id: 'admin', label: 'User Activity', icon: '▣' }, { id: 'accounts', label: 'Account Management', icon: '♧' }, { id: 'settings', label: 'System Settings', icon: '◉' }] },
];

export function Workspace({ session, onSessionChange, onLogout, notify }: WorkspaceProps) {
  const administrator = session.role === 'Administrator';
  const [page, setPage] = useState<Page>(administrator ? 'admin' : 'dashboard');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ groupId: string; kind: CallKind } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const sections = administrator ? adminSections : userSections;

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
      <div className="sb-head"><button className="sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'Show sidebar navigation' : 'Hide sidebar navigation'} title={sidebarCollapsed ? 'Show sidebar navigation' : 'Hide sidebar navigation'}><SidebarToggleIcon collapsed={sidebarCollapsed} /></button><button className="sb-brand" onClick={() => setPage(administrator ? 'admin' : 'dashboard')}><GlobeIcon /><span className="sb-brand-label">WebSphere</span></button></div>
      <nav aria-label="Main navigation">{sections.map((section) => <div className="sb-group" key={section.title}><div className="sb-sec">{section.title}</div>{section.links.map((link) => <button className={`sb-item ${page === link.id ? 'on' : ''}`} key={link.id} onClick={() => setPage(link.id)} title={sidebarCollapsed ? link.label : undefined}><span className="sb-ico"><NavIcon page={link.id} /></span><span className="sb-label">{link.label}</span></button>)}</div>)}</nav>
      <div className="sb-bot"><div className="uchip">{session.user.avatarUrl ? <img className="ava ava-image" src={session.user.avatarUrl} alt={`${session.user.fullName}'s profile picture`} /> : <span className="ava">{initials(session.user.fullName)}</span>}<span className="user-detail"><strong className="u-name">{session.user.fullName}</strong><small className="u-role">{administrator ? 'Administrator' : 'Member'}</small></span></div><button className="logout-btn" onClick={() => void logout()} title={sidebarCollapsed ? 'Log out' : undefined}><span aria-hidden="true">↪</span><span className="logout-label">Logout</span></button></div>
    </aside>
    {sidebarCollapsed ? <button className="sidebar-reopen" type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Show sidebar navigation" title="Show sidebar navigation"><SidebarToggleIcon collapsed /></button> : null}
    <div className="workspace-body"><div className="mobile-header"><span className="sb-brand"><GlobeIcon />WebSphere</span><select value={page} onChange={(event) => setPage(event.target.value as Page)}>{sections.flatMap((section) => section.links).map((link) => <option key={link.id} value={link.id}>{link.label}</option>)}</select></div><div className="main">
      {page === 'dashboard' ? <Dashboard name={session.user.fullName} notify={notify} onPage={navigate} onNotificationClick={openNotification} /> : null}
      {page === 'groups' ? <GroupsPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} onIdeas={() => setPage('ideas')} onChat={() => setPage('chat')} notify={notify} /> : null}
      {page === 'ideas' ? <IdeasPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} notify={notify} /> : null}
      {page === 'projects' ? <ProjectsPage notify={notify} /> : null}
      {page === 'admin' ? <AdminPage notify={notify} /> : null}
      {page === 'accounts' ? <AdminAccounts notify={notify} /> : null}
      {page === 'chat' ? <GroupChatPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} notify={notify} incomingCall={incomingCall?.groupId === selectedGroupId ? incomingCall : null} onIncomingCallHandled={() => setIncomingCall(null)} /> : null}
      {page === 'tasks' ? <TasksPage notify={notify} focusedTaskId={selectedTaskId} /> : null}
      {page === 'workflow' ? <ProjectsAnalyticsPage kind="workflow" notify={notify} /> : null}
      {page === 'predictive' ? <ProjectsAnalyticsPage kind="predictive" notify={notify} /> : null}
      {page === 'calendar' ? <CalendarPage notify={notify} /> : null}
      {page === 'tools' ? <IntegrationsPage notify={notify} /> : null}
      {page === 'trello' ? <TrelloMonitoringPage notify={notify} /> : null}
      {page === 'tracker' ? <TrackerPage notify={notify} /> : null}
      {page === 'notifications' ? <NotificationsPage notify={notify} onNotificationClick={openNotification} /> : null}
      {page === 'profile' ? <ProfilePage user={session.user} onUserUpdated={updateUser} onSessionInvalidated={() => { clearSession(); onLogout(); }} notify={notify} /> : null}
      {page === 'settings' ? <AdminSettingsPage notify={notify} /> : null}
    </div></div>
  </div>
  <AiAssistantModal open={assistantOpen} onClose={() => setAssistantOpen(false)} notify={notify} />
  </main>;
}

function AdminPage({ notify }: { notify: (message: string) => void }) {
  type Monitoring = { users: { total: number; active: number; locked: number; suspended: number; newSignups7d: number }; projects: { active: number; completed: number }; activity: { tasksCompleted24h: number; openSupportTickets: number }; health: { database: string; redis: string; overall: string } };
  type SupportTicket = { id: string; category: string; subject: string; body: string; status: string; createdAt: string; user: { fullName: string; email: string } };
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
    <section className="cc support-request-queue"><div className="cc-head"><div><h3>Support Requests</h3><span className="support-queue-count">{tickets?.length ?? 0} recent</span></div><button type="button" className="btn-o btn-sm" onClick={() => void refresh()}>Refresh</button></div>{tickets === null ? <div className="empty-message">Loading support requests…</div> : tickets.length ? <div className="support-ticket-list">{tickets.map((ticket) => <article className="support-ticket" key={ticket.id}><div className="support-ticket-top"><div><strong>{ticket.subject}</strong><span>{ticket.user.fullName} · {ticket.user.email}</span></div><span className={`support-ticket-status ${ticket.status}`}>{ticket.status.replace('_', ' ')}</span></div><p>{ticket.body}</p><footer><span>{ticket.category.replaceAll('_', ' ')}</span><time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString()}</time></footer></article>)}</div> : <div className="empty-message">New support requests will appear here.</div>}</section>
  </section>;
}

function AdminAccounts({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<Array<{ id: string; fullName: string; email: string; role: string; status: string }> | null>(null);
  useEffect(() => { void request<Array<{ id: string; fullName: string; email: string; role: string; status: string }>>('/admin/users').then(setUsers).catch((error: Error) => notify(error.message)); }, [notify]);
  return <section className="sp on"><div className="ph"><div><h2>Account Management</h2></div><button className="btn-o btn-sm" onClick={() => notify('System logs are available from the admin activity log endpoint.')}>View System Logs</button></div><div className="cc requests-card"><div className="cc-head"><h3>⟳ Requests</h3><button className="btn-o btn-sm" onClick={() => notify('Resolved requests cleared.')}>Clear Resolved</button></div><div className="empty-message">No help requests yet. Requests submitted by users will appear here automatically.</div></div><div className="cc"><div className="cc-head"><h3>All Users</h3></div>{users?.length ? users.map((user) => <div className="urow" key={user.id}><span className="ava">{initials(user.fullName)}</span><span className="ur-info"><strong className="ur-name">{user.fullName}</strong><small className="ur-email">{user.email} · {user.role}</small></span><span className={`bdg ${user.status === 'active' ? 'g' : 'y'}`}>{user.status}</span></div>) : <div className="empty-message">{users ? 'Registered users will appear here.' : 'Loading accounts…'}</div>}</div></section>;
}

function GlobeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#0EA0D0" strokeWidth="2"/><ellipse cx="12" cy="12" rx="4" ry="9" stroke="#0EA0D0" strokeWidth="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="#0EA0D0" strokeWidth="1.5"/></svg>; }
function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><path d={collapsed ? 'm10 8 4 4-4 4' : 'm14 8-4 4 4 4'} /></svg>; }
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
  if (page === 'ideas') return <svg {...common}><path d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5z"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function Health({ label, detail, ok = true }: { label: string; detail: string; ok?: boolean }) { return <div className="health-row"><span><strong>{label}</strong><small>{detail}</small></span><span className={`bdg ${ok ? 'g' : 'r'}`}>{ok ? '● Healthy' : '● Attention'}</span></div>; }
function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
