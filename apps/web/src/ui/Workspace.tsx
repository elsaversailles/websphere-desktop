import { AdminActivityChart } from './AdminActivityChart';
import { workspaceSubscription, closeWorkspaceSocket } from './workspaceSocket';
import { startIncomingRingtone } from './ringtone';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CallKind, TicketStatus } from '@websphere/shared';
import { clearSession, invalidateSession, request, saveSessionUser, type Session, type User } from '../api';
import { AiAssistantModal, useAiAssistant } from './AiAssistantModal';
import { Dashboard } from './Dashboard';
import { avatarTone } from './health';
import { ConfirmDialog } from './ConfirmDialog';
import { GroupChatPage, loadSavedCall, removeSavedCall } from './GroupChatPage';
import { GroupsPage } from './GroupsPage';
import { IdeasPage } from './IdeasPage';
import { ProjectsPage } from './ProjectsPage';
import { taskNotificationDestination } from './taskNotificationDestination';
import { SupportRequestsPage, FeedbackPage } from './SupportRequestsPage';
import { categoryLabel, statusLabel, ticketStatusOptions, type SupportTicketRecord } from './ticketStatus';
import { AdminSettingsPage, AnnouncementsPage, CalendarPage, NotificationsPage, ProfilePage, ProjectsAnalyticsPage, TasksPage, TrackerPage } from './LegacyPages';

type Page = 'dashboard' | 'groups' | 'chat' | 'ideas' | 'projects' | 'tasks' | 'workflow' | 'predictive' | 'calendar' | 'tracker' | 'notifications' | 'announcements' | 'profile' | 'assistant' | 'admin' | 'accounts' | 'archive' | 'settings' | 'support' | 'feedback';
type WorkspaceProps = { session: Session; onSessionChange: (session: Session) => void; onLogout: () => void; notify: (message: string) => void };
type Link = { id: Page; label: string; icon: string };
type NotificationEntry = { id: string; read: boolean; type?: string; relatedId?: string | null; relatedType?: string | null };
type AdminSupportTicket = SupportTicketRecord & { user: { fullName: string; email: string } | null; contactEmail: string | null };

const userSections: Array<{ title: string; links: Link[] }> = [
  { title: 'Main', links: [{ id: 'dashboard', label: 'Dashboard', icon: '⌂' }, { id: 'announcements', label: 'Announcements', icon: '◉' }] },
  { title: 'Groups & Projects', links: [{ id: 'groups', label: 'My Groups', icon: '♧' }, { id: 'chat', label: 'Group Chat', icon: '□' }, { id: 'ideas', label: 'Idea Management', icon: '◇' }, { id: 'projects', label: 'My Projects', icon: '▱' }, { id: 'tasks', label: 'My Tasks', icon: '✓' }] },
  { title: 'Analytics', links: [{ id: 'workflow', label: 'Workflow Analytics', icon: '▥' }, { id: 'predictive', label: 'Predictive Monitoring', icon: '◉' }] },
  { title: 'Tools', links: [{ id: 'calendar', label: 'Calendar', icon: '▦' }, { id: 'tracker', label: 'Task Progress Tracker', icon: '▤' }] },
  { title: 'Account', links: [{ id: 'profile', label: 'Profile & Settings', icon: '♙' }, { id: 'support', label: 'My Support Requests', icon: '?' }, { id: 'feedback', label: 'Feedback', icon: '☆' }] },
];
const adminSections: Array<{ title: string; links: Link[] }> = [
  { title: 'System Admin', links: [{ id: 'admin', label: 'User Activity', icon: '▣' }, { id: 'accounts', label: 'Account Management', icon: '♧' }, { id: 'archive', label: 'Archive Accounts', icon: '🗄' }, { id: 'feedback', label: 'User Feedback', icon: '☆' }, { id: 'settings', label: 'System Settings', icon: '◉' }] },
];

// The sidebar sections are the source of truth for which pages a role may land on, so a restored
// page can never put a user somewhere their role has no nav entry for.
const allowedPagesFor = (admin: boolean): Set<Page> => new Set([...(admin ? adminSections : userSections).flatMap((section) => section.links.map((link) => link.id)), 'notifications'] as Page[]);
const defaultPageFor = (admin: boolean): Page => (admin ? 'admin' : 'dashboard');

type NavState = { page: Page; selectedGroupId?: string; selectedProjectId?: string; selectedTaskId?: string; selectedTicketId?: string };

function readNavState(admin: boolean): NavState {
  const url = new URL(window.location.href);
  const [, segment, id] = url.pathname.split('/');
  const path = segment === 'tools' ? 'tracker' : segment;
  const page = allowedPagesFor(admin).has(path as Page) ? path as Page : defaultPageFor(admin);
  const groupId = ['groups', 'chat', 'ideas'].includes(page) ? id : undefined;
  return {
    page,
    selectedGroupId: groupId,
    selectedProjectId: page === 'projects' ? id : undefined,
    selectedTaskId: page === 'tasks' ? id : url.searchParams.get('task') ?? undefined,
    selectedTicketId: ['accounts', 'support'].includes(page) ? id : undefined,
  };
}

function navPath(nav: NavState) {
  const selection = ({ projects: nav.selectedProjectId, chat: nav.selectedGroupId, groups: nav.selectedGroupId, ideas: nav.selectedGroupId, tasks: nav.selectedTaskId, accounts: nav.selectedTicketId, support: nav.selectedTicketId } as Partial<Record<Page, string>>)[nav.page];
  const query = nav.page === 'projects' && nav.selectedTaskId ? `?task=${encodeURIComponent(nav.selectedTaskId)}` : '';
  return `/${nav.page}${selection ? `/${encodeURIComponent(selection)}` : ''}${query}`;
}

export function Workspace({ session, onSessionChange, onLogout, notify }: WorkspaceProps) {
  const administrator = session.role === 'Administrator';
  const drawerName = session.user.fullName;
  const userId = session.user.id;
  const [nav, setNav] = useState(() => readNavState(administrator));
  const { page, selectedGroupId = '', selectedProjectId = '', selectedTaskId = '', selectedTicketId = '' } = nav;
  const projectTaskFocus = useMemo(() => selectedProjectId && selectedTaskId ? { projectId: selectedProjectId, taskId: selectedTaskId } : null, [selectedProjectId, selectedTaskId]);
  const notificationRequestRef = useRef(0);

  function go(next: NavState, replace = false) {
    if (!allowedPagesFor(administrator).has(next.page)) return;
    const path = navPath(next);
    if (path !== window.location.pathname + window.location.search) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    }
    setNav(next);
  }

  function setPage(target: Page) {
    if (target === page) return;
    notificationRequestRef.current += 1;
    go({ page: target, selectedGroupId });
  }

  function setSelectedGroupId(groupId: string) {
    go({ ...nav, selectedGroupId: groupId }, !selectedGroupId);
  }

  useEffect(() => {
    const pop = () => { notificationRequestRef.current += 1; setNav(readNavState(administrator)); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [administrator]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeCall, setActiveCall] = useState<{ groupId: string; startedAt: number } | null>(() => administrator ? null : loadSavedCall(userId));
  const [callTime, setCallTime] = useState(0);
  useEffect(() => {
    if (!activeCall) return;
    const timer = window.setInterval(() => setCallTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCall]);
  const [incomingCall, setIncomingCall] = useState<{ groupId: string; kind: CallKind } | null>(null);
  useEffect(() => {
    if (incomingCall && !activeCall) return startIncomingRingtone();
  }, [incomingCall, activeCall]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMinimized, setAssistantMinimized] = useState(false);
  const [systemName, setSystemName] = useState('WebSphere');
  // Lives at Workspace level (which stays mounted across page navigation) so an in-flight request
  // keeps running and its reply is captured even while the panel is minimized.
  const assistant = useAiAssistant(notify);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const sections = administrator ? adminSections : userSections;
  const [monitoring, setMonitoring] = useState<Monitoring | null>(null);
  const [monitoringError, setMonitoringError] = useState('');
  const [monitoringRevision, setMonitoringRevision] = useState(0);
  const openTickets = monitoring?.activity.openSupportTickets ?? 0;

  useEffect(() => {
    if (!administrator) return;
    const controller = new AbortController();
    setMonitoringError('');
    void request<Monitoring>('/admin/monitoring', { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setMonitoring(data);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setMonitoringError(error.message);
    });
    return () => controller.abort();
  }, [administrator, monitoringRevision, page]);

  useEffect(() => {
    let cancelled = false;
    void request<{ systemName: string }>('/settings/general').then((settings) => {
      if (!cancelled && settings.systemName) { setSystemName(settings.systemName); document.title = settings.systemName; }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!logoutOpen) return;
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && !loggingOut) setLogoutOpen(false); }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [logoutOpen, loggingOut]);

  function navigate(target: Page) {
    if (target === 'assistant') { setAssistantOpen(true); setAssistantMinimized(false); }
    else setPage(target);
  }

  function openNotification(notification: NotificationEntry) {
    const requestId = ++notificationRequestRef.current;
    if (!notification.read) void request(`/notifications/${notification.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    switch (notification.relatedType?.trim().toLowerCase()) {
      case 'group':
      case 'group_chat':
      case 'chat':
        go({ page: 'chat', selectedGroupId: notification.relatedId ?? selectedGroupId });
        break;
      case 'project': setPage(administrator ? 'notifications' : 'projects'); break;
      case 'task':
        if (administrator) { setPage('notifications'); break; }
        if (notification.type === 'task_update' && notification.relatedId) {
          const taskId = notification.relatedId;
          void request<{ projectId: string; assignments: Array<{ assigneeId: string }> }>(`/tasks/${encodeURIComponent(taskId)}`).then((task) => {
            if (notificationRequestRef.current !== requestId) return;
            if (taskNotificationDestination(task, userId) === 'tasks') {
              go({ page: 'tasks', selectedTaskId: taskId });
            } else {
              go({ page: 'projects', selectedProjectId: task.projectId, selectedTaskId: taskId });
            }
          }).catch((error: Error) => { if (notificationRequestRef.current === requestId) notify(error.message || 'Could not open this task.'); });
          break;
        }
        go({ page: 'tasks', selectedTaskId: notification.relatedId ?? '' });
        break;
      case 'idea': setPage('ideas'); break;
      case 'ticket':
        go({ page: administrator ? 'accounts' : 'support', selectedTicketId: notification.relatedId ?? '' });
        break;
      case 'calendar':
      case 'event': setPage('calendar'); break;
      default: setPage('notifications');
    }
  }

  useEffect(() => {
    const { on, dispose } = workspaceSubscription();
    on('account:archived', () => invalidateSession('ACCOUNT_ARCHIVED'));
    on('group:removed', (event: { groupId: string }) => setIncomingCall((current) => current?.groupId === event.groupId ? null : current));
    on('call:invite', (event: { groupId: string; kind: CallKind; initiatorUserId: string }) => {
      if (event.initiatorUserId !== userId) setIncomingCall({ groupId: event.groupId, kind: event.kind });
    });
    on('call:ended', (event: { groupId: string }) => setIncomingCall((current) => current?.groupId === event.groupId ? null : current));
    on('admin:activity', () => { if (administrator) setMonitoringRevision((value) => value + 1); });
    on('notification:new', (notification: { message?: string; relatedType?: string | null }) => {
      if (notification?.message && notification.relatedType?.trim().toLowerCase() !== 'chat') notify(notification.message);
      if (administrator && notification?.relatedType === 'ticket') setMonitoringRevision((value) => value + 1);
    });
    return () => { dispose(); closeWorkspaceSocket(); };
  }, [userId, notify, administrator]);

  // A login on another device increments the account token version immediately. Poll without
  // touching the idle timer so an open previous session is returned to the landing page promptly.
  useEffect(() => {
    const verifyCurrentSession = () => { void request('/auth/session-valid').catch(() => undefined); };
    const interval = window.setInterval(verifyCurrentSession, 15_000);
    window.addEventListener('focus', verifyCurrentSession);
    window.addEventListener('online', verifyCurrentSession);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', verifyCurrentSession); window.removeEventListener('online', verifyCurrentSession); };
  }, [session.access]);

  // The API enforces the same policy on every authenticated request. This timer gives an idle user
  // a clear sign-out even when they leave a tab open without making another request.
  useEffect(() => {
    let idleTimeoutMinutes = 30;
    let inactivityTimer: number | undefined;
    let lastServerTouch = 0;
    let signedOut = false;
    const signOutForInactivity = async () => {
      if (signedOut) return;
      signedOut = true;
      try { await request('/auth/logout'); } catch { /* The local session is always cleared below. */ }
      clearSession();
      notify('Your session timed out due to inactivity. Please sign in again.');
      onLogout();
    };
    const schedule = () => {
      if (inactivityTimer) window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => { void signOutForInactivity(); }, idleTimeoutMinutes * 60_000);
    };
    const recordActivity = () => {
      schedule();
      // Keep the server-side session timestamp current for active users who are reading, typing,
      // or moving through the interface without otherwise making an API request.
      if (Date.now() - lastServerTouch >= 60_000) {
        lastServerTouch = Date.now();
        void request<{ idleTimeoutMinutes: number }>('/auth/session-policy').then((policy) => {
          if (Number.isInteger(policy.idleTimeoutMinutes) && policy.idleTimeoutMinutes >= 5 && policy.idleTimeoutMinutes <= 480) idleTimeoutMinutes = policy.idleTimeoutMinutes;
          schedule();
        }).catch(() => undefined);
      }
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
    recordActivity();
    return () => {
      if (inactivityTimer) window.clearTimeout(inactivityTimer);
      events.forEach((event) => window.removeEventListener(event, recordActivity));
    };
  }, [session.access, onLogout, notify]);

  async function logout() {
    setLoggingOut(true);
    try { await request('/auth/logout', { method: 'POST' }); } catch { /* local session is always cleared */ }
    // Explicit sign-out starts fresh next time; a plain refresh keeps the saved page.
    removeSavedCall(userId);
    clearSession(); onLogout();
  }

  function updateUser(user: User) {
    const next = saveSessionUser(user);
    if (next) onSessionChange(next);
  }

  return <main className="page on">{activeCall && (page !== 'chat' || selectedGroupId !== activeCall.groupId) ? <button type="button" className="workspace-active-call" onClick={() => go({ page: 'chat', selectedGroupId: activeCall.groupId })}>● Return to call · {formatCallDuration(callTime - activeCall.startedAt)}</button> : null}{incomingCall && (page !== 'chat' || incomingCall.groupId !== selectedGroupId) ? <div className="workspace-call-invite call-invite"><span>{incomingCall.kind === 'video' ? 'Video' : 'Voice'} call in progress</span><button className="btn btn-sm" onClick={() => go({ page: 'chat', selectedGroupId: incomingCall.groupId })}>Join call</button><button className="btn-o btn-sm" onClick={() => setIncomingCall(null)}>Dismiss</button></div> : null}<div className={`layout${administrator ? ' admin-workspace' : ''}`}>
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sb-head"><button className="sb-brand" onClick={() => setPage(administrator ? 'admin' : 'dashboard')}><img className="sb-logo" src="/logo.png" alt="" /><span className="sb-brand-word">{systemName}</span></button><button className="sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'Show sidebar navigation' : 'Hide sidebar navigation'} title={sidebarCollapsed ? 'Show sidebar navigation' : 'Hide sidebar navigation'}><BurgerIcon /></button></div>
      <nav aria-label="Main navigation">{sections.map((section) => <div className="sb-inline-sec" key={section.title}><div className="sb-sec-label">{section.title}</div>{section.links.map((link) => <button type="button" className={`sb-item ${page === link.id ? 'on' : ''}`} key={link.id} aria-current={page === link.id ? 'page' : undefined} onClick={() => setPage(link.id)}><span className="sb-ico"><NavIcon page={link.id} /></span><span className="sb-label">{link.label}</span>{administrator && link.id === 'accounts' && openTickets > 0 ? <span className="admin-ticket-badge" aria-label={`${openTickets} open support tickets`}>{openTickets}</span> : null}</button>)}</div>)}</nav>
      <div className="sb-bot"><div className="uchip">{!administrator && session.user.avatarUrl ? <img className="ava ava-image" src={session.user.avatarUrl} alt={`${session.user.fullName}'s profile picture`} /> : <span className={`ava tone-${avatarTone(session.user.id)}`}>{initials(drawerName)}</span>}<span className="user-detail"><strong className="u-name">{drawerName}</strong>{administrator ? <small className="u-role" title={session.user.email}>Administrator</small> : null}</span></div><div className="sidebar-footer-actions">{administrator ? <button type="button" className="admin-notifications" aria-label="Notifications" title="Notifications" aria-current={page === 'notifications' ? 'page' : undefined} onClick={() => setPage('notifications')}><NavIcon page="notifications" /></button> : null}<button className="logout-btn" onClick={() => setLogoutOpen(true)} title={sidebarCollapsed ? 'Log out' : undefined}>{administrator ? <LogoutIcon /> : <span aria-hidden="true">↪</span>}<span className="logout-label">Logout</span></button></div></div>
    </aside>
    {sidebarCollapsed ? <button className="sidebar-reopen" type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Show sidebar navigation" title="Show sidebar navigation"><BurgerIcon /></button> : null}
    <div className="workspace-body"><div className="mobile-header"><span className="sb-brand"><img className="sb-logo" src="/logo.png" alt="" /><span className="sb-brand-word">{systemName}</span></span><select aria-label="Page" value={page} onChange={(event) => setPage(event.target.value as Page)}>{sections.flatMap((section) => section.links).map((link) => <option key={link.id} value={link.id}>{link.label}</option>)}{administrator ? <option value="notifications">Notifications</option> : null}</select>{administrator ? <button type="button" className="admin-notifications" aria-label="Log out" onClick={() => setLogoutOpen(true)}><LogoutIcon /></button> : null}</div><div className="main">
      {page === 'dashboard' ? <Dashboard userId={session.user.id} name={session.user.fullName} notify={notify} onPage={navigate} onNotificationClick={openNotification} /> : null}
      {page === 'groups' ? <GroupsPage selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} onChat={() => setPage('chat')} notify={notify} /> : null}
      {page === 'ideas' ? <IdeasPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} notify={notify} /> : null}
      {page === 'projects' ? <ProjectsPage notify={notify} userId={userId} focusedTask={projectTaskFocus} selectedProjectId={selectedProjectId} onSelectProject={(id) => go({ page: 'projects', selectedProjectId: id })} /> : null}
      {page === 'admin' ? <AdminPage data={monitoring} error={monitoringError} onRetry={() => setMonitoringRevision((value) => value + 1)} /> : null}
      {page === 'accounts' ? <AdminAccounts key="accounts" notify={notify} focusedTicketId={selectedTicketId} onTicketSaved={() => setMonitoringRevision((value) => value + 1)} /> : null}
      {page === 'archive' ? <AdminArchive notify={notify} /> : null}
      {page === 'chat' || activeCall ? <div hidden={page !== 'chat' || (!!activeCall && selectedGroupId !== activeCall.groupId)}><GroupChatPage userId={session.user.id} selectedGroupId={activeCall?.groupId ?? selectedGroupId} onSelectGroup={setSelectedGroupId} onIdeas={() => setPage('ideas')} notify={notify} incomingCall={incomingCall?.groupId === selectedGroupId ? incomingCall : null} onIncomingCallHandled={() => setIncomingCall(null)} onCallChange={setActiveCall} /></div> : null}
      {page === 'tasks' ? <TasksPage notify={notify} focusedTaskId={selectedTaskId} /> : null}
      {page === 'workflow' ? <ProjectsAnalyticsPage kind="workflow" notify={notify} /> : null}
      {page === 'predictive' ? <ProjectsAnalyticsPage kind="predictive" notify={notify} /> : null}
      {page === 'calendar' ? <CalendarPage notify={notify} /> : null}
      {page === 'tracker' ? <TrackerPage notify={notify} /> : null}
      {page === 'notifications' ? <NotificationsPage notify={notify} onNotificationClick={openNotification} /> : null}
      {page === 'announcements' ? <AnnouncementsPage notify={notify} /> : null}
      {page === 'profile' ? <ProfilePage user={session.user} onUserUpdated={updateUser} onSessionInvalidated={() => { clearSession(); onLogout(); }} notify={notify} /> : null}
      {page === 'settings' ? <AdminSettingsPage notify={notify} onSessionInvalidated={() => { clearSession(); onLogout(); }} /> : null}
      {page === 'feedback' ? administrator ? <AdminAccounts key="feedback" feedbackOnly notify={notify} onTicketSaved={() => setMonitoringRevision((value) => value + 1)} /> : <FeedbackPage notify={notify} /> : null}
      {page === 'support' ? <SupportRequestsPage notify={notify} focusedTicketId={selectedTicketId} /> : null}
    </div></div>
  </div>
  <AiAssistantModal open={assistantOpen} minimized={assistantMinimized} assistant={assistant} onClose={() => { setAssistantOpen(false); setAssistantMinimized(false); }} onMinimize={() => setAssistantMinimized(true)} onRestore={() => setAssistantMinimized(false)} />
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

type Monitoring = {
  users: { locked: number; suspended: number; newSignups7d: number };
  projects: { completed: number };
  activity: { tasksCompleted24h: number; openSupportTickets: number };
  health: { database: string; redis: string; overall: string };
};

function AdminPage({ data, error, onRetry }: { data: Monitoring | null; error: string; onRetry: () => void }) {
  return <section className="sp on admin-dashboard">
    <header className="ph"><h2>User Activity</h2></header>
    <div className="admin-dashboard-grid">
      <AdminActivityChart metric="projects" />
      <AdminActivityChart metric="users" initialPeriod="six-months" />
      <Kpi label="Flagged Inactive" value={data ? data.users.locked + data.users.suspended : '—'} tone="yel" />
      <Kpi label="System Status" value={data ? data.health.overall === 'up' ? 'Online' : 'Degraded' : '—'} tone={data ? data.health.overall === 'up' ? 'grn' : 'red' : undefined} />
      <section className="cc admin-monitoring-card">
        <div className="cc-head"><h3>System Health</h3></div>
        {error ? <p className="admin-monitoring-message" role="alert">{error} <button type="button" className="btn-o btn-sm" onClick={onRetry}>Retry</button></p> : null}
        <Health label="Database" detail="WebSphere database" ok={data ? data.health.database === 'up' : undefined} />
        <Health label="Redis" detail="Session and job queue store" ok={data ? data.health.redis === 'up' : undefined} />
        <Health label="File Storage" detail="Linux instance storage" />
      </section>
      <section className="cc admin-monitoring-card">
        <div className="cc-head"><h3>Recent User Activity</h3></div>
        {data ? <>
          <Health label="New signups (7 days)" detail={`${data.users.newSignups7d} accounts created`} ok />
          <Health label="Tasks completed (24h)" detail={`${data.activity.tasksCompleted24h} tasks marked complete`} ok />
          <Health label="Open support tickets" detail={`${data.activity.openSupportTickets} awaiting response`} ok={data.activity.openSupportTickets === 0} />
          <Health label="Completed projects" detail={`${data.projects.completed} projects completed`} ok />
        </> : <p className="admin-monitoring-message" role="status">{error ? 'Activity unavailable.' : 'Loading recent activity…'}</p>}
      </section>
    </div>
  </section>;
}

function AdminTicketCard({ ticket, notify, onSaved, focused }: { ticket: AdminSupportTicket; notify: (message: string) => void; onSaved: () => void; focused: boolean }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [response, setResponse] = useState(ticket.response ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = status !== ticket.status || response.trim() !== (ticket.response ?? '');
  async function save() {
    setSaving(true);
    try {
      await request(`/admin/support/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status, ...(response !== (ticket.response ?? '') && { response }) }) });
      notify(ticket.user ? `Request set to ${statusLabel(status)}. ${ticket.user.fullName} has been notified.` : `Request set to ${statusLabel(status)}.`);
      onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the support request.'); } finally { setSaving(false); }
  }
  return <article id={`admin-ticket-${ticket.id}`} className={`support-ticket ${focused ? 'focused' : ''}`}>
    <div className="support-ticket-top"><div><strong>{ticket.subject}</strong><span>{ticket.user ? `${ticket.user.fullName} · ${ticket.user.email}` : `Signed-out request · ${ticket.contactEmail} (unverified)`}</span></div><span className={`support-ticket-status ${ticket.status}`}>{statusLabel(ticket.status)}</span></div>
    {!ticket.user && ticket.contactEmail ? <p>Contact the requester directly: <a href={`mailto:${encodeURIComponent(ticket.contactEmail)}?subject=${encodeURIComponent(`Re: ${ticket.subject}`)}`}>{ticket.contactEmail}</a>. Verify their identity before making account changes.</p> : null}
    <p>{ticket.body}</p>
    <div className="support-ticket-controls">
      <label>Status<select className="legacy-select" value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)} disabled={saving}>{ticketStatusOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}</select></label>
      {ticket.user ? <label className="support-ticket-reply-field">Reply to user<textarea className="ifield" rows={2} maxLength={200} value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Optional message shown with the status update" disabled={saving} /></label> : <span>Use email to reply to signed-out requesters.</span>}
      <button type="button" className="btn btn-sm" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save & Notify'}</button>
    </div>
    <footer><span>{categoryLabel(ticket.category)}</span><time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString()}</time></footer>
  </article>;
}

type AdminUser = { id: string; fullName: string; email: string; role: string; status: string; archivedAt?: string | null };
type AdminUsersPage = { users: AdminUser[]; total: number; page: number; pageSize: number; totalPages: number };
const USERS_PAGE_SIZE = 10;
const SUPPORT_REQUESTS_PAGE_SIZE = 5;

function AdminAccounts({ notify, focusedTicketId, onTicketSaved, feedbackOnly = false }: { notify: (message: string) => void; focusedTicketId?: string; onTicketSaved: () => void; feedbackOnly?: boolean }) {
  const [data, setData] = useState<AdminUsersPage | null>(null);
  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null);
  const [supportPage, setSupportPage] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [archiving, setArchiving] = useState<AdminUser | null>(null);
  const [grantingAdmin, setGrantingAdmin] = useState<AdminUser | null>(null);
  const refreshUsers = () => setReloadToken((token) => token + 1);
  async function refreshSupportRequests() {
    try {
      const records = await request<AdminSupportTicket[]>('/admin/support/tickets');
      setTickets(feedbackOnly ? records.filter((ticket) => ticket.category === 'other' && /^Feedback · [1-5]\/5 stars$/.test(ticket.subject)) : records);
      setSupportPage(1);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not load support requests.'); }
  }
  // Debounce the typed search so we don't fire a request on every keystroke; reset to page 1 whenever the term changes.
  useEffect(() => {
    const { on, dispose } = workspaceSubscription();
    on('admin:activity', (metric: string) => { if (metric === 'users') setReloadToken((value) => value + 1); });
    return dispose;
  }, []);
  useEffect(() => {
    const handle = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(handle);
  }, [search]);
  useEffect(() => {
    if (feedbackOnly) return;
    let active = true;
    setLoading(true);
    const qs = `/admin/users?page=${page}&pageSize=${USERS_PAGE_SIZE}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
    void request<AdminUsersPage>(qs)
      .then((next) => { if (active) setData(next); })
      .catch((error: Error) => { if (active) notify(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, term, notify, reloadToken, feedbackOnly]);
  useEffect(() => { void refreshSupportRequests(); }, [notify, feedbackOnly]);
  useEffect(() => {
    if (!focusedTicketId || !tickets) return;
    const ticketIndex = tickets.findIndex((ticket) => ticket.id === focusedTicketId);
    if (ticketIndex < 0) return;
    const focusedPage = Math.floor(ticketIndex / SUPPORT_REQUESTS_PAGE_SIZE) + 1;
    if (supportPage !== focusedPage) { setSupportPage(focusedPage); return; }
    const frame = requestAnimationFrame(() => document.getElementById(`admin-ticket-${focusedTicketId}`)?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [focusedTicketId, tickets, supportPage]);
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total ? (page - 1) * USERS_PAGE_SIZE + 1 : 0;
  const rangeEnd = (page - 1) * USERS_PAGE_SIZE + users.length;
  const supportTotal = tickets?.length ?? 0;
  const supportTotalPages = Math.max(1, Math.ceil(supportTotal / SUPPORT_REQUESTS_PAGE_SIZE));
  const supportRangeStart = supportTotal ? (supportPage - 1) * SUPPORT_REQUESTS_PAGE_SIZE + 1 : 0;
  const supportRangeEnd = Math.min(supportPage * SUPPORT_REQUESTS_PAGE_SIZE, supportTotal);
  const displayedTickets = tickets?.slice(supportRangeStart - 1, supportRangeEnd) ?? [];
  async function setStatus(user: AdminUser, status: string, done: string) {
    try {
      await request(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      notify(done);
      refreshUsers();
    } catch (error) { notify((error as Error).message); }
  }
  async function grantAdmin(user: AdminUser) {
    try {
      await request(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'Administrator' }) });
      notify(`${user.fullName} can now sign in as an administrator.`);
      refreshUsers();
    } catch (error) { notify((error as Error).message); }
  }
  return <section className="sp on"><div className="ph"><div><h2>{feedbackOnly ? 'User Feedback' : 'Account Management'}</h2></div></div><section className="cc support-request-queue"><div className="cc-head"><div><h3>{feedbackOnly ? 'Submitted Feedback' : 'Support Requests'}</h3><span className="support-queue-count">{supportTotal} recent</span></div><button type="button" className="btn-o btn-sm" onClick={() => { void refreshSupportRequests(); refreshUsers(); }}>Refresh</button></div>{tickets === null ? <div className="empty-message">{feedbackOnly ? 'Loading feedback…' : 'Loading support requests…'}</div> : tickets.length ? <><div className="support-ticket-list">{displayedTickets.map((ticket) => <AdminTicketCard key={`${ticket.id}-${ticket.updatedAt}`} ticket={ticket} focused={ticket.id === focusedTicketId} notify={notify} onSaved={() => { void refreshSupportRequests(); onTicketSaved(); }} />)}</div>{supportTotalPages > 1 ? <div className="user-pager support-request-pager"><button type="button" className="btn-o btn-sm" disabled={supportPage <= 1} onClick={() => setSupportPage((current) => Math.max(1, current - 1))}>Previous</button><span className="user-pager-label" aria-live="polite">{supportRangeStart}–{supportRangeEnd} of {supportTotal} · Page {supportPage} of {supportTotalPages}</span><button type="button" className="btn-o btn-sm" disabled={supportPage >= supportTotalPages} onClick={() => setSupportPage((current) => Math.min(supportTotalPages, current + 1))}>Next</button></div> : null}</> : <div className="empty-message">{feedbackOnly ? 'No feedback has been submitted.' : 'New support requests will appear here.'}</div>}</section>{!feedbackOnly ? <div className="cc"><div className="cc-head"><h3>All Users</h3>{total ? <span className="user-page-count">{rangeStart}–{rangeEnd} of {total}</span> : null}</div><div className="user-search"><input type="search" className="ifield" placeholder="Search by name or email…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search users by name or email" /></div>{users.length ? users.map((user) => <AdminUserRow key={user.id} user={user} onGrantAdmin={() => setGrantingAdmin(user)} onArchive={() => setArchiving(user)} onDeactivate={() => setStatus(user, 'deactivated', `${user.fullName} has been deactivated.`)} onActivate={() => setStatus(user, 'active', `${user.fullName} has been reactivated.`)} />) : <div className="empty-message">{loading ? 'Loading accounts…' : term ? `No users match “${term}”.` : 'Registered users will appear here.'}</div>}{totalPages > 1 ? <div className="user-pager"><button type="button" className="btn-o btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span className="user-pager-label">Page {page} of {totalPages}</span><button type="button" className="btn-o btn-sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button></div> : null}</div> : null}
    {grantingAdmin ? <ConfirmDialog
      title="Grant administrator access?"
      description={`${grantingAdmin.fullName} (${grantingAdmin.email}) will have full administrator access. They’ll need to sign in again using Admin login.`}
      confirmLabel="Grant access"
      onCancel={() => setGrantingAdmin(null)}
      onConfirm={() => { void grantAdmin(grantingAdmin); setGrantingAdmin(null); }}
    /> : null}
    {archiving ? <AdminUserArchiveModal user={archiving} onClose={() => setArchiving(null)} onArchived={() => { setArchiving(null); refreshUsers(); }} notify={notify} /> : null}
  </section>;
}

function AdminArchive({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdminUsersPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const refresh = () => setReloadToken((token) => token + 1);
  useEffect(() => {
    const { on, dispose } = workspaceSubscription();
    on('admin:activity', (metric: string) => { if (metric === 'users') setReloadToken((value) => value + 1); });
    return dispose;
  }, []);
  useEffect(() => {
    const handle = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(handle);
  }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const qs = `/admin/users/archived?page=${page}&pageSize=${USERS_PAGE_SIZE}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
    void request<AdminUsersPage>(qs)
      .then((next) => { if (active) setData(next); })
      .catch((error: Error) => { if (active) notify(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, term, notify, reloadToken]);
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total ? (page - 1) * USERS_PAGE_SIZE + 1 : 0;
  const rangeEnd = (page - 1) * USERS_PAGE_SIZE + users.length;
  async function restore(user: AdminUser) {
    setRestoringId(user.id);
    try {
      await request(`/admin/users/${user.id}/restore`, { method: 'POST' });
      notify(`${user.fullName}'s account was restored.`);
      refresh();
    } catch (error) { notify((error as Error).message); }
    finally { setRestoringId(null); }
  }
  return <section className="sp on"><div className="ph"><div><h2>Archived Accounts</h2><p className="ph-sub">Archived accounts are hidden from Account Management but their records are kept. Restore an account to return it to the active list.</p></div></div><div className="cc"><div className="cc-head"><h3>Archived Users</h3>{total ? <span className="user-page-count">{rangeStart}–{rangeEnd} of {total}</span> : null}</div><div className="user-search"><input type="search" className="ifield" placeholder="Search archived by name or email…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search archived accounts by name or email" /></div>{users.length ? users.map((user) => <div className="urow" key={user.id}><span className={`ava tone-${avatarTone(user.id)}`}>{initials(user.fullName)}</span><span className="ur-info"><strong className="ur-name">{user.fullName}</strong><small className="ur-email">{user.email} · {user.role}{user.archivedAt ? ` · archived ${new Date(user.archivedAt).toLocaleDateString()}` : ''}</small></span><button type="button" className="btn-o btn-sm" disabled={restoringId === user.id} onClick={() => void restore(user)}>{restoringId === user.id ? 'Restoring…' : 'Restore'}</button></div>) : <div className="empty-message">{loading ? 'Loading archived accounts…' : term ? `No archived accounts match “${term}”.` : 'No accounts have been archived yet.'}</div>}{totalPages > 1 ? <div className="user-pager"><button type="button" className="btn-o btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span className="user-pager-label">Page {page} of {totalPages}</span><button type="button" className="btn-o btn-sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button></div> : null}</div></section>;
}

function AdminUserRow({ user, onGrantAdmin, onArchive, onDeactivate, onActivate }: { user: AdminUser; onGrantAdmin: () => void; onArchive: () => void; onDeactivate: () => void; onActivate: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const inactive = user.status !== 'active';
  const run = (action: () => void) => { setOpen(false); action(); };
  return <div className="urow"><span className={`ava tone-${avatarTone(user.id)}`}>{initials(user.fullName)}</span><span className="ur-info"><strong className="ur-name">{user.fullName}</strong><small className="ur-email">{user.email} · {user.role}</small></span><span className={`bdg ${user.status === 'active' ? 'g' : 'y'}`}>{user.status === 'suspended' ? 'deactivated' : user.status}</span><div className="ur-menu" ref={menuRef}><button type="button" className="ur-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${user.fullName}`} onClick={() => setOpen((value) => !value)}><DotsIcon /></button>{open ? <div className="ur-menu-pop" role="menu">{inactive ? <button type="button" role="menuitem" onClick={() => run(onActivate)}>Activate</button> : <button type="button" role="menuitem" onClick={() => run(onDeactivate)}>Deactivate</button>}{!inactive && user.role !== 'Administrator' ? <button type="button" role="menuitem" onClick={() => run(onGrantAdmin)}>Make administrator</button> : null}<button type="button" role="menuitem" className="danger" onClick={() => run(onArchive)}>Archive</button></div> : null}</div></div>;
}

function AdminUserArchiveModal({ user, onClose, onArchived, notify }: { user: AdminUser; onClose: () => void; onArchived: () => void; notify: (message: string) => void }) {
  const [working, setWorking] = useState(false);
  async function confirmArchive() {
    setWorking(true);
    try {
      await request(`/admin/users/${user.id}/archive`, { method: 'POST' });
      notify(`${user.fullName}'s account was archived.`);
      onArchived();
    } catch (error) { notify((error as Error).message); }
    finally { setWorking(false); }
  }
  return <div className="logout-ov" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
    <div className="logout-box" role="dialog" aria-modal="true" aria-labelledby="ur-arch-title">
      <h3 id="ur-arch-title" className="ur-edit-title">Archive account?</h3>
      <p className="muted">This moves <strong>{user.fullName}</strong> ({user.email}) to Archived Accounts and signs them out of every device. Their records are kept, and you can restore the account later.</p>
      <div className="ur-edit-actions"><button type="button" className="btn-o" disabled={working} onClick={onClose}>Cancel</button><button type="button" className="btn btn-red" disabled={working} onClick={() => void confirmArchive()}>{working ? 'Archiving…' : 'Archive account'}</button></div>
    </div>
  </div>;
}

function DotsIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>; }

function LogoutIcon() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>; }
function BurgerIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>; }
function NavIcon({ page }: { page: Page }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (page === 'dashboard') return <svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>;
  if (page === 'announcements') return <svg {...common}><path d="M3 11v2a2 2 0 0 0 2 2h3l3 5h2l-1-5 8 3V6L8 9H5a2 2 0 0 0-2 2z"/><path d="M20 9a3 3 0 0 1 0 6"/></svg>;
  if (page === 'groups' || page === 'accounts') return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (page === 'chat' || page === 'feedback') return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
  if (page === 'projects') return <svg {...common}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
  if (page === 'tasks') return <svg {...common}><path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
  if (page === 'workflow') return <svg {...common}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>;
  if (page === 'predictive' || page === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>;
  if (page === 'calendar') return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
  if (page === 'tracker') return <svg {...common}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>;
  if (page === 'notifications') return <svg {...common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
  if (page === 'profile') return <svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
  if (page === 'admin') return <svg {...common}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
  if (page === 'archive') return <svg {...common}><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>;
  if (page === 'support') return <svg {...common}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/></svg>;
  if (page === 'ideas') return <svg {...common}><path d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5z"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function Health({ label, detail, ok }: { label: string; detail: string; ok?: boolean }) { return <div className="health-row"><span><strong>{label}</strong><small>{detail}</small></span>{ok !== undefined ? <span className={`bdg ${ok ? 'g' : 'r'}`}>{ok ? '● Healthy' : '● Attention'}</span> : null}</div>; }
function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }

function formatCallDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}
