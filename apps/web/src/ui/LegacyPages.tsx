import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { ApiRequestError, apiUrl, getAccessToken, request, socketBaseUrl, type User } from '../api';
import { disablePush, enablePush, pushStatus as getPushStatus, type PushStatus } from '../push';
import { ChartCanvas } from './ChartCanvas';
import { ToolLogo } from './ToolLogo';

type Notice = (message: string) => void;
type Task = { id: string; title: string; projectId: string; deadline?: string | null; priority: string; status: string; project?: { id: string; title: string }; assignedBy?: string; progress?: number };
type Project = { id: string; title: string; status: string; deadline?: string | null; group: { name: string }; members?: Array<{ role: string }>; tasks: Array<{ status: string }> };
type CalendarData = { events: Array<{ id: string; title: string; type: string; startAt: string }>; hints: Array<{ id: string; title: string; type: string; deadline: string }> };

const Empty = ({ children }: { children: React.ReactNode }) => <div className="legacy-empty">{children}</div>;
const Head = ({ title, action }: { title: string; action?: React.ReactNode }) => <div className="ph"><h2>{title}</h2>{action}</div>;
const Badge = ({ value }: { value: string }) => <span className={`bdg ${value === 'completed' || value === 'active' ? 'g' : value === 'pending' ? 'y' : 'ac'}`}>{value.replaceAll('_', ' ')}</span>;

export function TasksPage({ notify, focusedTaskId }: { notify: Notice; focusedTaskId?: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  useEffect(() => { void request<Task[]>('/tasks/mine').then(setTasks).catch((error: Error) => notify(error.message)); }, [notify]);
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
      const progress = status === 'completed' ? 100 : status === 'for_review' ? 75 : status === 'ongoing' ? 50 : 0;
      setTasks((current) => current?.map((item) => item.id === task.id ? { ...item, status, progress } : item) ?? null);
      notify(`Task marked ${status === 'ongoing' ? 'in progress' : status}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this task.'); }
    finally { setUpdatingTaskId(null); }
  }
  return <section className="sp on"><Head title="My Tasks" /><div className="cc legacy-table-card">{tasks === null ? <Empty>Loading tasks…</Empty> : tasks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Project</th><th>Assigned By</th><th>Deadline</th><th>Priority</th><th>Auto-Progress</th><th>Status</th></tr></thead><tbody>{tasks.map((task) => <tr id={`task-${task.id}`} className={task.id === focusedTaskId ? 'notification-target' : ''} key={task.id}><td><strong>{task.title}</strong></td><td>{task.project?.title ?? '—'}</td><td>{task.assignedBy ?? '—'}</td><td>{date(task.deadline)}</td><td><Badge value={task.priority} /></td><td>{task.progress ?? 0}%</td><td><select className="task-status-select" value={task.status} aria-label={`Status for ${task.title}`} disabled={updatingTaskId === task.id} onChange={(event) => void updateStatus(task, event.target.value as 'pending' | 'ongoing' | 'for_review' | 'completed')}><option value="pending">Not Started</option><option value="ongoing">In Progress</option><option value="for_review">For Review</option><option value="completed">Completed</option></select></td></tr>)}</tbody></table> : <Empty>Tasks assigned to you will appear here.</Empty>}</div><div className="cc"><div className="cc-head"><h3>Connected External Tools Progress</h3></div><div className="g4 legacy-tool-progress">{['Design & Presentation', 'Documents', 'File Storage', 'Task Management'].map((label) => <div className="mini-state" key={label}><strong>{label}</strong><span>Connect a tool when your project needs one.</span></div>)}</div></div></section>;
}

export function CalendarPage({ notify }: { notify: Notice }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [data, setData] = useState<CalendarData>({ events: [], hints: [] });
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarData['events'][number] | null>(null);
  const [saving, setSaving] = useState(false);
  async function refresh() { setData(await request<CalendarData>('/calendar')); }
  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => { void request<Project[]>('/projects').then(setProjects).catch(() => undefined); }, []);
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const items = [...data.events.map((event) => ({ ...event, at: event.startAt, kind: 'event' as const })), ...data.hints.map((hint) => ({ ...hint, at: hint.deadline, kind: 'hint' as const }))];

  function openCreate() { setEditingEvent(null); setDialogOpen(true); }
  function openEdit(event: CalendarData['events'][number]) { setEditingEvent(event); setDialogOpen(true); }
  async function saveEvent(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const values = new FormData(formEvent.currentTarget);
    const payload = { title: values.get('title'), type: values.get('type'), startAt: values.get('startAt'), endAt: values.get('endAt') || undefined, projectId: values.get('projectId') || undefined };
    setSaving(true);
    try {
      if (editingEvent) await request(`/calendar/events/${editingEvent.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await request('/calendar/events', { method: 'POST', body: JSON.stringify(payload) });
      setDialogOpen(false);
      await refresh();
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

  return <section className="sp on cal-page-wrap"><div className="cal-page-header"><div><h2>Calendar</h2><div className="cal-page-header-sub">Your project schedule and deadlines</div></div><div className="cal-header-controls"><div className="cal-legend"><span className="cal-legend-item"><i className="cal-legend-dot event" />Event</span><span className="cal-legend-item"><i className="cal-legend-dot deadline" />Deadline</span></div><button className="cal-nav-btn" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</button><span className="cal-month-label">{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><button className="cal-nav-btn" onClick={() => setCursor(shiftMonth(cursor, 1))}>›</button><button className="cal-today-btn" onClick={() => setCursor(new Date())}>Today</button><button className="btn btn-sm" onClick={openCreate}>+ New Event</button></div></div><div className="cal-grid-wrap"><div className="cal-weekday-row">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day) => <div className="cal-weekday-cell" key={day}>{day}</div>)}</div><div className="cal-body">{cells.map((cell, index) => { const dayItems = cell ? items.filter((item) => sameDay(new Date(item.at), cell)) : []; return <div className={`cal-cell ${cell && sameDay(cell, new Date()) ? 'today' : ''}`} key={index}>{cell ? <><span className="cal-day-num">{cell.getDate()}</span>{dayItems.slice(0, 3).map((item) => <span className={`cal-event ${item.type.includes('deadline') ? 'deadline' : 'event'}`} key={`${item.id}-${item.type}`} onClick={() => item.kind === 'event' ? openEdit(item as CalendarData['events'][number]) : undefined} style={{ cursor: item.kind === 'event' ? 'pointer' : 'default' }}>{item.title}</span>)}</> : null}</div>; })}</div></div>{!items.length ? <div className="calendar-empty-note">Your scheduled events will appear here.</div> : null}
  {dialogOpen ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><div className="modal-box"><div className="modal-ttl"><span>{editingEvent ? 'Edit Event' : 'New Event'}</span><button className="modal-close" onClick={() => setDialogOpen(false)}>×</button></div><form onSubmit={saveEvent}>
    <label className="lbl">Title</label><input className="ifield" name="title" required minLength={2} defaultValue={editingEvent?.title ?? ''} placeholder="Event title" />
    <label className="lbl">Type</label><select className="ifield" name="type" defaultValue={editingEvent?.type ?? 'meeting'}><option value="meeting">Meeting</option><option value="work_session">Work session</option><option value="presentation">Presentation</option><option value="activity">Activity</option></select>
    <label className="lbl">Start</label><input className="ifield" name="startAt" type="datetime-local" required defaultValue={editingEvent ? toLocalInput(editingEvent.startAt) : ''} />
    <label className="lbl">End (optional)</label><input className="ifield" name="endAt" type="datetime-local" />
    <label className="lbl">Related Project (optional)</label><select className="ifield" name="projectId" defaultValue=""><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
    <div className="modal-acts">{editingEvent ? <button type="button" className="btn-red" onClick={() => void deleteEvent()} disabled={saving}>Delete</button> : null}<button type="button" className="btn-o" onClick={() => setDialogOpen(false)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Saving…' : editingEvent ? 'Save Changes' : 'Create Event'}</button></div>
  </form></div></div> : null}
  </section>;
}

function toLocalInput(value: string) { const date = new Date(value); const pad = (n: number) => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }

export function ProjectsAnalyticsPage({ kind, notify }: { kind: 'workflow' | 'predictive'; notify: Notice }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState('');
  const [analytics, setAnalytics] = useState<any>(null);
  const [trends, setTrends] = useState<{ periods: Array<{ periodStart: string; tasksCompleted: number; progress: number }>; trend: string } | null>(null);
  const [summary, setSummary] = useState<{ summary: string; recommendations: string[] } | null>(null);
  useEffect(() => { void request<Project[]>('/projects').then((next) => { setProjects(next); setSelected((current) => current || next[0]?.id || ''); }).catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => {
    if (!selected) { setAnalytics(null); setTrends(null); setSummary(null); return; }
    void request(`/projects/${selected}/analytics`).then(setAnalytics).catch((error: Error) => notify(error.message));
    void request<{ periods: Array<{ periodStart: string; tasksCompleted: number; progress: number }>; trend: string }>(`/projects/${selected}/analytics/trends`).then(setTrends).catch(() => setTrends(null));
    void request<{ summary: string; recommendations: string[] }>(`/projects/${selected}/analytics/summary`).then(setSummary).catch(() => setSummary(null));
  }, [selected, notify]);
  const picker = <select className="legacy-select" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a project</option>{projects?.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>;
  if (kind === 'workflow') return <section className="sp on"><Head title="Workflow Analytics" action={picker} /><div className="krow c3"><Kpi value={analytics ? `${Math.round((analytics.overallEfficiency ?? 0) * 100)}%` : '—'} label="Overall Efficiency" /><Kpi value={analytics?.bottlenecks?.length ?? '—'} label="Bottlenecks Detected" tone="yel" /><Kpi value={analytics?.tasksCompleted ?? '—'} label="Tasks Completed" tone="grn" /></div><div className="g2"><TrendChartCard trends={trends} /><ChartCard title="Team Member Performance" empty={!analytics} /></div><div className="cc"><div className="cc-head"><h3>Bottleneck Analysis</h3></div>{analytics?.bottlenecks?.length ? <table className="tbl"><thead><tr><th>Task</th><th>Delay (days)</th><th>Blast Radius</th><th>Recommendation</th></tr></thead><tbody>{analytics.bottlenecks.map((item: any, index: number) => <tr key={index}><td>{item.taskId ?? 'Task'}</td><td>{item.delayDays?.toFixed?.(1) ?? item.delayDays}</td><td><span className="bdg y">{item.blastRadius}</span></td><td>Discuss with your group and update the task plan.</td></tr>)}</tbody></table> : <Empty>Workflow insights will appear after your project has activity.</Empty>}</div><div className="g2"><InfoCard title="Connected Tool Usage" text="Tool activity will appear after you connect an external app." /><div className="cc"><div className="cc-head"><h3>Workflow Summary</h3></div>{summary ? <><p style={{ fontSize: '13px', color: 'var(--sub)', marginBottom: '10px' }}>{summary.summary}</p>{summary.recommendations.length ? summary.recommendations.map((value, index) => <div className="alert y" key={index}>{value}</div>) : null}</> : <Empty>Your workflow summary will appear here.</Empty>}</div></div></section>;
  const score = Number(analytics?.riskScore ?? 0);
  return <section className="sp on"><Head title="Predictive Monitoring" action={picker} /><div className="krow c3"><Kpi value={score ? 1 : '—'} label="High Risk Tasks" tone="red" /><Kpi value={analytics?.deltaDays ?? '—'} label="Possible Delays" tone="yel" /><Kpi value={analytics ? Math.max(0, (projects?.find((p) => p.id === selected)?.tasks.length ?? 0) - (score ? 1 : 0)) : '—'} label="On-Track Tasks" tone="grn" /></div><div className="cc"><div className="cc-head"><h3>Risk Assessment by Task</h3></div>{analytics ? <div className="risk-cards"><RiskRing score={score} title="Project Risk" /></div> : <Empty>Project risk and progress insights will appear here once you have project data.</Empty>}</div><div className="cc prediction-alerts"><div className="lbl">AI Predictions &amp; Alerts</div>{analytics?.recommendations?.length ? analytics.recommendations.map((value: string, index: number) => <div className="alert y" key={index}>{value}</div>) : <Empty>Your AI predictions and alerts will appear here.</Empty>}</div><div className="cc"><div className="cc-head"><h3>Predicted Timeline</h3></div>{analytics ? <table className="tbl"><thead><tr><th>Project</th><th>Original Deadline</th><th>Predicted Completion</th><th>Risk</th><th>Recommendation</th></tr></thead><tbody><tr><td>{projects?.find((p) => p.id === selected)?.title}</td><td>{date(projects?.find((p) => p.id === selected)?.deadline)}</td><td>{date(analytics.predictedCompletion)}</td><td><Badge value={analytics.riskLevel ?? 'low'} /></td><td>{analytics.recommendations?.[0] ?? 'No action needed'}</td></tr></tbody></table> : <Empty>Predicted timelines will appear here.</Empty>}</div></section>;
}

export function NotificationsPage({ notify, onNotificationClick }: { notify: Notice; onNotificationClick: (notification: { id: string; read: boolean; relatedId?: string | null; relatedType?: string | null }) => void }) {
  const [items, setItems] = useState<Array<{ id: string; message: string; read: boolean; createdAt: string; relatedId?: string | null; relatedType?: string | null }> | null>(null);
  async function refresh() { setItems(await request('/notifications')); }
  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('notification:new', () => { void refresh().catch(() => undefined); });
    return () => { socket.disconnect(); };
  }, []);
  async function markAll() { if (!items) return; await Promise.all(items.filter((item) => !item.read).map((item) => request(`/notifications/${item.id}/read`, { method: 'PATCH' }))); await refresh(); notify('Notifications marked as read.'); }
  function activateNotification(item: NonNullable<typeof items>[number]) {
    setItems((current) => current?.map((notification) => notification.id === item.id ? { ...notification, read: true } : notification) ?? null);
    onNotificationClick(item);
  }
  return <section className="sp on"><Head title="Notifications" action={<button className="btn-o btn-sm" onClick={() => void markAll()}>Mark All Read</button>} /><div className="cc no-bottom">{items === null ? <Empty>Loading notifications…</Empty> : items.length ? items.map((item) => <button type="button" className="notif-item notif-entry" key={item.id} onClick={() => activateNotification(item)}><span className="ndot" style={{ opacity: item.read ? .35 : 1 }} /><span><span className="ntxt">{item.message}</span><span className="ntime">{new Date(item.createdAt).toLocaleString()}</span></span></button>) : <Empty>You have no notifications yet.</Empty>}</div></section>;
}

export function ProfilePage({ user, onUserUpdated, onSessionInvalidated, notify }: { user: User; onUserUpdated: (user: User) => void; onSessionInvalidated: () => void; notify: Notice }) {
  const [profile, setProfile] = useState({ fullName: user.fullName, email: user.email, institution: user.institution ?? '', course: user.course ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [browserPush, setBrowserPush] = useState<PushStatus>('disabled');
  const [changingBrowserPush, setChangingBrowserPush] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ tasks: true, groupActivity: true, deadlines: true, aiSuggestions: true, profileVisibility: true, activityStatus: true });
  useEffect(() => { setProfile({ fullName: user.fullName, email: user.email, institution: user.institution ?? '', course: user.course ?? '' }); }, [user]);
  useEffect(() => { void request<Record<string, boolean>>('/notifications/preferences').then((value) => setPrefs((current) => ({ ...current, ...value }))).catch(() => undefined); }, []);
  useEffect(() => { void getPushStatus().then(setBrowserPush).catch(() => setBrowserPush('unsupported')); }, []);
  const persistedKeys = ['tasks', 'groupActivity', 'deadlines', 'aiSuggestions'];
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
  const browserPushDescription = browserPush === 'enabled' ? 'Browser notifications are enabled for this device.' : browserPush === 'blocked' ? 'Browser permission is blocked. Enable notifications in your browser settings.' : browserPush === 'unsupported' ? 'This browser does not support push notifications.' : 'Get alerts even when WebSphere is closed.';
  return <section className="sp on"><Head title="Profile & Settings" /><div className="profile-grid"><form className="cc no-bottom" onSubmit={(event) => void saveProfile(event)}><div className="profile-hero">{user.avatarUrl ? <img className="profile-avatar profile-avatar-image" src={user.avatarUrl} alt="Profile" /> : <div className="profile-avatar">{initials(user.fullName)}</div>}<div><strong>{user.fullName}</strong><span>Member</span></div><label className={`btn-o btn-sm profile-avatar-action ${uploading ? 'disabled' : ''}`}>{uploading ? 'Uploading…' : 'Change photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label></div>{([['fullName', 'Full Name'], ['email', 'Email'], ['institution', 'School'], ['course', 'Course']] as const).map(([field, label]) => <label className="profile-field" key={field}><span className="lbl">{label}</span><input value={profile[field]} type={field === 'email' ? 'email' : 'text'} onChange={(event) => setField(field, event.target.value)} placeholder={`Your ${label.toLowerCase()}`} /><span className="profile-error">{errors[field]}</span></label>)}<button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button></form><div className="cc no-bottom"><div className="cc-head"><h3>Settings</h3></div><SettingsTitle>Notifications</SettingsTitle><Toggle title="Task Reminders" description="Get notified before task deadlines" checked={prefs.tasks} onChange={() => toggle('tasks')} /><Toggle title="Group Chat Alerts" description="Notify me when someone messages the group" checked={prefs.groupActivity} onChange={() => toggle('groupActivity')} /><Toggle title="Deadline Alerts" description="Notify me 24 hours before project deadlines" checked={prefs.deadlines} onChange={() => toggle('deadlines')} /><Toggle title="AI Suggestions" description="Receive AI-generated project recommendations" checked={prefs.aiSuggestions} onChange={() => toggle('aiSuggestions')} /><Toggle title="Browser Push Notifications" description={browserPushDescription} checked={browserPush === 'enabled'} disabled={changingBrowserPush || browserPush === 'unsupported'} onChange={() => void toggleBrowserPush()} /><SettingsTitle>Privacy</SettingsTitle><Toggle title="Profile Visibility" description="Allow group members to see your profile" checked={prefs.profileVisibility} onChange={() => toggle('profileVisibility')} /><Toggle title="Activity Status" description="Show others when you are online" checked={prefs.activityStatus} onChange={() => toggle('activityStatus')} /><SettingsTitle>Security</SettingsTitle><Security title="Change Password" description="Update your account password" action={changingPassword ? 'Cancel' : 'Change'} onClick={() => setChangingPassword((value) => !value)} />{changingPassword ? <form className="password-change-form" onSubmit={(event) => void changePassword(event)}><input className="ifield" required name="oldPassword" type="password" placeholder="Current password" /><input className="ifield" required minLength={8} name="password" type="password" placeholder="New password" /><input className="ifield" required minLength={8} name="confirm" type="password" placeholder="Confirm new password" /><button className="btn btn-sm" disabled={saving}>{saving ? 'Changing…' : 'Change Password'}</button></form> : null}<Security danger title="Delete Account" description="Permanently remove your WebSphere account" action="Delete" onClick={() => notify('Please contact your administrator to delete your account.')} /></div></div></section>;
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
    return () => socket.disconnect();
  }, [projectRoomIds.join(',')]);
  const connections = data?.connections ?? [];
  const connectedConnections = connections.filter((connection) => connection.status === 'connected');
  const complete = tasks.filter((task) => task.status === 'completed').length;
  const average = tasks.length ? Math.round(tasks.reduce((total, task) => total + task.progress, 0) / tasks.length) : 0;
  const visibleTasks = (filter === 'all' ? tasks : tasks.filter((task) => task.status === filter));
  const cards: TrackerCard[] = visibleTasks.flatMap((task) => task.resources.length ? task.resources.map((resource) => ({ task, resource })) : [{ task, resource: null }]).filter((card) => platform === 'all' || card.resource?.provider === platform);
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
    {editingTask && editingResource ? <div className="modal-ov open tracker-edit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEditingTaskId(null); setEditingResourceId(null); } }}><div className="modal-box tracker-edit-modal"><div className="modal-ttl"><span>Edit External File Link</span><button type="button" className="modal-close" onClick={() => { setEditingTaskId(null); setEditingResourceId(null); }}>×</button></div><form onSubmit={(event) => void saveExternalFile(event)}><label className="lbl">File name</label><input className="ifield" name="title" required minLength={2} maxLength={180} defaultValue={editingResource.title} /><label className="lbl">External file URL</label><input className="ifield" name="externalUrl" type="url" required defaultValue={editingResource.externalUrl} /><label className="lbl">Platform</label><div className="tracker-platform-options">{connectedConnections.map((connection) => <label className={`tracker-platform-option ${connection.id === editingResource.connectionId ? 'selected' : ''}`} key={connection.id}><input type="radio" name="connectionId" value={connection.id} defaultChecked={connection.id === editingResource.connectionId} required /><ToolLogo provider={connection.provider} name={connection.platform} size="xs" /><span>{connection.platform}</span></label>)}</div>{connectedConnections.length ? null : <div className="tracker-auto-progress-note">Connect an external platform before editing this file link.</div>}<label className="lbl">Assigned member</label><select className="ifield" name="assigneeId" defaultValue={editingTask.assignees[0]?.id ?? ''} disabled={!editingTask.canAssign}>{editingTask.collaborators.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select><label className="lbl">Status</label><div className="tracker-status-options">{(['pending', 'ongoing', 'for_review', 'completed'] as const).map((status) => <button type="button" className={editStatus === status ? 'selected' : ''} disabled={!editingTask.canUpdateStatus} key={status} onClick={() => setEditStatus(status)}>{trackerFilterLabel[status]}</button>)}</div><div className="tracker-auto-progress-note">Progress is calculated automatically from task status and cannot be entered manually.</div><div className="modal-acts"><button type="button" className="btn-o" onClick={() => { setEditingTaskId(null); setEditingResourceId(null); }}>Cancel</button><button className="btn" disabled={saving || !connectedConnections.length}>{saving ? 'Saving…' : 'Save Changes'}</button></div></form></div></div> : null}
  </section>;
}

function TrackerKpi({ icon, value, label, tone }: { icon: string; value: string | number; label: string; tone?: 'yel' | 'grn' }) { return <div className={`tracker-kpi ${tone ?? ''}`}><i>{icon}</i><div><strong>{value}</strong><span>{label}</span></div></div>; }
function TrackerResourceCard({ task, resource, onEdit, onOpen, onAttach }: { task: TrackerTask; resource: TrackerResource | null; onEdit: () => void; onOpen: () => void; onAttach: () => void }) {
  const assignee = task.assignees[0];
  return <article className="tracker-resource-card"><div className="tracker-resource-top"><div className="tracker-file-icon"><ToolLogo provider={resource?.provider} name={resource?.platform} size="md" /></div><div className="tracker-resource-copy"><strong>{resource?.title ?? task.title}</strong><span>{resource ? `${resource.platform} · ${task.title}` : 'No file linked'}</span></div><Badge value={task.status} /></div><div className="tracker-owner"><span className="tracker-owner-avatar">{assignee?.avatarUrl ? <img src={assignee.avatarUrl} alt="" /> : initials(assignee?.fullName ?? 'Unassigned')}</span><span>{assignee ? assignee.fullName : 'Unassigned'}</span></div><div className="tracker-progress-row"><span>Progress <small>Automatic from status</small></span><strong>{task.progress}%</strong></div><div className="tracker-progress-track"><i style={{ width: `${task.progress}%` }} /></div><div className="tracker-resource-footer"><span>Updated {relativeDate(task.latestActivityAt)}</span><div>{resource ? <><button className="btn-o btn-sm tracker-edit-button" disabled={!task.canEditResource} title={task.canEditResource ? 'Edit external file link' : 'Only the active assignee or project leader can edit this file link'} onClick={onEdit}>⌑ Edit</button><button className="btn btn-sm" onClick={onOpen}>Open File</button></> : <button className="btn-o btn-sm" onClick={onAttach}>Attach</button>}</div></div></article>;
}
function activityLabel(activity: TrackerActivity) { if (activity.kind === 'integration') return activity.action ?? `${activity.platform ?? 'Integration'} activity`; const actor = activity.actor?.fullName ?? 'A project member'; if (activity.type === 'task_completed') return `${actor} completed ${activity.taskTitle ?? 'a task'}`; if (activity.type === 'progress_activity') return activity.toValue ? `${actor} linked ${activity.toValue}` : `${actor} updated task progress`; if (activity.type === 'assignment_change') return `${actor} assigned ${activity.taskTitle ?? 'a task'}`; return `${actor} changed ${activity.taskTitle ?? 'a task'} to ${(activity.toValue ?? 'a new status').replaceAll('_', ' ')}`; }

export function IntegrationsPage({ notify }: { notify: Notice }) {
  const [tools, setTools] = useState<Array<{ id: string; provider: string; name: string; category: string; connections: Array<{ status: string; lastSyncedAt?: string }> }> | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  useEffect(() => {
    void request<any[]>('/integrations/catalog').then(setTools).catch((error: Error) => notify(error.message));
    const provider = new URLSearchParams(window.location.search).get('connected');
    if (provider) { notify(`${provider === 'microsoft' ? 'Microsoft 365' : provider[0].toUpperCase() + provider.slice(1)} connected successfully.`); window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`); }
  }, [notify]);
  async function connect(tool: { provider: string; name: string }) {
    if (!['google', 'microsoft', 'figma', 'trello', 'asana', 'canva'].includes(tool.provider)) { notify(`${tool.name} is not available yet.`); return; }
    setConnecting(tool.provider);
    try {
      const callbackPath = apiUrl(`/integrations/${tool.provider}/callback`);
      const callbackUrl = callbackPath.startsWith('http') ? callbackPath : new URL(callbackPath, window.location.origin).toString();
      const { authorizeUrl } = await request<{ authorizeUrl: string }>(`/integrations/${tool.provider}/authorize?redirectUri=${encodeURIComponent(callbackUrl)}`);
      window.location.assign(authorizeUrl);
    } catch (error) { notify(error instanceof Error ? error.message : `Could not connect ${tool.name}.`); setConnecting(null); }
  }
  const connected = tools?.filter((tool) => tool.connections.length).length ?? 0;
  const sections = useMemo(() => groupBy(tools ?? [], (tool) => tool.category || 'Other'), [tools]);
  return <section className="sp on"><div className="ext-workspace-header"><div><div className="ext-workspace-title">Apps & External Tools</div><div className="ext-workspace-sub" /></div><div className="ext-header-actions"><button className="btn-o btn-sm" onClick={() => notify('More apps will appear in the catalog when available.')}>⌕ Browse Apps</button><button className="btn btn-sm" onClick={() => notify('Use Sync Files in Task Progress Tracker to sync your connected tools.')}>↻ Sync All</button></div></div><div className="ext-status-bar"><span className="ext-status-pill"><i className="dot-pulse connected" />{connected} Connected</span><i className="ext-divider" /><span className="ext-status-pill"><i className="dot-pulse idle" />0 Active Sessions</span><i className="ext-divider" /><span className="ext-status-pill">✓ 0 Tasks Auto-Completed Today</span><span className="ext-last-sync">Last synced: not yet</span></div>{tools === null ? <div className="cc"><Empty>Loading apps…</Empty></div> : tools.length ? Object.entries(sections).map(([category, values]) => <div key={category}><div className="ext-section-label">{category}</div><div className="ext-app-grid">{values.map((tool) => <article className={`ext-app-card ${tool.connections.length ? 'connected' : ''}`} key={tool.id}><div className="ext-card-top"><div className="ext-app-icon"><ToolLogo provider={tool.provider} name={tool.name} size="lg" /></div><span className={`ext-conn-badge ${tool.connections.length ? 'connected' : 'not-connected'}`}>{tool.connections.length ? '● Connected' : 'Not Connected'}</span></div><div className="ext-app-name">{tool.name}</div><div className="ext-app-category">{tool.category}</div><div className="ext-recent-activity">{tool.connections.length ? 'Connected — ready to launch and link to a task.' : `Connect ${tool.name} when your project needs it.`}</div><div className="ext-card-footer"><span className="ext-task-link">No task linked yet</span><button className={`ext-action-btn ${tool.connections.length ? 'launch' : 'connect'}`} disabled={connecting === tool.provider} onClick={() => tool.connections.length ? notify(`${tool.name} is ready to launch.`) : void connect(tool)}>{tool.connections.length ? 'Launch' : connecting === tool.provider ? 'Opening…' : ['google', 'microsoft', 'figma', 'trello', 'asana', 'canva'].includes(tool.provider) ? 'Connect' : 'Coming Soon'}</button></div></article>)}</div></div>) : <div className="cc"><Empty>Connect a tool when your project needs one.</Empty></div>}</section>;
}

export function AdminSettingsPage({ notify }: { notify: Notice }) {
  const [maintenance, setMaintenance] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void request<Array<{ key: string; value: unknown }>>('/admin/settings').then((rows) => setMaintenance(Boolean(rows.find((row) => row.key === 'maintenanceMode')?.value))).catch(() => undefined); }, []);
  async function toggleMaintenance() {
    const next = !maintenance;
    setSaving(true);
    try { await request('/admin/settings', { method: 'PUT', body: JSON.stringify({ maintenanceMode: next }) }); setMaintenance(next); notify(next ? 'Maintenance mode enabled. Only administrators can use WebSphere.' : 'Maintenance mode disabled.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update maintenance mode.'); }
    finally { setSaving(false); }
  }
  return <section className="sp on"><Head title="System Settings" /><div className="g2 settings-top"><div className="cc"><div className="cc-head"><h3>General Configuration</h3></div><div className="lbl">System Name</div><div className="ifield"><span>WebSphere</span></div><div className="lbl">Max Ideas per AI Search</div><div className="ifield"><span>10 ideas (maximum)</span></div><button className="btn" onClick={() => notify('Settings saved!')}>Save Settings</button></div><div className="cc"><div className="cc-head"><h3>Security & Access</h3></div><Security title="Admin Password" description="Change admin credentials" action="Change" onClick={() => notify('Password change instructions sent.')} /><Security title="Session Timeout" description="Currently: 30 minutes" action="Edit" onClick={() => notify('Session settings are ready to edit.')} /><Security title="Email Notifications" description="Inactive account alerts" action="Configure" onClick={() => notify('Email settings are ready to configure.')} /><Security title="System Logs" description="View recent activity" action="View Logs" onClick={() => notify('System logs are available in User Activity.')} /></div></div><div className="cc maintenance-card"><div className="cc-head"><h3>Maintenance & Updates</h3></div><div className="g3"><Security title="Software Update" description="Your installed version is shown here" action="Check Now" onClick={() => notify('WebSphere is ready for update checks.')} /><Security title="Backup Database" description="Backups use your Linux instance" action="Backup Now" onClick={() => notify('Database backup request received.')} /><Security danger={maintenance} title="Maintenance Mode" description={maintenance ? 'Enabled — only administrators can access WebSphere' : 'Disabled — WebSphere is available to everyone'} action={saving ? 'Saving…' : maintenance ? 'Disable' : 'Enable'} onClick={() => void toggleMaintenance()} /></div></div><div className="cc"><div className="cc-head"><h3>Notifications</h3><button className="btn-o btn-sm">Mark All Read</button></div><Empty>System notifications will appear here.</Empty></div></section>;
}

function Kpi({ value, label, tone }: { value: string | number; label: string; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function ChartCard({ title, empty }: { title: string; empty: boolean }) { return <div className="cc"><div className="cc-head"><h3>{title}</h3></div>{empty ? <Empty>Your project activity will appear here.</Empty> : <div className="chart-box"><div className="chart-bars">{[32,48,38,66,58,76,84].map((height, i) => <i className="cbar" style={{ height: `${height}%` }} key={i} />)}</div></div>}</div>; }
function TrendChartCard({ trends }: { trends: { periods: Array<{ periodStart: string; tasksCompleted: number; progress: number }>; trend: string } | null }) {
  return <div className="cc"><div className="cc-head"><h3>Task Completion Rate — Weekly</h3>{trends ? <span className={`bdg ${trends.trend === 'improving' ? 'g' : 'y'}`}>{trends.trend}</span> : null}</div>{trends?.periods.length ? <ChartCanvas height={200} config={{
    type: 'line',
    data: {
      labels: trends.periods.map((period) => new Date(period.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      datasets: [{ label: 'Tasks Completed', data: trends.periods.map((period) => period.tasksCompleted), borderColor: '#0038A8', backgroundColor: 'rgba(0,56,168,0.12)', tension: 0.35, fill: true }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  }} /> : <Empty>Your project activity will appear here.</Empty>}</div>;
}
function InfoCard({ title, text }: { title: string; text: string }) { return <div className="cc"><div className="cc-head"><h3>{title}</h3></div><Empty>{text}</Empty></div>; }
function RiskRing({ score, title }: { score: number; title: string }) { const level = score >= 70 ? 'h' : score >= 40 ? 'm' : 'l'; return <div className={`risk-ring-card ${level}`}><div className="risk-ring" style={{ '--score': score } as React.CSSProperties}><strong>{score}%</strong></div><span>{title}</span><i className={`rlvl ${level}`}>{level === 'h' ? 'High Risk' : level === 'm' ? 'Medium Risk' : 'Low Risk'}</i></div>; }
function SettingsTitle({ children }: { children: React.ReactNode }) { return <div className="settings-label">{children}</div>; }
function Toggle({ title, description, checked, onChange, disabled = false }: { title: string; description: string; checked: boolean; onChange: () => void; disabled?: boolean }) { return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div><button type="button" className={`big-toggle ${checked ? 'on' : ''}`} aria-pressed={checked} disabled={disabled} onClick={onChange}><i /></button></div>; }
function Security({ title, description, action, onClick, danger = false }: { title: string; description: string; action: string; onClick: () => void; danger?: boolean }) { return <div className={`security-row ${danger ? 'danger' : ''}`}><div><strong>{title}</strong><span>{description}</span></div><button className={danger ? 'btn-red btn-sm' : 'btn-o btn-sm'} onClick={onClick}>{action}</button></div>; }
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
