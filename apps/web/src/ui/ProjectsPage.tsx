import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';

type Project = { id: string; title: string; description: string; status: string; deadline?: string | null; group: { name: string }; members?: Array<{ role: string }>; tasks: Array<{ id: string; status: string }> };
type ProjectTask = { id: string; title: string; description: string; deadline?: string | null; priority: string; status: string; assignments: Array<{ assigneeId: string }> };
type Member = { userId: string; role: string; responsibility?: string | null; user: { id: string; fullName: string } };
type ProjectDetail = { id: string; title: string; description: string; status: string; deadline?: string | null; group: { members: Member[] }; members: Member[]; tasks: ProjectTask[] };

export function ProjectsPage({ notify }: { notify: (message: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const refreshProjects = () => request<Project[]>('/projects').then(setProjects).catch((error: Error) => notify(error.message));
  useEffect(() => { void refreshProjects(); }, [notify]);

  const selectedProject = useMemo(() => projects?.find((project) => project.id === selectedProjectId), [projects, selectedProjectId]);
  const leader = selectedProject?.members?.[0]?.role === 'Project_Leader';

  async function openTasks(projectId: string) {
    setSelectedProjectId(projectId);
    setDetail(null);
    setLoadingDetail(true);
    try { setDetail(await request<ProjectDetail>(`/projects/${projectId}`)); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not load project tasks.'); }
    finally { setLoadingDetail(false); }
  }

  async function refreshTasks() {
    if (selectedProjectId) await openTasks(selectedProjectId);
  }

  useEffect(() => {
    if (!selectedProjectId) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => socket.emit('project:join', selectedProjectId, () => undefined));
    socket.on('task:updated', () => { void refreshTasks(); });
    return () => { socket.disconnect(); };
  }, [selectedProjectId]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const assigneeId = String(values.get('assigneeId') ?? '');
    setSaving(true);
    try {
      const task = await request<{ id: string }>(`/projects/${detail.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: values.get('title'), description: values.get('description'), deadline: values.get('deadline') || undefined, priority: values.get('priority') }) });
      if (assigneeId) { await request(`/projects/${detail.id}/members`, { method: 'POST', body: JSON.stringify({ userId: assigneeId }) }); await request(`/tasks/${task.id}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) }); }
      form.reset();
      await refreshTasks();
      notify(assigneeId ? 'Task created and assigned.' : 'Task created.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the task.'); }
    finally { setSaving(false); }
  }

  async function assignTask(event: FormEvent<HTMLFormElement>, taskId: string) {
    event.preventDefault();
    const assigneeId = String(new FormData(event.currentTarget).get('assigneeId') ?? '');
    if (!assigneeId) return notify('Choose a project member.');
    setSaving(true);
    try {
      if (detail) await request(`/projects/${detail.id}/members`, { method: 'POST', body: JSON.stringify({ userId: assigneeId }) });
      await request(`/tasks/${taskId}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) });
      await refreshTasks();
      notify('Task assignment updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not assign the task.'); }
    finally { setSaving(false); }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const values = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await request(`/projects/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ title: values.get('title'), description: values.get('description'), deadline: values.get('deadline') || undefined }) });
      const status = String(values.get('status') ?? '');
      if (status && status !== detail.status) await request(`/projects/${detail.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setEditing(false);
      await Promise.all([refreshProjects(), refreshTasks()]);
      notify('Project updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the project.'); }
    finally { setSaving(false); }
  }

  async function saveResponsibility(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    if (!detail) return;
    const responsibility = String(new FormData(event.currentTarget).get('responsibility') ?? '').trim();
    setSaving(true);
    try { await request(`/projects/${detail.id}/team/${userId}`, { method: 'PATCH', body: JSON.stringify({ responsibility }) }); await refreshTasks(); notify('Responsibility updated.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update responsibility.'); }
    finally { setSaving(false); }
  }

  const memberName = (assigneeId?: string) => detail?.group.members.find((member) => member.userId === assigneeId)?.user.fullName ?? 'Unassigned';
  return <section className="sp on"><div className="ph"><h2>My Projects</h2></div><section className="cc"><div className="cc-head"><h3>Existing Projects</h3></div>{projects === null ? <div className="legacy-empty">Loading projects…</div> : projects.length ? <table className="tbl"><thead><tr><th>Project</th><th>Group</th><th>Role</th><th>Progress</th><th>Deadline</th><th>Status</th><th /></tr></thead><tbody>{projects.map((project) => { const complete = project.tasks.filter((task) => task.status === 'completed').length; const progress = project.tasks.length ? Math.round(complete / project.tasks.length * 100) : 0; const isLeader = project.members?.[0]?.role === 'Project_Leader'; return <tr key={project.id}><td><strong>{project.title}</strong></td><td>{project.group.name}</td><td><span className="bdg ac">{isLeader ? 'Leader' : 'Member'}</span></td><td><div className="progress-cell"><div className="pb-wrap"><div className="pb" style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div></td><td>{project.deadline ? new Date(project.deadline).toLocaleDateString() : 'Not set'}</td><td><span className="bdg g">{project.status}</span></td><td><button className="btn-o btn-sm" onClick={() => void openTasks(project.id)}>{selectedProjectId === project.id ? 'Refresh Tasks' : isLeader ? 'Manage Tasks' : 'View Tasks'}</button></td></tr>; })}</tbody></table> : <div className="legacy-empty">Your projects will appear here. Create your first project from the dashboard.</div>}</section>{selectedProjectId ? <section className="cc task-manager"><div className="cc-head"><div><h3>{selectedProject?.title ?? 'Project'} Tasks</h3><span className="task-manager-subtitle">{leader ? 'Create tasks and assign them to group members.' : 'View tasks assigned within this project.'}</span></div><div className="ph-acts">{leader ? <button className="btn-o btn-sm" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel Edit' : 'Edit Project'}</button> : null}<button className="btn-o btn-sm" onClick={() => { setSelectedProjectId(''); setDetail(null); setEditing(false); }}>Close</button></div></div>{loadingDetail ? <div className="legacy-empty">Loading project tasks…</div> : detail ? <>
    {editing && leader ? <form className="task-create-form" onSubmit={(event) => void saveEdit(event)}><input className="ifield" name="title" required minLength={2} maxLength={180} defaultValue={detail.title} placeholder="Project title" /><input className="ifield" name="description" required defaultValue={detail.description} placeholder="Project description" /><input className="ifield" name="deadline" type="date" defaultValue={detail.deadline ? detail.deadline.slice(0, 10) : ''} aria-label="Project deadline" /><select className="legacy-select" name="status" defaultValue={detail.status}><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option><option value="on_hold">On hold</option></select><button className="btn btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button></form> : null}
    {leader ? <form className="task-create-form" onSubmit={(event) => void createTask(event)}><input className="ifield" name="title" required minLength={2} maxLength={180} placeholder="Task title" /><input className="ifield" name="description" required placeholder="Task description" /><select className="legacy-select" name="assigneeId" defaultValue=""><option value="">Assign later</option>{detail.group.members.map((member) => <option value={member.userId} key={member.userId}>{member.user.fullName}</option>)}</select><select className="legacy-select" name="priority" defaultValue="medium"><option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option></select><input className="ifield" name="deadline" type="date" aria-label="Task deadline" /><button className="btn btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Task'}</button></form> : null}
    {detail.tasks.length ? <table className="tbl"><thead><tr><th>Task</th><th>Assignee</th><th>Deadline</th><th>Priority</th><th>Status</th>{leader ? <th>Assign</th> : null}</tr></thead><tbody>{detail.tasks.map((task) => <tr key={task.id}><td><strong>{task.title}</strong><span className="task-description">{task.description}</span></td><td>{memberName(task.assignments[0]?.assigneeId)}</td><td>{task.deadline ? new Date(task.deadline).toLocaleDateString() : 'Not set'}</td><td><span className="bdg ac">{task.priority}</span></td><td><span className="bdg g">{task.status}</span></td>{leader ? <td><form className="task-assign-form" onSubmit={(event) => void assignTask(event, task.id)}><select className="legacy-select" name="assigneeId" defaultValue={task.assignments[0]?.assigneeId ?? ''} aria-label={`Assignee for ${task.title}`}><option value="" disabled>Choose member</option>{detail.group.members.map((member) => <option value={member.userId} key={member.userId}>{member.user.fullName}</option>)}</select><button className="btn-o btn-sm" disabled={saving}>Assign</button></form></td> : null}</tr>)}</tbody></table> : <div className="legacy-empty">No tasks yet.{leader ? ' Create the first one above.' : ''}</div>}
    <div className="cc-head"><h3>Team Responsibilities</h3></div>
    <table className="tbl"><thead><tr><th>Member</th><th>Role</th><th>Responsibility</th></tr></thead><tbody>{detail.members.map((member) => <tr key={member.userId}><td>{member.user.fullName}</td><td><span className="bdg ac">{member.role === 'Project_Leader' ? 'Leader' : 'Member'}</span></td><td>{leader ? <form className="task-assign-form" onSubmit={(event) => void saveResponsibility(event, member.userId)}><input className="ifield" name="responsibility" defaultValue={member.responsibility ?? ''} placeholder="Assign a responsibility" /><button className="btn-o btn-sm" disabled={saving}>Save</button></form> : member.responsibility || '—'}</td></tr>)}</tbody></table>
  </> : null}</section> : null}
  </section>;
}
