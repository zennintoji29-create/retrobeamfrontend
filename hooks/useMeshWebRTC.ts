import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : '',
);
const IS_ANDROID_WEBVIEW =
  typeof navigator !== 'undefined' &&
  /Android/.test(navigator.userAgent) &&
  (/; wv\)/.test(navigator.userAgent) || /Version\/\d/.test(navigator.userAgent));

// ─────────────────────────────────────────────────────────────────────────────
// ICE servers
// ─────────────────────────────────────────────────────────────────────────────
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443',username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy:       'max-bundle',
  rtcpMuxPolicy:      'require',
};

// ─────────────────────────────────────────────────────────────────────────────
// Media constraints
// ─────────────────────────────────────────────────────────────────────────────
const AUDIO_CONSTRAINTS: MediaTrackConstraints = IS_ANDROID_WEBVIEW
  ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 };

function buildVideoConstraints(facingMode: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  if (IS_ANDROID_WEBVIEW) return { facingMode: { ideal: facingMode } };
  if (IS_MOBILE)          return { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen share availability
// ─────────────────────────────────────────────────────────────────────────────
export const SCREEN_SHARE_SUPPORTED: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  if (IS_ANDROID_WEBVIEW) return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
})();

// ─────────────────────────────────────────────────────────────────────────────
// SDP patching — Opus prioritization, FEC, DTX, bitrate cap
// ─────────────────────────────────────────────────────────────────────────────
function patchOpusSDP(sdp: string): string {
  let r = sdp;
  const ptMatch = r.match(/a=rtpmap:(\d+) opus\/48000/i);
  const pt = ptMatch?.[1];
  if (pt) {
    r = r.replace(/^(m=audio \d+ \S+ )([\d ]+)$/m, (_m, prefix, payloads) => {
      const pts = payloads.trim().split(' ');
      return `${prefix}${[pt, ...pts.filter((p: string) => p !== pt)].join(' ')}`;
    });
  }
  r = r.replace(/a=fmtp:(\d+) (.*opus.*)\r\n/gi, (_m, fpt, params) => {
    let p = params.includes('minptime') ? params : `minptime=10;${params}`;
    p = p.replace(/useinbandfec=\d/, 'useinbandfec=1')
         .replace(/usedtx=\d/,       'usedtx=1')
         .replace(/stereo=\d/,        'stereo=0')
         .replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=32000');
    const extras: string[] = [];
    if (!p.includes('useinbandfec'))    extras.push('useinbandfec=1');
    if (!p.includes('usedtx'))          extras.push('usedtx=1');
    if (!p.includes('stereo'))          extras.push('stereo=0');
    if (!p.includes('maxaveragebitrate')) extras.push('maxaveragebitrate=32000');
    return `a=fmtp:${fpt} ${p}${extras.length ? ';' + extras.join(';') : ''}\r\n`;
  });
  if (!r.includes('b=AS:32')) {
    r = r.replace(/(m=audio [^\r\n]+\r\n(?:c=[^\r\n]+\r\n)?)/, '$1b=AS:32\r\n');
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface RemotePeer {
  peerId: string;
  username?: string;
  isHost?: boolean;
  streams: MediaStream[];
}

export interface Participant {
  peerId: string;
  name: string;
  isHost: boolean;
  role: string;
}

type SenderRole = 'audio' | 'camera' | 'screen';

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────
export function useMeshWebRTC(roomId: string, socket: Socket | null, guestName?: string) {
  const [localStream,       setLocalStream]       = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers,       setRemotePeers]       = useState<RemotePeer[]>([]);
  const [participants,      setParticipants]       = useState<Participant[]>([]);
  const [isMicOn,           setIsMicOn]           = useState(false);
  const [isCameraOn,        setIsCameraOn]         = useState(false);
  const [isScreenOn,        setIsScreenOn]         = useState(false);
  const [viewerCount,       setViewerCount]       = useState(1);

  const localStreamRef        = useRef<MediaStream | null>(null);
  const participantsRef       = useRef<Participant[]>([]);
  const peerConnections       = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates     = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef    = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);
  const senderRoles           = useRef<Map<string, Map<RTCRtpSender, SenderRole>>>(new Map());

  const audioContextRef    = useRef<AudioContext | null>(null);
  const gainNodeRef        = useRef<GainNode | null>(null);
  const compressorNodeRef  = useRef<DynamicsCompressorNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  const isMicOnRef          = useRef(false);
  const isCameraOnRef       = useRef(false);
  const isScreenOnRef       = useRef(false);
  const isUpdatingTracksRef = useRef(false);

  useEffect(() => { localStreamRef.current  = localStream;  }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // ── Audio pipeline ─────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream => {
    let ctx = audioContextRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext({ sampleRate: IS_ANDROID_WEBVIEW ? undefined : 48000 });
        audioContextRef.current = ctx;
      } catch (e) {
        console.error('AudioContext failed, using raw stream', e);
        processedStreamRef.current = rawStream;
        return rawStream;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    try {
      if (!rawStream.getAudioTracks().length) {
        processedStreamRef.current = rawStream;
        return rawStream;
      }
      const source    = ctx.createMediaStreamSource(rawStream);
      const gain      = ctx.createGain();
      // Always init to 1 — isMicOnRef hasn't been updated yet when this
      // pipeline is first built (the ref is set at the end of updateLocalTracks).
      // The track's .enabled flag is the real gate; gain handles smooth ramp.
      gain.gain.value = 1;
      gainNodeRef.current = gain;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value  = -24;
      comp.knee.value       = 12;
      comp.ratio.value      = 4;
      comp.attack.value     = 0.003;
      comp.release.value    = 0.25;
      compressorNodeRef.current = comp;

      const dest = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(comp);
      comp.connect(dest);

      const processed = new MediaStream();
      dest.stream.getAudioTracks().forEach(t => processed.addTrack(t));
      // Note: video tracks are NOT added to processedStream — they go via their own sender
      processedStreamRef.current = processed;
      return processed;
    } catch (e) {
      console.error('AudioContext pipeline failed', e);
      processedStreamRef.current = rawStream;
      return rawStream;
    }
  }, []);

  // ── leaveRoom ──────────────────────────────────────────────────────────
  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    senderRoles.current.clear();
    setRemotePeers([]);

    userMediaStreamRef.current?.getTracks().forEach(t => t.stop());
    userMediaStreamRef.current = null;
    displayMediaStreamRef.current?.getTracks().forEach(t => t.stop());
    displayMediaStreamRef.current = null;

    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    }
    gainNodeRef.current = compressorNodeRef.current = processedStreamRef.current = null;

    setLocalStream(null);
    setLocalScreenStream(null);
    localStreamRef.current = null;
    isMicOnRef.current = isCameraOnRef.current = isScreenOnRef.current = false;
    setIsMicOn(false); setIsCameraOn(false); setIsScreenOn(false);
  }, []);

  // ── replaceTracksOnPeers ───────────────────────────────────────────────
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const audioTrack  = processedStreamRef.current?.getAudioTracks()[0]   ?? null;
    const videoTrack  = userMediaStreamRef.current?.getVideoTracks()[0]    ?? null;
    const screenTrack = displayMediaStreamRef.current?.getVideoTracks()[0] ?? null;

    if (audioTrack)  audioTrack.enabled  = isMicOnRef.current;
    if (videoTrack)  videoTrack.enabled  = isCameraOnRef.current;

    for (const [peerId, pc] of Array.from(peerConnections.current.entries())) {
      const state = pc.connectionState;
      if (state === 'closed' || state === 'failed') continue;

      let roleMap = senderRoles.current.get(peerId);
      if (!roleMap) { roleMap = new Map(); senderRoles.current.set(peerId, roleMap); }

      const byRole = (role: SenderRole) =>
        Array.from(roleMap!.entries()).find(([, r]) => r === role)?.[0];

      let renegotiate = false;

      // Audio
      const aS = byRole('audio');
      if (aS) { await aS.replaceTrack(audioTrack).catch(e => console.error('replaceTrack audio', peerId, e)); }
      else if (audioTrack && processedStreamRef.current) {
        roleMap.set(pc.addTrack(audioTrack, processedStreamRef.current), 'audio');
        renegotiate = true;
      }

      // Camera
      const cS = byRole('camera');
      if (cS) { await cS.replaceTrack(videoTrack).catch(e => console.error('replaceTrack cam', peerId, e)); }
      else if (videoTrack && userMediaStreamRef.current) {
        roleMap.set(pc.addTrack(videoTrack, userMediaStreamRef.current), 'camera');
        renegotiate = true;
      }

      // Screen
      const sS = byRole('screen');
      if (sS) {
        if (screenTrack) { await sS.replaceTrack(screenTrack).catch(e => console.error('replaceTrack screen', peerId, e)); }
        else { pc.removeTrack(sS); roleMap.delete(sS); renegotiate = true; }
      } else if (screenTrack && displayMediaStreamRef.current) {
        roleMap.set(pc.addTrack(screenTrack, displayMediaStreamRef.current), 'screen');
        renegotiate = true;
      }

      if (renegotiate) {
        try {
          const offer = await pc.createOffer();
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          currentSocket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
        } catch (e) { console.error('Renegotiation failed', peerId, e); }
      }
    }
  }, [roomId]);

  // ── handlePeerLeft ─────────────────────────────────────────────────────
  const handlePeerLeft = useCallback((peerId: string) => {
    peerConnections.current.get(peerId)?.close();
    peerConnections.current.delete(peerId);
    senderRoles.current.delete(peerId);
    pendingCandidates.current.delete(peerId);
    setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
  }, []);

  // ── Socket + WebRTC effect ─────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    socket.emit('peer:join', { roomId, guestName });

    const glareState = new WeakMap<RTCPeerConnection, {
      isPolite: boolean;
      makingOfferRef: { current: boolean };
      ignoreOfferRef: { current: boolean };
    }>();

    const createPC = (peerId: string, isOfferer: boolean): RTCPeerConnection => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(peerId, pc);
      const roleMap = new Map<RTCRtpSender, SenderRole>();
      senderRoles.current.set(peerId, roleMap);

      let makingOffer = false;
      let ignoreOffer = false;
      glareState.set(pc, { isPolite: !isOfferer, makingOfferRef: { current: makingOffer }, ignoreOfferRef: { current: ignoreOffer } });

      pc.onicecandidate = e => {
        if (e.candidate)
          socket.emit('peer:ice-candidate', { candidate: e.candidate, roomId, targetSocketId: peerId });
      };

      pc.onnegotiationneeded = async () => {
        // Only the offerer (the peer who initiated) drives renegotiation.
        // The impolite side should not spontaneously send offers — that causes glare.
        if (!isOfferer) return;
        if (makingOffer || pc.signalingState !== 'stable') return;
        try {
          makingOffer = true;
          const offer = await pc.createOffer();
          // Double-check state hasn't changed while we awaited createOffer
          if (pc.signalingState !== 'stable') return;
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          socket.emit('peer:offer', { sdp: pc.localDescription, roomId, targetSocketId: peerId });
        } catch (e) { console.error('onnegotiationneeded', e); }
        finally { makingOffer = false; }
      };

      pc.ontrack = event => {
        const pAtEvent = participantsRef.current.find(p => p.peerId === peerId);
        event.track.onended = () => {
          setRemotePeers(prev => prev.map(p => p.peerId !== peerId ? p : {
            ...p, streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')),
          }));
        };
        const incoming = event.streams[0] ?? new MediaStream([event.track]);
        setRemotePeers(prev => {
          const existing = prev.find(p => p.peerId === peerId);
          if (existing) {
            let streams = [...existing.streams];
            const es = streams.find(s => s.id === incoming.id);
            if (es) { if (!es.getTracks().find(t => t.id === event.track.id)) es.addTrack(event.track); }
            else streams.push(incoming);
            streams = streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended'));
            return prev.map(p => p.peerId === peerId ? { ...p, streams } : p);
          }
          return [...prev, { peerId, username: pAtEvent?.name ?? 'Remote Peer', isHost: pAtEvent?.isHost, streams: [incoming] }];
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') { console.warn('ICE restart for', peerId); pc.restartIce(); }
        else if (pc.connectionState === 'closed') handlePeerLeft(peerId);
      };

      // Attach current tracks
      if (processedStreamRef.current) {
        processedStreamRef.current.getAudioTracks().forEach(t => { roleMap.set(pc.addTrack(t, processedStreamRef.current!), 'audio'); });
      }
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getVideoTracks().forEach(t => { roleMap.set(pc.addTrack(t, userMediaStreamRef.current!), 'camera'); });
      }
      if (displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getVideoTracks().forEach(t => { roleMap.set(pc.addTrack(t, displayMediaStreamRef.current!), 'screen'); });
      }

      // Audio priority hint
      setTimeout(() => {
        pc.getSenders().forEach(s => {
          if (s.track?.kind === 'audio') {
            const p = s.getParameters();
            if (p.encodings?.length) {
              p.encodings[0].priority = p.encodings[0].networkPriority = 'high';
              s.setParameters(p).catch(() => {});
            }
          }
        });
      }, 0);

      return pc;
    };

    const handlePeerJoined = async ({ peerId, username, isHost }: { peerId: string; username?: string; isHost?: boolean }) => {
      if (peerConnections.current.has(peerId)) return;
      setRemotePeers(prev => prev.find(p => p.peerId === peerId) ? prev : [...prev, { peerId, username, isHost, streams: [] }]);
      const pc = createPC(peerId, true);
      try {
        const offer = await pc.createOffer();
        offer.sdp = patchOpusSDP(offer.sdp ?? '');
        await pc.setLocalDescription(offer);
        socket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) { console.error('createOffer', e); }
    };

    const handlePeerOffer = async ({ sdp, peerId }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      let pc = peerConnections.current.get(peerId);
      if (!pc) pc = createPC(peerId, false);
      const gs = glareState.get(pc);
      const collision = sdp.type === 'offer' && ((gs?.makingOfferRef.current ?? false) || pc.signalingState !== 'stable');
      const ignore = !(gs?.isPolite ?? true) && collision;
      if (gs) gs.ignoreOfferRef.current = ignore;
      if (ignore) return;
      try {
        if (collision) await Promise.all([pc.setLocalDescription({ type: 'rollback' }), pc.setRemoteDescription(new RTCSessionDescription(sdp))]);
        else await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        answer.sdp = patchOpusSDP(answer.sdp ?? '');
        await pc.setLocalDescription(answer);
        socket.emit('peer:answer', { sdp: answer, roomId, targetSocketId: peerId });
        const q = pendingCandidates.current.get(peerId) ?? [];
        for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        pendingCandidates.current.delete(peerId);
      } catch (e) { console.error('handlePeerOffer', e); }
    };

    const handlePeerAnswer = async ({ sdp, peerId }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      const pc = peerConnections.current.get(peerId);
      if (!pc) return;
      const gs = glareState.get(pc);
      if (gs?.ignoreOfferRef.current) return;
      if (pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const q = pendingCandidates.current.get(peerId) ?? [];
        for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        pendingCandidates.current.delete(peerId);
      } catch (e) { console.error('handlePeerAnswer', e); }
    };

    const handleIceCandidate = async ({ candidate, peerId }: { candidate: RTCIceCandidateInit; peerId: string }) => {
      const pc = peerConnections.current.get(peerId);
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
          if ((e as DOMException).name !== 'OperationError') console.error('addIceCandidate', e);
        });
      } else {
        const q = pendingCandidates.current.get(peerId) ?? [];
        q.push(candidate);
        pendingCandidates.current.set(peerId, q);
      }
    };

    const handleParticipantsUpdate = ({ participants: up }: { participants: Participant[] }) => {
      setParticipants(up);
      participantsRef.current = up;
      setRemotePeers(prev => prev.map(peer => {
        const m = up.find(p => p.peerId === peer.peerId);
        return m ? { ...peer, username: m.name, isHost: m.isHost } : peer;
      }));
    };

    const handleHostMuted = () => {
      setIsMicOn(false); isMicOnRef.current = false;
      if (gainNodeRef.current && audioContextRef.current)
        gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.01);
      processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
    };

    const handlePeerLeftEv = ({ peerId }: { peerId: string }) => handlePeerLeft(peerId);
    const handleKicked     = () => { window.location.href = '/'; };
    const handleBanned     = () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; };
    const handleRoomEnded  = () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; };
    const handleViewers    = ({ count }: { count: number }) => setViewerCount(count);

    socket.on('peer:joined',              handlePeerJoined);
    socket.on('peer:offer',               handlePeerOffer);
    socket.on('peer:answer',              handlePeerAnswer);
    socket.on('peer:ice-candidate',       handleIceCandidate);
    socket.on('room:viewers_update',      handleViewers);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:muted',               handleHostMuted);
    socket.on('peer:left',                handlePeerLeftEv);
    socket.on('host:kicked',              handleKicked);
    socket.on('host:banned',              handleBanned);
    socket.on('room:ended',               handleRoomEnded);

    return () => {
      socket.off('peer:joined',              handlePeerJoined);
      socket.off('peer:offer',               handlePeerOffer);
      socket.off('peer:answer',              handlePeerAnswer);
      socket.off('peer:ice-candidate',       handleIceCandidate);
      socket.off('peer:left',                handlePeerLeftEv);
      socket.off('room:viewers_update',      handleViewers);
      socket.off('room:participants_update', handleParticipantsUpdate);
      socket.off('host:kicked',              handleKicked);
      socket.off('host:banned',              handleBanned);
      socket.off('room:ended',               handleRoomEnded);
      socket.off('host:muted',               handleHostMuted);
      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, guestName, leaveRoom, handlePeerLeft, replaceTracksOnPeers, buildAudioPipeline]);

  // ── updateLocalTracks ──────────────────────────────────────────────────
  const updateLocalTracks = useCallback(async ({
    targetAudio, targetVideo, targetScreen,
  }: { targetAudio?: boolean; targetVideo?: boolean; targetScreen?: boolean }) => {
    if (isUpdatingTracksRef.current) return;
    isUpdatingTracksRef.current = true;
    try {
      let mic    = targetAudio  ?? isMicOnRef.current;
      let cam    = targetVideo  ?? isCameraOnRef.current;
      let screen = targetScreen ?? isScreenOnRef.current;

      if (mic || cam) {
        if (!userMediaStreamRef.current) {
          try {
            userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
              video: cam ? buildVideoConstraints() : false,
              audio: mic ? AUDIO_CONSTRAINTS : false,
            });
          } catch (err: unknown) {
            const e = err as DOMException;
            console.warn('getUserMedia failed:', e.name);
            if (cam && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError' || e.name === 'DevicesNotFoundError')) {
              try { userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: false, audio: mic ? AUDIO_CONSTRAINTS : false }); cam = false; }
              catch { mic = cam = false; }
            } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
              if (cam && mic) {
                try { userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: false, audio: AUDIO_CONSTRAINTS }); cam = false; }
                catch { mic = cam = false; }
              } else { mic = cam = false; }
            } else if (e.name === 'OverconstrainedError' && cam) {
              try { userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: mic ? AUDIO_CONSTRAINTS : false }); }
              catch { mic = cam = false; }
            } else { mic = cam = false; }
          }
        } else {
          if (targetVideo !== undefined)
            userMediaStreamRef.current.getVideoTracks().forEach(t => { t.enabled = cam; });
        }

        if (mic && userMediaStreamRef.current?.getAudioTracks().length) {
          if (!processedStreamRef.current) buildAudioPipeline(userMediaStreamRef.current);
          if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume().catch(() => {});
          if (gainNodeRef.current && audioContextRef.current)
            gainNodeRef.current.gain.setTargetAtTime(1, audioContextRef.current.currentTime, 0.01);
          processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });
        } else if (!mic) {
          if (gainNodeRef.current && audioContextRef.current)
            gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.01);
          processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
        }
      }

      if (!mic && !cam && userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(t => t.stop());
        userMediaStreamRef.current = processedStreamRef.current = null;
        if (audioContextRef.current?.state !== 'closed') {
          audioContextRef.current?.close().catch(() => {});
          audioContextRef.current = gainNodeRef.current = compressorNodeRef.current = null;
        }
      }

      if (screen) {
        if (!SCREEN_SHARE_SUPPORTED) {
          alert(IS_MOBILE
            ? 'Screen sharing is not supported on this mobile device.'
            : 'Screen sharing is not supported in this browser.');
          screen = false;
        } else if (!displayMediaStreamRef.current) {
          try {
            displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } }, audio: false });
            const track = displayMediaStreamRef.current.getVideoTracks()[0];
            if (track) track.onended = () => updateLocalTracks({ targetScreen: false });
          } catch (e: unknown) {
            const err = e as DOMException;
            if (err.name === 'NotAllowedError') alert('Screen share permission denied.');
            else if (err.name !== 'AbortError') alert('Screen sharing failed: ' + err.message);
            screen = false;
          }
        }
      } else if (!screen && displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
        displayMediaStreamRef.current = null;
      }

      isMicOnRef.current = mic; isCameraOnRef.current = cam; isScreenOnRef.current = screen;
      setIsMicOn(mic); setIsCameraOn(cam); setIsScreenOn(screen);
      setLocalStream(userMediaStreamRef.current);
      setLocalScreenStream(displayMediaStreamRef.current);

      if (socket) await replaceTracksOnPeers(socket);
    } finally {
      isUpdatingTracksRef.current = false;
    }
  }, [socket, replaceTracksOnPeers, buildAudioPipeline]);

  const toggleMic         = useCallback(() => updateLocalTracks({ targetAudio:  !isMicOnRef.current }),    [updateLocalTracks]);
  const toggleCamera      = useCallback(() => updateLocalTracks({ targetVideo:  !isCameraOnRef.current }), [updateLocalTracks]);
  const toggleScreenShare = useCallback(() => updateLocalTracks({ targetScreen: !isScreenOnRef.current }), [updateLocalTracks]);

  return {
    localStream, localScreenStream, remotePeers, participants,
    isMicOn, isCameraOn, isScreenOn,
    toggleMic, toggleCamera, toggleScreenShare,
    viewerCount, leaveRoom,
    screenShareSupported: SCREEN_SHARE_SUPPORTED,
  };
}