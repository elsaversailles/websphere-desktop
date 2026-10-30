import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { ApiRequestError, apiUrl, getAccessToken, request, socketBaseUrl, type User } from '../api';
import { disablePush, enablePush, pushStatus as getPushStatus, type PushStatus } from '../push';
import { ChartCanvas } from './ChartCanvas';
import { ToolLogo } from './ToolLogo';
import { DateField } from './DateField';
import { formatDateOnly, localDateFromKey, localDateKey } from './dates';
import { badgeTone, taskPriorityHealth } from './health';
import { useLocalDay } from './useLocalDay';
import { ConfirmDialog } from './ConfirmDialog';
import { CalendarAgendaModal } from './CalendarAgendaModal';
import { MaintenanceModeControl } from './MaintenanceModeControl';
import { agendaForDay, calendarItems, type CalendarData } from './calendar';

type Notice = (message: string) => void;
type ConfirmAction = { title: string; description: string; confirmLabel: string; destructive?: boolean; action: () => void };
type Task = { id: string; title: string; projectId: string; deadline?: string | null; assignedAt?: string; priority: string; status: string; project?: { id: string; title: string }; assignedBy?: string; progress?: number };
type Project = { id: string; title: string; status: string; deadline?: string | null; group: { name: string }; members?: Array<{ role: string }>; tasks: Array<{ status: string }> };

type TeamMemberWeek = { id: string; fullName: string; role: string; contributions: number; tasksCompleted: number; performance: number; active: boolean };
type TeamPerformanceWeek = { periodStart: string; periodEnd: string; label: string; members: TeamMemberWeek[]; activeCount: number; inactiveCount: number };
type TeamMemberSummary = { id: string; fullName: string; role: string; totalContributions: number; totalCompleted: number; activeWeeks: number; performance: number; active: boolean };
type TeamPerformance = { weeks: TeamPerformanceWeek[]; members: TeamMemberSummary[]; activeMembers: number; inactiveMembers: number };
type ToolUsage = { provider: string; name: string; actions: number; usagePercent: number };
type WorkflowSummary = { summary: string; recommendations: string[]; insights: Array<{ tone: 'great' | 'notice' | 'action'; label: string; text: string }> };
type TaskRisk = { taskId: string; title: string; status: string; deadline?: string | null; projectTitle: string; assignees: string[]; score: number; level: 'high' | 'medium' | 'low'; predictedCompletion: string; delayDays: number };

const Empty = ({ children }: { children: React.ReactNode }) => <div className="legacy-empty">{children}</div>;
const Head = ({ title, action }: { title: string; action?: React.ReactNode }) => <div className="ph"><h2>{title}</h2>{action}</div>;
const Badge = ({ value }: { value: string }) => <span className={`bdg ${badgeTone(value)}`}>{value.replaceAll('_', ' ')}</span>;

export function TasksPage({ notify, focusedTaskId }: { notify: Notice; focusedTaskId?: string }) {
  const today = useLocalDay();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [connections, setConnections] = useState<Array<{ id: string; provider: string; status: string; lastSyncedAt?: string | null; tool: { name: string; category: string }; _count: { linkedResources: number; usage: number } }> | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const refreshTasks = useCallback(() => request<Task[]>('/tasks/mine').then(setTasks), []);
  useEffect(() => { void refreshTasks().catch((error: Error) => notify(error.message)); }, [notify, refreshTasks]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('notification:new', () => { void refreshTasks().catch(() => undefined); });
    return () => { socket.disconnect(); };
  }, [refreshTasks]);
  useEffect(() => { void request<Array<{ id: string; provider: string; status: string; lastSyncedAt?: string | null; tool: { name: string; category: string }; _count: { linkedResources: number; usage: number } }>>('/integrations/connections').then(setConnections).catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => {
    if (!focusedTaskId || !tasks?.some((task) => task.id === focusedTaskId)) return;
    const frame = requestAnimationFrame(() => document.getElementById(`task-${focusedTaskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [focusedTaskId, tasks]);
  async function updateStatus(task: Task, status: 'pending' | 'ongoing' | 'for_review' | 'completed') {
    if (task.status === status) return;
    setUpdatingTaskId(task.id);
    try {
      await request(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshTasks();
      notify(`Task marked ${status === 'ongoing' ? 'in progress' : status}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this task.'); }
    finally { setUpdatingTaskId(null); }
  }
  const connectedTools = connections?.filter((connection) => connection.status === 'connected') ?? [];
  return <section className="sp on"><Head title="My Tasks" /><div className="cc legacy-table-card">{tasks === null ? <Empty>Loading tasks…</Empty> : tasks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Project</th><th>Assigned By</th><th>Date Assigned</th><th>Due Date</th><th>Priority</th><th>Auto-Progress</th><th>Status</th></tr></thead><tbody>{tasks.map((task) => <tr id={`task-${task.id}`} className={task.id === focusedTaskId ? 'notification-target' : ''} key={task.id}><td><strong>{task.title}</strong></td><td>{task.project?.title ?? '—'}</td><td>{task.assignedBy ?? '—'}</td><td>{task.assignedAt ? new Date(task.assignedAt).toLocaleDateString() : 'Not set'}</td><td className={task.deadline && task.status !== 'completed' ? `due-${taskPriorityHealth(task, today).tone}` : undefined}>{formatDateOnly(task.deadline)}</td><td><span className={`bdg ${taskPriorityHealth(task, today).tone}`}>{taskPriorityHealth(task, today).label}</span></td><td>{task.progress ?? 0}%</td><td><select className={`task-status-select ${badgeTone(task.status)}`} value={task.status} aria-label={`Status for ${task.title}`} disabled={updatingTaskId === task.id} onChange={(event) => void updateStatus(task, event.target.value as 'pending' | 'ongoing' | 'for_review' | 'completed')}><option value="pending">Not Started</option><option value="ongoing">In Progress</option><option value="for_review">For Review</option><option value="completed">Completed</option></select></td></tr>)}</tbody></table> : <Empty>Tasks assigned to you will appear here.</Empty>}</div><div className="cc"><div className="cc-head"><h3>Connected External Tools</h3></div><div className="g4 legacy-tool-progress">{connections === null ? <Empty>Loading connected tools…</Empty> : connectedTools.length ? connectedTools.map((connection) => <div className="mini-state" key={connection.id}><strong>{connection.tool.name}</strong><span>{connection._count.linkedResources} linked resource{connection._count.linkedResources === 1 ? '' : 's'}{connection.lastSyncedAt ? ` · synced ${new Date(connection.lastSyncedAt).toLocaleString()}` : ''}</span></div>) : <Empty>Connect an external tool to link its files to your tasks.</Empty>}</div></div></section>;
}

export function CalendarPage({ notify }: { notify: Notice }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [data, setData] = useState<CalendarData>({ events: [], hints: [] });
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarData['events'][number] | null>(null);
  const [newEventStart, setNewEventStart] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setData(await request<CalendarData>('/calendar')); setCalendarError(null); }
    catch (error) { setCalendarError(error instanceof Error ? error.message : 'Could not load calendar events.'); throw error; }
    finally { setLoadingCalendar(false); }
  }, []);
  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [notify, refresh]);
  useEffect(() => { void request<Project[]>('/projects').then(setProjects).catch(() => undefined); }, []);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => {
      projects.forEach((project) => socket.emit('project:join', project.id, () => undefined));
      void refresh().catch(() => undefined);
    });
    socket.on('notification:new', () => { void refresh().catch(() => undefined); });
    socket.on('task:updated', () => { void refresh().catch(() => undefined); });
    // Also reconcile task creation/deletion and changes made while this tab was disconnected.
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh().catch(() => undefined); }, 30_000);
    return () => { socket.disconnect(); window.clearInterval(timer); };
  }, [projects, refresh]);
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const items = useMemo(() => calendarItems(data), [data]);

  function openCreate(day?: Date) { setEditingEvent(null); setNewEventStart(day ? toLocalInput(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9)) : ''); setDialogOpen(true); }
  function openEdit(event: CalendarData['events'][number]) { setSelectedDay(null); setEditingEvent(event); setDialogOpen(true); }
  async function saveEvent(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const values = new FormData(formEvent.currentTarget);
    const payload = { title: values.get('title'), type: values.get('type'), startAt: new Date(String(values.get('startAt'))).toISOString(), endAt: values.get('endAt') ? new Date(String(values.get('endAt'))).toISOString() : undefined, projectId: values.get('projectId') || undefined };
    setSaving(true);
    try {
      if (editingEvent) await request(`/calendar/events/${editingEvent.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await request('/calendar/events', { method: 'POST', body: JSON.stringify(payload) });
      setDialogOpen(false);
      await refresh();
      setCursor(new Date(payload.startAt));
      notify(editingEvent ? 'Event updated.' : 'Event created.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save the event.'); }
    finally { setSaving(false); }
  }
  async function deleteEvent() {
    if (!editingEvent) return;
    setSaving(true);
    try { await request(`/calendar/events/${editingEvent.id}`, { method: 'DELETE' }); setDialogOpen(false); await refresh(); notify('Event deleted.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete the event.'); }
    finally { setSaving(false); }
  }

  return <section className="sp on cal-page-wrap">
    <div className="cal-page-header">
      <div><h2>Calendar</h2></div>
      <div className="cal-header-controls">
        <div className="cal-legend"><span className="cal-legend-item"><i className="cal-legend-dot event" />Event</span><span className="cal-legend-item"><i className="cal-legend-dot deadline" />Deadline</span></div>
        <button className="cal-nav-btn" onClick={() => setCursor(shiftMonth(cursor, -1))} aria-label="Previous month">‹</button>
        <span className="cal-month-label" aria-live="polite">{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button className="cal-nav-btn" onClick={() => setCursor(shiftMonth(cursor, 1))} aria-label="Next month">›</button>
        <button className="cal-today-btn" onClick={() => setCursor(new Date())}>Today</button>
        <button className="btn btn-sm" onClick={() => openCreate()}>+ New Event</button>
      </div>
    </div>
    {calendarError ? <div className="calendar-error" role="alert">{calendarError} <button type="button" onClick={() => void refresh().catch(() => undefined)}>Retry</button></div> : null}
    <div className="cal-grid-wrap">
      <div className="cal-weekday-row">{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => <div className="cal-weekday-cell" key={day}>{day}</div>)}</div>
      <div className="cal-body">{cells.map((cell, index) => {
        if (!cell) return <div className="cal-cell" key={`empty-${index}`} aria-hidden="true" />;
        const dayItems = agendaForDay(items, cell);
        const key = localDateKey(cell);
        return <button type="button" className={`cal-cell cal-cell-button ${sameDay(cell, new Date()) ? 'today' : ''}`} key={key}
          aria-label={`Agenda for ${cell.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}, ${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}`}
          aria-haspopup="dialog" aria-expanded={selectedDay === key} onClick={() => setSelectedDay(key)}>
            <span className="cal-day-num" aria-hidden="true">{cell.getDate()}</span>
            {dayItems.slice(0, 3).map((item) => {
              const outlook = 'source' in item && item.source === 'outlook';
              const deadline = item.type.includes('deadline');
              return <span
                className={`cal-event ${deadline ? 'deadline' : 'event'}${outlook ? ' outlook' : ''}`}
                key={`${item.kind}-${item.id}-${item.type}`}
              >{item.title}</span>;
            })}
            {dayItems.length > 3 ? <span className="cal-agenda-more">+{dayItems.length - 3} more</span> : null}
        </button>;
      })}</div>
    </div>
    {loadingCalendar ? <div className="calendar-empty-note">Loading calendar…</div> : !calendarError && !items.length ? <div className="calendar-empty-note">No events or deadlines yet. Select a day to view its agenda, or New Event to add an event.</div> : null}
    {selectedDay ? <CalendarAgendaModal key={selectedDay} day={localDateFromKey(selectedDay)} items={agendaForDay(items, localDateFromKey(selectedDay))} loading={loadingCalendar} error={calendarError} onClose={() => setSelectedDay(null)} onEdit={openEdit} onRetry={() => void refresh().catch(() => undefined)} /> : null}
    {dialogOpen ? <div className="modal-ov open project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><div className="modal-box project-modal calendar-event-modal" role="dialog" aria-modal="true" aria-label={editingEvent ? 'Edit event' : 'New event'}>
      <div className="modal-ttl"><span>{editingEvent ? 'Edit Event' : 'New Event'}</span><button className="modal-close" onClick={() => setDialogOpen(false)} aria-label="Close event form">×</button></div>
      <form className="project-create-form" onSubmit={saveEvent}>
        <label className="lbl">Title</label><input className="ifield" name="title" required minLength={2} defaultValue={editingEvent?.title ?? ''} placeholder="Event title" />
        <label className="lbl">Type</label><select className="ifield" name="type" defaultValue={editingEvent?.type ?? 'meeting'}><option value="meeting">Meeting</option><option value="work_session">Work session</option><option value="presentation">Presentation</option><option value="activity">Activity</option></select>
        <label className="lbl" htmlFor="event-start-at">Start</label><DateField id="event-start-at" name="startAt" label="Event start" type="datetime-local" required defaultValue={editingEvent ? toLocalInput(editingEvent.startAt) : newEventStart} showJump={false} />
        <label className="lbl" htmlFor="event-end-at">End (optional)</label><DateField id="event-end-at" name="endAt" label="Event end" type="datetime-local" defaultValue={editingEvent?.endAt ? toLocalInput(editingEvent.endAt) : ''} showJump={false} />
        <label className="lbl">Related Project (optional)</label><select className="ifield" name="projectId" defaultValue={editingEvent?.projectId ?? ''}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
        <div className="modal-acts project-modal-actions">{editingEvent ? <button type="button" className="btn-red" onClick={() => void deleteEvent()} disabled={saving}>Delete</button> : null}<button type="button" className="btn-o" onClick={() => setDialogOpen(false)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Saving…' : editingEvent ? 'Save Changes' : 'Create Event'}</button></div>
      </form>
    </div></div> : null}
  </section>;
}

function toLocalInput(value: string | Date) { const date = value instanceof Date ? value : new Date(value); const pad = (n: number) => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }

export function ProjectsAnalyticsPage({ kind, notify }: { kind: 'workflow' | 'predictive'; notify: Notice }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState('');
  const [analytics, setAnalytics] = useState<any>(null);
  const [trends, setTrends] = useState<{ periods: Array<{ periodStart: string; tasksCompleted: number; progress: number }>; trend: string } | null>(null);
  const [summary, setSummary] = useState<WorkflowSummary | null>(null);
  const [team, setTeam] = useState<TeamPerformance | null>(null);
  const [tools, setTools] = useState<ToolUsage[] | null>(null);
  useEffect(() => { void request<Project[]>('/projects').then((next) => { setProjects(next); setSelected((current) => current || next[0]?.id || ''); }).catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => {
    if (!selected) { setAnalytics(null); setTrends(null); setSummary(null); setTeam(null); setTools(null); return; }
    void request(`/projects/${selected}/analytics`).then(setAnalytics).catch((error: Error) => notify(error.message));
    void request<{ periods: Array<{ periodStart: string; tasksCompleted: number; progress: number }>; trend: string }>(`/projects/${selected}/analytics/trends`).then(setTrends).catch(() => setTrends(null));
    void request<WorkflowSummary>(`/projects/${selected}/analytics/summary`).then(setSummary).catch(() => setSummary(null));
    void request<TeamPerformance>(`/projects/${selected}/analytics/team`).then(setTeam).catch(() => setTeam(null));
    void request<ToolUsage[]>(`/projects/${selected}/analytics/tools`).then(setTools).catch(() => setTools(null));
  }, [selected, notify]);
  const picker = <select className="legacy-select" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a project</option>{projects?.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>;
  if (kind === 'workflow') return <section className="sp on workflow-analytics"><Head title="Workflow Analytics" action={picker} /><div className="krow c3 workflow-kpis"><Kpi value={analytics ? `${Math.round((analytics.overallEfficiency ?? 0) * 100)}%` : '—'} label="Overall Efficiency" /><Kpi value={analytics?.bottlenecks?.length ?? '—'} label="Bottlenecks Detected" tone="yel" /><Kpi value={analytics?.tasksCompleted ?? '—'} label="Tasks Completed" tone="grn" /></div><div className="g2 workflow-top-grid"><TrendChartCard trends={trends} /><TeamPerformanceCard team={team} /></div><BottleneckAnalysis stages={analytics?.stages ?? null} /><div className="g2 workflow-bottom-grid"><ToolUsageCard tools={tools} /><WorkflowSummaryCard summary={summary} /></div></section>;
  const taskRisks: TaskRisk[] = analytics?.taskRisks ?? [];
  const highRiskTasks = taskRisks.filter((task) => task.level === 'high');
  const delayedTasks = taskRisks.filter((task) => task.delayDays > 0);
  const onTrackTasks = taskRisks.filter((task) => task.level === 'low');
  return <section className="sp on predictive-monitoring"><Head title="Predictive Monitoring" action={picker} /><div className="krow c3 predictive-kpis"><Kpi value={analytics ? highRiskTasks.length : '—'} label="High Risk Tasks" tone="red" /><Kpi value={analytics ? delayedTasks.length : '—'} label="Possible Delays" tone="yel" /><Kpi value={analytics ? onTrackTasks.length : '—'} label="On-Track Tasks" tone="grn" /></div><div className="cc predictive-risk-assessment"><div className="cc-head"><h3>Risk Assessment by Task</h3></div>{analytics ? taskRisks.length ? <div className="risk-cards">{taskRisks.map((task) => <TaskRiskCard task={task} key={task.taskId} />)}</div> : <Empty>Tasks will appear here once they are added to this project.</Empty> : <Empty>Project risk and progress insights will appear here once you have project data.</Empty>}</div><PredictionAlerts tasks={taskRisks} recommendations={analytics?.recommendations ?? []} /><div className="cc predicted-timeline"><div className="cc-head"><h3>Predicted Timeline</h3></div>{analytics ? taskRisks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Assigned Member</th><th>Project</th><th>Original Deadline</th><th>Predicted Completion</th><th>Risk</th><th>Recommendation</th></tr></thead><tbody>{taskRisks.map((task) => <tr key={task.taskId}><td>{task.title}</td><td>{assigneeLabel(task)}</td><td>{task.projectTitle}</td><td>{formatDateOnly(task.deadline)}</td><td className={`timeline-${task.level}`}>{date(task.predictedCompletion)}{task.delayDays ? ` (${task.delayDays > 0 ? '+' : ''}${task.delayDays} days)` : ''}</td><td><Badge value={task.level} /></td><td>{taskRecommendation(task)}</td></tr>)}</tbody></table> : <Empty>Predicted timelines will appear here.</Empty> : <Empty>Predicted timelines will appear here.</Empty>}</div></section>;
}

export function NotificationsPage({ notify, onNotificationClick }: { notify: Notice; onNotificationClick: (notification: { id: string; read: boolean; relatedId?: string | null; relatedType?: string | null }) => void }) {
  const [items, setItems] = useState<Array<{ id: string; message: string; read: boolean; createdAt: string; type?: string; relatedId?: string | null; relatedType?: string | null }> | null>(null);
  async function refresh() { setItems(await request('/notifications')); }
  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('notification:new', () => { void refresh().catch(() => undefined); });
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh().catch(() => undefined); }, 15_000);
    return () => { socket.disconnect(); window.clearInterval(timer); };
  }, []);
  async function markAll() { if (!items) return; try { await Promise.all(items.filter((item) => !item.read).map((item) => request(`/notifications/${item.id}/read`, { method: 'PATCH' }))); await refresh(); notify('Notifications marked as read.'); } catch (error) { notify(error instanceof Error ? error.message : 'Could not mark notifications as read.'); } }
  function activateNotification(item: NonNullable<typeof items>[number]) {
    setItems((current) => current?.map((notification) => notification.id === item.id ? { ...notification, read: true } : notification) ?? null);
    onNotificationClick(item);
  }
  return <section className="sp on"><Head title="Notifications" action={<button className="btn-o btn-sm" onClick={() => void markAll()}>Mark All Read</button>} /><div className="cc no-bottom">{items === null ? <Empty>Loading notifications…</Empty> : items.length ? items.map((item) => <button type="button" className="notif-item notif-entry" key={item.id} onClick={() => activateNotification(item)}><span className="ndot" style={{ opacity: item.read ? .35 : 1 }} /><span><span className="ntxt">{item.type === 'outlook' ? <span className="notif-source">Outlook</span> : null}{item.message}</span><span className="ntime">{new Date(item.createdAt).toLocaleString()}</span></span></button>) : <Empty>You have no notifications yet.</Empty>}</div></section>;
}

export function ProfilePage({ user, onUserUpdated, onSessionInvalidated, notify }: { user: User; onUserUpdated: (user: User) => void; onSessionInvalidated: () => void; notify: Notice }) {
  const [profile, setProfile] = useState({ fullName: user.fullName, email: user.email, institution: user.institution ?? '', course: user.course ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [browserPush, setBrowserPush] = useState<PushStatus>('disabled');
  const [changingBrowserPush, setChangingBrowserPush] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ tasks: true, groupActivity: true, deadlines: true, aiSuggestions: true, emailEnabled: true, profileVisibility: true, activityStatus: true });
  useEffect(() => { setProfile({ fullName: user.fullName, email: user.email, institution: user.institution ?? '', course: user.course ?? '' }); }, [user]);
  useEffect(() => { void request<Record<string, boolean>>('/notifications/preferences').then((value) => setPrefs((current) => ({ ...current, ...value }))).catch(() => undefined); }, []);
  useEffect(() => { void getPushStatus().then(setBrowserPush).catch(() => setBrowserPush('unsupported')); }, []);
  const persistedKeys = ['tasks', 'groupActivity', 'deadlines', 'aiSuggestions', 'emailEnabled', 'profileVisibility', 'activityStatus'];
  async function toggle(key: string) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    if (!persistedKeys.includes(key)) return;
    try { await request('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ [key]: next[key] }) }); }
    catch (error) { setPrefs(prefs); notify(error instanceof Error ? error.message : 'Could not save preference.'); }
  }
  async function toggleBrowserPush() {
    setChangingBrowserPush(true);
    try {
      if (browserPush === 'enabled') {
        await disablePush();
        await request('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ pushEnabled: false }) });
        setPrefs((current) => ({ ...current, pushEnabled: false }));
        setBrowserPush('disabled');
      } else {
        await enablePush();
        await request('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ pushEnabled: true }) });
        setPrefs((current) => ({ ...current, pushEnabled: true }));
        setBrowserPush('enabled');
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update browser notifications.'); }
    finally { setChangingBrowserPush(false); }
  }
  const setField = (field: keyof typeof profile, value: string) => { setProfile((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: '' })); };
  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setErrors({});
    try { const updated = await request<User>('/users/me', { method: 'PATCH', body: JSON.stringify(profile) }); onUserUpdated(updated); notify('Profile updated.'); }
    catch (error) { if (error instanceof ApiRequestError && error.fields) setErrors(error.fields); notify(error instanceof Error ? error.message : 'Profile could not be updated.'); }
    finally { setSaving(false); }
  }
  async function uploadAvatar(file?: File) {
    if (!file) return;
    const form = new FormData(); form.append('file', file); setUploading(true);
    try { const updated = await request<User>('/users/me/avatar', { method: 'POST', body: form }); onUserUpdated(updated); notify('Profile photo updated.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Avatar could not be uploaded.'); }
    finally { setUploading(false); }
  }
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) return notify('Your password does not match.');
    setSaving(true);
    try { await request('/auth/password/change', { method: 'POST', body: JSON.stringify({ oldPassword: data.get('oldPassword'), password: data.get('password'), confirm: data.get('confirm') }) }); notify('Password changed. Please sign in again.'); onSessionInvalidated(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Password could not be changed.'); }
    finally { setSaving(false); }
  }
  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setDeleting(true);
    try {
      await request('/users/me', { method: 'DELETE', body: JSON.stringify({ confirmation: values.get('confirmation'), password: values.get('password') }) });
      notify('Your account and personal data have been removed.');
      onSessionInvalidated();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete your account.'); }
    finally { setDeleting(false); }
  }
  const browserPushDescription = browserPush === 'enabled' ? 'Browser notifications are enabled for this device.' : browserPush === 'blocked' ? 'Browser permission is blocked. Enable notifications in your browser settings.' : browserPush === 'unsupported' ? 'This browser does not support push notifications.' : 'Get alerts even when WebSphere is closed.';
  return <section className="sp on"><Head title="Profile & Settings" /><div className="profile-grid"><form className="cc no-bottom" onSubmit={(event) => void saveProfile(event)}><div className="profile-hero">{user.avatarUrl ? <img className="profile-avatar profile-avatar-image" src={user.avatarUrl} alt="Profile" /> : <div className="profile-avatar">{initials(user.fullName)}</div>}<div><strong>{user.fullName}</strong><span>Member</span></div><label className={`btn-o btn-sm profile-avatar-action ${uploading ? 'disabled' : ''}`}>{uploading ? 'Uploading…' : 'Change photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label></div>{([['fullName', 'Full Name'], ['email', 'Email'], ['institution', 'School'], ['course', 'Course']] as const).map(([field, label]) => <label className="profile-field" key={field}><span className="lbl">{label}</span><input value={profile[field]} type={field === 'email' ? 'email' : 'text'} onChange={(event) => setField(field, event.target.value)} placeholder={`Your ${label.toLowerCase()}`} /><span className="profile-error">{errors[field]}</span></label>)}<button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button></form><div className="cc no-bottom"><div className="cc-head"><h3>Settings</h3></div><SettingsTitle>Notifications</SettingsTitle><Toggle title="Task Reminders" description="Get assignment, update, and task-deadline alerts" checked={prefs.tasks} onChange={() => toggle('tasks')} /><Toggle title="Group Chat Alerts" description="Notify me when someone messages the group" checked={prefs.groupActivity} onChange={() => toggle('groupActivity')} /><Toggle title="Deadline Alerts" description="Notify me 24 hours before project deadlines" checked={prefs.deadlines} onChange={() => toggle('deadlines')} /><Toggle title="AI Suggestions" description="Receive AI-generated project recommendations" checked={prefs.aiSuggestions} onChange={() => toggle('aiSuggestions')} /><Toggle title="Email Notifications" description="Send notification alerts to your email" checked={prefs.emailEnabled} onChange={() => toggle('emailEnabled')} /><Toggle title="Browser Push Notifications" description={browserPushDescription} checked={browserPush === 'enabled'} disabled={changingBrowserPush || browserPush === 'unsupported'} onChange={() => void toggleBrowserPush()} /><SettingsTitle>Privacy</SettingsTitle><Toggle title="Profile Photo Visibility" description="Allow group members to see your profile photo" checked={prefs.profileVisibility} onChange={() => toggle('profileVisibility')} /><Toggle title="Activity Status" description="Show others when you are online" checked={prefs.activityStatus} onChange={() => toggle('activityStatus')} /><SettingsTitle>Security</SettingsTitle><Security title="Change Password" description="Update your account password" action={changingPassword ? 'Cancel' : 'Change'} onClick={() => setChangingPassword((value) => !value)} />{changingPassword ? <form className="password-change-form" onSubmit={(event) => void changePassword(event)}><input className="ifield" required name="oldPassword" type="password" placeholder="Current password" /><input className="ifield" required minLength={8} name="password" type="password" placeholder="New password" /><input className="ifield" required minLength={8} name="confirm" type="password" placeholder="Confirm new password" /><button className="btn btn-sm" disabled={saving}>{saving ? 'Changing…' : 'Change Password'}</button></form> : null}<Security danger title="Delete Account" description="Permanently erase your account and personal data" action="Delete" onClick={() => setDeleteOpen(true)} /></div></div>{deleteOpen ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteOpen(false); }}><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"><div className="modal-ttl"><span id="delete-account-title">Delete account</span><button type="button" className="modal-close" aria-label="Close account deletion" disabled={deleting} onClick={() => setDeleteOpen(false)}>×</button></div><form onSubmit={(event) => void deleteAccount(event)}><p className="security-modal-help">This permanently erases your personal account data. Shared project history will be kept under an anonymous author.</p><label className="lbl">Current password</label><input className="ifield" name="password" type="password" autoComplete="current-password" required /><label className="lbl">Type DELETE to confirm</label><input className="ifield" name="confirmation" autoComplete="off" required /><div className="modal-acts"><button type="button" className="btn-o" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</button><button className="btn danger" disabled={deleting}>{deleting ? 'Deleting…' : 'Delete account'}</button></div></form></div></div> : null}</section>;
}

const trackerFilters = ['all', 'pending', 'ongoing', 'for_review', 'completed'] as const;
type TrackerFilter = (typeof trackerFilters)[number];
const trackerFilterLabel: Record<TrackerFilter, string> = { all: 'All Files', pending: 'Not Started', ongoing: 'In Progress', for_review: 'For Review', completed: 'Completed' };
type TrackerResource = { id: string; connectionId: string; title: string; externalUrl: string; provider: string; platform: string; category: string; createdAt: string };
type TrackerMember = { id: string; fullName: string; avatarUrl?: string | null };
type TrackerTask = { id: string; title: string; description: string; deadline?: string | null; priority: string; status: 'pending' | 'ongoing' | 'for_review' | 'completed'; progress: number; createdAt: string; latestActivityAt: string; project: { id: string; title: string }; resources: TrackerResource[]; assignees: TrackerMember[]; canUpdateStatus: boolean; canAssign: boolean; canEditResource: boolean; collaborators: TrackerMember[] };
type TrackerConnection = { id: string; provider: string; platform: string; category: string; status: string; syncState?: string | null; lastSyncedAt?: string | null };
type TrackerActivity = { id: string; kind: 'workflow' | 'integration'; createdAt: string; type?: string; taskTitle?: string | null; projectTitle?: string; actor?: { id: string; fullName: string; avatarUrl?: string | null } | null; fromValue?: string | null; toValue?: string | null; action?: string; platform?: string; provider?: string };
type TrackerData = { tasks: TrackerTask[]; connections: TrackerConnection[]; activity: TrackerActivity[] };
type TrackerCard = { task: TrackerTask; resource: TrackerResource | null };
type GooglePickedFile = { connectionId: string; id: string; name: string; url: string };

async function loadGooglePicker() {
  const browserWindow = window as any;
  if (!browserWindow.gapi) await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-picker]');
    const script = existing ?? document.createElement('script');
    if (!existing) { script.src = 'https://apis.google.com/js/api.js'; script.async = true; script.dataset.googlePicker = 'true'; document.head.append(script); }
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google Picker could not be loaded.')), { once: true });
  });
  await new Promise<void>((resolve, reject) => browserWindow.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker could not be initialized.')) }));
}

export function TrackerPage({ notify }: { notify: Notice }) {
  const [data, setData] = useState<TrackerData | null>(null);
  const [filter, setFilter] = useState<TrackerFilter>('all');
  const [platform, setPlatform] = useState('all');
  const [linkingTaskId, setLinkingTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [linkConnectionId, setLinkConnectionId] = useState('');
  const [pickedGoogleFile, setPickedGoogleFile] = useState<GooglePickedFile | null>(null);
  const [editStatus, setEditStatus] = useState<TrackerTask['status']>('pending');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  async function refresh() { setData(await request<TrackerData>('/tasks/tracker')); }
  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [notify]);
  const tasks = data?.tasks ?? [];
  const projectRoomIds = useMemo(() => [...new Set(tasks.map((task) => task.project.id))], [data]);
  useEffect(() => {
    if (!projectRoomIds.length) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => projectRoomIds.forEach((projectId) => socket.emit('project:join', projectId, () => undefined)));
    socket.on('task:updated', () => { void refresh().catch(() => undefined); });
    return () => { socket.disconnect(); };
  }, [projectRoomIds.join(',')]);
  const connections = data?.connections ?? [];
  const connectedConnections = connections.filter((connection) => connection.status === 'connected');
  const complete = tasks.filter((task) => task.status === 'completed').length;
  const average = tasks.length ? Math.round(tasks.reduce((total, task) => total + task.progress, 0) / tasks.length) : 0;
  const visibleTasks = (filter === 'all' ? tasks : tasks.filter((task) => task.status === filter));
  const cards: TrackerCard[] = visibleTasks.flatMap<TrackerCard>((task) => task.resources.length ? task.resources.map((resource) => ({ task, resource })) : [{ task, resource: null }]).filter((card) => platform === 'all' || card.resource?.provider === platform);
  const projectSections = Object.values(cards.reduce<Record<string, { title: string; cards: TrackerCard[] }>>((sections, card) => { (sections[card.task.project.id] ||= { title: card.task.project.title, cards: [] }).cards.push(card); return sections; }, {}));
  const collaborators = [...new Map(tasks.flatMap((task) => task.collaborators).map((member) => [member.id, member])).values()];
  const linkingTask = tasks.find((task) => task.id === linkingTaskId) ?? null;
  const editingTask = tasks.find((task) => task.id === editingTaskId) ?? null;
  const editingResource = editingTask?.resources.find((resource) => resource.id === editingResourceId) ?? null;
  const activeLinkConnection = connectedConnections.find((connection) => connection.id === linkConnectionId) ?? connectedConnections[0];
  const usingGooglePicker = activeLinkConnection?.provider === 'google';
  function beginLink(taskId: string) { setLinkingTaskId(taskId); setLinkConnectionId(connectedConnections[0]?.id ?? ''); setPickedGoogleFile(null); }

  async function saveExternalFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask || !editingResource) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await request(`/resources/${editingResource.id}`, { method: 'PATCH', body: JSON.stringify({ connectionId: form.get('connectionId'), title: form.get('title'), externalUrl: form.get('externalUrl'), ...(editingTask.canAssign ? { assigneeId: form.get('assigneeId') } : {}), ...(editingTask.canUpdateStatus ? { status: editStatus } : {}) }) });
      await refresh();
      setEditingTaskId(null); setEditingResourceId(null);
      notify('External file link updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this file link.'); }
    finally { setSaving(false); }
  }
  async function linkFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkingTask) return;
    const form = new FormData(event.currentTarget);
    const connectionId = String(form.get('connectionId') ?? '');
    const connection = connectedConnections.find((item) => item.id === connectionId);
    if (connection?.provider === 'google' && (!pickedGoogleFile || pickedGoogleFile.connectionId !== connectionId)) { notify('Choose a Google Drive file before attaching it.'); return; }
    setSaving(true);
    try {
      await request(`/tasks/${linkingTask.id}/resources`, { method: 'POST', body: JSON.stringify({ connectionId, title: form.get('title'), externalUrl: form.get('externalUrl'), ...(pickedGoogleFile?.connectionId === connectionId ? { externalId: pickedGoogleFile.id } : {}) }) });
      setLinkingTaskId(null);
      await refresh();
      notify('File link attached to the task.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not attach this file link.'); }
    finally { setSaving(false); }
  }
  async function chooseGoogleFile() {
    if (!activeLinkConnection || activeLinkConnection.provider !== 'google') return;
    try {
      const { accessToken, developerKey, appId } = await request<{ accessToken: string; developerKey: string; appId: string }>(`/integrations/connections/${activeLinkConnection.id}/google-picker-token`);
      await loadGooglePicker();
      const google = (window as any).google;
      const picker = new google.picker.PickerBuilder()
        .setDeveloperKey(developerKey)
        .setAppId(appId)
        .setOAuthToken(accessToken)
        .setOrigin(window.location.origin)
        .addView(new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true))
        .setCallback((data: any) => {
          if (data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) return;
          const file = data[google.picker.Response.DOCUMENTS]?.[0];
          if (file) setPickedGoogleFile({ connectionId: activeLinkConnection.id, id: file[google.picker.Document.ID], name: file[google.picker.Document.NAME], url: file[google.picker.Document.URL] });
        }).build();
      picker.setVisible(true);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open Google Drive.'); }
  }
  async function syncFiles() {
    if (!connectedConnections.length) { notify('Connect an external tool before syncing files.'); return; }
    setSyncing(true);
    try { await Promise.all(connectedConnections.map((connection) => request(`/integrations/connections/${connection.id}/sync`, { method: 'POST' }))); await refresh(); notify(`Synced ${connectedConnections.length} connected ${connectedConnections.length === 1 ? 'tool' : 'tools'}.`); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not sync all connected tools.'); }
    finally { setSyncing(false); }
  }
  async function openResource(resource: TrackerResource) {
    try {
      const launch = await request<{ externalUrl: string }>(`/resources/${resource.id}/launch`, { method: 'POST' });
      window.open(launch.externalUrl, '_blank', 'noopener,noreferrer');
      void refresh();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open this file.'); }
  }

  return <section className="sp on tracker-page"><Head title="Task Progress Tracker" action={<div className="tracker-head-actions"><button className="btn-o btn-sm" onClick={() => { if (!tasks.length) notify('Create or receive a task before attaching a file.'); else if (!connectedConnections.length) notify('Connect an external tool before attaching a file.'); else beginLink(tasks[0].id); }}>⌕ Attach File Link</button><button className="btn btn-sm" disabled={syncing} onClick={() => void syncFiles()}>{syncing ? 'Syncing…' : '↻ Sync Files'}</button></div>} />
    <div className="tracker-kpis"><TrackerKpi icon="▤" value={tasks.reduce((total, task) => total + task.resources.length, 0)} label="Total Files" /><TrackerKpi icon="◷" value={tasks.filter((task) => task.status === 'ongoing').length} label="In Progress" tone="yel" /><TrackerKpi icon="✓" value={complete} label="Completed" tone="grn" /><TrackerKpi icon="▥" value={`${average}%`} label="Avg. Progress" /></div>
    <div className="tracker-toolbar"><div className="tracker-filter"><span>Filter:</span><div>{trackerFilters.map((value) => <button type="button" className={filter === value ? 'on' : ''} key={value} onClick={() => setFilter(value)}>{trackerFilterLabel[value]}</button>)}</div></div><label className="tracker-platform">Platform:<span className="tracker-selected-platform">{platform !== 'all' ? <ToolLogo provider={platform} size="xs" /> : null}<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">All Platforms</option>{connectedConnections.map((connection) => <option key={connection.id} value={connection.provider}>{connection.platform}</option>)}</select></span></label></div>
    {data === null ? <div className="cc"><Empty>Loading your tracker…</Empty></div> : projectSections.length ? <div className="tracker-project-sections">{projectSections.map((section) => <section className="tracker-project-section" key={section.title}><div className="tracker-project-heading"><span>Project</span><h3>{section.title}</h3></div><div className="tracker-resource-grid">{section.cards.map(({ task, resource }) => <TrackerResourceCard key={resource?.id ?? task.id} task={task} resource={resource} onEdit={() => { if (!resource) return; setEditingTaskId(task.id); setEditingResourceId(resource.id); setEditStatus(task.status); }} onOpen={() => resource && void openResource(resource)} onAttach={() => connectedConnections.length ? beginLink(task.id) : notify('Connect an external tool before attaching a file.')} />)}</div></section>)}</div> : <div className="cc"><Empty>{tasks.length ? 'No linked files match the selected filters.' : 'Tasks from your projects will appear here, along with any files you link to them.'}</Empty></div>}
    <div className="tracker-lower-grid"><section className="cc tracker-activity"><div className="cc-head"><h3>Recent File Activity</h3><span>Latest updates</span></div>{data?.activity.length ? <div className="tracker-activity-list">{data.activity.slice(0, 8).map((activity) => <div className="tracker-activity-row" key={activity.id}><ToolLogo provider={activity.provider} name={activity.platform} size="sm" /><div><strong>{activityLabel(activity)}</strong><span>{relativeDate(activity.createdAt)}</span></div></div>)}</div> : <Empty>Linked-file and task updates will appear here.</Empty>}</section><section className="cc tracker-collaborators"><div className="cc-head"><h3>Project Collaborators</h3><span>{collaborators.length || '—'} members</span></div>{collaborators.length ? <div className="tracker-collaborator-list">{collaborators.map((member) => <div className="tracker-collaborator" key={member.id}><span className="tracker-collaborator-avatar">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initials(member.fullName)}</span><strong>{member.fullName}</strong></div>)}</div> : <Empty>Collaborators appear when you have assigned project tasks.</Empty>}</section></div>
    {linkingTask ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) setLinkingTaskId(null); }}><div className="modal-box tracker-link-modal"><div className="modal-ttl"><span>Attach file link</span><button type="button" className="modal-close" onClick={() => setLinkingTaskId(null)}>×</button></div><p>Attach a file from one of your connected tools to <strong>{linkingTask.title}</strong>.</p><form onSubmit={linkFile}><label className="lbl">Connected platform</label><div className="tracker-link-platform"><ToolLogo provider={activeLinkConnection?.provider} name={activeLinkConnection?.platform} size="sm" /><select className="ifield" name="connectionId" required value={activeLinkConnection?.id ?? ''} onChange={(event) => { setLinkConnectionId(event.target.value); setPickedGoogleFile(null); }}>{connectedConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.platform}</option>)}</select></div>{usingGooglePicker ? <><label className="lbl">Google Drive file</label><button className="btn-o" type="button" onClick={() => void chooseGoogleFile()}>{pickedGoogleFile ? 'Choose a different Google file' : 'Choose from Google Drive'}</button>{pickedGoogleFile ? <div className="tracker-auto-progress-note">Selected: <strong>{pickedGoogleFile.name}</strong></div> : <div className="tracker-auto-progress-note">Google files must be chosen from Drive so only selected files can be accessed.</div>}<label className="lbl">File name</label><input className="ifield" name="title" required readOnly value={pickedGoogleFile?.name ?? ''} placeholder="Choose a file from Google Drive" /><label className="lbl">File link</label><input className="ifield" name="externalUrl" type="url" required readOnly value={pickedGoogleFile?.url ?? ''} placeholder="Choose a file from Google Drive" /></> : <><label className="lbl">File name</label><input className="ifield" name="title" required minLength={2} maxLength={180} placeholder="e.g. Research presentation slides" /><label className="lbl">File link</label><input className="ifield" name="externalUrl" type="url" required placeholder="https://…" /></>}<div className="modal-acts"><button type="button" className="btn-o" onClick={() => setLinkingTaskId(null)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Attaching…' : 'Attach Link'}</button></div></form></div></div> : null}
    {editingTask && editingResource ? <div className="modal-ov open tracker-edit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEditingTaskId(null); setEditingResourceId(null); } }}><div className="modal-box tracker-edit-modal"><div className="modal-ttl"><span>Edit External File Link</span><button type="button" className="modal-close" onClick={() => { setEditingTaskId(null); setEditingResourceId(null); }}>×</button></div><form onSubmit={(event) => void saveExternalFile(event)}><label className="lbl">File name</label><input className="ifield" name="title" required minLength={2} maxLength={180} defaultValue={editingResource.title} /><label className="lbl">External file URL</label><input className="ifield" name="externalUrl" type="url" required defaultValue={editingResource.externalUrl} /><label className="lbl">Platform</label><div className="tracker-platform-options">{connectedConnections.map((connection) => <label className={`tracker-platform-option ${connection.id === editingResource.connectionId ? 'selected' : ''}`} key={connection.id}><input type="radio" name="connectionId" value={connection.id} defaultChecked={connection.id === editingResource.connectionId} required /><ToolLogo provider={connection.provider} name={connection.platform} size="xs" /><span>{connection.platform}</span></label>)}</div>{connectedConnections.length ? null : <div className="tracker-auto-progress-note">Connect an external platform before editing this file link.</div>}<label className="lbl">Assigned member</label><select className="ifield" name="assigneeId" defaultValue={editingTask.assignees[0]?.id ?? ''} disabled={!editingTask.canAssign}>{editingTask.collaborators.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select><label className="lbl">Status</label><div className="tracker-status-options">{(['pending', 'ongoing', 'for_review', 'completed'] as const).map((status) => <button type="button" className={editStatus === status ? 'selected' : ''} disabled={!editingTask.canUpdateStatus} key={status} onClick={() => setEditStatus(status)}>{trackerFilterLabel[status]}</button>)}</div><div className="modal-acts"><button type="button" className="btn-o" onClick={() => { setEditingTaskId(null); setEditingResourceId(null); }}>Cancel</button><button className="btn" disabled={saving || !connectedConnections.length}>{saving ? 'Saving…' : 'Save Changes'}</button></div></form></div></div> : null}
  </section>;
}

function TrackerKpi({ icon, value, label, tone }: { icon: string; value: string | number; label: string; tone?: 'yel' | 'grn' }) { return <div className={`tracker-kpi ${tone ?? ''}`}><i>{icon}</i><div><strong>{value}</strong><span>{label}</span></div></div>; }
function TrackerResourceCard({ task, resource, onEdit, onOpen, onAttach }: { task: TrackerTask; resource: TrackerResource | null; onEdit: () => void; onOpen: () => void; onAttach: () => void }) {
  const assignee = task.assignees[0];
  return <article className="tracker-resource-card"><div className="tracker-resource-top"><div className="tracker-file-icon"><ToolLogo provider={resource?.provider} name={resource?.platform} size="md" /></div><div className="tracker-resource-copy"><strong>{resource?.title ?? task.title}</strong><span>{resource ? `${resource.platform} · ${task.title}` : 'No file linked'}</span></div><Badge value={task.status} /></div><div className="tracker-owner"><span className="tracker-owner-avatar">{assignee?.avatarUrl ? <img src={assignee.avatarUrl} alt="" /> : initials(assignee?.fullName ?? 'Unassigned')}</span><span>{assignee ? assignee.fullName : 'Unassigned'}</span></div><div className="tracker-progress-row"><span>Progress <small>Automatic from status</small></span><strong>{task.progress}%</strong></div><div className="tracker-progress-track"><i style={{ width: `${task.progress}%` }} /></div><div className="tracker-resource-footer"><span>Updated {relativeDate(task.latestActivityAt)}</span><div>{resource ? <><button className="btn-o btn-sm tracker-edit-button" disabled={!task.canEditResource} title={task.canEditResource ? 'Edit external file link' : 'Only the active assignee or project leader can edit this file link'} onClick={onEdit}>⌑ Edit</button><button className="btn btn-sm" onClick={onOpen}>Open File</button></> : <button className="btn-o btn-sm" onClick={onAttach}>Attach</button>}</div></div></article>;
}
function activityLabel(activity: TrackerActivity) { if (activity.kind === 'integration') return activity.action ?? `${activity.platform ?? 'Integration'} activity`; const actor = activity.actor?.fullName ?? 'A project member'; if (activity.type === 'task_completed') return `${actor} completed ${activity.taskTitle ?? 'a task'}`; if (activity.type === 'progress_activity') return activity.toValue ? `${actor} linked ${activity.toValue}` : `${actor} updated task progress`; if (activity.type === 'assignment_change') return `${actor} assigned ${activity.taskTitle ?? 'a task'}`; return `${actor} changed ${activity.taskTitle ?? 'a task'} to ${(activity.toValue ?? 'a new status').replaceAll('_', ' ')}`; }

export function IntegrationsPage({ notify }: { notify: Notice }) {
  const [tools, setTools] = useState<Array<{ id: string; provider: string; name: string; category: string; connections: Array<{ id: string; status: string; lastSyncedAt?: string | null; _count: { linkedResources: number; usage: number } }> }> | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  async function loadCatalog() { setTools(await request('/integrations/catalog')); }
  useEffect(() => {
    void loadCatalog().catch((error: Error) => notify(error.message));
    const provider = new URLSearchParams(window.location.search).get('connected');
    if (provider) { notify(`${provider === 'microsoft' ? 'Microsoft 365' : provider[0].toUpperCase() + provider.slice(1)} connected successfully.`); window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`); }
  }, [notify]);
  async function disconnect(tool: { provider: string; name: string; connections: Array<{ id: string }> }) {
    const connectionId = tool.connections[0]?.id;
    if (!connectionId) return;
    setDisconnecting(tool.provider);
    try { await request(`/integrations/connections/${connectionId}`, { method: 'DELETE' }); await loadCatalog(); notify(`${tool.name} disconnected.`); }
    catch (error) { notify(error instanceof Error ? error.message : `Could not disconnect ${tool.name}.`); }
    finally { setDisconnecting(null); }
  }
  async function connect(tool: { provider: string; name: string }) {
    if (!['google', 'microsoft', 'trello', 'asana', 'canva'].includes(tool.provider)) { notify(`${tool.name} is not available yet.`); return; }
    setConnecting(tool.provider);
    try {
      const returnUrl = new URL('/integrations', window.location.origin).toString();
      const { authorizeUrl } = await request<{ authorizeUrl: string }>(`/integrations/${tool.provider}/authorize?redirectUri=${encodeURIComponent(returnUrl)}`);
      window.location.assign(authorizeUrl);
    } catch (error) { notify(error instanceof Error ? error.message : `Could not connect ${tool.name}.`); setConnecting(null); }
  }
  async function launch(tool: { provider: string; name: string; connections: Array<{ id: string; status: string }> }) {
    const connection = tool.connections.find((item) => item.status === 'connected');
    if (!connection) return notify(`${tool.name} is not connected.`);
    setLaunching(tool.provider);
    try {
      const { externalUrl } = await request<{ externalUrl: string }>(`/integrations/connections/${connection.id}/launch`, { method: 'POST' });
      const link = document.createElement('a'); link.href = externalUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click();
      notify(`${tool.name} opened in a new tab.`);
    } catch (error) { notify(error instanceof Error ? error.message : `Could not open ${tool.name}.`); }
    finally { setLaunching(null); }
  }
  const connections = tools?.flatMap((tool) => tool.connections.map((connection) => ({ ...connection, tool }))) ?? [];
  const connected = connections.filter((connection) => connection.status === 'connected');
  const linkedResources = connected.reduce((total, connection) => total + connection._count.linkedResources, 0);
  const lastSyncedAt = connected.map((connection) => connection.lastSyncedAt).filter((value): value is string => Boolean(value)).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const sections = useMemo(() => groupBy(tools ?? [], (tool) => tool.category || 'Other'), [tools]);
  return <section className="sp on"><div className="ext-workspace-header"><div><div className="ext-workspace-title">Apps & External Tools</div><div className="ext-workspace-sub" /></div></div><div className="ext-status-bar"><span className="ext-status-pill"><i className="dot-pulse connected" />{connected.length} Connected</span><i className="ext-divider" /><span className="ext-status-pill">{linkedResources} Linked File{linkedResources === 1 ? '' : 's'}</span><span className="ext-last-sync">Last synced: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'not yet'}</span></div>{tools === null ? <div className="cc"><Empty>Loading apps…</Empty></div> : tools.length ? Object.entries(sections).map(([category, values]) => <div key={category}><div className="ext-section-label">{category}</div><div className="ext-app-grid">{values.map((tool) => { const activeConnection = tool.connections.find((connection) => connection.status === 'connected'); const resourceCount = tool.connections.reduce((total, connection) => total + connection._count.linkedResources, 0); return <article className={`ext-app-card ${activeConnection ? 'connected' : ''}`} key={tool.id}><div className="ext-card-top"><div className="ext-app-icon"><ToolLogo provider={tool.provider} name={tool.name} size="lg" /></div><span className={`ext-conn-badge ${activeConnection ? 'connected' : 'not-connected'}`}>{activeConnection ? '● Connected' : 'Not Connected'}</span></div><div className="ext-app-name">{tool.name}</div><div className="ext-app-category">{tool.category}</div><div className="ext-recent-activity">{activeConnection ? `${resourceCount} linked resource${resourceCount === 1 ? '' : 's'}${activeConnection.lastSyncedAt ? ` · synced ${new Date(activeConnection.lastSyncedAt).toLocaleString()}` : ''}` : `Connect ${tool.name} when your project needs it.`}</div><div className="ext-card-footer"><span className="ext-task-link">{activeConnection ? `${resourceCount} task-linked file${resourceCount === 1 ? '' : 's'}` : 'No connection yet'}</span><div className="ext-card-actions">{activeConnection ? <button className="ext-action-btn disconnect" disabled={disconnecting === tool.provider} onClick={() => setConfirmation({ title: `Disconnect ${tool.name}?`, description: `Linked resources will be removed${tool.provider === 'microsoft' ? ', and synced Outlook events will be cleared from your calendar' : ''}. You can reconnect anytime.`, confirmLabel: 'Disconnect', destructive: true, action: () => void disconnect(tool) })}>{disconnecting === tool.provider ? 'Removing…' : 'Disconnect'}</button> : null}<button className={`ext-action-btn ${activeConnection ? 'launch' : 'connect'}`} disabled={connecting === tool.provider || launching === tool.provider} onClick={() => activeConnection ? void launch(tool) : void connect(tool)}>{activeConnection ? launching === tool.provider ? 'Opening…' : 'Launch' : connecting === tool.provider ? 'Opening…' : 'Connect'}</button></div></div></article>; })}</div></div>) : <div className="cc"><Empty>Connect a tool when your project needs one.</Empty></div>}{confirmation ? <ConfirmDialog {...confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); action(); }} /> : null}</section>;
}

type AuditLogEntry = { id: string; actorId: string | null; module: string; activity: string; severity: string; description: string; createdAt: string };
type InactiveAccountAlerts = { enabled: boolean; recipientEmail: string; inactivityDays: number };
type AdminSecuritySettings = { sessionTimeoutMinutes: number; inactiveAccountAlerts: InactiveAccountAlerts };
type AdminGeneralSettings = { systemName: string; maxIdeasPerSearch: number; releaseManifestUrl: string };
type SystemBackup = { id: string; fileName: string; bytes: number; createdAt: string; downloadPath?: string };
type ReleaseCheck = { currentVersion: string; latestVersion: string; updateAvailable: boolean; releaseDate: string | null; summary: string; features: string[]; fixes: string[]; enhancements: string[]; downloadUrl: string | null; checkedAt: string };
const defaultAdminSecuritySettings: AdminSecuritySettings = { sessionTimeoutMinutes: 30, inactiveAccountAlerts: { enabled: false, recipientEmail: '', inactivityDays: 30 } };
const defaultAdminGeneralSettings: AdminGeneralSettings = { systemName: 'WebSphere', maxIdeasPerSearch: 10, releaseManifestUrl: '' };

export function AdminSettingsPage({ notify, onSessionInvalidated }: { notify: Notice; onSessionInvalidated: () => void }) {
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceSchedule, setMaintenanceSchedule] = useState<{ startsAt: string } | null>(null);
  const [maintenanceDialog, setMaintenanceDialog] = useState(false);
  const [maintenanceStartDraft, setMaintenanceStartDraft] = useState('');
  const [maintenanceMessageDraft, setMaintenanceMessageDraft] = useState('');
  const [maintenanceAnnouncementSaving, setMaintenanceAnnouncementSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [security, setSecurity] = useState<AdminSecuritySettings>(defaultAdminSecuritySettings);
  const [securityDialog, setSecurityDialog] = useState<'password' | 'timeout' | 'email' | null>(null);
  const [timeoutDraft, setTimeoutDraft] = useState(String(defaultAdminSecuritySettings.sessionTimeoutMinutes));
  const [emailDraft, setEmailDraft] = useState<InactiveAccountAlerts>(defaultAdminSecuritySettings.inactiveAccountAlerts);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [general, setGeneral] = useState<AdminGeneralSettings>(defaultAdminGeneralSettings);
  const [generalSaving, setGeneralSaving] = useState(false);
  const [backups, setBackups] = useState<SystemBackup[] | null>(null);
  const [backupSaving, setBackupSaving] = useState(false);
  const [release, setRelease] = useState<ReleaseCheck | null>(null);
  const [releaseChecking, setReleaseChecking] = useState(false);
  useEffect(() => {
    void request<Array<{ key: string; value: unknown }>>('/admin/settings').then((rows) => {
      setMaintenance(Boolean(rows.find((row) => row.key === 'maintenanceMode')?.value));
      const schedule = rows.find((row) => row.key === 'maintenanceSchedule')?.value as { startsAt?: string } | null;
      setMaintenanceSchedule(schedule?.startsAt ? { startsAt: schedule.startsAt } : null);
    }).catch(() => undefined);
    void request<AdminSecuritySettings>('/admin/security-settings').then(setSecurity).catch((error: Error) => notify(error.message));
    void request<AdminGeneralSettings>('/admin/general-settings').then(setGeneral).catch((error: Error) => notify(error.message));
    void request<SystemBackup[]>('/admin/backups').then(setBackups).catch((error: Error) => notify(error.message));
  }, [notify]);
  const maintenanceActive = maintenance || Boolean(maintenanceSchedule && new Date(maintenanceSchedule.startsAt) <= new Date());
  async function toggleMaintenance() {
    const next = !maintenanceActive;
    setSaving(true);
    try { await request('/admin/settings', { method: 'PUT', body: JSON.stringify({ maintenanceMode: next }) }); setMaintenance(next); if (!next) setMaintenanceSchedule(null); notify(next ? 'Maintenance mode enabled. Only administrators can use WebSphere.' : 'Maintenance mode disabled.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update maintenance mode.'); }
    finally { setSaving(false); }
  }
  async function announceMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startsAt = new Date(maintenanceStartDraft);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) return notify('Choose a future maintenance start time.');
    const message = `${maintenanceMessageDraft.trim() || 'WebSphere will be unavailable until maintenance is complete.'}\n\nScheduled maintenance begins ${startsAt.toLocaleString()}.`;
    setMaintenanceAnnouncementSaving(true);
    try {
      const result = await request<{ startsAt: string; notified: number }>('/admin/maintenance/announcement', { method: 'POST', body: JSON.stringify({ startsAt: startsAt.toISOString(), message }) });
      setMaintenanceSchedule({ startsAt: result.startsAt });
      setMaintenanceDialog(false);
      notify(`Maintenance announced to ${result.notified} active user${result.notified === 1 ? '' : 's'}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not announce maintenance.'); }
    finally { setMaintenanceAnnouncementSaving(false); }
  }
  async function cancelScheduledMaintenance() {
    setSaving(true);
    try {
      await request('/admin/settings', { method: 'PUT', body: JSON.stringify({ maintenanceSchedule: null }) });
      setMaintenanceSchedule(null);
      notify('Scheduled maintenance canceled.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not cancel scheduled maintenance.'); }
    finally { setSaving(false); }
  }
  async function openLogs() {
    setLogsOpen(true);
    setLogsLoading(true);
    try { setLogs(await request<AuditLogEntry[]>('/admin/logs')); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not load system logs.'); setLogs([]); }
    finally { setLogsLoading(false); }
  }
  function openSecurityDialog(dialog: 'password' | 'timeout' | 'email') {
    if (dialog === 'timeout') setTimeoutDraft(String(security.sessionTimeoutMinutes));
    if (dialog === 'email') setEmailDraft(security.inactiveAccountAlerts);
    setSecurityDialog(dialog);
  }
  async function saveTimeout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sessionTimeoutMinutes = Number(timeoutDraft);
    if (!Number.isInteger(sessionTimeoutMinutes) || sessionTimeoutMinutes < 5 || sessionTimeoutMinutes > 480) return notify('Choose a whole number from 5 to 480 minutes.');
    setSecuritySaving(true);
    try {
      const updated = await request<AdminSecuritySettings>('/admin/security-settings', { method: 'PUT', body: JSON.stringify({ sessionTimeoutMinutes }) });
      setSecurity(updated); setSecurityDialog(null); notify('Session timeout updated. New activity is required before the selected timeout expires.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the session timeout.'); }
    finally { setSecuritySaving(false); }
  }
  async function saveInactiveAccountAlerts(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipientEmail = emailDraft.recipientEmail.trim();
    if (emailDraft.enabled && !recipientEmail) return notify('Enter the email address that should receive inactive-account alerts.');
    setSecuritySaving(true);
    try {
      const updated = await request<AdminSecuritySettings>('/admin/security-settings', { method: 'PUT', body: JSON.stringify({ inactiveAccountAlerts: { ...emailDraft, recipientEmail } }) });
      setSecurity(updated); setSecurityDialog(null); notify(updated.inactiveAccountAlerts.enabled ? 'Inactive-account email alerts enabled.' : 'Inactive-account email alerts disabled.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save email notification settings.'); }
    finally { setSecuritySaving(false); }
  }
  async function changeAdminPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (values.get('password') !== values.get('confirm')) return notify('Your new password and confirmation do not match.');
    setSecuritySaving(true);
    try {
      await request('/auth/password/change', { method: 'POST', body: JSON.stringify({ oldPassword: values.get('oldPassword'), password: values.get('password'), confirm: values.get('confirm') }) });
      notify('Password changed. Please sign in again.'); onSessionInvalidated();
    } catch (error) { notify(error instanceof Error ? error.message : 'Password could not be changed.'); }
    finally { setSecuritySaving(false); }
  }
  async function saveGeneral(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralSaving(true);
    try { const saved = await request<AdminGeneralSettings>('/admin/general-settings', { method: 'PUT', body: JSON.stringify(general) }); setGeneral(saved); notify('General configuration saved.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save general configuration.'); }
    finally { setGeneralSaving(false); }
  }
  async function createBackup() {
    setBackupSaving(true);
    try { const backup = await request<SystemBackup>('/admin/backups', { method: 'POST' }); setBackups((current) => [backup, ...(current ?? [])]); notify('Database backup created.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not create the database backup.'); }
    finally { setBackupSaving(false); }
  }
  async function downloadBackup(backup: SystemBackup) {
    try {
      const response = await fetch(apiUrl(`/admin/backups/${encodeURIComponent(backup.fileName)}/download`), { headers: { authorization: `Bearer ${getAccessToken()}` } });
      if (!response.ok) throw new Error('Could not download this backup.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = backup.fileName; link.click(); URL.revokeObjectURL(url);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not download this backup.'); }
  }
  async function checkForUpdates() {
    setReleaseChecking(true);
    try { const result = await request<ReleaseCheck>('/admin/release/check', { method: 'POST' }); setRelease(result); setUpdateOpen(true); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not check for updates.'); }
    finally { setReleaseChecking(false); }
  }
  return <section className="sp on"><Head title="System Settings" /><div className="g2 settings-top"><form className="cc" onSubmit={(event) => void saveGeneral(event)}><div className="cc-head"><h3>General Configuration</h3></div><label className="lbl" htmlFor="system-name">System Name</label><input id="system-name" className="ifield" value={general.systemName} maxLength={80} required onChange={(event) => setGeneral((current) => ({ ...current, systemName: event.target.value }))} /><label className="lbl" htmlFor="max-ideas">Maximum ideas shown per group</label><input id="max-ideas" className="ifield" type="number" min="2" max="50" required value={general.maxIdeasPerSearch} onChange={(event) => setGeneral((current) => ({ ...current, maxIdeasPerSearch: Number(event.target.value) }))} /><label className="lbl" htmlFor="release-manifest">Release Manifest URL</label><input id="release-manifest" className="ifield" type="url" value={general.releaseManifestUrl} placeholder="https://example.edu/websphere-release.json" onChange={(event) => setGeneral((current) => ({ ...current, releaseManifestUrl: event.target.value }))} /><button className="btn" disabled={generalSaving}>{generalSaving ? 'Saving…' : 'Save Settings'}</button></form><div className="cc"><div className="cc-head"><h3>Security & Access</h3></div><Security title="Admin Password" description="Change this administrator account's password" action="Change" onClick={() => openSecurityDialog('password')} /><Security title="Session Timeout" description={`Currently: ${security.sessionTimeoutMinutes} minutes`} action="Edit" onClick={() => openSecurityDialog('timeout')} /><Security title="Email Notifications" description={security.inactiveAccountAlerts.enabled ? `Inactive account alerts every ${security.inactiveAccountAlerts.inactivityDays} days` : 'Inactive account alerts are disabled'} action="Configure" onClick={() => openSecurityDialog('email')} /><Security title="System Logs" description="View recent activity" action="View Logs" onClick={() => void openLogs()} /></div></div><div className="cc maintenance-card"><div className="cc-head"><h3>Maintenance & Updates</h3></div><div className="g3"><Security title="Software Update" description={release ? `Current ${release.currentVersion} · latest ${release.latestVersion}` : 'Check the configured release manifest'} action={releaseChecking ? 'Checking…' : release ? 'View details' : 'Check now'} onClick={() => release ? setUpdateOpen(true) : void checkForUpdates()} /><Security title="Backup Database" description={backups?.[0] ? `Latest: ${new Date(backups[0].createdAt).toLocaleString()}` : 'Create a private application-data snapshot'} action={backupSaving ? 'Backing up…' : 'Backup Now'} onClick={() => void createBackup()} /><MaintenanceModeControl active={maintenanceActive} busy={saving || maintenanceAnnouncementSaving} description={maintenanceActive ? 'Enabled — only administrators can access WebSphere' : maintenanceSchedule ? `Scheduled for ${new Date(maintenanceSchedule.startsAt).toLocaleString()}` : 'Disabled — WebSphere is available to everyone'} onToggle={() => void toggleMaintenance()} onSchedule={() => setMaintenanceDialog(true)} /></div>{maintenanceSchedule && !maintenanceActive ? <button type="button" className="btn-o btn-sm maintenance-cancel" disabled={saving} onClick={() => void cancelScheduledMaintenance()}>Cancel Scheduled Maintenance</button> : null}{backups?.length ? <div className="logs-list">{backups.slice(0, 3).map((backup) => <div className="log-row" key={backup.id}><span className="log-time">{new Date(backup.createdAt).toLocaleString()}</span><span className="log-desc">{backup.fileName} · {(backup.bytes / 1024).toFixed(1)} KB</span><button type="button" className="btn-o btn-sm" onClick={() => void downloadBackup(backup)}>Download</button></div>)}</div> : null}</div>
    {maintenanceDialog ? <SecurityModal title="Announce Upcoming Maintenance" onClose={() => setMaintenanceDialog(false)}><form onSubmit={(event) => void announceMaintenance(event)}><p className="security-modal-help">All active users will receive an in-app announcement now. Email and push follow their delivery settings. Maintenance starts automatically at the chosen time.</p><label className="lbl" htmlFor="maintenance-start">Maintenance starts</label><input className="ifield" id="maintenance-start" type="datetime-local" autoFocus required value={maintenanceStartDraft} onChange={(event) => setMaintenanceStartDraft(event.target.value)} /><label className="lbl" htmlFor="maintenance-message">Announcement message (optional)</label><textarea className="ifield" id="maintenance-message" maxLength={350} rows={4} value={maintenanceMessageDraft} onChange={(event) => setMaintenanceMessageDraft(event.target.value)} placeholder="Scheduled maintenance begins at the selected time. WebSphere will be unavailable until maintenance is complete." /><div className="modal-acts"><button type="button" className="btn-o" disabled={maintenanceAnnouncementSaving} onClick={() => setMaintenanceDialog(false)}>Cancel</button><button className="btn" disabled={maintenanceAnnouncementSaving}>{maintenanceAnnouncementSaving ? 'Announcing…' : 'Schedule & Announce'}</button></div></form></SecurityModal> : null}
    {securityDialog === 'password' ? <SecurityModal title="Change Admin Password" onClose={() => setSecurityDialog(null)}><form onSubmit={(event) => void changeAdminPassword(event)}><p className="security-modal-help">Changing your password signs this administrator account out of every active session.</p><label className="lbl">Current password</label><input className="ifield" name="oldPassword" type="password" autoComplete="current-password" required /><label className="lbl">New password</label><input className="ifield" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={64} required /><label className="lbl">Confirm new password</label><input className="ifield" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={64} required /><div className="modal-acts"><button type="button" className="btn-o" disabled={securitySaving} onClick={() => setSecurityDialog(null)}>Cancel</button><button className="btn" disabled={securitySaving}>{securitySaving ? 'Changing…' : 'Change Password'}</button></div></form></SecurityModal> : null}
    {securityDialog === 'timeout' ? <SecurityModal title="Edit Session Timeout" onClose={() => setSecurityDialog(null)}><form onSubmit={(event) => void saveTimeout(event)}><p className="security-modal-help">Users are signed out after this amount of inactivity. Choose 5 to 480 minutes.</p><label className="lbl" htmlFor="session-timeout-minutes">Inactivity timeout (minutes)</label><input className="ifield" id="session-timeout-minutes" type="number" min="5" max="480" step="1" required value={timeoutDraft} onChange={(event) => setTimeoutDraft(event.target.value)} /><div className="modal-acts"><button type="button" className="btn-o" disabled={securitySaving} onClick={() => setSecurityDialog(null)}>Cancel</button><button className="btn" disabled={securitySaving}>{securitySaving ? 'Saving…' : 'Save Timeout'}</button></div></form></SecurityModal> : null}
    {securityDialog === 'email' ? <SecurityModal title="Inactive Account Email Alerts" onClose={() => setSecurityDialog(null)}><form onSubmit={(event) => void saveInactiveAccountAlerts(event)}><label className="security-checkbox"><input type="checkbox" checked={emailDraft.enabled} onChange={(event) => setEmailDraft((current) => ({ ...current, enabled: event.target.checked }))} /> Send a daily digest when inactive accounts are found</label><label className="lbl" htmlFor="inactive-alert-recipient">Recipient email</label><input className="ifield" id="inactive-alert-recipient" type="email" value={emailDraft.recipientEmail} disabled={!emailDraft.enabled} required={emailDraft.enabled} onChange={(event) => setEmailDraft((current) => ({ ...current, recipientEmail: event.target.value }))} placeholder="admin@example.edu" /><label className="lbl" htmlFor="inactive-alert-days">Alert when an account has not signed in for</label><select className="ifield" id="inactive-alert-days" value={emailDraft.inactivityDays} disabled={!emailDraft.enabled} onChange={(event) => setEmailDraft((current) => ({ ...current, inactivityDays: Number(event.target.value) }))}>{[7, 14, 30, 60, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}</select><p className="security-modal-help">The daily digest lists active accounts with no sign-in since the selected period, including accounts that have never signed in.</p><div className="modal-acts"><button type="button" className="btn-o" disabled={securitySaving} onClick={() => setSecurityDialog(null)}>Cancel</button><button className="btn" disabled={securitySaving}>{securitySaving ? 'Saving…' : 'Save Alerts'}</button></div></form></SecurityModal> : null}
    {logsOpen ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogsOpen(false); }}>
      <div className="modal-box logs-modal" role="dialog" aria-modal="true" aria-labelledby="settings-system-logs-title">
        <div className="modal-ttl"><span id="settings-system-logs-title">System Logs</span><button type="button" className="modal-close" aria-label="Close system logs" onClick={() => setLogsOpen(false)}>×</button></div>
        <div className="logs-list">
          {logsLoading ? <div className="empty-message">Loading system logs…</div> : logs?.length ? logs.map((entry) => <div className="log-row" key={entry.id}><span className={`log-sev ${entry.severity}`}>{entry.severity.toUpperCase()}</span><span className="log-time">{new Date(entry.createdAt).toLocaleString()}</span><span className="log-desc">{entry.module} — {entry.description}</span></div>) : <div className="empty-message">No system logs yet.</div>}
        </div>
        <div className="modal-acts"><button type="button" className="btn" onClick={() => setLogsOpen(false)}>Close</button></div>
      </div>
    </div> : null}
    {updateOpen ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) setUpdateOpen(false); }}>
      <div className="modal-box release-modal" role="dialog" aria-modal="true" aria-labelledby="software-update-title">
        <div className="modal-ttl"><span id="software-update-title">Software Update</span><button type="button" className="modal-close" aria-label="Close release notes" onClick={() => setUpdateOpen(false)}>×</button></div>
        <div className="release-list">{release ? <article className="release-entry"><header className="release-head"><h3>WebSphere {release.latestVersion}</h3><span className="bdg ac">{release.releaseDate ?? 'Latest release'}</span></header><p className="release-summary">{release.summary || (release.updateAvailable ? 'A newer release is available for deployment.' : 'Your deployed version matches the configured release manifest.')}</p><p><strong>Installed:</strong> {release.currentVersion} · <strong>Status:</strong> {release.updateAvailable ? 'Update available' : 'Up to date'}</p>{release.features.length ? <div className="release-group"><h4>New features</h4><ul>{release.features.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}{release.fixes.length ? <div className="release-group"><h4>Bug fixes</h4><ul>{release.fixes.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}{release.enhancements.length ? <div className="release-group"><h4>Enhancements</h4><ul>{release.enhancements.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}</article> : <Empty>Check the configured release manifest to view update details.</Empty>}</div>
        <div className="modal-acts"><button type="button" className="btn-o" disabled={releaseChecking} onClick={() => void checkForUpdates()}>{releaseChecking ? 'Checking…' : 'Check again'}</button>{release?.updateAvailable && release.downloadUrl ? <a className="btn" href={release.downloadUrl} target="_blank" rel="noreferrer">Open update</a> : null}<button type="button" className="btn" onClick={() => setUpdateOpen(false)}>Close</button></div>
      </div>
    </div> : null}
  </section>;
}

function Kpi({ value, label, tone }: { value: string | number; label: string; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function TrendChartCard({ trends }: { trends: { periods: Array<{ periodStart: string; tasksCompleted: number; progress: number }>; trend: string } | null }) {
  const colors = ['#436dc3', '#48ad7c', '#d49a48', '#7c63df', '#50abd0', '#209d60', '#dc6c6e'];
  return <div className="cc workflow-chart"><div className="cc-head"><h3>Task Completion Rate — Weekly</h3></div>{trends?.periods.length ? <ChartCanvas height={200} config={{
    type: 'bar',
    data: {
      labels: trends.periods.map((period) => new Date(period.periodStart).toLocaleDateString(undefined, { weekday: 'short' })),
      datasets: [{ label: 'Tasks Completed', data: trends.periods.map((period) => period.tasksCompleted), backgroundColor: colors, borderRadius: 5, borderSkipped: false }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, title: { display: true, text: 'Weekly Task Completion', color: '#3789ad', font: { weight: 600 } } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(168,216,240,.45)' } } } },
  }} /> : <Empty>Your project activity will appear here.</Empty>}</div>;
}
function TeamPerformanceCard({ team }: { team: TeamPerformance | null }) {
  const hasData = !!team && team.members.length > 0;
  const sortedMembers = hasData ? [...team!.members].sort((a, b) => b.performance - a.performance || b.totalContributions - a.totalContributions || a.fullName.localeCompare(b.fullName)) : [];
  return <div className="cc team-performance">
    <div className="cc-head"><h3>Team Member Performance</h3></div>
    {!hasData ? <Empty>Team member activity will appear here once your group records workflow activity.</Empty> : <>
      <div className="performance-list">{sortedMembers.map((member, index) => <div className={`performance-row tone-${index % 4}`} key={member.id}>
        <div className="performance-label"><span>{member.fullName}{member.role === 'Project_Leader' ? ' (Leader)' : ''}</span><strong>{member.performance}%</strong></div>
        <div className="performance-track"><i style={{ '--performance-progress': member.performance / 100 } as React.CSSProperties} /></div>
      </div>)}</div>
    </>}
  </div>;
}
function BottleneckAnalysis({ stages }: { stages: Array<{ taskId: string; stage: string; averageDays: number; expectedDays: number; delayDays: number; impact: 'high' | 'medium' | 'none' }> | null }) {
  return <div className="cc workflow-bottlenecks"><div className="cc-head"><h3>Bottleneck Analysis</h3></div>{stages?.length ? <table className="tbl"><thead><tr><th>Stage</th><th>Avg Time Spent</th><th>Expected</th><th>Delay</th><th>Impact</th></tr></thead><tbody>{stages.map((stage) => <tr key={stage.taskId}><td>{stage.stage}</td><td>{formatDays(stage.averageDays)}</td><td>{formatDays(stage.expectedDays)}</td><td className={`delay-${stage.impact}`}>{stage.delayDays > 0 ? `+${formatDays(stage.delayDays)}` : 'On Track'}</td><td><span className={`bdg ${stage.impact === 'high' ? 'r' : stage.impact === 'medium' ? 'y' : 'g'}`}>{stage.impact}</span></td></tr>)}</tbody></table> : <Empty>Stages with a time estimate will appear here once work begins.</Empty>}</div>;
}
function ToolUsageCard({ tools }: { tools: ToolUsage[] | null }) { return <div className="cc tool-usage"><div className="cc-head"><h3>Connected Tool Usage</h3></div>{tools?.length ? <div className="performance-list">{tools.map((tool, index) => <div className={`performance-row tone-${index % 4}`} key={`${tool.provider}-${tool.name}`}><div className="performance-label"><span>{tool.name}</span><strong>{tool.usagePercent}%</strong></div><div className="performance-track"><i style={{ '--performance-progress': tool.usagePercent / 100 } as React.CSSProperties} /></div></div>)}</div> : <Empty>Usage will appear after your team links and uses an external tool.</Empty>}</div>; }
function WorkflowSummaryCard({ summary }: { summary: WorkflowSummary | null }) { return <div className="cc workflow-summary"><div className="cc-head"><h3>Workflow Summary</h3></div>{summary ? <div className="summary-insights">{summary.insights.map((insight, index) => <div className={`summary-insight ${insight.tone}`} key={index}><strong>{insight.label}:</strong> {insight.text}</div>)}</div> : <Empty>Your workflow summary will appear here.</Empty>}</div>; }
function formatDays(value: number) { const rounded = Math.round(value * 10) / 10; return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded} day${rounded === 1 ? '' : 's'}`; }
function TaskRiskCard({ task }: { task: TaskRisk }) { return <article className={`risk-task-card ${task.level}`}><RiskRing score={task.score} title={task.title} /><div className="risk-attribution"><span>{assigneeLabel(task)}</span><small>{task.projectTitle}</small></div></article>; }
function PredictionAlerts({ tasks, recommendations }: { tasks: TaskRisk[]; recommendations: string[] }) {
  const alerts = tasks.slice(0, 3);
  return <div className="cc prediction-alerts"><div className="lbl">AI Predictions &amp; Alerts</div>{alerts.length ? alerts.map((task) => <div className={`prediction-alert ${task.level}`} key={task.taskId}><strong>{task.level === 'high' ? 'High Risk' : task.level === 'medium' ? 'Warning' : 'On Track'}:</strong> “{task.title}” is assigned to {assigneeLabel(task)} in {task.projectTitle}. {task.delayDays > 0 ? `A ${task.delayDays}-day delay is predicted.` : task.level === 'low' ? 'The task is currently on track.' : 'Review its progress and deadline with the team.'}</div>) : recommendations.length ? recommendations.map((value, index) => <div className="prediction-alert medium" key={index}><strong>Notice:</strong> {value}</div>) : <Empty>Your AI predictions and alerts will appear here.</Empty>}</div>;
}
function assigneeLabel(task: Pick<TaskRisk, 'assignees'>) { return task.assignees.length ? task.assignees.join(', ') : 'Unassigned'; }
function taskRecommendation(task: TaskRisk) { return task.level === 'high' ? 'Reassign work or extend the deadline' : task.level === 'medium' ? 'Schedule a review with the assigned member' : 'No action needed'; }
function RiskRing({ score, title }: { score: number; title: string }) { const level = score >= 70 ? 'h' : score >= 40 ? 'm' : 'l'; return <div className={`risk-ring-card ${level}`}><div className="risk-ring" style={{ '--score': score } as React.CSSProperties}><strong>{score}%</strong></div><span>{title}</span><i className={`rlvl ${level}`}>{level === 'h' ? 'High Risk' : level === 'm' ? 'Medium Risk' : 'Low Risk'}</i></div>; }
function SettingsTitle({ children }: { children: React.ReactNode }) { return <div className="settings-label">{children}</div>; }
function Toggle({ title, description, checked, onChange, disabled = false }: { title: string; description: string; checked: boolean; onChange: () => void; disabled?: boolean }) { return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div><button type="button" className={`big-toggle ${checked ? 'on' : ''}`} aria-pressed={checked} disabled={disabled} onClick={onChange}><i /></button></div>; }
function Security({ title, description, action, onClick, danger = false }: { title: string; description: string; action: string; onClick: () => void; danger?: boolean }) { return <div className={`security-row ${danger ? 'danger' : ''}`}><div><strong>{title}</strong><span>{description}</span></div><button className={danger ? 'btn-red btn-sm' : 'btn-o btn-sm'} onClick={onClick}>{action}</button></div>; }
function SecurityModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-box security-modal" role="dialog" aria-modal="true" aria-labelledby="security-settings-dialog-title"><div className="modal-ttl"><span id="security-settings-dialog-title">{title}</span><button type="button" className="modal-close" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</div></div>; }
function date(value?: string | null) { return value ? new Date(value).toLocaleDateString() : 'Not set'; }
function relativeDate(value?: string | null) {
  if (!value) return 'not yet';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 172800) return 'yesterday';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function shiftMonth(value: Date, by: number) { return new Date(value.getFullYear(), value.getMonth() + by, 1); }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function monthCells(value: Date) { const first = new Date(value.getFullYear(), value.getMonth(), 1); const count = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate(); const result: Array<Date | null> = Array(first.getDay()).fill(null); for (let day = 1; day <= count; day++) result.push(new Date(value.getFullYear(), value.getMonth(), day)); while (result.length % 7) result.push(null); return result; }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((result, item) => { (result[key(item)] ||= []).push(item); return result; }, {}); }
