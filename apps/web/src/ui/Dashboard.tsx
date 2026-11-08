import { PROJECT_EXTERNAL_TOOLS, TASK_TITLE_MAX_LENGTH } from '@websphere/shared';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import type { GroupHub as GroupHubData, GroupSummary } from './types';
import { ScheduleDateFields } from './ScheduleDateFields';
import { dateOnlyKey, formatDateOnly, localDateFromKey } from './dates';
import { type Tone, avatarTone, dateKey, deadlineCountdown, deadlineHealth, initials, taskPriorityHealth, relativeTime, worstTone } from './health';
import { dashboardProjectProgress } from './dashboardProjectProgress';
import { useLocalDay } from './useLocalDay';
import { EventAnnouncementCard, type EventAnnouncement } from './EventAnnouncement';
import { upcomingDeadlines } from './upcomingDeadlines';

function DashboardAvatar({ name, id, avatarUrl, className }: { name: string; id: string; avatarUrl?: string | null; className: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const classes = `ava ${className} tone-${avatarTone(id)}`;
  if (avatarUrl && avatarUrl !== failedUrl) return <img className={`${classes} ava-image`} src={avatarUrl} alt="" aria-hidden="true" onError={() => setFailedUrl(avatarUrl)} />;
  return <span className={classes} aria-hidden="true">{initials(name)}</span>;
}

type DashboardProject = { id: string; title: string; status: string; deadline?: string | null; group: { name: string } | null; tasks: Array<{ status: string }>; _count?: { members: number } };
type DashboardTask = { id: string; title: string; status: string; priority?: string | null; deadline?: string | null; completedAt?: string | null; project?: { id: string; title: string } | null };
type DashboardNotification = { id: string; message: string; read: boolean; type?: string; createdAt?: string; relatedId?: string | null; relatedType?: string | null };
type DashboardActivity = { id: string; type: string; fromValue?: string | null; toValue?: string | null; createdAt: string; taskTitle?: string | null; projectTitle: string; actor?: { id: string; fullName: string; avatarUrl?: string | null } | null };
type DashboardTeammate = { id: string; fullName: string; avatarUrl?: string | null; role: string; groupName: string; online: boolean };
type DashboardMilestone = { id: string; kind: 'achievement' | 'award' | 'next'; icon: 'check' | 'star' | 'target'; title: string; detail: string; at: string };
type DashboardData = {
  glance: { activeProjects: number; pendingTasks: number; ideasSubmitted: number };
  projects: DashboardProject[];
  tasks: DashboardTask[];
  notifications: DashboardNotification[];
  activity?: DashboardActivity[];
  online?: DashboardTeammate[];
  announcements?: EventAnnouncement[];
  milestones?: DashboardMilestone[];
};
type DashboardProps = { userId: string; name: string; notify: (message: string) => void; onPage: (page: 'groups' | 'ideas' | 'projects' | 'tasks' | 'assistant' | 'notifications' | 'announcements') => void; onNotificationClick: (notification: DashboardNotification) => void };

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
/** Wins are green, awards are blue, and the milestone still ahead of you is red. */
const MILESTONE_TONE: Record<string, Tone> = { achievement: 'g', award: 'ac', next: 'r' };

export function Dashboard({ userId, name, notify, onPage, onNotificationClick }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [createGroupId, setCreateGroupId] = useState('');
  const [createGroupHub, setCreateGroupHub] = useState<GroupHubData | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSaving, setHelpSaving] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() }; });
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const groupRequestRef = useRef(0);
  const localDay = useLocalDay();
  const projectMembers = createGroupId
    ? (createGroupHub?.group.members ?? []).filter((member) => selectedMemberIds.includes(member.userId)).map((member) => ({ id: member.userId, name: member.user.fullName }))
    : [{ id: userId, name }];

  const refreshDashboard = useCallback(() => request<DashboardData>('/dashboard').then(setData).catch((error: Error) => notify(error.message)), [notify]);
  useEffect(() => { void refreshDashboard(); }, [refreshDashboard]);
  useEffect(() => { setUnread(data?.notifications.filter((item) => !item.read).length ?? 0); }, [data]);
  useEffect(() => {
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => {
      void request<Array<{ id: string }>>('/projects').then((projects) => projects.forEach((project) => socket.emit('project:join', project.id, () => undefined))).catch(() => undefined);
      void refreshDashboard();
    });
    socket.on('notification:new', () => void refreshDashboard());
    socket.on('task:updated', () => void refreshDashboard());
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

  /** Worst-case deadline tone per calendar day, so a red task always wins over a calm one. */
  const deadlineMarkers = useMemo(() => {
    const markers = new Map<string, { tone: Tone; items: string[] }>();
    function mark(date: string | null | undefined, label: string) {
      const health = deadlineHealth(date, localDay);
      if (!health || !date) return;
      const key = dateOnlyKey(date);
      const current = markers.get(key);
      markers.set(key, { tone: worstTone(current?.tone, health.tone), items: [...(current?.items ?? []), label] });
    }
    data?.tasks.forEach((task) => mark(task.deadline, task.title));
    data?.projects.forEach((project) => mark(project.deadline, `${project.title} (project)`));
    return markers;
  }, [data, localDay]);

  const monthCells = useMemo(() => monthMatrix(monthCursor.year, monthCursor.month), [monthCursor]);
  /** Overdue first, then soonest — matches the "Next 14 days" framing in the panel header. */
  const upcoming = useMemo(() => {
    return upcomingDeadlines(data?.tasks ?? [], localDay);
  }, [data, localDay]);

  /** Task-derived completion keeps the KPI and overview in sync with the project tables. */
  const activeProjects = useMemo(() => (data?.projects ?? []).filter((project) => project.status !== 'archived' && project.status !== 'on_hold' && dashboardProjectProgress(project.tasks, project.status).progress < 100), [data]);
  const onlineCount = useMemo(() => (data?.online ?? []).filter((teammate) => teammate.online).length, [data]);

  async function openCreateDialog() {
    groupRequestRef.current += 1;
    setCreateOpen(true);
    setCreateGroupId('');
    setCreateGroupHub(null);
    setSelectedMemberIds([]);
    try { setGroups(await request<GroupSummary[]>('/groups')); } catch (error) { notify(error instanceof Error ? error.message : 'Could not load your groups.'); }
  }
  async function pickCreateGroup(groupId: string) {
    const requestId = ++groupRequestRef.current;
    setCreateGroupId(groupId);
    setCreateGroupHub(null);
    setSelectedMemberIds([]);
    if (!groupId) return;
    try { const hub = await request<GroupHubData>(`/groups/${groupId}/hub`); if (requestId === groupRequestRef.current) setCreateGroupHub(hub); } catch (error) { if (requestId === groupRequestRef.current) notify(error instanceof Error ? error.message : 'Could not load group members.'); }
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const values = new FormData(event.currentTarget);
    const memberIds = projectMembers.map((member) => member.id);
    const initialTasks = memberIds.flatMap((assigneeId) => {
      const title = String(values.get(`responsibility-${assigneeId}`) ?? '').trim();
      return title ? [{ assigneeId, title }] : [];
    });
    setSaving(true);
    try {
      await request('/projects', { method: 'POST', body: JSON.stringify({ ...(createGroupId ? { groupId: createGroupId } : {}), title: values.get('title'), startDate: values.get('startDate') || undefined, deadline: values.get('deadline') || undefined, memberIds, initialTasks, externalTools: values.getAll('externalTools') }) });
      setCreateOpen(false);
      await refreshDashboard();
      notify(initialTasks.length ? 'Project created and tasks assigned.' : 'Project created.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the project.'); }
    finally { setSaving(false); }
  }
  function toggleProjectMember(userId: string) {
    setSelectedMemberIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }
  async function submitHelpTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setHelpSaving(true);
    try {
      await request('/support/tickets', { method: 'POST', body: JSON.stringify({ category: values.get('category'), subject: values.get('subject'), body: values.get('body') }) });
      setHelpOpen(false);
      notify('Your support request was sent to the administrators.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not send your support request.'); }
    finally { setHelpSaving(false); }
  }
  function activateNotification(item: DashboardNotification) {
    setData((current) => current ? { ...current, notifications: current.notifications.map((notification) => notification.id === item.id ? { ...notification, read: true } : notification) } : current);
    setNotificationsOpen(false);
    onNotificationClick(item);
  }
  function shiftMonth(step: number) {
    setMonthCursor((current) => { const next = new Date(current.year, current.month + step, 1); return { year: next.getFullYear(), month: next.getMonth() }; });
  }

  if (!data) return <section className="sp on dashboard-page"><div className="cc">Loading your workspace…</div></section>;
  const today = new Date();
  const todayKey = dateKey(today);
  return <section className="sp on dashboard-page">
    <div className="ph"><div><h2>Dashboard</h2><div className="ph-sub dashboard-welcome">Welcome, {name}!</div></div><div className="ph-acts"><button className="ai-head-btn" title="WebSphere AI" onClick={() => onPage('assistant')}>✦</button><button className="new-btn" title="Create new project" onClick={() => void openCreateDialog()}>+</button><div className="notif-popover-wrap" ref={notificationsRef}><button className="notif-head-btn" title="Notifications" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><BellIcon />{unread ? <span className="notif-head-dot">{unread > 9 ? '9+' : unread}</span> : null}</button>{notificationsOpen ? <section className="notif-popover" role="dialog" aria-label="Notifications"><header className="notif-popover-header"><h3>Notifications</h3><button type="button" onClick={() => { setNotificationsOpen(false); onPage('notifications'); }}>View All</button></header><div className="notif-popover-list">{data.notifications.length ? data.notifications.slice(0, 4).map((item) => <button type="button" className={`notif-popover-item ${item.read ? 'read' : ''}`} key={item.id} onClick={() => activateNotification(item)}><span className="notif-popover-dot" /><span><strong>{item.message}</strong><small>{item.createdAt ? relativeTime(item.createdAt) : item.read ? 'Read' : 'New'}</small></span></button>) : <p className="notif-popover-empty">You have no notifications yet.</p>}</div></section> : null}</div></div></div>
    {createOpen ? <div className="modal-ov open project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><div className="modal-box project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><div className="modal-ttl"><div><span id="project-modal-title">Create New Project</span><small>New Project Details</small></div><button type="button" className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close new project form">×</button></div><form className="project-create-form" onSubmit={createProject}>
      <label className="lbl" htmlFor="project-title">Project Name</label><input className="ifield" id="project-title" name="title" required minLength={2} maxLength={180} placeholder="Enter project name" />
      <label className="lbl" htmlFor="project-group">Project Group</label><select className="ifield" id="project-group" value={createGroupId} onChange={(event) => void pickCreateGroup(event.target.value)}><option value="">No group — independent project</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label className="lbl">Team Members</label><fieldset className="project-member-picker" disabled={!createGroupId || !createGroupHub}><legend className="sr-only">Team Members</legend>{!createGroupId ? <label className="project-member-option"><input type="checkbox" checked readOnly /><span>{name}</span></label> : createGroupHub ? createGroupHub.group.members.map((member) => <label className="project-member-option" key={member.userId}><input type="checkbox" checked={selectedMemberIds.includes(member.userId)} onChange={() => toggleProjectMember(member.userId)} /><span>{member.user.fullName}</span></label>) : <span>Group members are unavailable.</span>}</fieldset>
      <label className="lbl">Task Assignment Per Member</label><div className={`project-responsibilities ${projectMembers.length ? '' : 'empty'}`}>{projectMembers.length ? projectMembers.map((member) => <label key={member.id}><span>{member.name}</span><input className="ifield" name={`responsibility-${member.id}`} minLength={2} maxLength={TASK_TITLE_MAX_LENGTH} title={`Maximum ${TASK_TITLE_MAX_LENGTH} characters`} placeholder={`Assign ${member.name} a task`} /></label>) : <span>Add members first, then assign tasks here.</span>}</div>
      <fieldset className="project-tools-picker" disabled={saving}><legend className="lbl">External Tools Will Be Used</legend><p>Select all tools you plan to use.</p><div>{Object.entries(PROJECT_EXTERNAL_TOOLS).map(([value, label]) => <label className="project-tool-option" key={value}><input type="checkbox" name="externalTools" value={value} /><span>{label}</span></label>)}</div></fieldset>
      <div className="project-date-grid"><ScheduleDateFields idPrefix="new-project" endLabel="End Date" /></div>
      <div className="modal-acts project-modal-actions"><button type="button" className="btn-o" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Creating…' : 'Create Project'}</button></div>
    </form></div></div> : null}
    {helpOpen ? <div className="modal-ov open support-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}><div className="modal-box support-modal" role="dialog" aria-modal="true" aria-labelledby="support-request-title"><div className="modal-ttl"><div><span id="support-request-title">Request support</span><small>Tell the WebSphere administrators what you need.</small></div><button type="button" className="modal-close" onClick={() => setHelpOpen(false)} aria-label="Close support request">×</button></div><form onSubmit={submitHelpTicket}>
      <label className="lbl" htmlFor="support-category">Category</label><select className="ifield" id="support-category" name="category" defaultValue="bug_report"><option value="bug_report">Report a problem</option><option value="account_reactivation">Account access</option><option value="password_concern">Password concern</option><option value="account_deletion">Account deletion</option><option value="other">Other request</option></select>
      <label className="lbl" htmlFor="support-subject">Subject</label><input className="ifield" id="support-subject" name="subject" required minLength={2} maxLength={180} placeholder="Briefly describe the issue" />
      <label className="lbl" htmlFor="support-details">Details</label><textarea className="ifield support-details" id="support-details" name="body" required minLength={1} placeholder="Include anything that will help us understand the request." />
      <div className="modal-acts"><button type="button" className="btn-o" onClick={() => setHelpOpen(false)}>Cancel</button><button className="btn" disabled={helpSaving}>{helpSaving ? 'Sending…' : 'Send request'}</button></div>
    </form></div></div> : null}
    <div className="krow c3"><Kpi label="Active Projects" value={activeProjects.length} tone="grn" /><Kpi label="Pending Tasks" value={data.glance.pendingTasks} tone="yel" /><Kpi label="Ideas Submitted" value={data.glance.ideasSubmitted} /></div>
    <div className="dashboard-main-grid">
      <div className="g2 dashboard-tables">
        <DataCard title="Recent Projects" action="View All" onAction={() => onPage('projects')}>
          {data.projects.length ? <div className="dashboard-table-scroll" role="region" aria-label="Recent projects" tabIndex={0}><table className="tbl"><thead><tr><th>Project</th><th>Progress</th><th>Status</th></tr></thead><tbody>{data.projects.slice(0, 8).map((project) => {
            const { progress, health } = dashboardProjectProgress(project.tasks, project.status);
            return <tr key={project.id}>
              <td className="table-title">{project.title}</td>
              <td><div className="progress-cell"><div className="pb-wrap"><div className={`pb ${health.tone}`} style={{ width: `${progress}%` }} /></div><span className={`pb-val ${health.tone}`}>{progress}%</span></div></td>
              <td><span className={`bdg ${health.tone}`}>{health.label}</span></td>
            </tr>;
          })}</tbody></table></div> : <Empty text="Your recent projects will appear here after you create or join one." />}
        </DataCard>
        <DataCard title="My Tasks" action="View All" onAction={() => onPage('tasks')}>
          {data.tasks.length ? <div className="dashboard-table-scroll" role="region" aria-label="My tasks" tabIndex={0}><table className="tbl"><thead><tr><th>Task</th><th>Project</th><th>Deadline</th><th>Priority</th></tr></thead><tbody>{data.tasks.slice(0, 8).map((task) => {
            const priority = taskPriorityHealth(task, localDay);
            const due = task.status !== 'completed' && task.deadline ? priority : deadlineHealth(task.deadline);
            return <tr key={task.id}>
              <td className="table-title">{task.title}</td>
              <td className="table-sub">{task.project?.title ?? '—'}</td>
              <td className={`table-sub ${due ? `due-${due.tone}` : ''}`}>{formatDateOnly(task.deadline, { month: 'short', day: 'numeric' })}</td>
              <td><span className={`bdg ${priority.tone}`}>{priority.label}</span></td>
            </tr>;
          })}</tbody></table></div> : <Empty text="Tasks assigned to you will appear here." />}
        </DataCard>
      </div>
      <aside className="cc calendar-card">
        <div className="cc-head"><h3>{new Date(monthCursor.year, monthCursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><span className="calendar-arrows"><button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button><button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">›</button></span></div>
        <div className="calendar-week">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{monthCells.map((cell) => {
          const key = dateKey(cell.date);
          const marker = deadlineMarkers.get(key);
          const isToday = key === todayKey;
          return <span
            className={`${isToday ? 'today' : ''} ${cell.inMonth ? '' : 'outside'} ${marker ? 'has-deadline' : ''}`}
            key={key}
            title={marker ? `${marker.items.length} due: ${marker.items.join(', ')}` : undefined}
          >{cell.day}{marker ? <em className={`calendar-day-dot ${marker.tone}`} /> : null}</span>;
        })}</div>
        <div className="calendar-legend"><span><i className="calendar-day-dot r" />Urgent</span><span><i className="calendar-day-dot y" />Due soon</span><span><i className="calendar-day-dot ac" />On track</span></div>
        <p className="calendar-label">Today is {today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </aside>
    </div>
    <div className="g2">
      <DataCard title="Upcoming Deadlines" note="Next 14 days">
        {upcoming.length ? upcoming.map(({ task, health }) => <div className={`deadline-row tone-${health.tone}`} key={task.id}>
          <span className={`deadline-date ${health.tone}`}><strong>{localDateFromKey(dateOnlyKey(task.deadline!)).getDate()}</strong><small>{formatDateOnly(task.deadline, { month: 'short' }).toUpperCase()}</small></span>
          <span className="deadline-copy"><strong>{task.title}</strong><small>{task.project?.title ?? 'Unassigned project'} · {deadlineCountdown(health.days)}</small></span>
          <span className={`bdg ${task.status === 'completed' ? 'g' : health.tone}`}>{task.status === 'completed' ? 'Completed' : health.label}</span>
        </div>) : <Empty text="Nothing is due in the next 14 days. Add tasks with due dates to see them here." />}
      </DataCard>
      <DataCard title="Team Activity" note="Live feed">
        {data.activity?.length ? <div className="activity-list">{data.activity.map((event) => {
          const actorName = event.actor?.fullName ?? 'A teammate';
          const described = describeActivity(event);
          return <div className="activity-row" key={event.id}>
            <DashboardAvatar className="activity-avatar" id={event.actor?.id ?? actorName} name={actorName} avatarUrl={event.actor?.avatarUrl} />
            <span className="activity-copy"><strong>{actorName} <span className="activity-verb">{described.verb}</span> {described.target}</strong><small>{relativeTime(event.createdAt)}</small></span>
          </div>;
        })}</div> : <Empty text="Your group activity will appear here once collaboration begins." />}
      </DataCard>
    </div>
    <div className="g2">
      <DataCard title="Project Progress Overview" note="All active projects">
        {activeProjects.length ? activeProjects.slice(0, 4).map((project) => {
          const { progress, health } = dashboardProjectProgress(project.tasks, project.status);
          const members = project._count?.members ?? 0;
          return <div className="progress-item" key={project.id}>
            <div className="progress-item-head">
              <span className="progress-item-copy"><strong>{project.title}</strong><small>{[project.group?.name ?? 'Independent', members ? `${members} member${members === 1 ? '' : 's'}` : null, project.deadline ? `Due ${formatDateOnly(project.deadline, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}</small></span>
              <strong className={`pb-val ${health.tone}`}>{progress}%</strong>
            </div>
            <div className="pb-wrap"><div className={`pb ${health.tone}`} style={{ width: `${progress}%` }} /></div>
          </div>;
        }) : <Empty text="Project progress will appear here once you start working." />}
      </DataCard>
      <DataCard title="Online" note={onlineCount ? `${onlineCount} now online` : 'Now online'}>
        {data.online?.length ? <div className="roster-list">{data.online.map((teammate) => <div className="roster-row" key={teammate.id}>
          <DashboardAvatar className="roster-avatar" id={teammate.id} name={teammate.fullName} avatarUrl={teammate.avatarUrl} />
          <span className="roster-copy"><strong>{teammate.fullName}</strong><small>{teammate.groupName}{teammate.role === 'Project_Leader' ? ' · Leader' : ''}</small></span>
          <span className={`roster-status ${teammate.online ? 'on' : ''}`} title={teammate.online ? 'Online' : 'Offline'}><span className="sr-only">{teammate.online ? 'Online' : 'Offline'}</span></span>
        </div>)}</div> : <Empty text="Group members will appear here after you invite them." />}
      </DataCard>
    </div>
    <div className="g2 bottom-grid">
      <DataCard title="Announcements" action="View All" onAction={() => onPage('announcements')}>
        {data.announcements?.length ? <div className="announce-list">{data.announcements.map((event) => <EventAnnouncementCard key={event.id} event={event} />)}</div> : <Empty text="Calendar events will appear here." />}
      </DataCard>
      <DataCard title="Milestones &amp; Achievements">
        {data.milestones?.length ? <div className="milestone-list">{data.milestones.map((item) => {
          const tone = MILESTONE_TONE[item.kind] ?? 'ac';
          return <div className={`milestone-row tone-${tone}`} key={item.id}>
            <span className={`milestone-badge ${tone}`} aria-hidden="true"><MilestoneIcon icon={item.icon} /></span>
            <span className="milestone-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
          </div>;
        })}</div> : <Empty text="Finish a task or project and your milestones will show up here." />}
      </DataCard>
    </div>
    <div className="help-actions"><button className="help-btn" type="button" onClick={() => setHelpOpen(true)} aria-haspopup="dialog"><SupportIcon />Need help?</button></div>
  </section>;
}

/** Turns a workflow event into "<verb> <target>" phrasing for the activity feed. */
function describeActivity(event: DashboardActivity): { verb: string; target: string } {
  const task = event.taskTitle ?? 'a task';
  if (event.type === 'task_completed') return { verb: 'completed task', target: task };
  if (event.type === 'assignment_change') return { verb: 'reassigned', target: task };
  if (event.type === 'progress_activity') {
    if (event.fromValue === 'resource_linked') return { verb: 'uploaded', target: event.toValue ?? 'a file' };
    return { verb: 'updated progress on', target: task };
  }
  if (event.type === 'status_change') return { verb: 'moved', target: `${task} to ${readableStatus(event.toValue)}` };
  return { verb: 'updated', target: `${task} in ${event.projectTitle}` };
}
function readableStatus(status?: string | null) { return String(status ?? 'a new status').replace(/_/g, ' '); }

/** Leading and trailing cells come from the neighbouring months so the grid always fills whole weeks. */
function monthMatrix(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells: Array<{ day: number; inMonth: boolean; date: Date }> = [];
  for (let offset = firstWeekday - 1; offset >= 0; offset -= 1) {
    const day = daysInPrevMonth - offset;
    cells.push({ day, inMonth: false, date: new Date(year, month - 1, day) });
  }
  for (let day = 1; day <= daysInMonth; day += 1) cells.push({ day, inMonth: true, date: new Date(year, month, day) });
  let trailing = 1;
  while (cells.length % 7 !== 0) { cells.push({ day: trailing, inMonth: false, date: new Date(year, month + 1, trailing) }); trailing += 1; }
  return cells;
}

function DataCard({ title, action, note, onAction, children }: { title: string; action?: string; note?: string; onAction?: () => void; children: React.ReactNode }) { return <section className="cc"><div className="cc-head"><h3>{title}</h3>{action ? <button className="btn btn-sm" onClick={onAction}>{action}</button> : note ? <span className="cc-note">{note}</span> : null}</div>{children}</section>; }
function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) { return <div className="empty-message"><p>{text}</p>{action ? <button className="btn-o btn-sm" onClick={onAction}>{action}</button> : null}</div>; }
function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function MilestoneIcon({ icon }: { icon: 'check' | 'star' | 'target' }) {
  const shared = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (icon === 'check') return <svg {...shared}><path d="M20 6 9 17l-5-5" /></svg>;
  if (icon === 'star') return <svg {...shared} strokeWidth={2} fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>;
  return <svg {...shared} strokeWidth={2.4}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
}
function BellIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>; }
function SupportIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-1-2.7V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/><path d="M9.5 10a2.5 2.5 0 1 1 4.2 1.8c-.9.7-1.7 1.2-1.7 2.2M12 17h.01"/></svg>; }
