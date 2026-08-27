import { io } from 'socket.io-client';

// In Docker, Nginx exposes the API at /api while the API container remains private.
// A supplied URL still takes precedence for non-Docker deployments.
const API = (globalThis as any).WEBSHERE_API_URL || import.meta.env.VITE_API_URL || '/api';
let access = sessionStorage.getItem('ws_access') ?? '';
let socket: ReturnType<typeof io> | undefined;
const call = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? 'Request failed');
  return data;
};
const setSession = (data: any) => {
  if (data.access) { access = data.access; sessionStorage.setItem('ws_access', data.access); }
  if (data.refresh) sessionStorage.setItem('ws_refresh', data.refresh);
  const role = data.role ?? data.user?.role;
  if (role) sessionStorage.setItem('ws_role', role);
  if (data.user) {
    sessionStorage.setItem('ws_user_id', data.user.id);
    sessionStorage.setItem('ws_fullname', data.user.fullName);
    sessionStorage.setItem('ws_name', data.user.fullName.split(' ')[0]);
    sessionStorage.setItem('ws_email', data.user.email);
    sessionStorage.setItem('ws_school', data.user.institution ?? '');
    sessionStorage.setItem('ws_course', data.user.course ?? '');
  }
  if (access) connectSocket();
};
const clearSession = () => {
  access = '';
  socket?.disconnect();
  socket = undefined;
  ['ws_access', 'ws_refresh', 'ws_role', 'ws_user_id', 'ws_fullname', 'ws_name', 'ws_email', 'ws_school', 'ws_course'].forEach((key) => sessionStorage.removeItem(key));
};
const formError = (message: string) => (globalThis as any).toast?.(message, 'error');

(globalThis as any).doLogin = async (button: HTMLButtonElement) => {
  const email = document.querySelector<HTMLInputElement>('#pg-login input[type="email"]')?.value.trim();
  const password = document.getElementById('login-pw') as HTMLInputElement | null;
  if (!email || !password?.value) return formError('Email and password are required.');
  button.textContent = 'Signing in…';
  try { const data = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: password.value }) }); setSession(data); (globalThis as any).toast?.('Welcome back!', 'success'); (globalThis as any).showPage?.('user'); } catch (error: any) { formError(error.message); } finally { button.textContent = 'Sign In'; }
};
(globalThis as any).doAdminLogin = async (button: HTMLButtonElement) => {
  const email = document.querySelector<HTMLInputElement>('#pg-adminlogin input[type="email"]')?.value.trim(); const password = document.getElementById('adm-pw') as HTMLInputElement | null;
  if (!email || !password?.value) return formError('Email and password are required.'); button.textContent = 'Signing in…';
  try { const data = await call('/auth/admin/login', { method: 'POST', body: JSON.stringify({ email, password: password.value }) }); setSession(data); (globalThis as any).showPage?.('admin'); } catch (error: any) { formError(error.message); } finally { button.textContent = 'Sign In as Admin'; }
};
(globalThis as any).doRegister = async (button: HTMLButtonElement) => {
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
  const password = value('reg-pw'); const confirm = value('reg-cpw');
  if (password !== confirm) return formError('Passwords do not match.');
  button.textContent = 'Creating account…';
  try { await call('/auth/register', { method: 'POST', body: JSON.stringify({ fullName: `${value('reg-fname')} ${value('reg-lname')}`.trim(), email: value('reg-email'), institution: value('reg-school'), course: value('reg-course'), password }) }); (globalThis as any).toast?.('Account created. Please sign in.', 'success'); (globalThis as any).showPage?.('login'); } catch (error: any) { formError(error.message); } finally { button.textContent = 'Create Account'; }
};
(globalThis as any).wsAIFetch = async (messages: Array<{ role: string; content: string }>) => { const prompt = messages.filter((message) => message.role === 'user').at(-1)?.content ?? ''; const answer = await call('/ai/ask', { method: 'POST', body: JSON.stringify({ prompt }) }); return { content: [{ text: answer.response }] }; };
(globalThis as any).websphereApi = { call, get access() { return access; }, async dashboard() { return call('/dashboard'); }, async createProject(payload: unknown) { return call('/projects', { method: 'POST', body: JSON.stringify(payload) }); }, async updateTaskStatus(id: string, status: string) { return call(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); } };
(globalThis as any).clearWebsphereSession = clearSession;

const restoreSession = async () => {
  if (!access) return;
  try {
    const user = await call('/users/me');
    setSession({ user });
  } catch {
    const refresh = sessionStorage.getItem('ws_refresh');
    if (!refresh) { clearSession(); return; }
    try {
      setSession(await call('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh }) }));
      setSession({ user: await call('/users/me') });
    } catch { clearSession(); return; }
  }
  (globalThis as any).showPage?.(sessionStorage.getItem('ws_role') === 'Administrator' ? 'admin' : 'user');
};

document.addEventListener('DOMContentLoaded', () => { void restoreSession(); });

const connectSocket = () => {
  if (!access || socket?.connected) return;
  socket?.disconnect();
  const socketUrl = API.startsWith('http') ? API.replace(/\/api\/?$/, '') : window.location.origin;
  socket = io(socketUrl, { path: '/socket.io', auth: { token: access } });
  socket.on('connect', () => { if (activeGroupId) socket?.emit('group:join', activeGroupId); });
  socket.on('task:updated', () => (globalThis as any).websphereApi.dashboard().catch(() => undefined));
  socket.on('notification:new', () => (globalThis as any).websphereApi.dashboard().catch(() => undefined));
  socket.on('poll:tally', (tally: any) => {
    if (tally.groupId === activeGroupId) void selectGroup(activeGroupId, false);
  });
};

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const currentUserId = () => sessionStorage.getItem('ws_user_id') ?? '';
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '';
let groups: any[] = [];
let activeGroupId = '';
let activeHub: any = null;

const currentMembership = () => activeHub?.group?.members?.find((member: any) => member.userId === currentUserId());
const isLeader = () => currentMembership()?.role === 'Project_Leader';

const renderGroups = () => {
  const view = document.getElementById('u-mygroups');
  if (!view) return;
  const cards = groups.length
    ? groups.map((group) => {
      const role = group.members?.[0]?.role === 'Project_Leader' ? 'Leader' : 'Member';
      return `<button type="button" onclick="wsSelectGroup('${group.id}')" style="width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:14px;background:${group.id === activeGroupId ? 'rgba(14,160,208,.12)' : 'rgba(234,246,252,.75)'};border:1px solid ${group.id === activeGroupId ? 'var(--acc)' : 'var(--bdr)'};border-radius:12px;cursor:pointer;font:inherit;color:var(--ink);"><span style="width:38px;height:38px;border-radius:50%;background:var(--acc);color:white;display:grid;place-items:center;font-weight:800;">${escapeHtml(group.name).slice(0, 1).toUpperCase()}</span><span style="flex:1"><strong style="display:block;font-size:14px;">${escapeHtml(group.name)}</strong><span style="font-size:12px;color:var(--sub)">${group._count?.projects ?? 0} projects · ${group._count?.ideas ?? 0} ideas</span></span><span class="bdg ${role === 'Leader' ? 'ac' : 'g'}">${role}</span></button>`;
    }).join('')
    : '<div style="padding:22px;text-align:center;color:var(--sub);font-size:13px;">Your recent group starts here. Create one or join with an invitation code.</div>';
  view.innerHTML = `<div class="ph"><div><h2>My Groups</h2><div class="ph-sub">Create a shared workspace, invite members, and choose a project idea together.</div></div></div><div class="cc" style="margin-bottom:16px"><div style="display:grid;grid-template-columns:1fr auto;gap:10px"><input id="ws-group-name" class="ifield" style="margin:0" placeholder="Name your group"><button class="btn" onclick="wsCreateGroup()">Create group</button></div><div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:10px"><input id="ws-join-code" class="ifield" style="margin:0" placeholder="Enter an invitation code"><button class="btn-o" onclick="wsJoinGroup()">Join group</button></div></div><div style="display:grid;grid-template-columns:minmax(250px,.7fr) minmax(0,1.3fr);gap:16px;align-items:start"><div class="cc" style="display:flex;flex-direction:column;gap:10px">${cards}</div><div id="ws-group-hub">${activeHub ? renderGroupHub() : '<div class="cc" style="text-align:center;padding:36px 18px;color:var(--sub);font-size:13px;">Select a group to open its collaboration hub.</div>'}</div></div>`;
};

const renderGroupHub = () => {
  const group = activeHub.group;
  const joinCode = group.joinCodes?.[0]?.code;
  const members = group.members.map((member: any) => `<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--bdr)"><span class="ava" style="width:28px;height:28px;font-size:10px;">${escapeHtml(member.user.fullName).split(' ').map((part: string) => part[0]).join('').slice(0, 2)}</span><span style="flex:1;font-size:13px;font-weight:700">${escapeHtml(member.user.fullName)}</span><span class="bdg ${member.role === 'Project_Leader' ? 'ac' : 'g'}">${member.role === 'Project_Leader' ? 'Leader' : 'Member'}</span>${isLeader() && member.userId !== currentUserId() ? `<button class="btn-o btn-sm" onclick="wsRemoveMember('${member.userId}')">Remove</button>` : ''}</div>`).join('');
  const ideas = activeHub.ideas.slice(0, 3).map((idea: any) => `<li>${escapeHtml(idea.title)} <span style="color:var(--sub)">· ${escapeHtml(idea.status)}</span></li>`).join('') || '<li style="color:var(--sub)">Your group has not submitted an idea yet.</li>';
  return `<div class="cc"><div class="cc-head"><h3>${escapeHtml(group.name)} collaboration hub</h3><button class="btn btn-sm" onclick="wsOpenIdeas()">Open ideas</button></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div><div class="lbl">Invite members</div><div style="font-size:13px;color:var(--sub);line-height:1.5">${joinCode ? `Share code <strong style="color:var(--ink)">${escapeHtml(joinCode)}</strong>` : 'No active invitation code.'}</div>${joinCode ? `<button class="btn-o btn-sm" style="margin-top:9px" onclick="wsCopyJoinCode('${joinCode}')">Copy code</button>` : ''}<div style="display:flex;gap:7px;margin-top:10px"><input id="ws-member-email" class="ifield" style="min-width:0;margin:0" placeholder="Member email"><button class="btn-o btn-sm" onclick="wsAddMember()">Add</button></div><div class="lbl" style="margin-top:18px">Members (${group.members.length})</div>${members}</div><div><div class="lbl">Idea board</div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">${ideas}</ul><div class="lbl" style="margin-top:18px">Activity</div><div style="font-size:13px;color:var(--sub)">${activeHub.messages.length ? `${activeHub.messages.length} recent chat messages` : 'Your group activity starts here.'}</div><div style="font-size:13px;color:var(--sub);margin-top:7px">${group.projects.length} projects created from this group.</div></div></div></div>`;
};

const selectGroup = async (groupId: string, redraw = true) => {
  if (!groupId) return;
  activeGroupId = groupId;
  try {
    activeHub = await call(`/groups/${groupId}/hub`);
    socket?.emit('group:join', groupId);
    if (redraw) renderGroups();
    renderIdeas();
  } catch (error: any) { formError(error.message); }
};

const refreshGroups = async () => {
  if (!access) return;
  try {
    groups = await call('/groups');
    if (activeGroupId && !groups.some((group) => group.id === activeGroupId)) { activeGroupId = ''; activeHub = null; }
    if (!activeGroupId && groups[0]) await selectGroup(groups[0].id, false);
    renderGroups();
    renderIdeas();
  } catch { /* The session restoration flow displays auth errors. */ }
};

const renderIdeas = () => {
  const view = document.getElementById('u-ideamgmt');
  if (!view) return;
  const groupOptions = groups.map((group) => `<option value="${group.id}" ${group.id === activeGroupId ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
  if (!activeHub) {
    view.innerHTML = `<div class="ph"><div><h2>Idea Management</h2></div></div><div class="cc" style="text-align:center;padding:42px 24px;color:var(--sub)">Create or join a group before submitting your first project idea.</div>`;
    return;
  }
  const ideas = activeHub.ideas.map((idea: any) => `<div style="padding:14px;border:1px solid var(--bdr);border-radius:11px;margin-top:10px;background:rgba(234,246,252,.68)"><div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><strong style="font-size:14px">${escapeHtml(idea.title)}</strong><div style="font-size:13px;line-height:1.55;color:var(--sub);margin-top:5px">${escapeHtml(idea.body)}</div><div style="font-size:11px;color:var(--sub);margin-top:8px">Submitted ${formatDate(idea.createdAt)} · ${escapeHtml(idea.status)}</div></div>${idea.authorId === currentUserId() && idea.status !== 'selected' ? `<button class="btn-o btn-sm" onclick="wsEditIdea('${idea.id}')">Revise</button>` : ''}${isLeader() && idea.status !== 'selected' ? `<button class="btn btn-sm" onclick="wsBeginProject('${idea.id}')">Create project</button>` : ''}</div></div>`).join('') || '<div style="padding:16px;text-align:center;color:var(--sub);font-size:13px">Your group’s first project idea starts here.</div>';
  const poll = activeHub.poll;
  const pollPanel = poll
    ? `<div class="cc" style="margin-top:16px"><div class="cc-head"><h3>Live group vote</h3><span class="bdg ac">Open</span></div>${poll.options.map((option: any) => `<div style="padding:11px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px"><div style="flex:1"><strong style="font-size:13px">${escapeHtml(option.label)}</strong><div style="height:6px;border-radius:6px;background:var(--bdr);margin-top:7px;overflow:hidden"><div style="height:100%;width:${poll.options.reduce((total: number, item: any) => total + item.votes, 0) ? Math.round(option.votes / poll.options.reduce((total: number, item: any) => total + item.votes, 0) * 100) : 0}%;background:var(--acc)"></div></div></div><span style="font-size:12px;color:var(--sub)">${option.votes} vote${option.votes === 1 ? '' : 's'}</span><button class="${poll.viewerOptionId === option.optionId ? 'btn' : 'btn-o'} btn-sm" onclick="wsVote('${poll.pollId}','${option.optionId}')">${poll.viewerOptionId === option.optionId ? 'Voted' : 'Vote'}</button></div>`).join('')}</div>`
    : isLeader() && activeHub.ideas.filter((idea: any) => idea.status !== 'selected').length > 1
      ? `<div class="cc" style="margin-top:16px"><div class="cc-head"><h3>Start a group vote</h3></div><div style="font-size:13px;color:var(--sub);margin-bottom:10px">Choose two or more submitted ideas for members to vote on.</div>${activeHub.ideas.filter((idea: any) => idea.status !== 'selected').map((idea: any) => `<label style="display:block;font-size:13px;margin:8px 0"><input type="checkbox" data-ws-poll-idea value="${idea.id}"> ${escapeHtml(idea.title)}</label>`).join('')}<button class="btn btn-sm" style="margin-top:8px" onclick="wsOpenPoll()">Open vote</button></div>`
      : '';
  view.innerHTML = `<div class="ph"><div><h2>Idea Management</h2><div class="ph-sub">Submit, refine, vote on, and convert your group’s best idea into a project.</div></div></div><div class="cc"><div class="lbl">Active group</div><select class="ifield" style="width:100%;margin-bottom:14px" onchange="wsSelectGroup(this.value)">${groupOptions}</select><div class="lbl">Submit an idea</div><input id="ws-idea-title" class="ifield" style="width:100%;margin-bottom:9px" placeholder="Your project idea title"><textarea id="ws-idea-body" class="ifield" style="width:100%;min-height:90px;resize:vertical" placeholder="Describe the problem, users, and expected outcome."></textarea><button class="btn" style="margin-top:10px" onclick="wsSubmitIdea()">Submit idea</button></div><div class="cc" style="margin-top:16px"><div class="cc-head"><h3>${escapeHtml(activeHub.group.name)} ideas</h3><span style="font-size:12px;color:var(--sub)">${activeHub.ideas.length} submitted</span></div>${ideas}</div>${pollPanel}`;
};

(globalThis as any).wsCreateGroup = async () => { const input = document.getElementById('ws-group-name') as HTMLInputElement | null; const name = input?.value.trim(); if (!name) return formError('Enter a group name.'); try { await call('/groups', { method: 'POST', body: JSON.stringify({ name }) }); if (input) input.value = ''; await refreshGroups(); (globalThis as any).toast?.('Group created.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsJoinGroup = async () => { const input = document.getElementById('ws-join-code') as HTMLInputElement | null; const code = input?.value.trim(); if (!code) return formError('Enter an invitation code.'); try { await call('/groups/join', { method: 'POST', body: JSON.stringify({ code }) }); if (input) input.value = ''; await refreshGroups(); (globalThis as any).toast?.('You joined the group.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsSelectGroup = (id: string) => void selectGroup(id);
(globalThis as any).wsOpenIdeas = () => { (globalThis as any).usw?.('ideamgmt'); renderIdeas(); };
(globalThis as any).wsCopyJoinCode = async (code: string) => { try { await navigator.clipboard.writeText(code); (globalThis as any).toast?.('Invitation code copied.', 'success'); } catch { (globalThis as any).toast?.(`Invitation code: ${code}`, 'info'); } };
(globalThis as any).wsAddMember = async () => { const email = (document.getElementById('ws-member-email') as HTMLInputElement | null)?.value.trim(); if (!email) return formError('Enter the member’s registered email.'); try { await call(`/groups/${activeGroupId}/members`, { method: 'POST', body: JSON.stringify({ email }) }); await selectGroup(activeGroupId); (globalThis as any).toast?.('Member added to the group.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsRemoveMember = async (userId: string) => { if (!activeGroupId || !confirm('Remove this member from the group?')) return; try { await call(`/groups/${activeGroupId}/members/${userId}`, { method: 'DELETE' }); await selectGroup(activeGroupId); (globalThis as any).toast?.('Member removed.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsSubmitIdea = async () => { const title = (document.getElementById('ws-idea-title') as HTMLInputElement | null)?.value.trim(); const body = (document.getElementById('ws-idea-body') as HTMLTextAreaElement | null)?.value.trim(); if (!activeGroupId || !title || !body) return formError('Add both an idea title and description.'); try { await call(`/groups/${activeGroupId}/ideas`, { method: 'POST', body: JSON.stringify({ title, body }) }); await selectGroup(activeGroupId); (globalThis as any).toast?.('Idea submitted to your group.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsEditIdea = async (id: string) => { const idea = activeHub?.ideas.find((item: any) => item.id === id); if (!idea) return; const title = prompt('Revise the title', idea.title); if (!title?.trim()) return; const body = prompt('Revise the description', idea.body); if (!body?.trim()) return; try { await call(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim(), body: body.trim() }) }); await selectGroup(activeGroupId); (globalThis as any).toast?.('Idea revised.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsOpenPoll = async () => { const ideaIds = [...document.querySelectorAll<HTMLInputElement>('[data-ws-poll-idea]:checked')].map((input) => input.value); if (ideaIds.length < 2) return formError('Choose at least two ideas for a vote.'); try { await call(`/groups/${activeGroupId}/polls`, { method: 'POST', body: JSON.stringify({ ideaIds }) }); await selectGroup(activeGroupId); (globalThis as any).toast?.('Group vote is open.', 'success'); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsVote = async (pollId: string, optionId: string) => { try { await call(`/polls/${pollId}/vote`, { method: 'POST', body: JSON.stringify({ optionId }) }); await selectGroup(activeGroupId); } catch (error: any) { formError(error.message); } };
(globalThis as any).wsBeginProject = async (ideaId: string) => { if (!confirm('Create a project from this idea? This cannot be undone.')) return; try { const project = await call(`/groups/${activeGroupId}/ideas/${ideaId}/begin`, { method: 'POST' }); await selectGroup(activeGroupId); (globalThis as any).toast?.(`Project “${project.title}” created.`, 'success'); } catch (error: any) { formError(error.message); } };

const existingUsw = (globalThis as any).usw;
(globalThis as any).usw = function (id: string, ...args: unknown[]) { existingUsw?.(id, ...args); if (access && (id === 'mygroups' || id === 'ideamgmt')) void refreshGroups(); };

document.addEventListener('DOMContentLoaded', () => { if (access) { connectSocket(); void refreshGroups(); } });
