import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import type { GroupHub as GroupHubData, GroupSummary } from './types';
import { type Tone, avatarTone, dateKey, deadlineCountdown, deadlineHealth, initials, priorityHealth, projectHealth, relativeTime, worstTone } from './health';

type DashboardProject = { id: string; title: string; status: string; deadline?: string | null; group: { name: string }; tasks: Array<{ status: string }>; _count?: { members: number } };
type DashboardTask = { id: string; title: string; status: string; priority?: string | null; deadline?: string | null; project?: { id: string; title: string } | null };
type DashboardNotification = { id: string; message: string; read: boolean; createdAt?: string; relatedId?: string | null; relatedType?: string | null };
type DashboardActivity = { id: string; type: string; fromValue?: string | null; toValue?: string | null; createdAt: string; taskTitle?: string | null; projectTitle: string; actor?: { id: string; fullName: string; avatarUrl?: string | null } | null };
type DashboardTeammate = { id: string; fullName: string; avatarUrl?: string | null; role: string; groupName: string; online: boolean };
type DashboardAnnouncement = { id: string; title: string; body: string; priority: 'normal' | 'important' | 'urgent'; createdAt: string; groupName: string; authorName: string; authorRole: string };
type DashboardMilestone = { id: string; kind: 'achievement' | 'award' | 'next'; icon: 'check' | 'star' | 'target'; title: string; detail: string; at: string };
type DashboardData = {
  glance: { activeProjects: number; pendingTasks: number; ideasSubmitted: number };
  projects: DashboardProject[];
  tasks: DashboardTask[];
  notifications: DashboardNotification[];
  activity?: DashboardActivity[];
  online?: DashboardTeammate[];
  announcements?: DashboardAnnouncement[];
  milestones?: DashboardMilestone[];
};
type DashboardProps = { name: string; notify: (message: string) => void; onPage: (page: 'groups' | 'ideas' | 'projects' | 'tasks' | 'assistant' | 'notifications') => void; onNotificationClick: (notification: DashboardNotification) => void };

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
/** Announcement priority reuses the same scale: urgent demands attention, normal is routine. */
const ANNOUNCEMENT_TONE: Record<string, Tone> = { urgent: 'r', important: 'y', normal: 'ac' };
/** Wins are green, awards are blue, and the milestone still ahead of you is red. */
const MILESTONE_TONE: Record<string, Tone> = { achievement: 'g', award: 'ac', next: 'r' };

export function Dashboard({ name, notify, onPage, onNotificationClick }: DashboardProps) {
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

  /** Worst-case deadline tone per calendar day, so a red task always wins over a calm one. */
  const deadlineMarkers = useMemo(() => {
    const markers = new Map<string, { tone: Tone; items: string[] }>();
    function mark(date: string | null | undefined, label: string) {
      const health = deadlineHealth(date);
      if (!health || !date) return;
      const key = dateKey(date);
      const current = markers.get(key);
      markers.set(key, { tone: worstTone(current?.tone, health.tone), items: [...(current?.items ?? []), label] });
    }
    data?.tasks.forEach((task) => mark(task.deadline, task.title));
    data?.projects.forEach((project) => mark(project.deadline, `${project.title} (project)`));
    return markers;
  }, [data]);

  const monthCells = useMemo(() => monthMatrix(monthCursor.year, monthCursor.month), [monthCursor]);
  /** Overdue first, then soonest — matches the "Next 14 days" framing in the panel header. */
  const upcoming = useMemo(() => {
    return (data?.tasks ?? [])
      .filter((task) => task.deadline)
      .map((task) => ({ task, health: deadlineHealth(task.deadline)! }))
      .filter((entry) => entry.health.days <= 14)
      .sort((a, b) => a.health.days - b.health.days)
      .slice(0, 5);
  }, [data]);

  /** The panel header says "All active projects", so archived and completed work is filtered out. */
  const activeProjects = useMemo(() => (data?.projects ?? []).filter((project) => project.status === 'active'), [data]);
  const onlineCount = useMemo(() => (data?.online ?? []).filter((teammate) => teammate.online).length, [data]);

  async function openCreateDialog() {
    setCreateOpen(true);
    setCreateGroupId('');
    setCreateGroupHub(null);
    setSelectedMemberIds([]);
    try { setGroups(await request<GroupSummary[]>('/groups')); } catch (error) { notify(error instanceof Error ? error.message : 'Could not load your groups.'); }
  }
  async function pickCreateGroup(groupId: string) {
    setCreateGroupId(groupId);
    setCreateGroupHub(null);
    setSelectedMemberIds([]);
    if (!groupId) return;
    try { setCreateGroupHub(await request<GroupHubData>(`/groups/${groupId}/hub`)); } catch (error) { notify(error instanceof Error ? error.message : 'Could not load group members.'); }
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createGroupId) return notify('Choose a group for this project.');
    const values = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const project = await request<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ groupId: createGroupId, title: values.get('title'), description: values.get('description'), startDate: values.get('startDate') || undefined, deadline: values.get('deadline') || undefined, memberIds: selectedMemberIds }) });
      await Promise.all(selectedMemberIds.map(async (userId) => {
        const responsibility = String(values.get(`responsibility-${userId}`) ?? '').trim();
        if (responsibility) await request(`/projects/${project.id}/team/${userId}`, { method: 'PATCH', body: JSON.stringify({ responsibility }) });
      }));
      setCreateOpen(false);
      await refreshDashboard();
      notify('Project created.');
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

  if (!data) return <section className="sp on"><div className="cc">Loading your workspace…</div></section>;
  const today = new Date();
  const todayKey = dateKey(today);
  return <section className="sp on">
    <div className="ph"><div><h2>Dashboard</h2><div className="ph-sub dashboard-welcome">Welcome, {name}!</div></div><div className="ph-acts"><button className="ai-head-btn" title="WebSphere AI" onClick={() => onPage('assistant')}>✦</button><button className="new-btn" title="Create new project" onClick={() => void openCreateDialog()}>+</button><div className="notif-popover-wrap" ref={notificationsRef}><button className="notif-head-btn" title="Notifications" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><BellIcon />{unread ? <span className="notif-head-dot">{unread > 9 ? '9+' : unread}</span> : null}</button>{notificationsOpen ? <section className="notif-popover" role="dialog" aria-label="Notifications"><header className="notif-popover-header"><h3>Notifications</h3><button type="button" onClick={() => { setNotificationsOpen(false); onPage('notifications'); }}>View All</button></header><div className="notif-popover-list">{data.notifications.length ? data.notifications.slice(0, 4).map((item) => <button type="button" className={`notif-popover-item ${item.read ? 'read' : ''}`} key={item.id} onClick={() => activateNotification(item)}><span className="notif-popover-dot" /><span><strong>{item.message}</strong><small>{item.createdAt ? relativeTime(item.createdAt) : item.read ? 'Read' : 'New'}</small></span></button>) : <p className="notif-popover-empty">You have no notifications yet.</p>}</div></section> : null}</div></div></div>
    {createOpen ? <div className="modal-ov open project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><div className="modal-box project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><div className="modal-ttl"><div><span id="project-modal-title">Create New Project</span><small>New Project Details</small></div><button type="button" className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close new project form">×</button></div><form className="project-create-form" onSubmit={createProject}>
      <label className="lbl" htmlFor="project-title">Project Name</label><input className="ifield" id="project-title" name="title" required minLength={2} maxLength={180} placeholder="Enter project name" />
      <label className="lbl" htmlFor="project-group">Project Group</label><select className="ifield" id="project-group" value={createGroupId} onChange={(event) => void pickCreateGroup(event.target.value)} required><option value="">Select project group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label className="lbl">Team Members</label><fieldset className="project-member-picker" disabled={!createGroupHub}><legend className="sr-only">Team Members</legend>{createGroupHub ? createGroupHub.group.members.map((member) => <label className="project-member-option" key={member.userId}><input type="checkbox" checked={selectedMemberIds.includes(member.userId)} onChange={() => toggleProjectMember(member.userId)} /><span>{member.user.fullName}</span></label>) : <span>Add members by selecting a project group first.</span>}</fieldset>
      <label className="lbl">Task Assignment Per Member</label><div className={`project-responsibilities ${selectedMemberIds.length ? '' : 'empty'}`}>{selectedMemberIds.length ? createGroupHub?.group.members.filter((member) => selectedMemberIds.includes(member.userId)).map((member) => <label key={member.userId}><span>{member.user.fullName}</span><input className="ifield" name={`responsibility-${member.userId}`} placeholder={`Assign ${member.user.fullName} a responsibility`} /></label>) : <span>Add members first, then assign responsibilities here.</span>}</div>
      <label className="lbl" htmlFor="external-tools">External Tools Will Be Used</label><select className="ifield project-tools-select" id="external-tools" name="externalTools" defaultValue="" aria-label="External tools used for this project"><option value="" disabled>Select external tools</option><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365</option><option value="figma">Figma</option><option value="trello">Trello</option><option value="asana">Asana</option></select>
      <div className="project-date-grid"><div><label className="lbl" htmlFor="project-start-date">Start Date</label><input className="ifield" id="project-start-date" name="startDate" type="date" /></div><div><label className="lbl" htmlFor="project-deadline">End Date / Deadline</label><input className="ifield" id="project-deadline" name="deadline" type="date" /></div></div>
      <label className="lbl" htmlFor="project-description">Project Description</label><textarea className="ifield project-description" id="project-description" name="description" required placeholder="Describe the project goals and scope…" />
      <div className="modal-acts project-modal-actions"><button type="button" className="btn-o" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Creating…' : 'Create Project'}</button></div>
    </form></div></div> : null}
    {helpOpen ? <div className="modal-ov open support-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}><div className="modal-box support-modal" role="dialog" aria-modal="true" aria-labelledby="support-request-title"><div className="modal-ttl"><div><span id="support-request-title">Request support</span><small>Tell the WebSphere administrators what you need.</small></div><button type="button" className="modal-close" onClick={() => setHelpOpen(false)} aria-label="Close support request">×</button></div><form onSubmit={submitHelpTicket}>
      <label className="lbl" htmlFor="support-category">Category</label><select className="ifield" id="support-category" name="category" defaultValue="bug_report"><option value="bug_report">Report a problem</option><option value="account_reactivation">Account access</option><option value="password_concern">Password concern</option><option value="account_deletion">Account deletion</option><option value="other">Other request</option></select>
      <label className="lbl" htmlFor="support-subject">Subject</label><input className="ifield" id="support-subject" name="subject" required minLength={2} maxLength={180} placeholder="Briefly describe the issue" />
      <label className="lbl" htmlFor="support-details">Details</label><textarea className="ifield support-details" id="support-details" name="body" required minLength={1} placeholder="Include anything that will help us understand the request." />
      <div className="modal-acts"><button type="button" className="btn-o" onClick={() => setHelpOpen(false)}>Cancel</button><button className="btn" disabled={helpSaving}>{helpSaving ? 'Sending…' : 'Send request'}</button></div>
    </form></div></div> : null}
    <div className="krow c3"><Kpi label="Active Projects" value={data.glance.activeProjects} tone="grn" /><Kpi label="Pending Tasks" value={data.glance.pendingTasks} tone="yel" /><Kpi label="Ideas Submitted" value={data.glance.ideasSubmitted} /></div>
    <div className="dashboard-main-grid">
      <div className="g2 dashboard-tables">
        <DataCard title="Recent Projects" action="View All" onAction={() => onPage('projects')}>
          {data.projects.length ? <table className="tbl"><thead><tr><th>Project</th><th>Course</th><th>Progress</th><th>Status</th></tr></thead><tbody>{data.projects.slice(0, 8).map((project) => {
            const completed = project.tasks.filter((task) => task.status === 'completed').length;
            const progress = project.tasks.length ? Math.round(completed / project.tasks.length * 100) : 0;
            const health = projectHealth(progress, project.status);
            return <tr key={project.id}>
              <td className="table-title">{project.title}</td>
              <td className="table-sub">{project.group.name}</td>
              <td><div className="progress-cell"><div className="pb-wrap"><div className={`pb ${health.tone}`} style={{ width: `${progress}%` }} /></div><span className={`pb-val ${health.tone}`}>{progress}%</span></div></td>
              <td><span className={`bdg ${health.tone}`}>{health.label}</span></td>
            </tr>;
          })}</tbody></table> : <Empty text="Your recent projects will appear here after you create or join one." />}
        </DataCard>
        <DataCard title="My Tasks" action="View All" onAction={() => onPage('tasks')}>
          {data.tasks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Project</th><th>Deadline</th><th>Priority</th></tr></thead><tbody>{data.tasks.slice(0, 8).map((task) => {
            const priority = priorityHealth(task.priority);
            const due = deadlineHealth(task.deadline);
            return <tr key={task.id}>
              <td className="table-title">{task.title}</td>
              <td className="table-sub">{task.project?.title ?? '—'}</td>
              <td className={`table-sub ${due ? `due-${due.tone}` : ''}`}>{task.deadline ? new Date(task.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Not set'}</td>
              <td><span className={`bdg ${priority.tone}`}>{priority.label}</span></td>
            </tr>;
          })}</tbody></table> : <Empty text="Tasks assigned to you will appear here." />}
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
        <div className="calendar-legend"><span><i className="calendar-day-dot r" />Urgent</span><span><i className="calendar-day-dot y" />Soon</span><span><i className="calendar-day-dot ac" />On track</span></div>
        <p className="calendar-label">Today is {today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </aside>
    </div>
    <div className="g2">
      <DataCard title="Upcoming Deadlines" note="Next 14 days">
        {upcoming.length ? upcoming.map(({ task, health }) => <div className={`deadline-row tone-${health.tone}`} key={task.id}>
          <span className={`deadline-date ${health.tone}`}><strong>{new Date(task.deadline!).getDate()}</strong><small>{new Date(task.deadline!).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</small></span>
          <span className="deadline-copy"><strong>{task.title}</strong><small>{task.project?.title ?? 'Unassigned project'} · {deadlineCountdown(health.days)}</small></span>
          <span className={`bdg ${health.tone}`}>{health.label}</span>
        </div>) : <Empty text="Nothing is due in the next 14 days. Add tasks with due dates to see them here." />}
      </DataCard>
      <DataCard title="Team Activity" note="Live feed">
        {data.activity?.length ? <div className="activity-list">{data.activity.map((event) => {
          const actorName = event.actor?.fullName ?? 'A teammate';
          const described = describeActivity(event);
          return <div className="activity-row" key={event.id}>
            <span className={`activity-avatar ava tone-${avatarTone(event.actor?.id ?? actorName)}`} aria-hidden="true">{initials(actorName)}</span>
            <span className="activity-copy"><strong>{actorName} <span className="activity-verb">{described.verb}</span> {described.target}</strong><small>{relativeTime(event.createdAt)}</small></span>
          </div>;
        })}</div> : <Empty text="Your group activity will appear here once collaboration begins." />}
      </DataCard>
    </div>
    <div className="g2">
      <DataCard title="Project Progress Overview" note="All active projects">
        {activeProjects.length ? activeProjects.slice(0, 4).map((project) => {
          const progress = project.tasks.length ? Math.round(project.tasks.filter((task) => task.status === 'completed').length / project.tasks.length * 100) : 0;
          const health = projectHealth(progress, project.status);
          const members = project._count?.members ?? 0;
          return <div className="progress-item" key={project.id}>
            <div className="progress-item-head">
              <span className="progress-item-copy"><strong>{project.title}</strong><small>{[project.group.name, members ? `${members} member${members === 1 ? '' : 's'}` : null, project.deadline ? `Due ${new Date(project.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}</small></span>
              <strong className={`pb-val ${health.tone}`}>{progress}%</strong>
            </div>
            <div className="pb-wrap"><div className={`pb ${health.tone}`} style={{ width: `${progress}%` }} /></div>
          </div>;
        }) : <Empty text="Project progress will appear here once you start working." />}
      </DataCard>
      <DataCard title="Online" note={onlineCount ? `${onlineCount} now online` : 'Now online'}>
        {data.online?.length ? <div className="roster-list">{data.online.map((teammate) => <div className="roster-row" key={teammate.id}>
          <span className={`ava roster-avatar tone-${avatarTone(teammate.id)}`} aria-hidden="true">{initials(teammate.fullName)}</span>
          <span className="roster-copy"><strong>{teammate.fullName}</strong><small>{teammate.groupName}{teammate.role === 'Project_Leader' ? ' · Leader' : ''}</small></span>
          <span className={`roster-status ${teammate.online ? 'on' : ''}`} title={teammate.online ? 'Online' : 'Offline'}><span className="sr-only">{teammate.online ? 'Online' : 'Offline'}</span></span>
        </div>)}</div> : <Empty text="Group members will appear here after you invite them." />}
      </DataCard>
    </div>
    <div className="g2 bottom-grid">
      <DataCard title="Announcements" action="View All" onAction={() => onPage('notifications')}>
        {data.announcements?.length ? <div className="announce-list">{data.announcements.map((item) => {
          const tone = ANNOUNCEMENT_TONE[item.priority] ?? 'ac';
          return <article className={`announce-row tone-${tone}`} key={item.id}>
            <div className="announce-head"><strong>{item.title}</strong><small>{relativeTime(item.createdAt)}</small></div>
            <p>{item.body}</p>
            <cite>— {item.authorName}{item.authorRole === 'Project_Leader' ? ', Leader' : ''} · {item.groupName}</cite>
          </article>;
        })}</div> : <Empty text="Announcements from your group leaders will appear here." />}
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
    <button className="help-btn" type="button" onClick={() => setHelpOpen(true)} aria-haspopup="dialog"><SupportIcon />Need help?</button>
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
