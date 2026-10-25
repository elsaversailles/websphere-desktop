import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import { DateField } from './DateField';
import { dateOnlyKey, formatDateOnly } from './dates';
import { deadlineHealth, priorityHealth, taskStatusHealth } from './health';

type Project = { id: string; title: string; description: string; status: string; deadline?: string | null; group: { name: string } | null; members?: Array<{ role: string }>; tasks: Array<{ id: string; status: string }> };
type ProjectTask = { id: string; title: string; description: string; deadline?: string | null; priority: string; status: string; assignments: Array<{ assigneeId: string }>; risk?: { level: 'high' | 'medium' | 'low' } };
type Member = { userId: string; role: string; responsibility?: string | null; user: { id: string; fullName: string } };
type ProjectDetail = { id: string; title: string; description: string; status: string; deadline?: string | null; group: { members: Member[] } | null; members: Member[]; tasks: ProjectTask[] };

export function ProjectsPage({ notify }: { notify: (message: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingTask, setEditingTask] = useState<{ task: ProjectTask; mode: 'edit' | 'reassign' } | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);

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
      if (assigneeId) {
        if (!detail.members.some((member) => member.userId === assigneeId)) await request(`/projects/${detail.id}/members`, { method: 'POST', body: JSON.stringify({ userId: assigneeId }) });
        await request(`/tasks/${task.id}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) });
      }
      form.reset();
      setCreateFormKey((current) => current + 1);
      await refreshTasks();
      notify(assigneeId ? 'Task created and assigned.' : 'Task created.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the task.'); }
    finally { setSaving(false); }
  }

  async function saveTaskEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask) return;
    const values = new FormData(event.currentTarget);
    const assigneeId = String(values.get('assigneeId') ?? '');
    const payload = editingTask.mode === 'reassign'
      ? { assigneeId }
      : { title: values.get('title'), description: values.get('description'), deadline: values.get('deadline') || null, priority: values.get('priority'), status: values.get('status'), assigneeId: assigneeId || null };
    setSaving(true);
    try {
      await request(`/tasks/${editingTask.task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditingTask(null);
      await Promise.all([refreshProjects(), refreshTasks()]);
      notify(editingTask.mode === 'reassign' ? 'Task reassigned. The new assignee was notified.' : 'Task updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save the task.'); }
    finally { setSaving(false); }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const values = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await request(`/projects/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ title: values.get('title'), description: values.get('description'), deadline: values.get('deadline') || null }) });
      const status = String(values.get('status') ?? '');
      if (status && status !== detail.status) await request(`/projects/${detail.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setEditing(false);
      await Promise.all([refreshProjects(), refreshTasks()]);
      notify('Project updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the project.'); }
    finally { setSaving(false); }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete “${project.title}” and all its tasks? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await request(`/projects/${project.id}`, { method: 'DELETE' });
      if (selectedProjectId === project.id) { setSelectedProjectId(''); setDetail(null); setEditing(false); }
      await refreshProjects();
      notify('Project deleted.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete the project.'); }
    finally { setSaving(false); }
  }

  async function deleteTask(task: ProjectTask) {
    if (!window.confirm(`Delete task “${task.title}”? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await request(`/tasks/${task.id}`, { method: 'DELETE' });
      await Promise.all([refreshProjects(), refreshTasks()]);
      notify('Task deleted.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete the task.'); }
    finally { setSaving(false); }
  }

  const projectMembers = detail?.group?.members ?? detail?.members ?? [];
  const memberName = (assigneeId?: string) => projectMembers.find((member) => member.userId === assigneeId)?.user.fullName ?? 'Unassigned';
  return <section className="sp on">
    <div className="ph"><h2>My Projects</h2></div>
    <section className="cc">
      <div className="cc-head"><h3>Existing Projects</h3></div>
      {projects === null ? <div className="legacy-empty">Loading projects…</div> : projects.length ? <table className="tbl">
        <thead><tr><th>Project</th><th>Group</th><th>Role</th><th>Progress</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{projects.map((project) => {
          const complete = project.tasks.filter((task) => task.status === 'completed').length;
          const progress = project.tasks.length ? Math.round(complete / project.tasks.length * 100) : 0;
          const isLeader = project.members?.[0]?.role === 'Project_Leader';
          return <tr key={project.id}>
            <td><strong>{project.title}</strong></td><td>{project.group?.name ?? 'Independent'}</td>
            <td><span className="bdg ac">{isLeader ? 'Leader' : 'Member'}</span></td>
            <td><div className="progress-cell"><div className="pb-wrap"><div className="pb" style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div></td>
            <td>{formatDateOnly(project.deadline)}</td><td><span className="bdg g">{project.status}</span></td>
            <td><div className="task-actions"><button className="btn-o btn-sm" onClick={() => void openTasks(project.id)}>{selectedProjectId === project.id ? 'Refresh Tasks' : isLeader ? 'Manage Tasks' : 'View Tasks'}</button>{isLeader ? <button type="button" className="btn-o btn-sm btn-red" disabled={saving} onClick={() => void deleteProject(project)}>Delete</button> : null}</div></td>
          </tr>;
        })}</tbody>
      </table> : <div className="legacy-empty">Your projects will appear here. Create your first project from the dashboard.</div>}
    </section>
    {selectedProjectId ? <section className="cc task-manager">
      <div className="cc-head"><div><h3>{selectedProject?.title ?? 'Project'} Tasks</h3><span className="task-manager-subtitle">{leader ? 'Create and manage tasks for this project.' : 'View tasks assigned within this project.'}</span></div><div className="ph-acts">{leader ? <button className="btn-o btn-sm" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel Edit' : 'Edit Project'}</button> : null}<button className="btn-o btn-sm" onClick={() => { setSelectedProjectId(''); setDetail(null); setEditing(false); }}>Close</button></div></div>
      {loadingDetail ? <div className="legacy-empty">Loading project tasks…</div> : detail ? <>
        {editing && leader ? <form className="task-create-form" onSubmit={(event) => void saveEdit(event)}>
          <input className="ifield" name="title" required minLength={2} maxLength={180} defaultValue={detail.title} placeholder="Project title" />
          <input className="ifield" name="description" required defaultValue={detail.description} placeholder="Project description" />
          <DateField name="deadline" label="Project due date" defaultValue={detail.deadline ? dateOnlyKey(detail.deadline) : ''} />
          <select className="legacy-select" name="status" defaultValue={detail.status}><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option><option value="on_hold">On hold</option></select>
          <button className="btn btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </form> : null}
        {leader ? <form className="task-create-form" key={createFormKey} onSubmit={(event) => void createTask(event)}>
          <input className="ifield" name="title" required minLength={2} maxLength={180} placeholder="Task title" />
          <input className="ifield" name="description" required placeholder="Task description" />
          <select className="legacy-select" name="assigneeId" defaultValue=""><option value="">Assign later</option>{projectMembers.map((member) => <option value={member.userId} key={member.userId}>{member.user.fullName}</option>)}</select>
          <select className="legacy-select" name="priority" defaultValue="medium"><option value="low">Low priority</option><option value="medium">Medium</option><option value="high">High priority</option></select>
          <DateField name="deadline" label="Task due date" />
          <button className="btn btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Task'}</button>
        </form> : null}
        {detail.tasks.length ? <table className="tbl">
          <thead><tr><th>Task</th><th>Assignee</th><th>Due Date</th><th>Priority</th><th>Status</th>{leader ? <th>Actions</th> : null}</tr></thead>
          <tbody>{detail.tasks.map((task) => {
            const due = deadlineHealth(task.deadline);
            const priority = priorityHealth(task.priority);
            const status = taskStatusHealth(task.status);
            const needsReassignment = task.status !== 'completed' && (task.risk?.level === 'high' || (due?.days ?? 0) < 0);
            const currentAssignee = task.assignments[0]?.assigneeId;
            const replacementAvailable = detail.members.some((member) => member.userId !== currentAssignee);
            return <tr key={task.id}>
              <td><strong>{task.title}</strong><span className="task-description">{task.description}</span></td>
              <td>{memberName(currentAssignee)}</td><td>{formatDateOnly(task.deadline)}</td>
              <td><span className={`bdg ${priority.tone}`}>{priority.label}</span></td><td><div className="task-actions"><span className={`bdg ${status.tone}`}>{status.label}</span>{needsReassignment ? <span className="bdg r">{due && due.days < 0 ? 'Overdue' : 'At Risk'}</span> : null}</div></td>
              {leader ? <td><div className="task-actions">
                <button type="button" className="btn-o btn-sm" disabled={saving} onClick={() => setEditingTask({ task, mode: 'edit' })}>Edit Task</button>
                {needsReassignment ? <button type="button" className="btn-o btn-sm" disabled={saving || !replacementAvailable} title={replacementAvailable ? undefined : 'No other project member is available'} onClick={() => setEditingTask({ task, mode: 'reassign' })}>Reassign Task</button> : null}
                <button type="button" className="btn-o btn-sm btn-red" disabled={saving} onClick={() => void deleteTask(task)}>Delete</button>
              </div></td> : null}
            </tr>;
          })}</tbody>
        </table> : <div className="legacy-empty">No tasks yet.{leader ? ' Create the first one above.' : ''}</div>}
      </> : null}
    </section> : null}
    {editingTask ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingTask(null); }}><div className="modal-box task-edit-modal" role="dialog" aria-modal="true" aria-label={editingTask.mode === 'reassign' ? 'Reassign task' : 'Edit task'}>
      <div className="modal-ttl"><span>{editingTask.mode === 'reassign' ? `Reassign “${editingTask.task.title}”` : `Edit “${editingTask.task.title}”`}</span><button type="button" className="modal-close" disabled={saving} onClick={() => setEditingTask(null)} aria-label="Close task editor">×</button></div>
      <form key={`${editingTask.task.id}-${editingTask.mode}`} onSubmit={(event) => void saveTaskEdit(event)}>
        {editingTask.mode === 'edit' ? <>
          <label className="lbl" htmlFor="task-edit-title">Task Name</label><input id="task-edit-title" className="ifield" name="title" required minLength={2} maxLength={180} defaultValue={editingTask.task.title} />
          <label className="lbl" htmlFor="task-edit-description">Description</label><textarea id="task-edit-description" className="ifield" name="description" required defaultValue={editingTask.task.description} />
          <label className="lbl" htmlFor="task-edit-deadline">Due Date</label><DateField id="task-edit-deadline" name="deadline" label="Task due date" defaultValue={editingTask.task.deadline ? dateOnlyKey(editingTask.task.deadline) : ''} />
          <label className="lbl" htmlFor="task-edit-priority">Priority</label><select id="task-edit-priority" className="ifield" name="priority" defaultValue={editingTask.task.priority}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
          <label className="lbl" htmlFor="task-edit-status">Status</label><select id="task-edit-status" className="ifield" name="status" defaultValue={editingTask.task.status}><option value="pending">Not Started</option><option value="ongoing">In Progress</option><option value="for_review">For Review</option><option value="completed">Completed</option></select>
        </> : <p className="muted">Choose a replacement project member. They will receive a task notification.</p>}
        <label className="lbl" htmlFor="task-edit-assignee">{editingTask.mode === 'reassign' ? 'New Assignee' : 'Assigned Member'}</label>
        <select id="task-edit-assignee" className="ifield" name="assigneeId" required={editingTask.mode === 'reassign'} defaultValue={editingTask.mode === 'reassign' ? '' : editingTask.task.assignments[0]?.assigneeId ?? ''}>
          <option value="" disabled={editingTask.mode === 'reassign'}>{editingTask.mode === 'reassign' ? 'Choose replacement' : 'Unassigned'}</option>
          {(detail?.members ?? []).filter((member) => editingTask.mode !== 'reassign' || member.userId !== editingTask.task.assignments[0]?.assigneeId).map((member) => <option key={member.userId} value={member.userId}>{member.user.fullName}</option>)}
        </select>
        <div className="modal-acts"><button type="button" className="btn-o" disabled={saving} onClick={() => setEditingTask(null)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Saving…' : editingTask.mode === 'reassign' ? 'Reassign Task' : 'Save Task'}</button></div>
      </form>
    </div></div> : null}
  </section>;
}
