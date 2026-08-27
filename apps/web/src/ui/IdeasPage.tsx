import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import type { GroupHub, GroupSummary } from './types';

type IdeasPageProps = {
  userId: string;
  selectedGroupId: string;
  onSelectGroup: (id: string) => void;
  notify: (message: string) => void;
};

export function IdeasPage({ userId, selectedGroupId, onSelectGroup, notify }: IdeasPageProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [hub, setHub] = useState<GroupHub | null>(null);
  const [selectedIdeas, setSelectedIdeas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');

  const refreshGroups = useCallback(async () => {
    const next = await request<GroupSummary[]>('/groups');
    setGroups(next);
    if (!selectedGroupId && next[0]) onSelectGroup(next[0].id);
  }, [onSelectGroup, selectedGroupId]);

  const refreshHub = useCallback(async () => {
    if (!selectedGroupId) {
      setHub(null);
      return;
    }
    setHub(await request<GroupHub>(`/groups/${selectedGroupId}/hub`));
  }, [selectedGroupId]);

  useEffect(() => {
    void refreshGroups().catch((error: Error) => notify(error.message)).finally(() => setLoading(false));
  }, [refreshGroups, notify]);

  useEffect(() => {
    setSelectedIdeas([]);
    void refreshHub().catch((error: Error) => notify(error.message));
  }, [refreshHub, notify]);

  useEffect(() => {
    if (!selectedGroupId) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => socket.emit('group:join', selectedGroupId, () => undefined));
    socket.on('poll:tally', (tally: { groupId?: string }) => {
      if (tally.groupId === selectedGroupId) void refreshHub().catch(() => undefined);
    });
    return () => { socket.disconnect(); };
  }, [selectedGroupId, refreshHub]);

  const membership = useMemo(() => hub?.group.members.find((member) => member.userId === userId), [hub, userId]);
  const leader = membership?.role === 'Project_Leader';
  const poll = hub?.poll ?? null;

  async function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroupId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await request(`/groups/${selectedGroupId}/ideas`, { method: 'POST', body: JSON.stringify({ title: data.get('title'), body: data.get('body') }) });
      form.reset();
      await refreshHub();
      notify('Idea submitted to the group.');
    } catch (error: any) { notify(error.message); }
  }

  async function reviseIdea(id: string, title: string, body: string) {
    const nextTitle = window.prompt('Revise the idea title', title);
    if (nextTitle === null) return;
    const nextBody = window.prompt('Revise the idea details', body);
    if (nextBody === null) return;
    try {
      await request(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify({ title: nextTitle, body: nextBody }) });
      await refreshHub();
      notify('Idea revision saved.');
    } catch (error: any) { notify(error.message); }
  }

  async function createPoll() {
    if (!selectedGroupId || selectedIdeas.length < 2) return notify('Choose at least two ideas for the poll.');
    try {
      await request(`/groups/${selectedGroupId}/polls`, { method: 'POST', body: JSON.stringify({ ideaIds: selectedIdeas }) });
      setSelectedIdeas([]);
      await refreshHub();
      notify('Live vote opened.');
    } catch (error: any) { notify(error.message); }
  }

  async function vote(optionId: string) {
    if (!hub?.poll) return;
    try {
      await request(`/polls/${hub.poll.pollId}/vote`, { method: 'POST', body: JSON.stringify({ optionId }) });
      await refreshHub();
    } catch (error: any) { notify(error.message); }
  }

  async function beginProject(ideaId: string) {
    if (!selectedGroupId) return;
    try {
      await request(`/groups/${selectedGroupId}/ideas/${ideaId}/begin`, { method: 'POST' });
      await refreshHub();
      notify('Project created from the selected idea.');
    } catch (error: any) { notify(error.message); }
  }

  async function generateIdeas() {
    if (!aiPrompt.trim()) return;
    try { const result = await request<{ response: string }>('/ai/ideas/generate', { method: 'POST', body: JSON.stringify({ prompt: aiPrompt }) }); setAiAnswer(result.response); } catch (error: any) { notify(error.message); }
  }

  return <section className="sp on"><div className="ph"><div><h2>Idea Management</h2><div className="ph-sub">AI-powered idea search, merging, and group selection</div></div><div className="ph-acts"><select className="legacy-select" value={selectedGroupId} onChange={(event) => onSelectGroup(event.target.value)}><option value="">Select a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button className="btn-o btn-sm" onClick={() => document.querySelector<HTMLTextAreaElement>('.idea-ai-input')?.focus()}>Open AI Assistant</button></div></div>{loading ? <div className="cc"><div className="legacy-empty">Loading ideas…</div></div> : !hub ? <div className="cc"><div className="legacy-empty"><strong>Your workspace is ready</strong><span>Generate your first project idea when you are ready.</span></div></div> : <><div className="cc"><div className="cc-head"><h3>AI Idea Generator</h3></div><p className="idea-generator-copy">Search for academic project ideas. AI will merge similar concepts and suggest up to 10 unique ideas. Your group discusses in Group Chat and the majority vote becomes your project idea!</p><div className="idea-generator-row"><textarea className="ifield idea-ai-input" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Describe your course, topic, or project problem…" rows={2} /><button className="btn" onClick={() => void generateIdeas()}>Generate Ideas</button></div>{aiAnswer ? <div className="ai-response">{aiAnswer}</div> : null}<div className="sdiv" /><form className="idea-submit-row" onSubmit={submitIdea}><input className="ifield" name="title" required minLength={2} maxLength={180} placeholder="Idea title" /><input className="ifield" name="body" required placeholder="Idea details" /><button className="btn">Submit Idea</button></form></div><div className="cc"><div className="cc-head"><h3>AI-Suggested Ideas (max 10) — Group votes in Group Chat</h3>{leader && !poll ? <button className="btn btn-sm" disabled={selectedIdeas.length < 2} onClick={() => void createPoll()}>Start Live Vote</button> : null}</div>{hub.ideas.length ? <div>{hub.ideas.slice(0, 10).map((idea, index) => <article className="legacy-idea-card" key={idea.id}><span className="idea-num">{index + 1}</span><div><strong className="idea-title">{idea.title}</strong><span className="idea-meta">{idea.body}</span></div>{leader && !poll ? <label className="idea-select"><input type="checkbox" checked={selectedIdeas.includes(idea.id)} onChange={(event) => setSelectedIdeas((current) => event.target.checked ? [...current, idea.id] : current.filter((value) => value !== idea.id))} /> Select</label> : null}{idea.authorId === userId && idea.status !== 'selected' ? <button className="btn-o btn-sm" onClick={() => void reviseIdea(idea.id, idea.title, idea.body)}>Revise</button> : null}{leader && idea.status !== 'selected' ? <button className="btn-o btn-sm" onClick={() => void beginProject(idea.id)}>Make Project</button> : null}</article>)}</div> : <div className="legacy-empty">Your suggested ideas will appear here.</div>}</div><div className="cc"><div className="cc-head"><h3>Submitted Ideas — AI Score Tracking</h3>{poll ? <span className="bdg g">Live vote open</span> : null}</div>{hub.ideas.length ? <table className="tbl"><thead><tr><th>Idea</th><th>Submitted By</th><th>Category</th><th>AI Score</th><th>Status</th></tr></thead><tbody>{hub.ideas.map((idea) => <tr key={idea.id}><td><strong>{idea.title}</strong></td><td>{idea.authorId === userId ? 'You' : 'Group member'}</td><td>Academic Project</td><td>—</td><td><span className="bdg ac">{idea.status}</span></td></tr>)}</tbody></table> : <div className="legacy-empty">Submitted ideas will appear here.</div>}</div></>}</section>;
}
