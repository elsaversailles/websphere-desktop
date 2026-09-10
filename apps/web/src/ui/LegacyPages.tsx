import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { ApiRequestError, getAccessToken, request, socketBaseUrl, type User } from '../api';
import { ChartCanvas } from './ChartCanvas';

type Notice = (message: string) => void;
type Task = { id: string; title: string; projectId: string; deadline?: string | null; priority: string; status: string; project?: { id: string; title: string }; assignedBy?: string; progress?: number };
type Project = { id: string; title: string; status: string; deadline?: string | null; group: { name: string }; members?: Array<{ role: string }>; tasks: Array<{ status: string }> };
type CalendarData = { events: Array<{ id: string; title: string; type: string; startAt: string }>; hints: Array<{ id: string; title: string; type: string; deadline: string }> };

const Empty = ({ children }: { children: React.ReactNode }) => <div className="legacy-empty">{children}</div>;
const Head = ({ title, action }: { title: string; action?: React.ReactNode }) => <div className="ph"><h2>{title}</h2>{action}</div>;
const Badge = ({ value }: { value: string }) => <span className={`bdg ${value === 'completed' || value === 'active' ? 'g' : value === 'pending' ? 'y' : 'ac'}`}>{value.replaceAll('_', ' ')}</span>;

export function TasksPage({ notify }: { notify: Notice }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => { void request<Task[]>('/tasks/mine').then(setTasks).catch((error: Error) => notify(error.message)); }, [notify]);
  return <section className="sp on"><Head title="My Tasks" /><div className="cc legacy-table-card">{tasks === null ? <Empty>Loading tasks…</Empty> : tasks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Project</th><th>Assigned By</th><th>Deadline</th><th>Priority</th><th>Auto-Progress</th><th>Status</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><strong>{task.title}</strong></td><td>{task.project?.title ?? '—'}</td><td>{task.assignedBy ?? '—'}</td><td>{date(task.deadline)}</td><td><Badge value={task.priority} /></td><td>{task.progress ?? 0}%</td><td><Badge value={task.status} /></td></tr>)}</tbody></table> : <Empty>Tasks assigned to you will appear here.</Empty>}</div><div className="cc"><div className="cc-head"><h3>Connected External Tools Progress</h3></div><div className="g4 legacy-tool-progress">{['Design & Presentation', 'Documents', 'File Storage', 'Task Management'].map((label) => <div className="mini-state" key={label}><strong>{label}</strong><span>Connect a tool when your project needs one.</span></div>)}</div></div></section>;
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

export function NotificationsPage({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<Array<{ id: string; message: string; read: boolean; createdAt: string }> | null>(null);
  async function refresh() { setItems(await request('/notifications')); }
  useEffect(() => { void refresh().catch((error: Error) => notify(error.message)); }, [notify]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('notification:new', () => { void refresh().catch(() => undefined); });
    return () => { socket.disconnect(); };
  }, []);
  async function markAll() { if (!items) return; await Promise.all(items.filter((item) => !item.read).map((item) => request(`/notifications/${item.id}/read`, { method: 'PATCH' }))); await refresh(); notify('Notifications marked as read.'); }
  return <section className="sp on"><Head title="Notifications" action={<button className="btn-o btn-sm" onClick={() => void markAll()}>Mark All Read</button>} /><div className="cc no-bottom">{items === null ? <Empty>Loading notifications…</Empty> : items.length ? items.map((item) => <div className="notif-item" key={item.id}><div className="ndot" style={{ opacity: item.read ? .35 : 1 }} /><div><div className="ntxt">{item.message}</div><div className="ntime">{new Date(item.createdAt).toLocaleString()}</div></div></div>) : <Empty>You have no notifications yet.</Empty>}</div></section>;
}

export function ProfilePage({ user, onUserUpdated, onSessionInvalidated, notify }: { user: User; onUserUpdated: (user: User) => void; onSessionInvalidated: () => void; notify: Notice }) {
  const [profile, setProfile] = useState({ fullName: user.fullName, email: user.email, institution: user.institution ?? '', course: user.course ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ tasks: true, groupActivity: true, deadlines: true, aiSuggestions: true, profileVisibility: true, activityStatus: true });
  useEffect(() => { setProfile({ fullName: user.fullName, email: user.email, institution: user.institution ?? '', course: user.course ?? '' }); }, [user]);
  useEffect(() => { void request<Record<string, boolean>>('/notifications/preferences').then((value) => setPrefs((current) => ({ ...current, ...value }))).catch(() => undefined); }, []);
  const persistedKeys = ['tasks', 'groupActivity', 'deadlines', 'aiSuggestions'];
  async function toggle(key: string) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    if (!persistedKeys.includes(key)) return;
    try { await request('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ [key]: next[key] }) }); }
    catch (error) { setPrefs(prefs); notify(error instanceof Error ? error.message : 'Could not save preference.'); }
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
  return <section className="sp on"><Head title="Profile & Settings" /><div className="profile-grid"><form className="cc no-bottom" onSubmit={(event) => void saveProfile(event)}><div className="profile-hero">{user.avatarUrl ? <img className="profile-avatar profile-avatar-image" src={user.avatarUrl} alt="Profile" /> : <div className="profile-avatar">{initials(user.fullName)}</div>}<div><strong>{user.fullName}</strong><span>Member</span></div><label className={`btn-o btn-sm profile-avatar-action ${uploading ? 'disabled' : ''}`}>{uploading ? 'Uploading…' : 'Change photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label></div>{([['fullName', 'Full Name'], ['email', 'Email'], ['institution', 'School'], ['course', 'Course']] as const).map(([field, label]) => <label className="profile-field" key={field}><span className="lbl">{label}</span><input value={profile[field]} type={field === 'email' ? 'email' : 'text'} onChange={(event) => setField(field, event.target.value)} placeholder={`Your ${label.toLowerCase()}`} /><span className="profile-error">{errors[field]}</span></label>)}<button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button></form><div className="cc no-bottom"><div className="cc-head"><h3>Settings</h3></div><SettingsTitle>Notifications</SettingsTitle><Toggle title="Task Reminders" description="Get notified before task deadlines" checked={prefs.tasks} onChange={() => toggle('tasks')} /><Toggle title="Group Chat Alerts" description="Notify me when someone messages the group" checked={prefs.groupActivity} onChange={() => toggle('groupActivity')} /><Toggle title="Deadline Alerts" description="Notify me 24 hours before project deadlines" checked={prefs.deadlines} onChange={() => toggle('deadlines')} /><Toggle title="AI Suggestions" description="Receive AI-generated project recommendations" checked={prefs.aiSuggestions} onChange={() => toggle('aiSuggestions')} /><SettingsTitle>Privacy</SettingsTitle><Toggle title="Profile Visibility" description="Allow group members to see your profile" checked={prefs.profileVisibility} onChange={() => toggle('profileVisibility')} /><Toggle title="Activity Status" description="Show others when you are online" checked={prefs.activityStatus} onChange={() => toggle('activityStatus')} /><SettingsTitle>Security</SettingsTitle><Security title="Change Password" description="Update your account password" action={changingPassword ? 'Cancel' : 'Change'} onClick={() => setChangingPassword((value) => !value)} />{changingPassword ? <form className="password-change-form" onSubmit={(event) => void changePassword(event)}><input className="ifield" required name="oldPassword" type="password" placeholder="Current password" /><input className="ifield" required minLength={8} name="password" type="password" placeholder="New password" /><input className="ifield" required minLength={8} name="confirm" type="password" placeholder="Confirm new password" /><button className="btn btn-sm" disabled={saving}>{saving ? 'Changing…' : 'Change Password'}</button></form> : null}<Security danger title="Delete Account" description="Permanently remove your WebSphere account" action="Delete" onClick={() => notify('Please contact your administrator to delete your account.')} /></div></div></section>;
}

const trackerFilters = ['all', 'pending', 'ongoing', 'completed'] as const;
type TrackerFilter = (typeof trackerFilters)[number];
const trackerFilterLabel: Record<TrackerFilter, string> = { all: 'All Tasks', pending: 'Not Started', ongoing: 'In Progress', completed: 'Completed' };

export function TrackerPage({ notify }: { notify: Notice }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [filter, setFilter] = useState<TrackerFilter>('all');
  useEffect(() => { void request<Task[]>('/tasks/mine').then(setTasks).catch((error: Error) => notify(error.message)); }, [notify]);
  const all = tasks ?? [];
  const complete = all.filter((task) => task.status === 'completed').length;
  const visible = filter === 'all' ? all : all.filter((task) => task.status === filter);
  return <section className="sp on"><Head title="Task Progress Tracker" /><div className="krow"><Kpi value={all.length || '—'} label="Total Tasks" /><Kpi value={all.filter((task) => task.status === 'ongoing').length || '—'} label="In Progress" tone="yel" /><Kpi value={complete || '—'} label="Completed" tone="grn" /><Kpi value={all.length ? `${Math.round(complete / all.length * 100)}%` : '—'} label="Avg. Progress" /></div><div className="tracker-filter"><div>{trackerFilters.map((value) => <button type="button" className={filter === value ? 'on' : ''} key={value} onClick={() => setFilter(value)}>{trackerFilterLabel[value]}</button>)}</div></div>{tasks === null ? <div className="cc"><Empty>Loading tasks…</Empty></div> : visible.length ? <div className="file-card-grid">{visible.map((task) => <article className="file-card" key={task.id}><div className="file-icon">▤</div><div><strong>{task.title}</strong><span>{task.project?.title ?? 'No project'} · {task.progress ?? 0}% complete{task.deadline ? ` · Due ${date(task.deadline)}` : ''}</span></div><Badge value={task.status} /></article>)}</div> : <div className="cc"><Empty>{filter === 'all' ? 'Tasks assigned to you will appear here.' : `No ${trackerFilterLabel[filter].toLowerCase()} tasks.`}</Empty></div>}</section>;
}

export function IntegrationsPage({ notify }: { notify: Notice }) {
  const [tools, setTools] = useState<Array<{ id: string; provider: string; name: string; category: string; connections: Array<{ status: string; lastSyncedAt?: string }> }> | null>(null);
  useEffect(() => { void request<any[]>('/integrations/catalog').then(setTools).catch((error: Error) => notify(error.message)); }, [notify]);
  const connected = tools?.filter((tool) => tool.connections.length).length ?? 0;
  const sections = useMemo(() => groupBy(tools ?? [], (tool) => tool.category || 'Other'), [tools]);
  return <section className="sp on"><div className="ext-workspace-header"><div><div className="ext-workspace-title">Apps & External Tools</div><div className="ext-workspace-sub" /></div><div className="ext-header-actions"><button className="btn-o btn-sm" onClick={() => notify('More apps will appear in the catalog when available.')}>⌕ Browse Apps</button><button className="btn btn-sm" onClick={() => notify('All connected tools synced!')}>↻ Sync All</button></div></div><div className="ext-status-bar"><span className="ext-status-pill"><i className="dot-pulse connected" />{connected} Connected</span><i className="ext-divider" /><span className="ext-status-pill"><i className="dot-pulse idle" />0 Active Sessions</span><i className="ext-divider" /><span className="ext-status-pill">✓ 0 Tasks Auto-Completed Today</span><span className="ext-last-sync">Last synced: not yet</span></div>{tools === null ? <div className="cc"><Empty>Loading apps…</Empty></div> : tools.length ? Object.entries(sections).map(([category, values]) => <div key={category}><div className="ext-section-label">{category}</div><div className="ext-app-grid">{values.map((tool) => <article className={`ext-app-card ${tool.connections.length ? 'connected' : ''}`} key={tool.id}><div className="ext-card-top"><div className="ext-app-icon">{tool.name.slice(0, 1)}</div><span className={`ext-conn-badge ${tool.connections.length ? 'connected' : 'not-connected'}`}>{tool.connections.length ? '● Connected' : 'Not Connected'}</span></div><div className="ext-app-name">{tool.name}</div><div className="ext-app-category">{tool.category}</div><div className="ext-recent-activity">{tool.connections.length ? 'Connected — ready to launch and link to a task.' : `Connect ${tool.name} when your project needs it.`}</div><div className="ext-card-footer"><span className="ext-task-link">No task linked yet</span><button className={`ext-action-btn ${tool.connections.length ? 'launch' : 'connect'}`} onClick={() => notify(tool.connections.length ? `${tool.name} is ready to launch.` : `${tool.name} connection setup is ready for provider credentials.`)}>{tool.connections.length ? 'Launch' : 'Connect'}</button></div></article>)}</div></div>) : <div className="cc"><Empty>Connect a tool when your project needs one.</Empty></div>}</section>;
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
function Toggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: () => void }) { return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div><button type="button" className={`big-toggle ${checked ? 'on' : ''}`} aria-pressed={checked} onClick={onChange}><i /></button></div>; }
function Security({ title, description, action, onClick, danger = false }: { title: string; description: string; action: string; onClick: () => void; danger?: boolean }) { return <div className={`security-row ${danger ? 'danger' : ''}`}><div><strong>{title}</strong><span>{description}</span></div><button className={danger ? 'btn-red btn-sm' : 'btn-o btn-sm'} onClick={onClick}>{action}</button></div>; }
function date(value?: string | null) { return value ? new Date(value).toLocaleDateString() : 'Not set'; }
function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function shiftMonth(value: Date, by: number) { return new Date(value.getFullYear(), value.getMonth() + by, 1); }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function monthCells(value: Date) { const first = new Date(value.getFullYear(), value.getMonth(), 1); const count = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate(); const result: Array<Date | null> = Array(first.getDay()).fill(null); for (let day = 1; day <= count; day++) result.push(new Date(value.getFullYear(), value.getMonth(), day)); while (result.length % 7) result.push(null); return result; }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((result, item) => { (result[key(item)] ||= []).push(item); return result; }, {}); }
