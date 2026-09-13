import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import type { GroupHub as GroupHubData, GroupSummary } from './types';

type DashboardData = {
  glance: { activeProjects: number; pendingTasks: number; ideasSubmitted: number };
  projects: Array<{ id: string; title: string; status: string; group: { name: string }; tasks: Array<{ status: string }> }>;
  tasks: Array<{ id: string; title: string; status: string; deadline?: string | null }>;
  notifications: Array<{ id: string; message: string; read: boolean }>;
};
type DashboardProps = { name: string; notify: (message: string) => void; onPage: (page: 'groups' | 'ideas' | 'projects' | 'tasks' | 'assistant' | 'notifications') => void };

export function Dashboard({ name, notify, onPage }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [createGroupId, setCreateGroupId] = useState('');
  const [createGroupHub, setCreateGroupHub] = useState<GroupHubData | null>(null);
  const [saving, setSaving] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);

  const refreshDashboard = useCallback(() => request<DashboardData>('/dashboard').then(setData).catch((error: Error) => notify(error.message)), [notify]);
  useEffect(() => { void refreshDashboard(); }, [refreshDashboard]);
  useEffect(() => { setUnread(data?.notifications.filter((item) => !item.read).length ?? 0); }, [data]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('notification:new', () => void refreshDashboard());
    return () => { socket.disconnect(); };
  }, [refreshDashboard]);
  useEffect(() => {
    if (!notificationsOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setNotificationsOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);
  const days = useMemo(calendarDays, []);

  async function openCreateDialog() {
    setCreateOpen(true);
    setCreateGroupId('');
    setCreateGroupHub(null);
    try { setGroups(await request<GroupSummary[]>('/groups')); } catch (error) { notify(error instanceof Error ? error.message : 'Could not load your groups.'); }
  }
  async function pickCreateGroup(groupId: string) {
    setCreateGroupId(groupId);
    setCreateGroupHub(null);
    if (!groupId) return;
    try { setCreateGroupHub(await request<GroupHubData>(`/groups/${groupId}/hub`)); } catch (error) { notify(error instanceof Error ? error.message : 'Could not load group members.'); }
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createGroupId) return notify('Choose a group for this project.');
    const values = new FormData(event.currentTarget);
    const memberIds = values.getAll('memberIds').map(String);
    setSaving(true);
    try {
      await request('/projects', { method: 'POST', body: JSON.stringify({ groupId: createGroupId, title: values.get('title'), description: values.get('description'), startDate: values.get('startDate') || undefined, deadline: values.get('deadline') || undefined, memberIds }) });
      setCreateOpen(false);
      await refreshDashboard();
      notify('Project created.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the project.'); }
    finally { setSaving(false); }
  }

  if (!data) return <section className="sp on"><div className="cc">Loading your workspace…</div></section>;
  return <section className="sp on">
    <div className="ph"><div><h2>Dashboard</h2><div className="ph-sub dashboard-welcome">Welcome, {name}!</div></div><div className="ph-acts"><button className="ai-head-btn" title="WebSphere AI" onClick={() => onPage('assistant')}>✦</button><button className="new-btn" title="Create new project" onClick={() => void openCreateDialog()}>+</button><div className="notif-popover-wrap" ref={notificationsRef}><button className="notif-head-btn" title="Notifications" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><BellIcon />{unread ? <span className="notif-head-dot">{unread > 9 ? '9+' : unread}</span> : null}</button>{notificationsOpen ? <section className="notif-popover" role="dialog" aria-label="Notifications"><header className="notif-popover-header"><h3>Notifications</h3><button type="button" onClick={() => { setNotificationsOpen(false); onPage('notifications'); }}>View All</button></header><div className="notif-popover-list">{data.notifications.length ? data.notifications.slice(0, 4).map((item) => <div className={`notif-popover-item ${item.read ? 'read' : ''}`} key={item.id}><span className="notif-popover-dot" /><div><strong>{item.message}</strong><small>{item.read ? 'Read' : 'New'}</small></div></div>) : <p className="notif-popover-empty">You have no notifications yet.</p>}</div></section> : null}</div></div></div>
    {createOpen ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><div className="modal-box"><div className="modal-ttl"><span>New Project</span><button className="modal-close" onClick={() => setCreateOpen(false)}>×</button></div><form onSubmit={createProject}>
      <label className="lbl">Group</label><select className="ifield" value={createGroupId} onChange={(event) => void pickCreateGroup(event.target.value)} required><option value="">Select a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label className="lbl">Project Title</label><input className="ifield" name="title" required minLength={2} maxLength={180} placeholder="Project title" />
      <label className="lbl">Description</label><input className="ifield" name="description" required placeholder="Project description" />
      <label className="lbl">Start Date</label><input className="ifield" name="startDate" type="date" />
      <label className="lbl">Deadline</label><input className="ifield" name="deadline" type="date" />
      {createGroupHub ? <><label className="lbl">Members</label><div className="member-list">{createGroupHub.group.members.map((member) => <label key={member.userId} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '4px 0' }}><input type="checkbox" name="memberIds" value={member.userId} /> {member.user.fullName}</label>)}</div></> : null}
      <div className="modal-acts"><button type="button" className="btn-o" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Creating…' : 'Create Project'}</button></div>
    </form></div></div> : null}
    <div className="krow c3"><Kpi label="Active Projects" value={data.glance.activeProjects} tone="grn" /><Kpi label="Pending Tasks" value={data.glance.pendingTasks} tone="yel" /><Kpi label="Ideas Submitted" value={data.glance.ideasSubmitted} /></div>
    <div className="dashboard-main-grid"><div className="g2 dashboard-tables"><DataCard title="Recent Projects" action="View All" onAction={() => onPage('projects')}>{data.projects.length ? <table className="tbl"><thead><tr><th>Project</th><th>Group</th><th>Progress</th><th>Status</th></tr></thead><tbody>{data.projects.slice(0, 6).map((project) => { const completed = project.tasks.filter((task) => task.status === 'completed').length; const progress = project.tasks.length ? Math.round(completed / project.tasks.length * 100) : 0; return <tr key={project.id}><td className="table-title">{project.title}</td><td className="table-sub">{project.group.name}</td><td><div className="progress-cell"><div className="pb-wrap"><div className="pb" style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div></td><td><span className="bdg ac">{project.status}</span></td></tr>; })}</tbody></table> : <Empty text="Your recent projects will appear here after you create or join one." />}</DataCard><DataCard title="My Tasks" action="View All" onAction={() => onPage('tasks')}>{data.tasks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Status</th><th>Deadline</th></tr></thead><tbody>{data.tasks.slice(0, 6).map((task) => <tr key={task.id}><td className="table-title">{task.title}</td><td><span className="bdg y">{task.status}</span></td><td className="table-sub">{task.deadline ? new Date(task.deadline).toLocaleDateString() : 'Not set'}</td></tr>)}</tbody></table> : <Empty text="Tasks assigned to you will appear here." />}</DataCard></div><aside className="cc calendar-card"><div className="cc-head"><h3>{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><span className="calendar-arrows">‹ ›</span></div><div className="calendar-week">{['S','M','T','W','T','F','S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-grid">{days.map((day, index) => <span className={day === new Date().getDate() ? 'today' : ''} key={index}>{day || ''}</span>)}</div><p className="calendar-label">Today · {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p><div className="calendar-dashboard-empty">Your scheduled events will appear here.</div></aside></div>
    <div className="g2"><DataCard title="Upcoming Deadlines">{data.tasks.some((task) => task.deadline) ? data.tasks.filter((task) => task.deadline).slice(0, 5).map((task) => <div className="deadline-row" key={task.id}><span className="deadline-date">{new Date(task.deadline!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><strong>{task.title}</strong></div>) : <Empty text="Add tasks and due dates to see your upcoming deadlines." />}</DataCard><DataCard title="Team Activity"><Empty text="Your group activity will appear here once collaboration begins." /></DataCard></div>
    <div className="g2"><DataCard title="Project Progress Overview">{data.projects.length ? data.projects.slice(0, 5).map((project) => { const progress = project.tasks.length ? Math.round(project.tasks.filter((task) => task.status === 'completed').length / project.tasks.length * 100) : 0; return <div className="project-progress-row" key={project.id}><span>{project.title}</span><div className="pb-wrap"><div className="pb" style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></div>; }) : <Empty text="Project progress will appear here once you start working." />}</DataCard><DataCard title="Online"><Empty text="Group members will appear here after you invite them." /></DataCard></div>
    <div className="g2 bottom-grid"><DataCard title="Announcements">{data.notifications.length ? <div>{data.notifications.slice(0, 4).map((item) => <div className="notif-item" key={item.id}><span className="ndot"/><span><strong className="ntxt">{item.message}</strong><small className="ntime">{item.read ? 'Read' : 'New'}</small></span></div>)}</div> : <Empty text="Your announcements will appear here." />}</DataCard><DataCard title="Milestones & Achievements"><Empty text="Your milestones and achievements will appear here." /></DataCard></div>
    <button className="help-btn" onClick={() => notify('Tell us what you need help with and an administrator can follow up.')}>? Need Help?</button>
  </section>;
}

function DataCard({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) { return <section className="cc"><div className="cc-head"><h3>{title}</h3>{action ? <button className="btn btn-sm" onClick={onAction}>{action}</button> : null}</div>{children}</section>; }
function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) { return <div className="empty-message"><p>{text}</p>{action ? <button className="btn-o btn-sm" onClick={onAction}>{action}</button> : null}</div>; }
function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function calendarDays() { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay(); const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); return [...Array(first).fill(0), ...Array.from({ length: total }, (_, index) => index + 1)]; }
function BellIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>; }
