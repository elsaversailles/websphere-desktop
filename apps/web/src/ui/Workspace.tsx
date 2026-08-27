import { useEffect, useState } from 'react';
import { clearSession, request, type Session } from '../api';
import { Dashboard } from './Dashboard';
import { GroupChatPage } from './GroupChatPage';
import { GroupsPage } from './GroupsPage';
import { IdeasPage } from './IdeasPage';
import { MarkdownText } from './MarkdownText';
import { ProjectsPage } from './ProjectsPage';
import { AdminSettingsPage, CalendarPage, IntegrationsPage, NotificationsPage, ProfilePage, ProjectsAnalyticsPage, TasksPage, TrackerPage } from './LegacyPages';

type Page = 'dashboard' | 'groups' | 'chat' | 'ideas' | 'projects' | 'tasks' | 'workflow' | 'predictive' | 'calendar' | 'tools' | 'tracker' | 'notifications' | 'profile' | 'assistant' | 'admin' | 'accounts' | 'settings';
type WorkspaceProps = { session: Session; onLogout: () => void; notify: (message: string) => void };
type Link = { id: Page; label: string; icon: string };

const userSections: Array<{ title: string; links: Link[] }> = [
  { title: 'Main', links: [{ id: 'dashboard', label: 'Dashboard', icon: '⌂' }] },
  { title: 'Groups & Projects', links: [{ id: 'groups', label: 'My Groups', icon: '♧' }, { id: 'chat', label: 'Group Chat', icon: '□' }, { id: 'ideas', label: 'Idea Management', icon: '◇' }, { id: 'projects', label: 'My Projects', icon: '▱' }, { id: 'tasks', label: 'My Tasks', icon: '✓' }] },
  { title: 'Analytics', links: [{ id: 'workflow', label: 'Workflow Analytics', icon: '▥' }, { id: 'predictive', label: 'Predictive Monitoring', icon: '◉' }] },
  { title: 'Tools', links: [{ id: 'calendar', label: 'Calendar', icon: '▦' }, { id: 'tools', label: 'Apps/External Tools', icon: '▦' }, { id: 'tracker', label: 'Task Progress Tracker', icon: '▤' }] },
  { title: 'Account', links: [{ id: 'notifications', label: 'Notifications', icon: '♢' }, { id: 'profile', label: 'Profile & Settings', icon: '♙' }] },
];
const adminSections: Array<{ title: string; links: Link[] }> = [
  { title: 'System Admin', links: [{ id: 'admin', label: 'User Activity', icon: '▣' }, { id: 'accounts', label: 'Account Management', icon: '♧' }, { id: 'settings', label: 'System Settings', icon: '◉' }] },
];

export function Workspace({ session, onLogout, notify }: WorkspaceProps) {
  const administrator = session.role === 'Administrator';
  const [page, setPage] = useState<Page>(administrator ? 'admin' : 'dashboard');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const sections = administrator ? adminSections : userSections;

  async function logout() {
    try { await request('/auth/logout', { method: 'POST' }); } catch { /* local session is always cleared */ }
    clearSession(); onLogout();
  }

  return <main className="page on"><div className="layout">
    <aside className="sidebar">
      <button className="sb-brand" onClick={() => setPage(administrator ? 'admin' : 'dashboard')}><GlobeIcon />WebSphere</button>
      <nav aria-label="Main navigation">{sections.map((section) => <div className="sb-group" key={section.title}><div className="sb-sec">{section.title}</div>{section.links.map((link) => <button className={`sb-item ${page === link.id ? 'on' : ''}`} key={link.id} onClick={() => setPage(link.id)}><span className="sb-ico"><NavIcon page={link.id} /></span>{link.label}</button>)}</div>)}</nav>
      <div className="sb-bot"><div className="uchip"><span className="ava">{initials(session.user.fullName)}</span><span><strong className="u-name">{session.user.fullName}</strong><small className="u-role">{administrator ? 'Administrator' : 'Member'}</small></span></div><button className="logout-btn" onClick={() => void logout()}>↪ Logout</button></div>
    </aside>
    <div className="workspace-body"><div className="mobile-header"><span className="sb-brand"><GlobeIcon />WebSphere</span><select value={page} onChange={(event) => setPage(event.target.value as Page)}>{sections.flatMap((section) => section.links).map((link) => <option key={link.id} value={link.id}>{link.label}</option>)}</select></div><div className="main">
      {page === 'dashboard' ? <Dashboard name={session.user.fullName} notify={notify} onPage={setPage} /> : null}
      {page === 'groups' ? <GroupsPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} onIdeas={() => setPage('ideas')} onChat={() => setPage('chat')} notify={notify} /> : null}
      {page === 'ideas' ? <IdeasPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} notify={notify} /> : null}
      {page === 'projects' ? <ProjectsPage notify={notify} /> : null}
      {page === 'assistant' ? <AssistantPage notify={notify} /> : null}
      {page === 'admin' ? <AdminPage notify={notify} /> : null}
      {page === 'accounts' ? <AdminAccounts notify={notify} /> : null}
      {page === 'chat' ? <GroupChatPage userId={session.user.id} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} notify={notify} /> : null}
      {page === 'tasks' ? <TasksPage notify={notify} /> : null}
      {page === 'workflow' ? <ProjectsAnalyticsPage kind="workflow" notify={notify} /> : null}
      {page === 'predictive' ? <ProjectsAnalyticsPage kind="predictive" notify={notify} /> : null}
      {page === 'calendar' ? <CalendarPage notify={notify} /> : null}
      {page === 'tools' ? <IntegrationsPage notify={notify} /> : null}
      {page === 'tracker' ? <TrackerPage notify={notify} /> : null}
      {page === 'notifications' ? <NotificationsPage notify={notify} /> : null}
      {page === 'profile' ? <ProfilePage user={session.user} notify={notify} /> : null}
      {page === 'settings' ? <AdminSettingsPage notify={notify} /> : null}
    </div></div>
  </div></main>;
}

function AssistantPage({ notify }: { notify: (message: string) => void }) {
  const [prompt, setPrompt] = useState(''); const [answer, setAnswer] = useState(''); const [busy, setBusy] = useState(false);
  async function ask() { if (!prompt.trim()) return; setBusy(true); try { const result = await request<{ response: string }>('/ai/ask', { method: 'POST', body: JSON.stringify({ prompt }) }); setAnswer(result.response); } catch (error: any) { notify(error.message); } finally { setBusy(false); } }
  return <section className="sp on"><div className="ph"><div><h2>WebSphere AI</h2><div className="ph-sub">Academic ideas, project planning, and risk analysis</div></div></div><div className="cc ai-workspace"><label className="lbl">How can I help?</label><textarea className="ifield ai-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about project titles, thesis topics, tools, or academic planning..." rows={5} /><button className="btn" disabled={busy} onClick={() => void ask()}>{busy ? 'Thinking…' : 'Send'}</button>{answer ? <article className="ai-response ai-markdown"><MarkdownText source={answer} /></article> : <div className="empty-message">Your AI conversation starts here.</div>}</div></section>;
}

function AdminPage({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<{ users: number; activeProjects: number; health: string } | null>(null);
  useEffect(() => { void request<{ users: number; activeProjects: number; health: string }>('/admin/monitoring').then(setData).catch((error: Error) => notify(error.message)); }, [notify]);
  return <section className="sp on"><div className="ph"><div><h2>User Activity</h2></div></div><div className="krow">{data ? <><Kpi label="Total Projects" value={data.activeProjects} /><Kpi label="Active Users" value={data.users} /><Kpi label="Flagged Inactive" value={0} tone="yel" /><Kpi label="Uptime" value={data.health === 'up' ? 'Online' : data.health} tone="grn" /></> : <div className="cc">Loading system activity…</div>}</div><div className="g2"><div className="cc"><div className="cc-head"><h3>System Health</h3></div><Health label="Database" detail="Connected to the WebSphere database" /><Health label="AI Service" detail="Configured through the WebSphere backend" /><Health label="File Storage" detail="Linux instance storage" /></div><div className="cc"><div className="cc-head"><h3>Recent User Activity</h3></div><div className="empty-message">Live audit activity will appear here.</div></div></div></section>;
}

function AdminAccounts({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<Array<{ id: string; fullName: string; email: string; role: string; status: string }> | null>(null);
  useEffect(() => { void request<Array<{ id: string; fullName: string; email: string; role: string; status: string }>>('/admin/users').then(setUsers).catch((error: Error) => notify(error.message)); }, [notify]);
  return <section className="sp on"><div className="ph"><div><h2>Account Management</h2></div><button className="btn-o btn-sm" onClick={() => notify('System logs are available from the admin activity log endpoint.')}>View System Logs</button></div><div className="cc requests-card"><div className="cc-head"><h3>⟳ Requests</h3><button className="btn-o btn-sm" onClick={() => notify('Resolved requests cleared.')}>Clear Resolved</button></div><div className="empty-message">No help requests yet. Requests submitted by users will appear here automatically.</div></div><div className="cc"><div className="cc-head"><h3>All Users</h3></div>{users?.length ? users.map((user) => <div className="urow" key={user.id}><span className="ava">{initials(user.fullName)}</span><span className="ur-info"><strong className="ur-name">{user.fullName}</strong><small className="ur-email">{user.email} · {user.role}</small></span><span className={`bdg ${user.status === 'active' ? 'g' : 'y'}`}>{user.status}</span></div>) : <div className="empty-message">{users ? 'Registered users will appear here.' : 'Loading accounts…'}</div>}</div></section>;
}

function GlobeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#0EA0D0" strokeWidth="2"/><ellipse cx="12" cy="12" rx="4" ry="9" stroke="#0EA0D0" strokeWidth="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="#0EA0D0" strokeWidth="1.5"/></svg>; }
function NavIcon({ page }: { page: Page }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (page === 'dashboard') return <svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>;
  if (page === 'groups' || page === 'accounts') return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (page === 'chat') return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
  if (page === 'projects') return <svg {...common}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
  if (page === 'tasks') return <svg {...common}><path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
  if (page === 'workflow') return <svg {...common}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>;
  if (page === 'predictive' || page === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>;
  if (page === 'calendar') return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
  if (page === 'tools') return <svg {...common}><rect x="2" y="3" width="7" height="7" rx="1"/><rect x="15" y="3" width="7" height="7" rx="1"/><rect x="2" y="14" width="7" height="7" rx="1"/><rect x="15" y="14" width="7" height="7" rx="1"/></svg>;
  if (page === 'tracker') return <svg {...common}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>;
  if (page === 'notifications') return <svg {...common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
  if (page === 'profile') return <svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
  if (page === 'admin') return <svg {...common}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
  if (page === 'ideas') return <svg {...common}><path d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5z"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <div className="kpi"><div className={`kval ${tone ?? ''}`}>{value}</div><div className="klbl">{label}</div></div>; }
function Health({ label, detail }: { label: string; detail: string }) { return <div className="health-row"><span><strong>{label}</strong><small>{detail}</small></span><span className="bdg g">● Healthy</span></div>; }
function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
