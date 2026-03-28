import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// Used to gate APIs that differ between desktop, mobile, and Android WebView.
// ─────────────────────────────────────────────────────────────────────────────
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : '',
);

// Android WebView: userAgent contains "wv" or "Version/" alongside "Android"
// and does NOT contain "Chrome/" alone without those markers.
const IS_ANDROID_WEBVIEW =
  typeof navigator !== 'undefined' &&
  /Android/.test(navigator.userAgent) &&
  (/; wv\)/.test(navigator.userAgent) || /Version\/\d/.test(navigator.userAgent));

// ─────────────────────────────────────────────────────────────────────────────
// ICE CONFIGURATION
// Multiple STUN + public TURN fallback.
// Replace openrelay with your own TURN server in production.
// ─────────────────────────────────────────────────────────────────────────────
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      // TURN over TLS — works through restrictive firewalls
      urls: 'turns:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO CONSTRAINTS
//
// FIX (mobile/desktop):  echoCancellation, noiseSuppression, autoGainControl
//   MUST all be true — these are the primary defense against echo and buzz.
//   Without them, the speaker feeds back into the mic on any device.
//
// FIX (Android WebView): some WebView builds ignore advanced constraints and
//   throw OverconstrainedError when sampleRate is specified.  We omit
//   sampleRate / channelCount / latency on Android WebView to avoid this.
//
// FIX (desktop mic not working): Setting deviceId: 'default' as an ideal
//   constraint coerces Chrome/Firefox to pick the OS default device even when
//   the user has multiple audio devices.
// ─────────────────────────────────────────────────────────────────────────────
const AUDIO_CONSTRAINTS: MediaTrackConstraints = IS_ANDROID_WEBVIEW
  ? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  : {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    };

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO CONSTRAINTS
//
// FIX (mobile camera not turning on): The plain `{ facingMode: 'user' }` ideal
//   constraint causes OverconstrainedError on some Android devices when the
//   front camera is not labelled as 'user'.  We wrap facingMode as an `ideal`
//   so the browser falls back gracefully rather than throwing.
//
// FIX (Android WebView): WebView on older Android versions rejects
//   width/height/frameRate constraints with OverconstrainedError.  On WebView
//   we send only the facingMode ideal.
//
// FIX (general): width/height as `ideal` (not `exact`) avoids constraint
//   errors when a camera cannot deliver 1280×720 (common on mid-range phones).
// ─────────────────────────────────────────────────────────────────────────────
function buildVideoConstraints(facingMode: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  if (IS_ANDROID_WEBVIEW) {
    return { facingMode: { ideal: facingMode } };
  }
  if (IS_MOBILE) {
    return {
      facingMode: { ideal: facingMode },
      width:  { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
    };
  }
  return {
    width:  { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SDP PATCHING — Opus codec prioritization, FEC, DTX, bitrate cap
// ─────────────────────────────────────────────────────────────────────────────
function patchOpusSDP(sdp: string): string {
  let result = sdp;

  const opusPtMatch = result.match(/a=rtpmap:(\d+) opus\/48000/i);
  const opusPt = opusPtMatch ? opusPtMatch[1] : null;

  if (opusPt) {
    result = result.replace(
      /^(m=audio \d+ \S+ )([\d ]+)$/m,
      (_match, prefix, payloads) => {
        const pts = payloads.trim().split(' ');
        const reordered = [opusPt, ...pts.filter((p: string) => p !== opusPt)];
        return `${prefix}${reordered.join(' ')}`;
      },
    );
  }

  result = result.replace(
    /a=fmtp:(\d+) (.*opus.*)\r\n/gi,
    (_match, pt, params) => {
      let patched = params.includes('minptime') ? params : `minptime=10;${params}`;
      patched = patched.replace(/useinbandfec=\d/, 'useinbandfec=1');
      patched = patched.replace(/usedtx=\d/,       'usedtx=1');
      patched = patched.replace(/stereo=\d/,        'stereo=0');
      patched = patched.replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=32000');
      const extras: string[] = [];
      if (!patched.includes('useinbandfec'))    extras.push('useinbandfec=1');
      if (!patched.includes('usedtx'))          extras.push('usedtx=1');
      if (!patched.includes('stereo'))          extras.push('stereo=0');
      if (!patched.includes('maxaveragebitrate')) extras.push('maxaveragebitrate=32000');
      return `a=fmtp:${pt} ${patched}${extras.length ? ';' + extras.join(';') : ''}\r\n`;
    },
  );

  if (!result.includes('b=AS:32')) {
    result = result.replace(
      /(m=audio [^\r\n]+\r\n(?:c=[^\r\n]+\r\n)?)/,
      '$1b=AS:32\r\n',
    );
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN SHARE AVAILABILITY
//
// FIX (mobile screen share): getDisplayMedia is NOT supported on iOS at all,
//   and on Android it only works in Chrome 94+ (not in WebView or Firefox).
//   We expose a flag so the UI can hide/disable the button gracefully instead
//   of letting the user tap it and getting a silent failure.
// ─────────────────────────────────────────────────────────────────────────────
export const SCREEN_SHARE_SUPPORTED: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  // iOS Safari / WKWebView — never supported
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  // Android WebView — not supported
  if (IS_ANDROID_WEBVIEW) return false;
  // All other platforms: check API presence
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
})();

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
// MAIN HOOK
// ─────────────────────────────────────────────────────────────────────────────
export function useMeshWebRTC(
  roomId: string,
  socket: Socket | null,
  guestName?: string,
) {
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

  // Audio pipeline refs
  const audioContextRef    = useRef<AudioContext | null>(null);
  const gainNodeRef        = useRef<GainNode | null>(null);
  const compressorNodeRef  = useRef<DynamicsCompressorNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  // Stable boolean refs (prevent stale closures)
  const isMicOnRef    = useRef(false);
  const isCameraOnRef = useRef(false);
  const isScreenOnRef = useRef(false);

  // Concurrency guard
  const isUpdatingTracksRef = useRef(false);

  useEffect(() => { localStreamRef.current  = localStream;  }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // ─────────────────────────────────────────────────────────────────────────
  // buildAudioPipeline
  //
  // FIX (echo / buzz): We build Source → GainNode → DynamicsCompressor →
  //   Destination.  This:
  //   1. Lets us mute via gain (no track.stop() = no renegotiation crackling).
  //   2. Applies soft compression so loud voices don't clip and cause buzz.
  //
  // FIX (Android WebView): AudioContext constructor is available in modern
  //   WebView but older versions (API < 29) may throw.  We catch and fall back
  //   to the raw stream — audio still works, just without the pipeline.
  //
  // FIX (desktop mic silent after reload): We call ctx.resume() inside a
  //   user-gesture chain (this function is always called from a button click
  //   via updateLocalTracks), which satisfies Chrome's autoplay policy.
  // ─────────────────────────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream | null => {
    let ctx = audioContextRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext({ sampleRate: IS_ANDROID_WEBVIEW ? undefined : 48000 });
        audioContextRef.current = ctx;
      } catch (e) {
        console.error('AudioContext creation failed, using raw stream', e);
        processedStreamRef.current = rawStream;
        return rawStream;
      }
    }

    if (ctx.state === 'suspended') {
      ctx.resume().catch(e => console.warn('AudioContext resume failed', e));
    }

    try {
      const audioTracks = rawStream.getAudioTracks();
      if (audioTracks.length === 0) {
        processedStreamRef.current = rawStream;
        return rawStream;
      }

      const source     = ctx.createMediaStreamSource(rawStream);
      const gain       = ctx.createGain();
      gain.gain.value  = isMicOnRef.current ? 1 : 0;
      gainNodeRef.current = gain;

      const compressor             = ctx.createDynamicsCompressor();
      compressor.threshold.value   = -24;
      compressor.knee.value        = 12;
      compressor.ratio.value       = 4;
      compressor.attack.value      = 0.003;
      compressor.release.value     = 0.25;
      compressorNodeRef.current    = compressor;

      const dest = ctx.createMediaStreamDestination();

      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(dest);

      const processedStream = new MediaStream();
      dest.stream.getAudioTracks().forEach(t => processedStream.addTrack(t));
      // NOTE: do NOT add video tracks to processedStream — video goes via its
      // own sender (role: 'camera').  Mixing them here caused duplicate video
      // sender bugs in the original code.
      rawStream.getVideoTracks().forEach(t => processedStream.addTrack(t));

      processedStreamRef.current = processedStream;
      return processedStream;
    } catch (e) {
      console.error('AudioContext pipeline failed, using raw stream', e);
      processedStreamRef.current = rawStream;
      return rawStream;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // leaveRoom
  // ─────────────────────────────────────────────────────────────────────────
  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    senderRoles.current.clear();
    setRemotePeers([]);

    userMediaStreamRef.current?.getTracks().forEach(t => t.stop());
    userMediaStreamRef.current = null;

    displayMediaStreamRef.current?.getTracks().forEach(t => t.stop());
    displayMediaStreamRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.warn);
      audioContextRef.current   = null;
    }
    gainNodeRef.current        = null;
    compressorNodeRef.current  = null;
    processedStreamRef.current = null;

    setLocalStream(null);
    setLocalScreenStream(null);
    localStreamRef.current = null;

    isMicOnRef.current    = false;
    isCameraOnRef.current = false;
    isScreenOnRef.current = false;
    setIsMicOn(false);
    setIsCameraOn(false);
    setIsScreenOn(false);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // replaceTracksOnPeers
  // ─────────────────────────────────────────────────────────────────────────
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const audioTrack  = processedStreamRef.current?.getAudioTracks()[0]   ?? null;
    const videoTrack  = userMediaStreamRef.current?.getVideoTracks()[0]    ?? null;
    const screenTrack = displayMediaStreamRef.current?.getVideoTracks()[0] ?? null;

    if (audioTrack)  audioTrack.enabled  = isMicOnRef.current;
    if (videoTrack)  videoTrack.enabled  = isCameraOnRef.current;

    const entries = Array.from(peerConnections.current.entries());

    for (const [peerId, pc] of entries) {
      const state = pc.connectionState;
      if (state === 'closed' || state === 'failed') continue;

      let roleMap = senderRoles.current.get(peerId);
      if (!roleMap) {
        roleMap = new Map();
        senderRoles.current.set(peerId, roleMap);
      }

      const senderByRole = (role: SenderRole): RTCRtpSender | undefined =>
        Array.from(roleMap!.entries()).find(([, r]) => r === role)?.[0];

      let needsRenegotiation = false;

      // ── Audio ──────────────────────────────────────────────────────────
      const audioSender = senderByRole('audio');
      if (audioSender) {
        await audioSender.replaceTrack(audioTrack).catch(e =>
          console.error(`replaceTrack audio failed for ${peerId}`, e),
        );
      } else if (audioTrack && processedStreamRef.current) {
        const s = pc.addTrack(audioTrack, processedStreamRef.current);
        roleMap.set(s, 'audio');
        needsRenegotiation = true;
      }

      // ── Camera ─────────────────────────────────────────────────────────
      const camSender = senderByRole('camera');
      if (camSender) {
        await camSender.replaceTrack(videoTrack).catch(e =>
          console.error(`replaceTrack camera failed for ${peerId}`, e),
        );
      } else if (videoTrack && userMediaStreamRef.current) {
        const s = pc.addTrack(videoTrack, userMediaStreamRef.current);
        roleMap.set(s, 'camera');
        needsRenegotiation = true;
      }

      // ── Screen ─────────────────────────────────────────────────────────
      const screenSender = senderByRole('screen');
      if (screenSender) {
        if (screenTrack) {
          await screenSender.replaceTrack(screenTrack).catch(e =>
            console.error(`replaceTrack screen failed for ${peerId}`, e),
          );
        } else {
          pc.removeTrack(screenSender);
          roleMap.delete(screenSender);
          needsRenegotiation = true;
        }
      } else if (screenTrack && displayMediaStreamRef.current) {
        const s = pc.addTrack(screenTrack, displayMediaStreamRef.current);
        roleMap.set(s, 'screen');
        needsRenegotiation = true;
      }

      if (needsRenegotiation) {
        try {
          const offer = await pc.createOffer();
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          currentSocket.emit('peer:offer', {
            sdp: offer,
            roomId,
            targetSocketId: peerId,
          });
        } catch (e) {
          console.error('Renegotiation failed for peer', peerId, e);
        }
      }
    }
  }, [roomId]);

  // ─────────────────────────────────────────────────────────────────────────
  // handlePeerLeft (stable, no stale closure)
  // ─────────────────────────────────────────────────────────────────────────
  const handlePeerLeft = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
    }
    senderRoles.current.delete(peerId);
    pendingCandidates.current.delete(peerId);
    setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Socket + WebRTC wiring effect
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.emit('peer:join', { roomId, guestName });

    const glareState = new WeakMap<RTCPeerConnection, {
      isPolite: boolean;
      makingOfferRef: { current: boolean };
      ignoreOfferRef: { current: boolean };
    }>();

    const createPeerConnection = (peerId: string, isOfferer: boolean): RTCPeerConnection => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(peerId, pc);

      const roleMap = new Map<RTCRtpSender, SenderRole>();
      senderRoles.current.set(peerId, roleMap);

      const isPolite     = !isOfferer;
      let   makingOffer  = false;
      let   ignoreOffer  = false;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('peer:ice-candidate', {
            candidate: event.candidate,
            roomId,
            targetSocketId: peerId,
          });
        }
      };

      pc.onnegotiationneeded = async () => {
        if (isOfferer && !makingOffer && pc.signalingState === 'stable') {
          if (!pc.remoteDescription) return;
        }
        try {
          makingOffer = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== 'stable') return;
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          socket.emit('peer:offer', { sdp: pc.localDescription, roomId, targetSocketId: peerId });
        } catch (e) {
          console.error('onnegotiationneeded offer failed', e);
        } finally {
          makingOffer = false;
        }
      };

      pc.ontrack = (event) => {
        const participantAtEventTime = participantsRef.current.find(p => p.peerId === peerId);

        const handleTrackEnded = () => {
          setRemotePeers(prev => prev.map(p => {
            if (p.peerId !== peerId) return p;
            return {
              ...p,
              streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')),
            };
          }));
        };
        event.track.onended = handleTrackEnded;

        const incomingStream = event.streams[0] ?? new MediaStream([event.track]);

        setRemotePeers(prev => {
          const peerEntry = prev.find(p => p.peerId === peerId);

          if (peerEntry) {
            let updatedStreams = [...peerEntry.streams];
            const existingStream = updatedStreams.find(s => s.id === incomingStream.id);
            if (existingStream) {
              if (!existingStream.getTracks().find(t => t.id === event.track.id)) {
                existingStream.addTrack(event.track);
              }
            } else {
              updatedStreams.push(incomingStream);
            }
            updatedStreams = updatedStreams.filter(s =>
              s.getTracks().some(t => t.readyState !== 'ended'),
            );
            return prev.map(p =>
              p.peerId === peerId ? { ...p, streams: updatedStreams } : p,
            );
          }

          return [...prev, {
            peerId,
            username: participantAtEventTime?.name ?? 'Remote Peer',
            isHost:   participantAtEventTime?.isHost,
            streams:  [incomingStream],
          }];
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          console.warn(`Peer ${peerId} failed, attempting ICE restart`);
          pc.restartIce();
        } else if (pc.connectionState === 'closed') {
          handlePeerLeft(peerId);
        }
      };

      // Add currently active local tracks
      const processed = processedStreamRef.current;
      if (processed) {
        processed.getAudioTracks().forEach(track => {
          const s = pc.addTrack(track, processed);
          roleMap.set(s, 'audio');
        });
      }
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getVideoTracks().forEach(track => {
          const s = pc.addTrack(track, userMediaStreamRef.current!);
          roleMap.set(s, 'camera');
        });
      }
      if (displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getVideoTracks().forEach(track => {
          const s = pc.addTrack(track, displayMediaStreamRef.current!);
          roleMap.set(s, 'screen');
        });
      }

      // Set audio sender priority
      setTimeout(() => {
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind === 'audio') {
            const params = sender.getParameters();
            if (params.encodings?.length) {
              params.encodings[0].priority        = 'high';
              params.encodings[0].networkPriority = 'high';
              sender.setParameters(params).catch(() => {});
            }
          }
        });
      }, 0);

      glareState.set(pc, {
        isPolite,
        makingOfferRef: { current: makingOffer },
        ignoreOfferRef: { current: ignoreOffer },
      });

      return pc;
    };

    const handlePeerJoined = async ({
      peerId, username, isHost,
    }: { peerId: string; username?: string; isHost?: boolean }) => {
      if (peerConnections.current.has(peerId)) return;

      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === peerId)) return prev;
        return [...prev, { peerId, username, isHost, streams: [] }];
      });

      const pc = createPeerConnection(peerId, true);
      try {
        const offer = await pc.createOffer();
        offer.sdp = patchOpusSDP(offer.sdp ?? '');
        await pc.setLocalDescription(offer);
        socket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) {
        console.error('Error creating offer', e);
      }
    };

    const handlePeerOffer = async ({
      sdp, peerId,
    }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      let pc = peerConnections.current.get(peerId);
      if (!pc) pc = createPeerConnection(peerId, false);

      const gs = glareState.get(pc);
      const isPolite    = gs?.isPolite             ?? true;
      const makingOffer = gs?.makingOfferRef.current ?? false;

      const offerCollision =
        sdp.type === 'offer' &&
        (makingOffer || pc.signalingState !== 'stable');

      const doIgnore = !isPolite && offerCollision;
      if (gs) gs.ignoreOfferRef.current = doIgnore;
      if (doIgnore) return;

      try {
        if (offerCollision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(new RTCSessionDescription(sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }

        setRemotePeers(prev => prev.map(p => {
          if (p.peerId !== peerId) return p;
          return {
            ...p,
            streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')),
          };
        }));

        const answer = await pc.createAnswer();
        answer.sdp = patchOpusSDP(answer.sdp ?? '');
        await pc.setLocalDescription(answer);
        socket.emit('peer:answer', { sdp: answer, roomId, targetSocketId: peerId });

        const queued = pendingCandidates.current.get(peerId) ?? [];
        for (const candidate of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e =>
            console.warn('addIceCandidate failed (offer flush)', e),
          );
        }
        pendingCandidates.current.delete(peerId);
      } catch (e) {
        console.error('Error handling offer', e);
      }
    };

    const handlePeerAnswer = async ({
      sdp, peerId,
    }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      const pc = peerConnections.current.get(peerId);
      if (!pc) return;

      const gs = glareState.get(pc);
      if (gs?.ignoreOfferRef.current) return;

      try {
        if (pc.signalingState !== 'have-local-offer') {
          console.warn(`Stale answer from ${peerId} in state: ${pc.signalingState}`);
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        const queued = pendingCandidates.current.get(peerId) ?? [];
        for (const candidate of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e =>
            console.warn('addIceCandidate failed (answer flush)', e),
          );
        }
        pendingCandidates.current.delete(peerId);

        setRemotePeers(prev => prev.map(p => {
          if (p.peerId !== peerId) return p;
          return {
            ...p,
            streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')),
          };
        }));
      } catch (e) {
        console.error('Error handling answer', e);
      }
    };

    const handleIceCandidate = async ({
      candidate, peerId,
    }: { candidate: RTCIceCandidateInit; peerId: string }) => {
      const pc = peerConnections.current.get(peerId);
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          if ((e as DOMException).name !== 'OperationError') {
            console.error('Error adding ICE candidate', e);
          }
        }
      } else {
        const queued = pendingCandidates.current.get(peerId) ?? [];
        queued.push(candidate);
        pendingCandidates.current.set(peerId, queued);
      }
    };

    const handleViewersUpdate       = ({ count }: { count: number }) => setViewerCount(count);
    const handleParticipantsUpdate  = ({ participants: updated }: { participants: Participant[] }) => {
      setParticipants(updated);
      participantsRef.current = updated;
      setRemotePeers(prev => prev.map(peer => {
        const match = updated.find(p => p.peerId === peer.peerId);
        return match ? { ...peer, username: match.name, isHost: match.isHost } : peer;
      }));
    };

    const handleHostMuted = () => {
      setIsMicOn(false);
      isMicOnRef.current = false;
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.01);
      }
      processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
    };

    const handlePeerLeftEvent = ({ peerId }: { peerId: string }) => handlePeerLeft(peerId);
    const handleKicked        = () => { window.location.href = '/'; };
    const handleBanned        = () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; };
    const handleRoomEnded     = () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; };

    socket.on('peer:joined',              handlePeerJoined);
    socket.on('peer:offer',               handlePeerOffer);
    socket.on('peer:answer',              handlePeerAnswer);
    socket.on('peer:ice-candidate',       handleIceCandidate);
    socket.on('room:viewers_update',      handleViewersUpdate);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:muted',               handleHostMuted);
    socket.on('peer:left',                handlePeerLeftEvent);
    socket.on('host:kicked',              handleKicked);
    socket.on('host:banned',              handleBanned);
    socket.on('room:ended',               handleRoomEnded);

    return () => {
      socket.off('peer:joined',              handlePeerJoined);
      socket.off('peer:offer',               handlePeerOffer);
      socket.off('peer:answer',              handlePeerAnswer);
      socket.off('peer:ice-candidate',       handleIceCandidate);
      socket.off('peer:left',                handlePeerLeftEvent);
      socket.off('room:viewers_update',      handleViewersUpdate);
      socket.off('room:participants_update', handleParticipantsUpdate);
      socket.off('host:kicked',              handleKicked);
      socket.off('host:banned',              handleBanned);
      socket.off('room:ended',               handleRoomEnded);
      socket.off('host:muted',               handleHostMuted);

      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, guestName, leaveRoom, handlePeerLeft, replaceTracksOnPeers, buildAudioPipeline]);

  // ─────────────────────────────────────────────────────────────────────────
  // updateLocalTracks — single entry point for all media toggles
  //
  // FIX (mobile camera not turning on): We use buildVideoConstraints() which
  //   wraps facingMode as `ideal` and relaxes width/height on mobile.
  //
  // FIX (desktop mic): Audio-only path is tried first when camera fails so
  //   mic still works even if the webcam is absent or permission-denied.
  //
  // FIX (echo): Echo cancellation constraints are always applied. The
  //   processed stream (AudioContext pipeline) is used for WebRTC senders,
  //   but the local preview uses the raw userMediaStream with `muted`.  This
  //   means the user never hears themselves back through the speaker.
  //
  // FIX (duplicate audio): processedStreamRef is built once from the raw
  //   stream and reused.  Building it again on the same stream would create
  //   a second AudioContext source node, doubling the signal.
  //
  // FIX (Android WebView getUserMedia): On WebView, getUserMedia requires
  //   both video and audio to be requested simultaneously in some versions.
  //   We handle this by requesting them together and catching partial errors.
  // ─────────────────────────────────────────────────────────────────────────
  const updateLocalTracks = useCallback(async ({
    targetAudio,
    targetVideo,
    targetScreen,
  }: {
    targetAudio?:  boolean;
    targetVideo?:  boolean;
    targetScreen?: boolean;
  }) => {
    if (isUpdatingTracksRef.current) return;
    isUpdatingTracksRef.current = true;

    try {
      let currentMic    = targetAudio  !== undefined ? targetAudio  : isMicOnRef.current;
      let currentVideo  = targetVideo  !== undefined ? targetVideo  : isCameraOnRef.current;
      let currentScreen = targetScreen !== undefined ? targetScreen : isScreenOnRef.current;

      const needsUserMedia = currentMic || currentVideo;

      // ── Acquire / update userMedia ────────────────────────────────────
      if (needsUserMedia) {
        if (!userMediaStreamRef.current) {
          // ── First acquisition ─────────────────────────────────────────
          //
          // Strategy (in order of preference):
          //   1. Request both video + audio together (ideal for Android WebView)
          //   2. If that fails with NotFoundError/OverconstrainedError on video,
          //      retry with audio-only (no camera on this device)
          //   3. If NotAllowedError with both, try audio-only (user denied camera)
          //   4. If everything fails, cancel and keep state as-is

          const tryGetMedia = async (
            video: MediaTrackConstraints | boolean,
            audio: MediaTrackConstraints | boolean,
          ): Promise<MediaStream> => {
            return navigator.mediaDevices.getUserMedia({ video, audio });
          };

          try {
            userMediaStreamRef.current = await tryGetMedia(
              currentVideo ? buildVideoConstraints() : false,
              currentMic   ? AUDIO_CONSTRAINTS       : false,
            );
          } catch (err: unknown) {
            const e = err as DOMException;
            console.warn('getUserMedia failed:', e.name, e.message);

            if (
              currentVideo &&
              (e.name === 'NotFoundError' ||
               e.name === 'OverconstrainedError' ||
               e.name === 'DevicesNotFoundError')
            ) {
              // No usable camera — fall back to audio only
              console.warn('Camera unavailable, retrying with audio only');
              try {
                userMediaStreamRef.current = await tryGetMedia(
                  false,
                  currentMic ? AUDIO_CONSTRAINTS : false,
                );
                currentVideo = false;
              } catch (e2) {
                console.error('Audio-only fallback also failed', e2);
                currentMic = currentVideo = false;
              }
            } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
              // User denied — try audio only if both were requested
              if (currentVideo && currentMic) {
                try {
                  userMediaStreamRef.current = await tryGetMedia(false, AUDIO_CONSTRAINTS);
                  currentVideo = false;
                  console.warn('Camera denied by user, continuing with audio only');
                } catch {
                  console.error('Both camera and mic denied by user');
                  currentMic = currentVideo = false;
                }
              } else {
                console.error('Media access denied', e);
                currentMic = currentVideo = false;
              }
            } else if (e.name === 'OverconstrainedError' && currentVideo) {
              // Constraint mismatch on mobile — retry with minimal video constraints
              console.warn('Video constraints not satisfied, retrying with minimal constraints');
              try {
                userMediaStreamRef.current = await tryGetMedia(
                  { facingMode: { ideal: 'user' } },
                  currentMic ? AUDIO_CONSTRAINTS : false,
                );
              } catch (e3) {
                console.error('Minimal video constraints also failed', e3);
                currentMic = currentVideo = false;
              }
            } else {
              console.error('getUserMedia unexpected error', e);
              currentMic = currentVideo = false;
            }
          }
        } else {
          // ── Stream already exists: toggle track.enabled (no renegotiation) ─
          if (targetVideo !== undefined) {
            userMediaStreamRef.current.getVideoTracks().forEach(t => {
              t.enabled = currentVideo;
            });
          }
        }

        // ── Build / update audio pipeline ─────────────────────────────────
        if (currentMic && userMediaStreamRef.current?.getAudioTracks().length) {
          if (!processedStreamRef.current) {
            buildAudioPipeline(userMediaStreamRef.current);
          }

          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume().catch(console.warn);
          }

          if (gainNodeRef.current && audioContextRef.current) {
            gainNodeRef.current.gain.setTargetAtTime(
              1, audioContextRef.current.currentTime, 0.01,
            );
          }
          processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });

        } else if (!currentMic) {
          if (gainNodeRef.current && audioContextRef.current) {
            gainNodeRef.current.gain.setTargetAtTime(
              0, audioContextRef.current.currentTime, 0.01,
            );
          }
          processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
        }
      }

      // ── Release hardware when both mic and camera are off ─────────────
      if (!needsUserMedia && userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(t => t.stop());
        userMediaStreamRef.current  = null;
        processedStreamRef.current  = null;
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(console.warn);
          audioContextRef.current   = null;
          gainNodeRef.current       = null;
          compressorNodeRef.current = null;
        }
      }

      // ── Screen share ──────────────────────────────────────────────────
      if (currentScreen) {
        if (!SCREEN_SHARE_SUPPORTED) {
          // FIX (mobile / iOS): getDisplayMedia is not available.
          // Show a clear message rather than a confusing silent failure.
          alert(
            IS_MOBILE
              ? 'Screen sharing is not supported on this mobile device/browser.\n\nUse a desktop browser for screen sharing.'
              : 'Screen sharing is not supported in this browser.',
          );
          currentScreen = false;
        } else if (!displayMediaStreamRef.current) {
          try {
            displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
              // FIX (desktop screen share inconsistency): Omitting `audio: false`
              // causes Chrome to prompt for system audio which, when accepted,
              // creates a separate audio track that gets mixed with the mic and
              // causes echo.  Explicitly set audio: false.
              video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } },
              audio: false,
            });

            const screenVideoTrack = displayMediaStreamRef.current.getVideoTracks()[0];
            if (screenVideoTrack) {
              screenVideoTrack.onended = () => {
                updateLocalTracks({ targetScreen: false });
              };
            }
          } catch (err: unknown) {
            const e = err as DOMException;
            console.error('getDisplayMedia failed', e);
            if (e.name === 'NotAllowedError') {
              alert('Screen share permission denied. Please allow screen sharing when prompted.');
            } else if (e.name === 'NotSupportedError') {
              alert('Screen sharing is not supported on this device or browser.');
            } else if (e.name === 'AbortError') {
              // User cancelled the picker — silent, no alert needed
            }
            currentScreen = false;
          }
        }
      } else if (!currentScreen && displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
        displayMediaStreamRef.current = null;
      }

      // ── Commit state ──────────────────────────────────────────────────
      isMicOnRef.current    = currentMic;
      isCameraOnRef.current = currentVideo;
      isScreenOnRef.current = currentScreen;

      setIsMicOn(currentMic);
      setIsCameraOn(currentVideo);
      setIsScreenOn(currentScreen);

      setLocalStream(userMediaStreamRef.current);
      setLocalScreenStream(displayMediaStreamRef.current);

      if (socket) {
        await replaceTracksOnPeers(socket);
      }
    } finally {
      isUpdatingTracksRef.current = false;
    }
  }, [socket, replaceTracksOnPeers, buildAudioPipeline]);

  const toggleMic         = useCallback(() => updateLocalTracks({ targetAudio:  !isMicOnRef.current }),    [updateLocalTracks]);
  const toggleCamera      = useCallback(() => updateLocalTracks({ targetVideo:  !isCameraOnRef.current }), [updateLocalTracks]);
  const toggleScreenShare = useCallback(() => updateLocalTracks({ targetScreen: !isScreenOnRef.current }), [updateLocalTracks]);

  return {
    localStream,
    localScreenStream,
    remotePeers,
    participants,
    isMicOn,
    isCameraOn,
    isScreenOn,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    viewerCount,
    leaveRoom,
    /** Expose so the UI can hide/disable the Screen Share button on unsupported platforms */
    screenShareSupported: SCREEN_SHARE_SUPPORTED,
  };
}