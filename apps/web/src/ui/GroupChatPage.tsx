import { FormEvent, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CallHostAction, CallKind, CallParticipant, CallSignal } from '@websphere/shared';
import { getAccessToken, request, socketBaseUrl } from '../api';
import { GroupAvatar } from './GroupAvatar';
import type { GroupHub, GroupSummary, Poll } from './types';

type Props = { userId: string; selectedGroupId: string; onSelectGroup: (id: string) => void; notify: (message: string) => void; incomingCall: { groupId: string; kind: CallKind } | null; onIncomingCallHandled: () => void };
type ActiveCall = { groupId: string; kind: CallKind };
type RemoteStream = { socketId: string; userId: string; stream: MediaStream };

function mediaDeviceErrorMessage(error: unknown, kind: CallKind) {
  const name = error instanceof DOMException ? error.name : '';
  const deviceName = kind === 'video' ? 'microphone or camera' : 'microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Please allow ${deviceName} access to join the call.`;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return `No ${deviceName} was found. Connect or enable one, then try again.`;
  if (name === 'NotReadableError' || name === 'TrackStartError') return `Your ${deviceName} is being used by another application. Close it, then try again.`;
  if (name === 'AbortError') return `Could not start the ${deviceName}. Please try again.`;
  return error instanceof Error ? error.message : 'Could not start the call.';
}

function MediaTile({ label, stream, muted, local, presenting, handRaised }: { label: string; stream: MediaStream; muted?: boolean; local?: boolean; presenting?: boolean; handRaised?: boolean }) {
  const media = useRef<HTMLVideoElement | null>(null);
  const hasVideo = stream.getVideoTracks().some((track) => track.enabled);
  useEffect(() => { if (media.current) media.current.srcObject = stream; }, [stream]);
  return <div className={`call-media-tile ${hasVideo ? 'has-video' : ''} ${presenting ? 'is-presenting' : ''}`}>
    <video ref={media} autoPlay playsInline muted={muted} />
    {!hasVideo ? <span className="call-avatar">{label.slice(0, 1).toUpperCase()}</span> : null}
    {handRaised ? <span className="call-hand-indicator" aria-label={`${local ? 'You have' : `${label} has`} raised a hand`} title="Hand raised"><CallIcon name="hand" /></span> : null}
    <small>{local ? 'You' : label}{presenting ? ' is presenting' : ''}</small>
  </div>;
}

function CallIcon({ name }: { name: 'microphone' | 'microphoneOff' | 'camera' | 'cameraOff' | 'screen' | 'people' | 'phone' | 'hand' | 'more' }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'microphone' || name === 'microphoneOff') return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17v4M8.5 21h7" />{name === 'microphoneOff' ? <path d="M4 4l16 16" /> : null}</svg>;
  if (name === 'camera' || name === 'cameraOff') return <svg {...common}><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 5-3v10l-5-3" />{name === 'cameraOff' ? <path d="M4 4l16 16" /> : null}</svg>;
  if (name === 'screen') return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
  if (name === 'hand') return <svg {...common}><path d="M8 11V5a1.5 1.5 0 0 1 3 0v5V3a1.5 1.5 0 0 1 3 0v7V5a1.5 1.5 0 0 1 3 0v7l.6-1.1a1.7 1.7 0 0 1 3 1.5L18 18.8A4 4 0 0 1 14.4 21H12a4 4 0 0 1-3.2-1.6L5.2 14a1.7 1.7 0 1 1 2.8-2z" /></svg>;
  if (name === 'people') return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.5a3 3 0 0 1 0 5.8M19.5 20v-2a5.5 5.5 0 0 0-2.8-4.8" /></svg>;
  if (name === 'phone') return <svg {...common}><path d="M7.6 3.5 10 7l-1.8 2.2a14 14 0 0 0 6.6 6.6L17 14l3.5 2.4-1 3.4c-.3 1-1.3 1.6-2.3 1.3C9.5 19 5 14.5 2.9 6.8c-.3-1 .3-2 1.3-2.3z" /></svg>;
  return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
}

function MemberAvatar({ name, avatarUrl, className = '' }: { name: string; avatarUrl?: string | null; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const classes = `gc-member-avatar ${className}`.trim();
  const color = avatarColor(name);
  return avatarUrl ? <img className={classes} src={avatarUrl} alt={`${name}'s profile picture`} /> : <svg className={`${classes} fallback`} viewBox="0 0 40 40" role="img" aria-label={`${name}'s initials`}><title>{`${name}'s initials`}</title><circle cx="20" cy="20" r="20" fill={color} /><text x="20" y="21" fill="#fff" fontFamily="Outfit, sans-serif" fontSize="13" fontWeight="800" textAnchor="middle" dominantBaseline="central">{initials || '?'}</text></svg>;
}

function avatarColor(name: string) {
  const palette = ['#0f6cbd', '#0f766e', '#7c3aed', '#c2410c', '#be185d', '#4f46e5', '#047857'];
  const hash = [...name].reduce((value, character) => (value * 31 + character.codePointAt(0)!) >>> 0, 0);
  return palette[hash % palette.length];
}

function IdeaVoteCard({ option, totalVotes, viewerOptionId, viewerId, onVote }: { option: Poll['options'][number]; totalVotes: number; viewerOptionId: string | null; viewerId: string; onVote: (optionId: string) => void }) {
  const chosen = viewerOptionId === option.optionId;
  const percentage = totalVotes ? Math.round(option.votes / totalVotes * 100) : 0;
  const voters = option.voters.map((voter) => voter.userId === viewerId ? 'You' : voter.fullName);
  return <article className={`gc-poll-option ${chosen ? 'chosen' : ''}`}>
    <div className="gc-poll-option-heading"><strong>{option.label}</strong><span>{option.votes} vote{option.votes === 1 ? '' : 's'}</span></div>
    <div className="gc-vote-meter" aria-label={`${option.votes} votes`}><span style={{ width: `${percentage}%` }} /></div>
    <p className="gc-voter-list">{voters.length ? voters.join(', ') : 'No votes yet'}</p>
    <button type="button" aria-pressed={chosen} className={chosen ? 'voted' : ''} onClick={() => onVote(option.optionId)}>{chosen ? 'Voted' : 'Vote'}</button>
  </article>;
}

export function GroupChatPage({ userId, selectedGroupId, onSelectGroup, notify, incomingCall, onIncomingCallHandled }: Props) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [hub, setHub] = useState<GroupHub | null>(null);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [hostSocketId, setHostSocketId] = useState<string | null>(null);
  const [presenterSocketId, setPresenterSocketId] = useState<string | null>(null);
  const [presentationStream, setPresentationStream] = useState<MediaStream | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [raisedHandSocketIds, setRaisedHandSocketIds] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const presentationStreamRef = useRef<MediaStream | null>(null);
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
    presentationStreamRef.current?.getTracks().forEach((track) => track.stop());
    presentationStreamRef.current = null;
    callRef.current = null;
    iceServersRef.current = [];
    setCall(null);
    setRemoteStreams([]);
    setMuted(false);
    setCameraEnabled(false);
    setHostSocketId(null);
    setPresenterSocketId(null);
    setPresentationStream(null);
    setPeopleOpen(false);
    setRaisedHandSocketIds([]);
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
    const presentation = presentationStreamRef.current;
    const sharedVideo = presentation?.getVideoTracks()[0];
    if (sharedVideo) {
      const videoSender = peer.getSenders().find((sender) => sender.track?.kind === 'video');
      if (videoSender) await videoSender.replaceTrack(sharedVideo);
    }
    presentation?.getAudioTracks().forEach((track) => peer.addTrack(track, presentation));
    peer.onicecandidate = (event) => { if (event.candidate) void sendSignal(participant.socketId, { type: 'ice-candidate', candidate: event.candidate.toJSON() }); };
    peer.ontrack = (event) => {
      const incoming = event.streams[0];
      if (incoming) setRemoteStreams((current) => {
        const existing = current.find((item) => item.socketId === participant.socketId);
        const stream = existing?.stream ?? new MediaStream();
        incoming.getTracks().forEach((track) => { if (!stream.getTracks().some((currentTrack) => currentTrack.id === track.id)) stream.addTrack(track); });
        return [...current.filter((item) => item.socketId !== participant.socketId), { socketId: participant.socketId, userId: peerUserIdsRef.current.get(participant.socketId) ?? '', stream }];
      });
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
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calling is not supported by this browser. Use a current version of Chrome, Edge, Firefox, or Safari.');
      const relay = await request<{ iceServers: RTCIceServer[] }>(`/groups/${selectedGroupId}/realtime/ice-servers`);
      iceServersRef.current = relay.iceServers;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
      localStreamRef.current = stream;
      const active = { groupId: selectedGroupId, kind };
      callRef.current = active;
      setCall(active);
      setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));
      const result = await new Promise<{ ok: boolean; participants?: CallParticipant[]; hostSocketId?: string; raisedHandSocketIds?: string[]; error?: { message?: string } }>((resolve) => socketRef.current?.emit('call:join', active, resolve));
      if (!result?.ok) throw new Error(result?.error?.message ?? 'Could not join the call.');
      setHostSocketId(result.hostSocketId ?? null);
      setRaisedHandSocketIds(result.raisedHandSocketIds ?? []);
      onIncomingCallHandled();
      // Existing callers create the offer when this socket joins; the joiner waits for it to avoid offer glare.
      for (const participant of result.participants ?? []) await createPeer(participant, false);
    } catch (error: unknown) {
      clearCall();
      notify(mediaDeviceErrorMessage(error, kind));
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

  async function stopPresenting(notifyOthers = true) {
    const presentation = presentationStreamRef.current;
    if (!presentation) return;
    presentation.getVideoTracks().forEach((track) => { track.onended = null; });
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    await Promise.all([...peersRef.current.values()].map(async (peer) => {
      const videoSender = peer.getSenders().find((sender) => sender.track?.kind === 'video');
      if (videoSender) await videoSender.replaceTrack(cameraTrack);
      presentation.getAudioTracks().forEach((track) => {
        const sender = peer.getSenders().find((candidate) => candidate.track?.id === track.id);
        if (sender) peer.removeTrack(sender);
      });
    }));
    presentation.getTracks().forEach((track) => track.stop());
    presentationStreamRef.current = null;
    setPresentationStream(null);
    setPresenterSocketId(null);
    if (notifyOthers && callRef.current && socketRef.current) socketRef.current.emit('call:screen-share', { groupId: callRef.current.groupId, sharing: false }, () => undefined);
  }

  async function togglePresenting() {
    if (!callRef.current || !navigator.mediaDevices?.getDisplayMedia) return notify('Screen sharing is not supported by this browser.');
    if (presentationStreamRef.current) return void stopPresenting();
    try {
      const presentation = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const videoTrack = presentation.getVideoTracks()[0];
      if (!videoTrack) throw new Error('No display was selected.');
      presentationStreamRef.current = presentation;
      setPresentationStream(presentation);
      setPresenterSocketId(socketRef.current?.id ?? 'local');
      videoTrack.onended = () => { void stopPresenting(); };
      await Promise.all([...peersRef.current.values()].map(async (peer) => {
        const videoSender = peer.getSenders().find((sender) => sender.track?.kind === 'video');
        if (videoSender) await videoSender.replaceTrack(videoTrack);
        presentation.getAudioTracks().forEach((track) => peer.addTrack(track, presentation));
      }));
      socketRef.current?.emit('call:screen-share', { groupId: callRef.current.groupId, sharing: true }, () => undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      notify(error instanceof Error ? error.message : 'Could not start screen sharing.');
    }
  }

  function requestHostAction(action: CallHostAction, targetSocketId?: string) {
    const active = callRef.current;
    if (!active || !socketRef.current) return;
    socketRef.current.emit('call:host-action', { groupId: active.groupId, action, targetSocketId }, (result: { ok: boolean; error?: { message?: string } }) => {
      if (!result?.ok) notify(result?.error?.message ?? 'That host action could not be completed.');
      else if (action === 'mute-all') notify('All other participants were asked to mute.');
    });
  }

  function toggleRaiseHand() {
    const active = callRef.current;
    const socketId = socketRef.current?.id;
    if (!active || !socketId || !socketRef.current) return;
    const raised = !raisedHandSocketIds.includes(socketId);
    setRaisedHandSocketIds((current) => raised ? [...new Set([...current, socketId])] : current.filter((id) => id !== socketId));
    socketRef.current.emit('call:raise-hand', { groupId: active.groupId, raised }, (result: { ok: boolean; error?: { message?: string } }) => {
      if (!result?.ok) {
        setRaisedHandSocketIds((current) => raised ? current.filter((id) => id !== socketId) : [...new Set([...current, socketId])]);
        notify(result?.error?.message ?? 'Could not update your raised hand.');
      }
    });
  }

  useEffect(() => {
    if (!selectedGroupId) return;
    const socket = io(socketBaseUrl(), { path: '/socket.io', auth: { token: getAccessToken() } });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('group:join', selectedGroupId, () => undefined));
    socket.on('chat:message', (message: GroupHub['messages'][number]) => setHub((current) => current ? { ...current, messages: [message, ...current.messages.filter((item) => item.id !== message.id)] } : current));
    socket.on('call:participant-joined', (event: { groupId: string; participant: CallParticipant; hostSocketId: string }) => { if (event.groupId === callRef.current?.groupId) { setHostSocketId(event.hostSocketId); void createPeer(event.participant, true); } });
    socket.on('call:participant-left', (event: { groupId: string; socketId: string }) => { if (event.groupId === callRef.current?.groupId) removePeer(event.socketId); });
    socket.on('call:signal', (event: { groupId: string; fromSocketId: string; signal: CallSignal }) => { if (event.groupId === callRef.current?.groupId) void acceptSignal(event.fromSocketId, event.signal); });
    socket.on('call:host-changed', (event: { groupId: string; hostSocketId: string | null }) => { if (event.groupId === callRef.current?.groupId) setHostSocketId(event.hostSocketId); });
    socket.on('call:screen-share', (event: { groupId: string; socketId: string; sharing: boolean }) => { if (event.groupId === callRef.current?.groupId) setPresenterSocketId(event.sharing ? event.socketId : (current) => current === event.socketId ? null : current); });
    socket.on('call:raise-hand', (event: { groupId: string; socketId: string; raised: boolean }) => { if (event.groupId === callRef.current?.groupId) setRaisedHandSocketIds((current) => event.raised ? [...new Set([...current, event.socketId])] : current.filter((id) => id !== event.socketId)); });
    socket.on('call:mute-request', (event: { groupId: string }) => { if (event.groupId === callRef.current?.groupId) { localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; }); setMuted(true); notify('The host asked everyone to mute.'); } });
    socket.on('call:removed', (event: { groupId: string }) => { if (event.groupId === callRef.current?.groupId) { clearCall(); notify('The host removed you from this meeting.'); } });
    socket.on('call:ended', (event: { groupId: string }) => { if (event.groupId === callRef.current?.groupId) { clearCall(); notify('The host ended the meeting.'); } });
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

  const participantName = (participantUserId: string) => hub?.group.members.find((member) => member.userId === participantUserId)?.user.fullName ?? 'Group member';
  const ownSocketId = socketRef.current?.id ?? null;
  const isHost = !!ownSocketId && ownSocketId === hostSocketId;
  return <section className="sp on">
    <div className="ph"><h2>Group Chat</h2></div>
    {incomingCall ? <div className="call-invite"><span>{incomingCall.kind === 'video' ? 'Video' : 'Voice'} call in progress</span><button className="btn btn-sm" onClick={() => void joinCall(incomingCall.kind)}>Join call</button><button className="btn-o btn-sm" onClick={onIncomingCallHandled}>Dismiss</button></div> : null}
    {call ? <div className="call-stage" role="dialog" aria-modal="true" aria-label={`${call.kind === 'video' ? 'Video' : 'Voice'} call`}>
      <header className="call-stage-head"><div><strong>{hub?.group.name ?? 'Group meeting'}</strong><span>{call.kind === 'video' ? 'Video meeting' : 'Voice meeting'} · {remoteStreams.length + 1} participant{remoteStreams.length ? 's' : ''}</span></div><div className="call-stage-status"><span className="call-live-dot" />{isHost ? 'You are host' : 'In meeting'}</div></header>
      <main className={`call-media-grid ${presenterSocketId ? 'has-presentation' : ''}`}>
        {presentationStream ? <MediaTile label="You" stream={presentationStream} muted local presenting handRaised={!!ownSocketId && raisedHandSocketIds.includes(ownSocketId)} /> : null}
        {remoteStreams.map((item) => <MediaTile key={item.socketId} label={participantName(item.userId)} stream={item.stream} presenting={item.socketId === presenterSocketId} handRaised={raisedHandSocketIds.includes(item.socketId)} />)}
        <MediaTile label="You" stream={localStreamRef.current!} muted local handRaised={!!ownSocketId && raisedHandSocketIds.includes(ownSocketId)} />
      </main>
      {peopleOpen ? <aside className="call-people-panel"><div className="call-people-head"><strong>People</strong><button type="button" onClick={() => setPeopleOpen(false)} aria-label="Close people panel" title="Close people panel">×</button></div><div className="call-person-row"><span>You {isHost ? '(Host)' : ''}</span>{ownSocketId && raisedHandSocketIds.includes(ownSocketId) ? <small className="call-hand-state">Hand raised</small> : <small>In meeting</small>}</div>{remoteStreams.map((item) => <div className="call-person-row" key={item.socketId}><span>{participantName(item.userId)}{item.socketId === hostSocketId ? ' (Host)' : ''}</span>{isHost ? <button type="button" className="call-remove" onClick={() => requestHostAction('remove-participant', item.socketId)}>Remove</button> : raisedHandSocketIds.includes(item.socketId) ? <small className="call-hand-state">Hand raised</small> : <small>In meeting</small>}</div>)}{isHost ? <div className="call-host-actions"><strong>Host controls</strong><button type="button" onClick={() => requestHostAction('mute-all')}>Mute all</button><button type="button" className="call-end-all" onClick={() => requestHostAction('end-call')}>End call for everyone</button></div> : null}</aside> : null}
      <footer className="call-controls"><button type="button" className={`call-control ${muted ? 'is-off' : ''}`} onClick={toggleMute} aria-label={muted ? 'Turn microphone on' : 'Turn microphone off'} title={muted ? 'Turn microphone on' : 'Turn microphone off'}><CallIcon name={muted ? 'microphoneOff' : 'microphone'} /></button>{call.kind === 'video' ? <button type="button" className={`call-control ${cameraEnabled ? '' : 'is-off'}`} onClick={toggleCamera} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'} title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}><CallIcon name={cameraEnabled ? 'camera' : 'cameraOff'} /></button> : null}<button type="button" className={`call-control ${presentationStream ? 'is-sharing' : ''}`} onClick={() => void togglePresenting()} aria-label={presentationStream ? 'Stop presenting' : 'Present screen'} title={presentationStream ? 'Stop presenting' : 'Present screen'}><CallIcon name="screen" /></button><button type="button" className={`call-control ${ownSocketId && raisedHandSocketIds.includes(ownSocketId) ? 'is-active' : ''}`} onClick={toggleRaiseHand} aria-label={ownSocketId && raisedHandSocketIds.includes(ownSocketId) ? 'Lower hand' : 'Raise hand'} title={ownSocketId && raisedHandSocketIds.includes(ownSocketId) ? 'Lower hand' : 'Raise hand'}><CallIcon name="hand" /></button><button type="button" className={`call-control ${peopleOpen ? 'is-active' : ''}`} onClick={() => setPeopleOpen((open) => !open)} aria-label="Show people and host controls" title="Show people and host controls"><CallIcon name="people" /></button><button type="button" className="call-control call-hangup" onClick={leaveCall} aria-label="Leave call" title="Leave call"><CallIcon name="phone" /></button></footer>
    </div> : null}
    <div className="gc-teams-layout">
      <aside className="gc-left-panel"><div className="gc-left-head"><h3>Chats</h3><button title="New chat">＋</button></div><div className="gc-search"><span>⌕</span><input placeholder="Search chats..." /></div><div className="gc-chat-list">{groups.length ? groups.map((group) => <button className={`gc-chat-item ${group.id === selectedGroupId ? 'active' : ''}`} key={group.id} onClick={() => onSelectGroup(group.id)}><GroupAvatar name={group.name} className="gc-list-avatar" /><span><strong>{group.name}</strong><small>{group._count.projects} projects · {group._count.ideas} ideas</small></span></button>) : <div className="gc-panel-empty">Your groups will appear here.</div>}</div><div className="gc-mini-calendar"><strong>{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><span>Your scheduled events will appear here.</span></div></aside>
      {hub ? <>
        <main className="gc-main-chat">
          <header className="gc-chat-header"><GroupAvatar name={hub.group.name} className="gc-list-avatar large" /><div><strong>{hub.group.name}</strong><span>● {hub.group.members.length} members</span></div><div className="gc-header-actions"><button disabled={!!call} onClick={() => void joinCall('voice')}>Call</button><button disabled={!!call} onClick={() => void joinCall('video')}>Video</button><button onClick={() => notify('Add members from My Groups → Group Hub.')}>Add Members</button><button>Search</button></div></header>
          <div className="gchat-msgs">{hub.messages.length ? [...hub.messages].reverse().map((message) => { const member = hub.group.members.find((value) => value.userId === message.senderId); const sender = message.senderId === userId ? 'You' : member?.user.fullName ?? 'Group member'; return <div className={`gc-msg ${message.senderId === userId ? 'me' : ''}`} key={message.id}><MemberAvatar name={member?.user.fullName ?? sender} avatarUrl={member?.user.avatarUrl} className="gc-message-avatar" /><div className="gc-bub"><div className="gc-name">{sender}</div><div className="gc-txt">{message.body}</div><div className="gc-time">{new Date(message.createdAt).toLocaleString()}</div></div></div>; }) : <div className="legacy-empty">Choose or create a group to begin a conversation.</div>}</div>
          <form className="gchat-ir" onSubmit={send}><input className="gchat-input" name="body" placeholder="Type a message to your group…" autoComplete="off" /><button className="gchat-send">Send</button></form>
        </main>
        <aside className="gc-right-panel">
          <section><div className="gc-side-title"><h3>Members</h3><span>{hub.group.members.length}</span></div>{hub.group.members.map((member) => <div className="gc-member-row" key={member.userId}><MemberAvatar name={member.user.fullName} avatarUrl={member.user.avatarUrl} /><span><strong>{member.user.fullName}</strong><small>{member.role === 'Project_Leader' ? 'Leader' : 'Member'}</small></span><i /></div>)}</section>
          <section className="gc-voting"><div className="gc-side-title"><h3>Idea Voting</h3></div>{hub.poll ? <div className="gc-poll-options">{hub.poll.options.map((option) => <IdeaVoteCard key={option.optionId} option={option} totalVotes={hub.poll.options.reduce((total, value) => total + value.votes, 0)} viewerOptionId={hub.poll.viewerOptionId} viewerId={userId} onVote={(optionId) => void vote(optionId)} />)}</div> : <div className="gc-panel-empty">Your group vote starts in Idea Management.</div>}</section>
          <button className="gc-start-project" disabled={!hub.poll} onClick={() => void startProject()}>Start Project</button>
        </aside>
      </> : <div className="gc-no-selection"><strong>Your workspace is ready</strong><span>Choose or create a group to begin a conversation.</span></div>}
    </div>
  </section>;
}
