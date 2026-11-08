import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';
import { PollStatus, votingDurations } from './PollStatus';
import { ConfirmDialog } from './ConfirmDialog';
import type { GroupHub, GroupSummary, Idea } from './types';

type IdeasPageProps = { userId: string; selectedGroupId: string; onSelectGroup: (id: string) => void; notify: (message: string) => void };
type ConfirmAction = { title: string; description: string; confirmLabel: string; destructive?: boolean; action: () => void };
type IdeaRevision = { id: string; title: string; body: string; category: string };
const ideaStatusChip: Record<Idea['status'], { label: string; tone: string }> = {
  submitted: { label: 'Pending', tone: 'y' },
  refined: { label: 'Refined', tone: 'ac' },
  selected: { label: 'Selected', tone: 'g' },
  rejected: { label: 'Rejected', tone: 'r' },
};

export function IdeasPage({ userId, selectedGroupId, onSelectGroup, notify }: IdeasPageProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [hub, setHub] = useState<GroupHub | null>(null);
  const [selectedIdeas, setSelectedIdeas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [voteHours, setVoteHours] = useState<number | null>(12);
  const [ideaLimit, setIdeaLimit] = useState(10);
  const [showAllIdeas, setShowAllIdeas] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [revision, setRevision] = useState<IdeaRevision | null>(null);

  const refreshGroups = useCallback(async () => {
    const next = await request<GroupSummary[]>('/groups');
    setGroups(next);
    if (!selectedGroupId && next[0]) onSelectGroup(next[0].id);
  }, [onSelectGroup, selectedGroupId]);
  const refreshHub = useCallback(async () => {
    if (!selectedGroupId) return setHub(null);
    setHub(await request<GroupHub>(`/groups/${selectedGroupId}/hub`));
  }, [selectedGroupId]);

  useEffect(() => { void refreshGroups().catch((error: Error) => notify(error.message)).finally(() => setLoading(false)); }, [refreshGroups, notify]);
  useEffect(() => { setSelectedIdeas([]); setShowAllIdeas(false); void refreshHub().catch((error: Error) => notify(error.message)); }, [refreshHub, notify]);
  useEffect(() => { void request<{ maxIdeasPerSearch: number }>('/settings/general').then((settings) => setIdeaLimit(settings.maxIdeasPerSearch)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!selectedGroupId) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socket.on('connect', () => socket.emit('group:join', selectedGroupId, () => undefined));
    socket.on('poll:tally', (tally: { groupId?: string }) => { if (tally.groupId === selectedGroupId) void refreshHub().catch(() => undefined); });
    return () => { socket.disconnect(); };
  }, [selectedGroupId, refreshHub]);

  const membership = useMemo(() => hub?.group.members.find((member) => member.userId === userId), [hub, userId]);
  const leader = membership?.role === 'Project_Leader';
  // `hub.poll` is the group's latest vote, even a finished one; only a running vote blocks starting the next.
  const poll = hub?.poll?.open ? hub.poll : null;
  const visibleIdeas = hub?.ideas.filter((idea) => idea.status !== 'rejected') ?? [];
  const selectedEligibleIdeas = visibleIdeas.filter((idea) => selectedIdeas.includes(idea.id) && (idea.status === 'submitted' || idea.status === 'refined'));

  async function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroupId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try { await request(`/groups/${selectedGroupId}/ideas`, { method: 'POST', body: JSON.stringify({ title: data.get('title'), body: data.get('body') }) }); form.reset(); await refreshHub(); notify(`Idea submitted to ${hub?.group.name ?? 'the group'}.`); }
    catch (error: any) { notify(error.message); }
  }
  async function saveRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revision) return;
    const data = new FormData(event.currentTarget);
    try { await request(`/ideas/${revision.id}`, { method: 'PATCH', body: JSON.stringify({ title: data.get('title'), body: data.get('body'), category: data.get('category') }) }); setRevision(null); await refreshHub(); notify('Idea revision saved.'); }
    catch (error: any) { notify(error.message); }
  }
  async function rejectIdea(id: string) {
    try { await request(`/ideas/${id}/reject`, { method: 'POST' }); await refreshHub(); notify('Idea rejected.'); }
    catch (error: any) { notify(error.message); }
  }
  async function deleteIdea(id: string) {
    try { await request(`/ideas/${id}`, { method: 'DELETE' }); await refreshHub(); notify('Idea deleted.'); }
    catch (error: any) { notify(error.message); }
  }
  async function createPoll() {
    if (!selectedGroupId || selectedEligibleIdeas.length < 2) return notify('Select at least two ideas to start a vote.');
    try { await request(`/groups/${selectedGroupId}/polls`, { method: 'POST', body: JSON.stringify({ ideaIds: selectedEligibleIdeas.map((idea) => idea.id), durationHours: voteHours }) }); setSelectedIdeas([]); await refreshHub(); notify(`Live vote opened in ${hub?.group.name ?? 'the group'} chat${voteHours ? ` — voting closes in ${votingDurations.find((option) => option.hours === voteHours)?.label ?? `${voteHours} hours`}` : ''}.`); }
    catch (error: any) { notify(error.message); }
  }
  async function closeVoting() {
    if (!hub?.poll) return;
    try { await request(`/polls/${hub.poll.pollId}/close`, { method: 'POST' }); await refreshHub(); notify('Voting is closed.'); }
    catch (error: any) { notify(error.message); }
  }
  async function vote(optionId: string) {
    if (!hub?.poll) return;
    try { await request(`/polls/${hub.poll.pollId}/vote`, { method: 'POST', body: JSON.stringify({ optionId }) }); await refreshHub(); }
    catch (error: any) { notify(error.message); }
  }
  async function beginProject(ideaId: string) {
    if (!selectedGroupId) return;
    try { await request(`/groups/${selectedGroupId}/ideas/${ideaId}/begin`, { method: 'POST' }); await refreshHub(); notify(`Project created for ${hub?.group.name ?? 'the group'}.`); }
    catch (error: any) { notify(error.message); }
  }
  return <section className="sp on ideas-page">
    <div className="ph">
      <div><h2>Idea Management</h2><div className="ph-sub">Ideas belong to a specific group and its Group Chat.</div></div>
      <div className="ph-acts">
        <label className="idea-group-picker"><span>Idea board for</span><select className="legacy-select" value={selectedGroupId} onChange={(event) => onSelectGroup(event.target.value)}><option value="">Select a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      </div>
    </div>
    {loading ? <div className="cc"><div className="legacy-empty">Loading ideas…</div></div> : !hub ? <div className="cc"><div className="legacy-empty"><strong>Your workspace is ready</strong><span>Select a group to view or submit its ideas.</span></div></div> : <>
      <div className="idea-group-context"><span>Group Chat idea board</span><strong>{hub.group.name}</strong><small>{hub.group.members.length} member{hub.group.members.length === 1 ? '' : 's'} · Ideas and votes here belong only to this group.</small></div>
      <div className="cc"><div className="cc-head"><h3>Submit an idea · {hub.group.name}</h3></div><p className="idea-generator-copy">Add an academic project idea for <strong>{hub.group.name}</strong>. Discuss these ideas in that group’s chat, then use its vote to choose a project.</p><form className="idea-submit-row" onSubmit={submitIdea}><input className="ifield" name="title" required minLength={2} maxLength={50} aria-label="Idea title" placeholder="Idea title" /><textarea className="ifield" name="body" maxLength={5000} aria-label="Idea details" placeholder="Idea details (optional)" /><button className="btn">Submit to {hub.group.name}</button></form></div>
      <div className="cc"><div className="cc-head"><h3>Ideas for {hub.group.name}</h3><div className="ph-acts">{leader && !poll ? <label className="vote-duration"><span>Voting time</span><select className="legacy-select" value={voteHours ?? ''} onChange={(event) => setVoteHours(event.target.value ? Number(event.target.value) : null)}>{votingDurations.map((option) => <option key={option.label} value={option.hours ?? ''}>{option.label}</option>)}</select></label> : null}{leader && !poll ? <button className="btn btn-sm" disabled={selectedEligibleIdeas.length < 2} onClick={() => void createPoll()}>Start Live Vote</button> : null}</div></div>{visibleIdeas.length ? <div>{(showAllIdeas ? visibleIdeas : visibleIdeas.slice(0, ideaLimit)).map((idea, index) => <article className="legacy-idea-card" key={idea.id}><span className="idea-num">{index + 1}</span><div className="idea-card-copy"><strong className="idea-title">{idea.title}</strong>{idea.body ? <span className="idea-meta">{idea.body}</span> : null}</div><div className="idea-card-actions">{leader && !poll && (idea.status === 'submitted' || idea.status === 'refined') ? <label className="idea-select"><input type="checkbox" aria-label={`Select ${idea.title} for voting`} checked={selectedIdeas.includes(idea.id)} onChange={(event) => setSelectedIdeas((current) => event.target.checked ? [...current, idea.id] : current.filter((id) => id !== idea.id))} /> Select</label> : null}{idea.authorId === userId && idea.status !== 'selected' ? <button className="btn-o btn-sm" onClick={() => setRevision({ id: idea.id, title: idea.title, body: idea.body, category: idea.category })}>Revise</button> : null}{idea.authorId === userId && idea.status !== 'selected' ? <button className="btn-o btn-sm" onClick={() => setConfirmation({ title: 'Reject idea?', description: 'This idea will be rejected and cannot be restored.', confirmLabel: 'Reject idea', destructive: true, action: () => void rejectIdea(idea.id) })}>Reject</button> : null}{idea.authorId === userId && idea.status !== 'selected' ? <button className="btn-o btn-sm btn-red" onClick={() => setConfirmation({ title: 'Delete idea?', description: 'This idea will be permanently deleted and cannot be restored.', confirmLabel: 'Delete idea', destructive: true, action: () => void deleteIdea(idea.id) })}>Delete</button> : null}{leader && idea.status !== 'selected' ? <button className="btn-o btn-sm" onClick={() => void beginProject(idea.id)}>Make Project</button> : null}</div></article>)}{visibleIdeas.length > ideaLimit ? <button type="button" className="btn-o btn-sm" onClick={() => setShowAllIdeas((value) => !value)}>{showAllIdeas ? `Show first ${ideaLimit}` : `Show all ${visibleIdeas.length} ideas`}</button> : null}</div> : <div className="legacy-empty">No ideas for {hub.group.name} yet.</div>}</div>
      <div className="cc"><div className="cc-head"><h3>Submitted Ideas · {hub.group.name}</h3>{hub.poll ? <div className="ph-acts"><PollStatus poll={hub.poll} onExpired={refreshHub} />{poll && leader ? <button className="btn-o btn-sm" onClick={() => setConfirmation({ title: 'Close voting?', description: 'Members will no longer be able to vote in this poll.', confirmLabel: 'Close voting', action: () => void closeVoting() })}>Close voting</button> : null}</div> : null}</div>{visibleIdeas.length ? <div className="ideas-table-scroll" role="region" aria-label="Submitted ideas" tabIndex={0}><table className="tbl"><thead><tr><th>Idea</th><th>Submitted By</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleIdeas.map((idea) => <tr key={idea.id}><td><strong>{idea.title}</strong></td><td>{idea.authorId === userId ? 'You' : 'Group member'}</td><td><span className={`bdg ${ideaStatusChip[idea.status].tone}`}>{ideaStatusChip[idea.status].label}</span></td><td>{idea.authorId === userId && idea.status !== 'selected' ? <button type="button" className="btn-o btn-sm btn-red" onClick={() => setConfirmation({ title: 'Delete idea?', description: 'This idea will be permanently deleted and cannot be restored.', confirmLabel: 'Delete idea', destructive: true, action: () => void deleteIdea(idea.id) })}>Delete</button> : '—'}</td></tr>)}</tbody></table></div> : <div className="legacy-empty">Submitted ideas for {hub.group.name} will appear here.</div>}</div>
    </>}{revision ? <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) setRevision(null); }}><div className="modal-box security-modal" role="dialog" aria-modal="true" aria-labelledby="revise-idea-title"><div className="modal-ttl"><span id="revise-idea-title">Revise idea</span><button type="button" className="modal-close" aria-label="Close idea revision" onClick={() => setRevision(null)}>×</button></div><form onSubmit={saveRevision}><label className="lbl">Title</label><input className="ifield" name="title" required minLength={2} maxLength={50} defaultValue={revision.title} /><label className="lbl">Details</label><textarea className="ifield" name="body" defaultValue={revision.body} /><label className="lbl">Category</label><input className="ifield" name="category" required minLength={2} maxLength={120} defaultValue={revision.category} /><div className="modal-acts"><button type="button" className="btn-o" onClick={() => setRevision(null)}>Cancel</button><button className="btn">Save changes</button></div></form></div></div> : null}{confirmation ? <ConfirmDialog {...confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); action(); }} /> : null}
  </section>;
}
