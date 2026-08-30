import { FormEvent, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CallKind, CallParticipant, CallSignal } from '@websphere/shared';
import { getAccessToken, request, socketBaseUrl } from '../api';
import type { GroupHub, GroupSummary } from './types';

type Props = { userId: string; selectedGroupId: string; onSelectGroup: (id: string) => void; notify: (message: string) => void; incomingCall: { groupId: string; kind: CallKind } | null; onIncomingCallHandled: () => void };
type ActiveCall = { groupId: string; kind: CallKind };
type RemoteStream = { socketId: string; userId: string; stream: MediaStream };

function MediaTile({ label, stream, muted, local }: { label: string; stream: MediaStream; muted?: boolean; local?: boolean }) {
  const media = useRef<HTMLVideoElement | null>(null);
  const hasVideo = stream.getVideoTracks().some((track) => track.enabled);
  useEffect(() => { if (media.current) media.current.srcObject = stream; }, [stream]);
  return <div className={`call-media-tile ${hasVideo ? 'has-video' : ''}`}>
    <video ref={media} autoPlay playsInline muted={muted} />
    {!hasVideo ? <span className="call-avatar">{label.slice(0, 1).toUpperCase()}</span> : null}
    <small>{local ? 'You' : label}</small>
  </div>;
}

export function GroupChatPage({ userId, selectedGroupId, onSelectGroup, notify, incomingCall, onIncomingCallHandled }: Props) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [hub, setHub] = useState<GroupHub | null>(null);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const peerUserIdsRef = useRef(new Map<string, string>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const iceServersRef = useRef<RTCIceServer[]>([]);

  useEffect(() => { void request<GroupSummary[]>('/groups').then((next) => { setGroups(next); if (!selectedGroupId && next[0]) onSelectGroup(next[0].id); }).catch((error: Error) => notify(error.message)); }, [selectedGroupId, onSelectGroup, notify]);
  useEffect(() => { if (!selectedGroupId) { setHub(null); return; } void request<GroupHub>(`/groups/${selectedGroupId}/hub`).then(setHub).catch((error: Error) => notify(error.message)); }, [selectedGroupId, notify]);

  function removePeer(socketId: string) {
    peersRef.current.get(socketId)?.close();
    peersRef.current.delete(socketId);
    peerUserIdsRef.current.delete(socketId);
    pendingCandidatesRef.current.delete(socketId);
    setRemoteStreams((current) => current.filter((item) => item.socketId !== socketId));
  }

  function clearCall() {
    for (const socketId of [...peersRef.current.keys()]) removePeer(socketId);
    peersRef.current.clear();
    peerUserIdsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    callRef.current = null;
    iceServersRef.current = [];
    setCall(null);
    setRemoteStreams([]);
    setMuted(false);
    setCameraEnabled(false);
  }

  function callConfiguration(): RTCConfiguration {
    return { iceServers: iceServersRef.current };
  }

  async function sendSignal(targetSocketId: string, signal: CallSignal) {
    const active = callRef.current;
    if (!active || !socketRef.current) return;
    socketRef.current.emit('call:signal', { groupId: active.groupId, targetSocketId, signal }, () => undefined);
  }

  async function createPeer(participant: CallParticipant, offer: boolean) {
    if (peersRef.current.has(participant.socketId) || !localStreamRef.current) return peersRef.current.get(participant.socketId);
    const peer = new RTCPeerConnection(callConfiguration());
    peersRef.current.set(participant.socketId, peer);
    if (participant.userId) peerUserIdsRef.current.set(participant.socketId, participant.userId);
    localStreamRef.current.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current!));
    peer.onicecandidate = (event) => { if (event.candidate) void sendSignal(participant.socketId, { type: 'ice-candidate', candidate: event.candidate.toJSON() }); };
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) setRemoteStreams((current) => [...current.filter((item) => item.socketId !== participant.socketId), { socketId: participant.socketId, userId: peerUserIdsRef.current.get(participant.socketId) ?? '', stream }]);
    };
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'failed') { removePeer(participant.socketId); notify('A participant media connection could not be established.'); } else if (peer.connectionState === 'closed') removePeer(participant.socketId); };
    if (offer) {
      const description = await peer.createOffer();
      await peer.setLocalDescription(description);
      await sendSignal(participant.socketId, { type: 'offer', sdp: description.sdp });
    }
    return peer;
  }

  async function acceptSignal(fromSocketId: string, signal: CallSignal) {
    if (!callRef.current || !localStreamRef.current) return;
    try {
      const peer = await createPeer({ socketId: fromSocketId, userId: peerUserIdsRef.current.get(fromSocketId) ?? '' }, false);
      if (!peer) return;
      if (signal.type === 'ice-candidate' && signal.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else pendingCandidatesRef.current.set(fromSocketId, [...(pendingCandidatesRef.current.get(fromSocketId) ?? []), signal.candidate]);
        return;
      }
      if ((signal.type === 'offer' || signal.type === 'answer') && signal.sdp) {
        await peer.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
        for (const candidate of pendingCandidatesRef.current.get(fromSocketId) ?? []) await peer.addIceCandidate(candidate);
        pendingCandidatesRef.current.delete(fromSocketId);
        if (signal.type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendSignal(fromSocketId, { type: 'answer', sdp: answer.sdp });
        }
      }
    } catch { notify('Could not establish a secure media connection.'); }
  }

  async function joinCall(kind: CallKind) {
    if (!selectedGroupId || !socketRef.current || callRef.current) return;
    try {
      const relay = await request<{ iceServers: RTCIceServer[] }>(`/groups/${selectedGroupId}/realtime/ice-servers`);
      iceServersRef.current = relay.iceServers;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
      localStreamRef.current = stream;
      const active = { groupId: selectedGroupId, kind };
      callRef.current = active;
      setCall(active);
      const result = await new Promise<{ ok: boolean; participants?: CallParticipant[]; error?: { message?: string } }>((resolve) => socketRef.current?.emit('call:join', active, resolve));
      if (!result?.ok) throw new Error(result?.error?.message ?? 'Could not join the call.');
      onIncomingCallHandled();
      // Existing callers create the offer when this socket joins; the joiner waits for it to avoid offer glare.
      for (const participant of result.participants ?? []) await createPeer(participant, false);
    } catch (error: any) {
      clearCall();
      notify(error?.name === 'NotAllowedError' ? 'Please allow microphone and camera access to join the call.' : error?.message ?? 'Could not start the call.');
    }
  }

  function leaveCall() {
    const active = callRef.current;
    if (active && socketRef.current) socketRef.current.emit('call:leave', { groupId: active.groupId }, () => undefined);
    clearCall();
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  }

  useEffect(() => {
    if (!selectedGroupId) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('group:join', selectedGroupId, () => undefined));
    socket.on('chat:message', (message: GroupHub['messages'][number]) => setHub((current) => current ? { ...current, messages: [message, ...current.messages.filter((item) => item.id !== message.id)] } : current));
    socket.on('call:participant-joined', (event: { groupId: string; participant: CallParticipant }) => { if (event.groupId === callRef.current?.groupId) void createPeer(event.participant, true); });
    socket.on('call:participant-left', (event: { groupId: string; socketId: string }) => { if (event.groupId === callRef.current?.groupId) removePeer(event.socketId); });
    socket.on('call:signal', (event: { groupId: string; fromSocketId: string; signal: CallSignal }) => { if (event.groupId === callRef.current?.groupId) void acceptSignal(event.fromSocketId, event.signal); });
    return () => { if (callRef.current?.groupId === selectedGroupId) clearCall(); socketRef.current = null; socket.disconnect(); };
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

  const participantName = (userId: string) => hub?.group.members.find((member) => member.userId === userId)?.user.fullName ?? 'Group member';
  return <section className="sp on"><div className="ph"><h2>Group Chat</h2></div>{incomingCall ? <div className="call-invite"><span>{incomingCall.kind === 'video' ? 'Video' : 'Voice'} call in progress</span><button className="btn btn-sm" onClick={() => void joinCall(incomingCall.kind)}>Join call</button><button className="btn-o btn-sm" onClick={onIncomingCallHandled}>Dismiss</button></div> : null}{call ? <div className="call-stage"><div className="call-stage-head"><strong>{call.kind === 'video' ? 'Video' : 'Voice'} call · {hub?.group.name}</strong><span>{remoteStreams.length + 1} participant{remoteStreams.length ? 's' : ''}</span></div><div className="call-media-grid"><MediaTile label="You" stream={localStreamRef.current!} muted local />{remoteStreams.map((item) => <MediaTile key={item.socketId} label={participantName(item.userId)} stream={item.stream} />)}</div><div className="call-controls"><button className="btn-o btn-sm" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>{call.kind === 'video' ? <button className="btn-o btn-sm" onClick={toggleCamera}>{cameraEnabled ? 'Turn camera off' : 'Turn camera on'}</button> : null}<button className="call-hangup" onClick={leaveCall}>Leave call</button></div></div> : null}<div className="gc-teams-layout"><aside className="gc-left-panel"><div className="gc-left-head"><h3>Chats</h3><button title="New chat">＋</button></div><div className="gc-search"><span>⌕</span><input placeholder="Search chats..." /></div><div className="gc-chat-list">{groups.length ? groups.map((group) => <button className={`gc-chat-item ${group.id === selectedGroupId ? 'active' : ''}`} key={group.id} onClick={() => onSelectGroup(group.id)}><span className="gc-list-avatar">{group.name.slice(0, 2).toUpperCase()}</span><span><strong>{group.name}</strong><small>{group._count.projects} projects · {group._count.ideas} ideas</small></span></button>) : <div className="gc-panel-empty">Your groups will appear here.</div>}</div><div className="gc-mini-calendar"><strong>{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><span>Your scheduled events will appear here.</span></div></aside>{hub ? <><main className="gc-main-chat"><header className="gc-chat-header"><span className="gc-list-avatar large">{hub.group.name.slice(0, 2).toUpperCase()}</span><div><strong>{hub.group.name}</strong><span>● {hub.group.members.length} members</span></div><div className="gc-header-actions"><button disabled={!!call} onClick={() => void joinCall('voice')}>Call</button><button disabled={!!call} onClick={() => void joinCall('video')}>Video</button><button onClick={() => notify('Add members from My Groups → Group Hub.')}>Add Members</button><button>Search</button></div></header><div className="gchat-msgs">{hub.messages.length ? [...hub.messages].reverse().map((message) => { const member = hub.group.members.find((value) => value.userId === message.senderId); const sender = message.senderId === userId ? 'You' : member?.user.fullName ?? 'Group member'; return <div className={`gc-msg ${message.senderId === userId ? 'me' : ''}`} key={message.id}><span className="gc-ava">{sender === 'You' ? 'Y' : sender.slice(0, 1)}</span><div className="gc-bub"><div className="gc-name">{sender}</div><div className="gc-txt">{message.body}</div><div className="gc-time">{new Date(message.createdAt).toLocaleString()}</div></div></div>; }) : <div className="legacy-empty">Choose or create a group to begin a conversation.</div>}</div><form className="gchat-ir" onSubmit={send}><input className="gchat-input" name="body" placeholder="Type a message to your group…" autoComplete="off" /><button className="gchat-send">Send</button></form></main><aside className="gc-right-panel"><section><div className="gc-side-title"><h3>Members</h3><span>{hub.group.members.length}</span></div>{hub.group.members.map((member) => <div className="gc-member-row" key={member.userId}><span className="gc-list-avatar small">{member.user.fullName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{member.user.fullName}</strong><small>{member.role === 'Project_Leader' ? 'Leader' : 'Member'}</small></span><i /></div>)}</section><section className="gc-voting"><div className="gc-side-title"><h3>Idea Voting</h3></div><p>Vote for a project title. Most votes wins!</p>{hub.poll ? <div className="gc-poll-options">{hub.poll.options.map((option) => <div className={`gc-poll-option ${hub.poll?.viewerOptionId === option.optionId ? 'chosen' : ''}`} key={option.optionId}><span><strong>{option.label}</strong><small>{option.votes} vote{option.votes === 1 ? '' : 's'}</small></span><button onClick={() => void vote(option.optionId)}>Vote</button></div>)}</div> : <div className="gc-panel-empty">Your group vote starts in Idea Management.</div>}</section><button className="gc-start-project" disabled={!hub.poll} onClick={() => void startProject()}>Start Project</button></aside></> : <div className="gc-no-selection"><strong>Your workspace is ready</strong><span>Choose or create a group to begin a conversation.</span></div>}</div></section>;
}
