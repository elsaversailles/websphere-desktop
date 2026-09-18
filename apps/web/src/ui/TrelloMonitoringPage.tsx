import { useEffect, useMemo, useState } from 'react';
import { request } from '../api';

type Notice = (message: string) => void;
type Project = { id: string; title: string; members: Array<{ role: string }> };
type Connection = { id: string; provider: string; status: string; tool: { name: string } };
type Board = { id: string; name: string; url: string };
type Monitor = { board: Board & { lastActivityAt?: string | null }; totalOpenCards: number; overdueCards: number; dueSoonCards: number; cardsByList: Array<{ listId: string; listName: string; count: number }>; memberWorkload: Array<{ memberId: string; fullName: string; openCards: number }> };
type SharedMonitor = { id: string; status: string; data?: Monitor; message?: string };

export function TrelloMonitoringPage({ notify }: { notify: Notice }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [boardId, setBoardId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [boards, setBoards] = useState<Board[]>([]);
  const [preview, setPreview] = useState<Monitor | null>(null);
  const [shared, setShared] = useState<SharedMonitor[]>([]);
  const [loading, setLoading] = useState(false);

  const trelloConnections = useMemo(() => connections.filter((connection) => connection.provider === 'trello' && connection.status === 'connected'), [connections]);
  const selectedProject = projects.find((project) => project.id === projectId);
  const canShare = selectedProject?.members.some((member) => member.role === 'Project_Leader') ?? false;

  useEffect(() => {
    void Promise.all([request<Project[]>('/projects'), request<Connection[]>('/integrations/connections')])
      .then(([projectRows, connectionRows]) => { setProjects(projectRows); setConnections(connectionRows); })
      .catch((error: Error) => notify(error.message));
  }, [notify]);

  useEffect(() => {
    setBoards([]); setBoardId(''); setPreview(null);
    if (!connectionId) return;
    void request<Board[]>(`/integrations/connections/${connectionId}/trello/boards`).then(setBoards).catch((error: Error) => notify(error.message));
  }, [connectionId, notify]);

  async function refreshShared() {
    if (!projectId) { setShared([]); return; }
    try { setShared(await request<SharedMonitor[]>(`/projects/${projectId}/trello/monitors`)); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not load shared Trello boards.'); }
  }
  useEffect(() => { void refreshShared(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function previewBoard() {
    if (!connectionId || !boardId) return;
    setLoading(true);
    try { setPreview(await request<Monitor>(`/integrations/connections/${connectionId}/trello/boards/${boardId}/monitor`)); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not refresh the Trello board.'); }
    finally { setLoading(false); }
  }
  async function shareBoard() {
    if (!projectId || !connectionId || !boardId) return;
    setLoading(true);
    try {
      await request(`/projects/${projectId}/trello/monitors`, { method: 'POST', body: JSON.stringify({ connectionId, boardId }) });
      notify('Trello board shared with this WebSphere project.');
      await refreshShared();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not share this Trello board.'); }
    finally { setLoading(false); }
  }
  async function removeShared(monitorId: string) {
    if (!projectId) return;
    try { await request(`/projects/${projectId}/trello/monitors/${monitorId}`, { method: 'DELETE' }); await refreshShared(); notify('Shared Trello board removed.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove the shared board.'); }
  }

  return <section className="sp on">
    <div className="ph"><div><h2>Trello Monitoring</h2><p>Monitor boards you can access, then optionally share selected board status with a WebSphere project.</p></div></div>
    {!trelloConnections.length ? <div className="cc"><h3>Connect Trello first</h3><p>Go to Apps & External Tools and connect your Trello account. WebSphere only reads boards you explicitly authorize.</p></div> : <>
      <div className="cc"><div className="cc-head"><h3>Your Trello board</h3></div><div className="g3"><label><span className="lbl">Account</span><select className="ifield" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">Select Trello account</option>{trelloConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.tool.name}</option>)}</select></label><label><span className="lbl">Board</span><select className="ifield" value={boardId} disabled={!connectionId} onChange={(event) => setBoardId(event.target.value)}><option value="">Select board</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label><div><span className="lbl">Status</span><button className="btn" disabled={!connectionId || !boardId || loading} onClick={() => void previewBoard()}>{loading ? 'Refreshing…' : 'Monitor board'}</button></div></div></div>
      {preview ? <MonitorSummary monitor={preview} /> : null}
      <div className="cc"><div className="cc-head"><h3>Share board with a project</h3></div><p>Only a project leader can share a board. Project members see board status, never your Trello token.</p><div className="g3"><label><span className="lbl">WebSphere project</span><select className="ifield" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><div><span className="lbl">Permission</span><div className="ifield">{projectId ? canShare ? 'Project leader' : 'Project member — view only' : 'Select a project'}</div></div><div><span className="lbl">Share</span><button className="btn" disabled={!canShare || !connectionId || !boardId || loading} onClick={() => void shareBoard()}>Share selected board</button></div></div></div>
      {projectId ? <div className="cc"><div className="cc-head"><h3>Shared project boards</h3><button className="btn-o btn-sm" onClick={() => void refreshShared()}>Refresh</button></div>{shared.length ? shared.map((item) => item.data ? <div className="urow" key={item.id}><span className="ur-info"><strong>{item.data.board.name}</strong><small>{item.data.totalOpenCards} open · {item.data.overdueCards} overdue · {item.data.dueSoonCards} due this week</small></span>{canShare ? <button className="btn-o btn-sm" onClick={() => void removeShared(item.id)}>Remove</button> : null}</div> : <div className="empty-message" key={item.id}>{item.message ?? 'Shared board unavailable.'}</div>) : <div className="empty-message">No Trello boards are shared with this project.</div>}</div> : null}
    </>}
  </section>;
}

function MonitorSummary({ monitor }: { monitor: Monitor }) {
  return <div className="cc"><div className="cc-head"><div><h3>{monitor.board.name}</h3><span>{monitor.board.lastActivityAt ? `Last activity ${new Date(monitor.board.lastActivityAt).toLocaleString()}` : 'No activity timestamp available'}</span></div><a className="btn-o btn-sm" href={monitor.board.url} target="_blank" rel="noreferrer">Open in Trello</a></div><div className="krow"><Metric value={monitor.totalOpenCards} label="Open cards" /><Metric value={monitor.overdueCards} label="Overdue" tone="red" /><Metric value={monitor.dueSoonCards} label="Due in 7 days" tone="yel" /></div><div className="g2"><div><h4>Cards by list</h4>{monitor.cardsByList.length ? monitor.cardsByList.map((list) => <div className="urow" key={list.listId}><span className="ur-info"><strong>{list.listName}</strong></span><span>{list.count}</span></div>) : <div className="empty-message">No open cards.</div>}</div><div><h4>Member workload</h4>{monitor.memberWorkload.length ? monitor.memberWorkload.map((member) => <div className="urow" key={member.memberId}><span className="ur-info"><strong>{member.fullName}</strong></span><span>{member.openCards}</span></div>) : <div className="empty-message">No assigned open cards.</div>}</div></div></div>;
}

function Metric({ value, label, tone }: { value: number; label: string; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
