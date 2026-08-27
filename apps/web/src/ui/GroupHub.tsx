import { FormEvent } from 'react';
import type { GroupHub as GroupHubData } from './types';

type GroupHubProps = { hub: GroupHubData; userId: string; onAdd: (email: string) => Promise<void>; onRemove: (userId: string) => Promise<void>; onIdeas: () => void; notify: (message: string) => void };

export function GroupHub({ hub, userId, onAdd, onRemove, onIdeas, notify }: GroupHubProps) {
  const membership = hub.group.members.find((member) => member.userId === userId);
  const leader = membership?.role === 'Project_Leader';
  const invitation = hub.group.joinCodes[0]?.code;
  const previewIdeas = hub.ideas.slice(0, 3);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email') ?? '').trim();
    if (!email) return;
    await onAdd(email);
    form.reset();
  }

  async function copyCode() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation); notify('Invitation code copied.'); } catch { notify(`Invitation code: ${invitation}`); }
  }

  return <section className="panel hub">
    <header className="panel-heading"><div><span className="eyebrow">Collaboration hub</span><h2>{hub.group.name}</h2></div><button className="button primary" onClick={onIdeas}>Open ideas</button></header>
    <div className="hub-grid">
      <div>
        <h3>Invite members</h3>
        {invitation ? <div className="invite-code"><span>Share this code</span><strong>{invitation}</strong><button className="button secondary small" onClick={copyCode}>Copy</button></div> : <p className="muted">No active invitation code.</p>}
        <form className="inline-form" onSubmit={addMember}><input aria-label="Member email" name="email" placeholder="Member email" type="email" /><button className="button secondary small">Add</button></form>
        <h3 className="section-title">Members · {hub.group.members.length}</h3>
        <div className="member-list">{hub.group.members.map((member) => <div className="member" key={member.userId}><span className="avatar">{member.user.fullName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span className="member-name">{member.user.fullName}</span><span className="pill">{member.role === 'Project_Leader' ? 'Leader' : 'Member'}</span>{leader && member.userId !== userId ? <button className="text-button danger" onClick={() => void onRemove(member.userId)}>Remove</button> : null}</div>)}</div>
      </div>
      <div>
        <h3>Idea board</h3>
        {previewIdeas.length ? <ul className="idea-preview">{previewIdeas.map((idea) => <li key={idea.id}><strong>{idea.title}</strong><span>{idea.status}</span></li>)}</ul> : <p className="muted">Your group’s first idea starts here.</p>}
        <h3 className="section-title">Activity</h3>
        <p className="muted">{hub.messages.length ? `${hub.messages.length} recent chat messages` : 'Your group activity starts here.'}</p>
        <p className="muted">{hub.group.projects.length} projects created from this group.</p>
      </div>
    </div>
  </section>;
}
