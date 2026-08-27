import { FormEvent, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import type { GroupHub, GroupSummary } from './types';

type Props = { userId: string; selectedGroupId: string; onSelectGroup: (id: string) => void; notify: (message: string) => void };

export function GroupChatPage({ userId, selectedGroupId, onSelectGroup, notify }: Props) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [hub, setHub] = useState<GroupHub | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => { void request<GroupSummary[]>('/groups').then((next) => { setGroups(next); if (!selectedGroupId && next[0]) onSelectGroup(next[0].id); }).catch((error: Error) => notify(error.message)); }, [selectedGroupId, onSelectGroup, notify]);
  useEffect(() => { if (!selectedGroupId) { setHub(null); return; } void request<GroupHub>(`/groups/${selectedGroupId}/hub`).then(setHub).catch((error: Error) => notify(error.message)); }, [selectedGroupId, notify]);
  useEffect(() => {
    if (!selectedGroupId) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('group:join', selectedGroupId, () => undefined));
    socket.on('chat:message', (message: GroupHub['messages'][number]) => setHub((current) => current ? { ...current, messages: [message, ...current.messages.filter((item) => item.id !== message.id)] } : current));
    return () => { socketRef.current = null; socket.disconnect(); };
  }, [selectedGroupId]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const body = String(new FormData(form).get('body') ?? '').trim();
    if (!body || !selectedGroupId || !socketRef.current) return;
    socketRef.current.emit('chat:send', { groupId: selectedGroupId, body }, (result: { ok: boolean; error?: { message?: string } }) => { if (result.ok) form.reset(); else notify(result.error?.message ?? 'Message could not be sent.'); });
  }

  async function vote(optionId: string) {
    if (!hub?.poll) return;
    try { await request(`/polls/${hub.poll.pollId}/vote`, { method: 'POST', body: JSON.stringify({ optionId }) }); setHub(await request<GroupHub>(`/groups/${selectedGroupId}/hub`)); } catch (error: any) { notify(error.message); }
  }

  async function startProject() {
    const winner = hub?.poll?.options.slice().sort((a, b) => b.votes - a.votes)[0];
    if (!winner) return notify('Open a vote in Idea Management first.');
    try { await request(`/groups/${selectedGroupId}/ideas/${winner.ideaId}/begin`, { method: 'POST' }); setHub(await request<GroupHub>(`/groups/${selectedGroupId}/hub`)); notify('Project created from the winning idea.'); } catch (error: any) { notify(error.message); }
  }

  return <section className="sp on"><div className="ph"><h2>Group Chat</h2></div><div className="gc-teams-layout"><aside className="gc-left-panel"><div className="gc-left-head"><h3>Chats</h3><button title="New chat">＋</button></div><div className="gc-search"><span>⌕</span><input placeholder="Search chats..." /></div><div className="gc-chat-list">{groups.length ? groups.map((group) => <button className={`gc-chat-item ${group.id === selectedGroupId ? 'active' : ''}`} key={group.id} onClick={() => onSelectGroup(group.id)}><span className="gc-list-avatar">{group.name.slice(0, 2).toUpperCase()}</span><span><strong>{group.name}</strong><small>{group._count.projects} projects · {group._count.ideas} ideas</small></span></button>) : <div className="gc-panel-empty">Your groups will appear here.</div>}</div><div className="gc-mini-calendar"><strong>{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><span>Your scheduled events will appear here.</span></div></aside>{hub ? <><main className="gc-main-chat"><header className="gc-chat-header"><span className="gc-list-avatar large">{hub.group.name.slice(0, 2).toUpperCase()}</span><div><strong>{hub.group.name}</strong><span>● {hub.group.members.length} members</span></div><div className="gc-header-actions"><button onClick={() => notify('Voice calling will be available after a call provider is configured.')}>Call</button><button onClick={() => notify('Video calling will be available after a call provider is configured.')}>Video</button><button onClick={() => notify('Add members from My Groups → Group Hub.')}>Add Members</button><button>Search</button></div></header><div className="gchat-msgs">{hub.messages.length ? [...hub.messages].reverse().map((message) => { const member = hub.group.members.find((value) => value.userId === message.senderId); const sender = message.senderId === userId ? 'You' : member?.user.fullName ?? 'Group member'; return <div className={`gc-msg ${message.senderId === userId ? 'me' : ''}`} key={message.id}><span className="gc-ava">{sender === 'You' ? 'Y' : sender.slice(0, 1)}</span><div className="gc-bub"><div className="gc-name">{sender}</div><div className="gc-txt">{message.body}</div><div className="gc-time">{new Date(message.createdAt).toLocaleString()}</div></div></div>; }) : <div className="legacy-empty">Choose or create a group to begin a conversation.</div>}</div><form className="gchat-ir" onSubmit={send}><input className="gchat-input" name="body" placeholder="Type a message to your group…" autoComplete="off" /><button className="gchat-send">Send</button></form></main><aside className="gc-right-panel"><section><div className="gc-side-title"><h3>Members</h3><span>{hub.group.members.length}</span></div>{hub.group.members.map((member) => <div className="gc-member-row" key={member.userId}><span className="gc-list-avatar small">{member.user.fullName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{member.user.fullName}</strong><small>{member.role === 'Project_Leader' ? 'Leader' : 'Member'}</small></span><i /></div>)}</section><section className="gc-voting"><div className="gc-side-title"><h3>Idea Voting</h3></div><p>Vote for a project title. Most votes wins!</p>{hub.poll ? <div className="gc-poll-options">{hub.poll.options.map((option) => <div className={`gc-poll-option ${hub.poll?.viewerOptionId === option.optionId ? 'chosen' : ''}`} key={option.optionId}><span><strong>{option.label}</strong><small>{option.votes} vote{option.votes === 1 ? '' : 's'}</small></span><button onClick={() => void vote(option.optionId)}>Vote</button></div>)}</div> : <div className="gc-panel-empty">Your group vote starts in Idea Management.</div>}</section><button className="gc-start-project" disabled={!hub.poll} onClick={() => void startProject()}>Start Project</button></aside></> : <div className="gc-no-selection"><strong>Your workspace is ready</strong><span>Choose or create a group to begin a conversation.</span></div>}</div></section>;
}
