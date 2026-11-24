import { ListFilters, ListPager, useListFilters, type ListPage } from './ListFilters';
import { workspaceSubscription } from './workspaceSocket';
import { TASK_TITLE_MAX_LENGTH } from '@websphere/shared';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../api';
import { ScheduleDateFields } from './ScheduleDateFields';
import { dateOnlyKey, formatDateOnly } from './dates';
import { deadlineHealth, taskPriorityHealth, taskStatusHealth } from './health';
import { dashboardProjectProgress } from './dashboardProjectProgress';
import { useLocalDay } from './useLocalDay';
import { ConfirmDialog } from './ConfirmDialog';

type Project = { id: string; title: string; description: string; status: string; startDate?: string | null; deadline?: string | null; group: { name: string } | null; members?: Array<{ role: string }>; tasks?: Array<{ id: string; status: string }>; progressAverage?: number };
type ProjectTask = { id: string; title: string; description: string; startDate?: string | null; deadline?: string | null; priority: string; status: string; completedAt?: string | null; assignments: Array<{ assigneeId: string }>; risk?: { level: 'high' | 'medium' | 'low' } };
type Member = { userId: string; role: string; responsibility?: string | null; user: { id: string; fullName: string } };
type ProjectDetail = { id: string; title: string; description: string; status: string; startDate?: string | null; deadline?: string | null; group: { members: Member[] } | null; members: Member[]; tasks: ProjectTask[] };
type ConfirmAction = { title: string; description: string; confirmLabel: string; destructive?: boolean; action: () => void };

export function ProjectsPage({ notify, userId, focusedTask, selectedProjectId, onSelectProject }: { notify: (message: string) => void; userId: string; selectedProjectId: string; onSelectProject: (id: string) => void; focusedTask?: { projectId: string; taskId: string } | null }) {
  const today = useLocalDay();
  const filters = useListFilters();
  const [result, setResult] = useState<ListPage<Project> | null>(null);
  const projects = result?.items ?? null;
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const { page, setPage, query } = filters;
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingTask, setEditingTask] = useState<{ task: ProjectTask; mode: 'edit' | 'reassign' } | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const refreshProjects = useCallback(async () => {
    const generation = ++listRequest.current;
    try {
      const next = await request<ListPage<Project>>(`/projects/list?${query}`);
      if (generation !== listRequest.current) return;
      if (page > next.totalPages) setPage(next.totalPages);
      else setResult(next);
    } catch (error) { if (generation === listRequest.current) notify(error instanceof Error ? error.message : 'Could not load projects.'); }
  }, [query, page, setPage, notify]);
  useEffect(() => {
    void refreshProjects();
    return () => { listRequest.current += 1; };
  }, [refreshProjects]);

  const selectedProject = useMemo(() => projects?.find((project) => project.id === selectedProjectId), [projects, selectedProjectId]);
  const leader = (detail?.members.find((member) => member.userId === userId) ?? selectedProject?.members?.[0])?.role === 'Project_Leader';

  const refreshTasks = useCallback(async () => {
    if (!selectedProjectId) return;
    const generation = ++detailRequest.current;
    setLoadingDetail(true);
    try {
      const next = await request<ProjectDetail>(`/projects/${encodeURIComponent(selectedProjectId)}`);
      if (generation === detailRequest.current) setDetail(next);
    } catch (error) {
      if (generation === detailRequest.current) notify(error instanceof Error ? error.message : 'Could not load project tasks.');
    } finally { if (generation === detailRequest.current) setLoadingDetail(false); }
  }, [selectedProjectId, notify]);

  useEffect(() => {
    setDetail(null); setEditing(false);
    void refreshTasks();
    return () => { detailRequest.current += 1; };
  }, [refreshTasks]);

  useEffect(() => {
    if (!focusedTask || detail?.id !== focusedTask.projectId || !detail.tasks.some((task) => task.id === focusedTask.taskId)) return;
    const frame = requestAnimationFrame(() => document.getElementById(`project-task-${focusedTask.taskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [detail, focusedTask]);

  useEffect(() => {
    const { on, join, dispose } = workspaceSubscription();
    let connected = false;
    projects?.forEach((project) => join('project', project.id));
    if (selectedProjectId && !projects?.some((project) => project.id === selectedProjectId)) join('project', selectedProjectId);
    on('connect', () => {
      if (connected) void Promise.all([refreshProjects(), refreshTasks()]);
      connected = true;
    });
    on('task:updated', (event: { projectId: string }) => {
      if (event.projectId === selectedProjectId) void Promise.all([refreshProjects(), refreshTasks()]);
      else if (projects?.some((project) => project.id === event.projectId)) void refreshProjects();
    });
    on('notification:new', (event: { relatedType?: string }) => {
      if (event.relatedType === 'project') void refreshProjects();
    });
    on('group:removed', () => void Promise.all([refreshProjects(), refreshTasks()]));
    return dispose;
  }, [selectedProjectId, refreshProjects, refreshTasks, projects]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const assigneeId = String(values.get('assigneeId') ?? '');
    const startDate = String(values.get('startDate') ?? '');
    const deadline = String(values.get('deadline') ?? '');
    if (!startDate || !deadline) return notify('Start date and due date are required to create a task.');
    setSaving(true);
    try {
      const task = await request<{ id: string }>(`/projects/${detail.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: values.get('title'), startDate, deadline }) });
      if (assigneeId) {
        if (!detail.members.some((member) => member.userId === assigneeId)) await request(`/projects/${detail.id}/members`, { method: 'POST', body: JSON.stringify({ userId: assigneeId }) });
        await request(`/tasks/${task.id}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) });
      }
      form.reset();
      setCreateFormKey((current) => current + 1);
      await Promise.all([refreshProjects(), refreshTasks()]);
      notify(assigneeId ? 'Task created and assigned.' : 'Task created.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the task.'); }
    finally { setSaving(false); }
  }

  async function saveTaskEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask) return;
    const values = new FormData(event.currentTarget);
    const assigneeId = String(values.get('assigneeId') ?? editingTask.task.assignments[0]?.assigneeId ?? '');
    const payload = editingTask.mode === 'reassign'
      ? { assigneeId }
      : { title: values.get('title'), startDate: values.get('startDate') || null, deadline: values.get('deadline') || null, assigneeId: assigneeId || null };
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
      await request(`/projects/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ title: values.get('title'), startDate: values.get('startDate') || null, deadline: values.get('deadline') || null }) });
      setEditing(false);
      await Promise.all([refreshProjects(), refreshTasks()]);
      notify('Project updated.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the project.'); }
    finally { setSaving(false); }
  }

  async function deleteProject(project: Project) {
    setSaving(true);
    try {
      await request(`/projects/${project.id}`, { method: 'DELETE' });
      if (selectedProjectId === project.id) { onSelectProject(''); setDetail(null); setEditing(false); }
      await refreshProjects();
      notify('Project deleted.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete the project.'); }
    finally { setSaving(false); }
  }

  async function deleteTask(task: ProjectTask) {
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
  return <section className="sp on projects-page">
    <div className="ph"><h2>My Projects</h2></div>
    <section className="cc">
      <div className="cc-head"><h3>Existing Projects</h3></div>
      <ListFilters filters={filters} placeholder="Search projects…" statuses={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'on_hold', label: 'On Hold' }, { value: 'archived', label: 'Archived' }]} />
      {projects === null ? <div className="legacy-empty">Loading projects…</div> : projects.length ? <div className="project-table-scroll" role="region" aria-label="Existing projects" tabIndex={0}><table className="tbl projects-table">
        <thead><tr><th>Project</th><th>Group</th><th>Role</th><th>Progress</th><th>Start Date</th><th>End Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{projects.map((project) => {
          const { progress, health } = dashboardProjectProgress(project.tasks ?? [], project.status, project.progressAverage);
          const isLeader = project.members?.[0]?.role === 'Project_Leader';
          return <tr key={project.id}>
            <td><strong>{project.title}</strong></td><td>{project.group?.name ?? 'Independent'}</td>
            <td><span className="bdg ac">{isLeader ? 'Leader' : 'Member'}</span></td>
            <td><div className="progress-cell"><div className="pb-wrap"><div className={`pb ${health.tone}`} style={{ width: `${progress}%` }} /></div><span className={`pb-val ${health.tone}`}>{progress}%</span></div></td>
            <td>{formatDateOnly(project.startDate)}</td><td>{formatDateOnly(project.deadline)}</td><td><span className={`bdg ${health.tone}`}>{health.label}</span></td>
            <td><div className="task-actions"><button className="btn-o btn-sm" onClick={() => selectedProjectId === project.id ? void refreshTasks() : onSelectProject(project.id)}>{selectedProjectId === project.id ? 'Refresh Tasks' : isLeader ? 'Manage Tasks' : 'View Tasks'}</button>{isLeader ? <button type="button" className="btn-o btn-sm btn-red" disabled={saving} onClick={() => setConfirmation({ title: 'Delete project?', description: `“${project.title}” and all of its tasks will be permanently deleted.`, confirmLabel: 'Delete project', destructive: true, action: () => void deleteProject(project) })}>Delete</button> : null}</div></td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="legacy-empty">No projects match your filters. Create your first project from the dashboard.</div>}
    </section>
    {result ? <ListPager page={page} totalPages={result.totalPages} setPage={setPage} /> : null}
    {selectedProjectId ? <section className="cc task-manager">
      <div className="cc-head"><div><h3>{detail?.title ?? selectedProject?.title ?? 'Project'} Tasks</h3><span className="task-manager-subtitle">{leader ? 'Create and manage tasks for this project.' : 'View tasks assigned within this project.'}</span></div><div className="ph-acts">{leader ? <button className="btn-o btn-sm" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel Edit' : 'Edit Project'}</button> : null}<button className="btn-o btn-sm" onClick={() => { onSelectProject(''); setDetail(null); setEditing(false); }}>Close</button></div></div>
      {loadingDetail ? <div className="legacy-empty">Loading project tasks…</div> : detail ? <>
        {editing && leader ? <form className="task-create-form project-edit-form" aria-label="Edit project" onSubmit={(event) => void saveEdit(event)}>
          <div className="task-form-field"><label className="lbl" htmlFor="project-edit-title">Project Title</label><input id="project-edit-title" className="ifield" name="title" required minLength={2} maxLength={180} defaultValue={detail.title} placeholder="Project title" /></div>
          <ScheduleDateFields idPrefix="project-edit" endLabel="End Date" initialStart={detail.startDate ? dateOnlyKey(detail.startDate) : ''} initialEnd={detail.deadline ? dateOnlyKey(detail.deadline) : ''} editing fieldClassName="task-form-field" />
          <button className="btn btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </form> : null}
        {leader ? <form className="task-create-form task-entry-form" aria-label="Create task" key={createFormKey} onSubmit={(event) => void createTask(event)}>
          <div className="task-form-field"><label className="lbl" htmlFor="task-create-title">Task Title</label><input id="task-create-title" className="ifield" name="title" required minLength={2} maxLength={TASK_TITLE_MAX_LENGTH} placeholder="Task title" /></div>
          <ScheduleDateFields idPrefix="task-create" fieldClassName="task-form-field" requiredStart requiredEnd />
          <div className="task-form-field"><label className="lbl" htmlFor="task-create-assignee">Assigned Member</label><select id="task-create-assignee" className="legacy-select" name="assigneeId" defaultValue=""><option value="">Assign later</option>{projectMembers.map((member) => <option value={member.userId} key={member.userId}>{member.user.fullName}</option>)}</select></div>
          <button className="btn btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Task'}</button>
        </form> : null}
        {detail.tasks.length ? <div className="project-table-scroll" role="region" aria-label="Project tasks" tabIndex={0}><table className="tbl project-tasks-table">
          <thead><tr><th>Task</th><th>Assignee</th><th>Start Date</th><th>Due Date</th><th>Priority</th><th>Status</th>{leader ? <th>Actions</th> : null}</tr></thead>
          <tbody>{detail.tasks.map((task) => {
            const due = deadlineHealth(task.deadline, today);
            const priority = taskPriorityHealth(task, today);
            const status = taskStatusHealth(task.status);
            const needsReassignment = task.status !== 'completed' && task.risk?.level === 'high';
            const currentAssignee = task.assignments[0]?.assigneeId;
            const replacementAvailable = detail.members.some((member) => member.userId !== currentAssignee);
            return <tr key={task.id} id={`project-task-${task.id}`} className={focusedTask?.projectId === detail.id && focusedTask.taskId === task.id ? 'notification-target' : undefined}>
              <td><strong>{task.title}</strong>{task.description?.trim() && task.description.trim() !== task.title.trim() ? <span className="task-description">{task.description}</span> : null}</td>
              <td>{memberName(currentAssignee)}</td><td>{formatDateOnly(task.startDate)}</td><td>{formatDateOnly(task.deadline)}</td>
              <td><span className={`bdg ${priority.tone}`}>{priority.label}</span></td><td><div className="task-actions"><span className={`bdg ${status.tone}`}>{status.label}</span>{needsReassignment ? <span className="bdg r">{due && due.days < 0 ? 'Overdue' : 'At Risk'}</span> : null}</div></td>
              {leader ? <td><div className="task-actions">
                <button type="button" className="btn-o btn-sm" disabled={saving} onClick={() => setEditingTask({ task, mode: 'edit' })}>Edit Task</button>
                {needsReassignment ? <button type="button" className="btn-o btn-sm" disabled={saving || !replacementAvailable} title={replacementAvailable ? undefined : 'No other project member is available'} onClick={() => setEditingTask({ task, mode: 'reassign' })}>Reassign Task</button> : null}
                <button type="button" className="btn-o btn-sm btn-red" disabled={saving} onClick={() => setConfirmation({ title: 'Delete task?', description: `“${task.title}” will be permanently deleted.`, confirmLabel: 'Delete task', destructive: true, action: () => void deleteTask(task) })}>Delete</button>
              </div></td> : null}
            </tr>;
          })}</tbody>
        </table></div> : <div className="legacy-empty">No tasks yet.{leader ? ' Create the first one above.' : ''}</div>}
      </> : null}
    </section> : null}
    {confirmation ? <ConfirmDialog {...confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); action(); }} /> : null}
    {editingTask ? <div className="modal-ov open project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingTask(null); }}><div className="modal-box project-modal" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
      <div className="modal-ttl"><div><span id="task-editor-title">{editingTask.mode === 'reassign' ? 'Reassign Task' : 'Edit Task'}</span><small>{editingTask.mode === 'reassign' ? 'Task Assignment' : 'Task Details'}</small></div><button type="button" className="modal-close" disabled={saving} onClick={() => setEditingTask(null)} aria-label="Close task editor">×</button></div>
      <form className="project-create-form" key={`${editingTask.task.id}-${editingTask.mode}`} onSubmit={(event) => void saveTaskEdit(event)}>
        {editingTask.mode === 'edit' ? <>
          <label className="lbl" htmlFor="task-edit-title">Task Title</label><input id="task-edit-title" className="ifield" name="title" required minLength={2} maxLength={TASK_TITLE_MAX_LENGTH} defaultValue={editingTask.task.title} />
          <ScheduleDateFields idPrefix="task-edit" initialStart={editingTask.task.startDate ? dateOnlyKey(editingTask.task.startDate) : ''} initialEnd={editingTask.task.deadline ? dateOnlyKey(editingTask.task.deadline) : ''} editing />
        </> : <p className="muted">Choose a replacement project member. They will receive a task notification.</p>}
        <label className="lbl" htmlFor="task-edit-assignee">{editingTask.mode === 'reassign' ? 'New Assignee' : 'Assigned Member'}</label>
        <select id="task-edit-assignee" className="ifield" name="assigneeId" disabled={editingTask.mode === 'edit' && !!editingTask.task.assignments[0] && editingTask.task.risk?.level !== 'high'} required={editingTask.mode === 'reassign'} defaultValue={editingTask.mode === 'reassign' ? '' : editingTask.task.assignments[0]?.assigneeId ?? ''}>
          <option value="" disabled={editingTask.mode === 'reassign'}>{editingTask.mode === 'reassign' ? 'Choose replacement' : 'Unassigned'}</option>
          {(detail?.members ?? []).filter((member) => editingTask.mode !== 'reassign' || member.userId !== editingTask.task.assignments[0]?.assigneeId).map((member) => <option key={member.userId} value={member.userId}>{member.user.fullName}</option>)}
        </select>
        <div className="modal-acts project-modal-actions"><button type="button" className="btn-o" disabled={saving} onClick={() => setEditingTask(null)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Saving…' : editingTask.mode === 'reassign' ? 'Reassign Task' : 'Save Task'}</button></div>
      </form>
    </div></div> : null}
  </section>;
}
