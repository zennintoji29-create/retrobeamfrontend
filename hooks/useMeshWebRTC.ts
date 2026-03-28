import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : '',
);

const IS_ANDROID_WEBVIEW =
  typeof navigator !== 'undefined' &&
  /Android/.test(navigator.userAgent) &&
  (/; wv\)/.test(navigator.userAgent) || /Version\/\d/.test(navigator.userAgent));

// ─────────────────────────────────────────────────────────────────────────────
// ICE CONFIGURATION
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
      // @ts-ignore — non-standard but widely supported
      latency: 0.01,
    };

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO CONSTRAINTS
// ─────────────────────────────────────────────────────────────────────────────
function buildVideoConstraints(facingMode: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  if (IS_ANDROID_WEBVIEW) {
    return { facingMode: { ideal: facingMode } };
  }
  if (IS_MOBILE) {
    return {
      facingMode: { ideal: facingMode },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
    };
  }
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SDP PATCHING — Opus prioritization, FEC, DTX, bitrate
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
      patched = patched.replace(/usedtx=\d/, 'usedtx=1');
      patched = patched.replace(/stereo=\d/, 'stereo=0');
      patched = patched.replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=40000');
      const extras: string[] = [];
      if (!patched.includes('useinbandfec')) extras.push('useinbandfec=1');
      if (!patched.includes('usedtx')) extras.push('usedtx=1');
      if (!patched.includes('stereo')) extras.push('stereo=0');
      if (!patched.includes('maxaveragebitrate')) extras.push('maxaveragebitrate=40000');
      return `a=fmtp:${pt} ${patched}${extras.length ? ';' + extras.join(';') : ''}\r\n`;
    },
  );

  if (!result.includes('b=AS:')) {
    result = result.replace(
      /(m=audio [^\r\n]+\r\n(?:c=[^\r\n]+\r\n)?)/,
      '$1b=AS:40\r\n',
    );
  } else {
    result = result.replace(/b=AS:\d+(\r\n)/, 'b=AS:40$1');
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN SHARE AVAILABILITY
// ─────────────────────────────────────────────────────────────────────────────
export const SCREEN_SHARE_SUPPORTED: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  if (IS_ANDROID_WEBVIEW) return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
})();

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — wait for stable signaling state with timeout
//
// FIX (Bug 3): Before calling createOffer manually in replaceTracksOnPeers,
// we must ensure the peer is in 'stable' state. If a previous negotiation is
// still in flight (have-local-offer), createOffer throws InvalidStateError and
// the entire renegotiation silently fails — no screen track, no camera update.
// ─────────────────────────────────────────────────────────────────────────────
function waitForStableState(pc: RTCPeerConnection, timeoutMs = 5000): Promise<boolean> {
  if (pc.signalingState === 'stable') return Promise.resolve(true);
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      pc.removeEventListener('signalingstatechange', handler);
      resolve(false);
    }, timeoutMs);
    const handler = () => {
      if (pc.signalingState === 'stable') {
        clearTimeout(timer);
        pc.removeEventListener('signalingstatechange', handler);
        resolve(true);
      }
    };
    pc.addEventListener('signalingstatechange', handler);
  });
}

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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenOn, setIsScreenOn] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);

  const localStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);
  const senderRoles = useRef<Map<string, Map<RTCRtpSender, SenderRole>>>(new Map());

  // Audio pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Stable boolean refs
  const isMicOnRef = useRef(false);
  const isCameraOnRef = useRef(false);
  const isScreenOnRef = useRef(false);

  // Concurrency guard
  const isUpdatingTracksRef = useRef(false);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // ─────────────────────────────────────────────────────────────────────────
  // buildAudioPipeline
  // ─────────────────────────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream | null => {
    // Guard: reuse if already built for this stream
    if (processedStreamRef.current && audioSourceNodeRef.current) {
      return processedStreamRef.current;
    }

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

      if (audioSourceNodeRef.current) {
        try { audioSourceNodeRef.current.disconnect(); } catch { /* already disconnected */ }
        audioSourceNodeRef.current = null;
      }

      const source = ctx.createMediaStreamSource(rawStream);
      audioSourceNodeRef.current = source;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gainNodeRef.current = gain;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 8;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.15;
      compressorNodeRef.current = compressor;

      const dest = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(dest);

      const processedStream = new MediaStream();
      dest.stream.getAudioTracks().forEach(t => processedStream.addTrack(t));

      processedStreamRef.current = processedStream;
      return processedStream;
    } catch (e) {
      console.error('AudioContext pipeline failed, using raw stream', e);
      processedStreamRef.current = rawStream;
      return rawStream;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // teardownAudioPipeline
  // ─────────────────────────────────────────────────────────────────────────
  const teardownAudioPipeline = useCallback(() => {
    if (audioSourceNodeRef.current) {
      try { audioSourceNodeRef.current.disconnect(); } catch { /* ok */ }
      audioSourceNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      try { gainNodeRef.current.disconnect(); } catch { /* ok */ }
      gainNodeRef.current = null;
    }
    if (compressorNodeRef.current) {
      try { compressorNodeRef.current.disconnect(); } catch { /* ok */ }
      compressorNodeRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.warn);
      audioContextRef.current = null;
    }
    processedStreamRef.current = null;
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

    teardownAudioPipeline();

    setLocalStream(null);
    setLocalScreenStream(null);
    localStreamRef.current = null;

    isMicOnRef.current = false;
    isCameraOnRef.current = false;
    isScreenOnRef.current = false;
    setIsMicOn(false);
    setIsCameraOn(false);
    setIsScreenOn(false);
  }, [teardownAudioPipeline]);

  // ─────────────────────────────────────────────────────────────────────────
  // replaceTracksOnPeers
  //
  // FIX (Bug 3): Guard signalingState before every manual createOffer call.
  //   Use waitForStableState() so we never throw InvalidStateError.
  //
  // FIX (Bug 5): addTrack fires onnegotiationneeded automatically.
  //   We let onnegotiationneeded handle addTrack cases (camera, audio).
  //   We only use the manual offer path for removeTrack (screen stop), because
  //   removeTrack does NOT reliably fire onnegotiationneeded in all browsers.
  //
  // FIX (Bug 1): processedStreamRef is guaranteed non-null before this is
  //   called — enforced in updateLocalTracks by checking the return value of
  //   buildAudioPipeline and assigning it explicitly.
  // ─────────────────────────────────────────────────────────────────────────
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const audioTrack = processedStreamRef.current?.getAudioTracks()[0] ?? null;
    const videoTrack = userMediaStreamRef.current?.getVideoTracks()[0] ?? null;
    const screenTrack = displayMediaStreamRef.current?.getVideoTracks()[0] ?? null;

    if (audioTrack) audioTrack.enabled = isMicOnRef.current;
    if (videoTrack) videoTrack.enabled = isCameraOnRef.current;

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

      // Only the removeTrack (screen stop) case needs a manual offer,
      // because removeTrack does NOT reliably fire onnegotiationneeded.
      let needsManualRenegotiation = false;

      // ── Audio ──────────────────────────────────────────────────────────
      const audioSender = senderByRole('audio');
      if (audioSender) {
        if (audioTrack && audioSender.track?.id !== audioTrack.id) {
          await audioSender.replaceTrack(audioTrack).catch(e =>
            console.error(`replaceTrack audio failed for ${peerId}`, e),
          );
        }
        if (audioSender.track) audioSender.track.enabled = isMicOnRef.current;
      } else if (audioTrack && processedStreamRef.current) {
        // addTrack fires onnegotiationneeded — no manual offer needed here
        const s = pc.addTrack(audioTrack, processedStreamRef.current);
        roleMap.set(s, 'audio');
      }

      // ── Camera ─────────────────────────────────────────────────────────
      const camSender = senderByRole('camera');
      if (camSender) {
        if (videoTrack) {
          if (camSender.track?.id !== videoTrack.id) {
            await camSender.replaceTrack(videoTrack).catch(e =>
              console.error(`replaceTrack camera failed for ${peerId}`, e),
            );
          }
          if (camSender.track) camSender.track.enabled = isCameraOnRef.current;
        } else {
          // Camera fully stopped — disable track, do NOT remove (avoids renegotiation churn)
          if (camSender.track) camSender.track.enabled = false;
        }
      } else if (videoTrack && userMediaStreamRef.current) {
        // addTrack fires onnegotiationneeded — no manual offer needed here
        const s = pc.addTrack(videoTrack, userMediaStreamRef.current);
        roleMap.set(s, 'camera');
      }

      // ── Screen ─────────────────────────────────────────────────────────
      const screenSender = senderByRole('screen');
      if (screenSender) {
        if (screenTrack) {
          if (screenSender.track?.id !== screenTrack.id) {
            await screenSender.replaceTrack(screenTrack).catch(e =>
              console.error(`replaceTrack screen failed for ${peerId}`, e),
            );
          }
        } else {
          // FIX (Bug 5): removeTrack does NOT fire onnegotiationneeded reliably —
          // we must trigger a manual offer only for this case.
          pc.removeTrack(screenSender);
          roleMap.delete(screenSender);
          needsManualRenegotiation = true;
        }
      } else if (screenTrack && displayMediaStreamRef.current) {
        // addTrack fires onnegotiationneeded — no manual offer needed here.
        // onnegotiationneeded will handle the offer/answer for this new track.
        const s = pc.addTrack(screenTrack, displayMediaStreamRef.current);
        roleMap.set(s, 'screen');
        // No needsManualRenegotiation = true here; onnegotiationneeded handles it.
      }

      // ── Manual renegotiation — ONLY for removeTrack cases ─────────────
      if (needsManualRenegotiation) {
        try {
          // FIX (Bug 3): Wait for stable state before creating offer.
          // If a previous negotiation is in flight, createOffer throws.
          const isStable = await waitForStableState(pc);
          if (!isStable) {
            console.warn(`Peer ${peerId}: signaling state never became stable, skipping renegotiation`);
            continue;
          }

          const offer = await pc.createOffer();
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          currentSocket.emit('peer:offer', {
            sdp: offer,
            roomId,
            targetSocketId: peerId,
          });
        } catch (e) {
          console.error('Manual renegotiation failed for peer', peerId, e);
        }
      }
    }
  }, [roomId]);

  // ─────────────────────────────────────────────────────────────────────────
  // handlePeerLeft
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

    // FIX (Bug 6): glareState used to store { current: makingOffer } capturing
    // the initial `let` value (always false) instead of the live variable.
    // Now we use actual ref objects so mutations are reflected everywhere.
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

      const isPolite = !isOfferer;

      // FIX (Bug 6): Use ref objects — not local `let` variables — so that
      // mutations inside closures (onnegotiationneeded, handlePeerOffer, etc.)
      // are visible across all handlers that share this peer connection.
      const makingOfferRef = { current: false };
      const ignoreOfferRef = { current: false };

      glareState.set(pc, { isPolite, makingOfferRef, ignoreOfferRef });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('peer:ice-candidate', {
            candidate: event.candidate,
            roomId,
            targetSocketId: peerId,
          });
        }
      };

      // FIX (Bug 2): Removed the inner guard `if (!pc.remoteDescription) return`.
      // That guard was silently killing the initial offer when remoteDescription
      // was null (early connection setup), causing the entire negotiation to be
      // lost with no retry or fallback.
      //
      // FIX (Bug 5): onnegotiationneeded is now the SOLE path for addTrack-
      // triggered renegotiations. replaceTracksOnPeers no longer creates offers
      // for addTrack — it relies on this handler firing naturally.
      pc.onnegotiationneeded = async () => {
        // Guard: skip if we're already mid-negotiation
        if (makingOfferRef.current) return;
        try {
          makingOfferRef.current = true;
          const offer = await pc.createOffer();
          // Check state after the async createOffer — it may have changed
          if (pc.signalingState !== 'stable') return;
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          socket.emit('peer:offer', {
            sdp: pc.localDescription,
            roomId,
            targetSocketId: peerId,
          });
        } catch (e) {
          console.error('onnegotiationneeded offer failed', e);
        } finally {
          makingOfferRef.current = false;
        }
      };

      // FIX (Bug 4): ontrack handler rewritten to:
      //   1. Never drop the incoming stream due to a stale "ended" filter.
      //   2. Use getTrackById() instead of find() for correct track dedup.
      //   3. Fall back to a new MediaStream([event.track]) only when
      //      event.streams is empty — but still add the track in both cases.
      //   4. Only filter out streams that are fully dead AND are not the
      //      incoming stream — avoids discarding the just-arrived track.
      pc.ontrack = (event) => {
        const participantAtEventTime = participantsRef.current.find(p => p.peerId === peerId);
        const incomingStream = event.streams[0] ?? null;

        setRemotePeers(prev => {
          const peerEntry = prev.find(p => p.peerId === peerId);

          if (peerEntry) {
            let updatedStreams = [...peerEntry.streams];

            if (incomingStream) {
              const existingStream = updatedStreams.find(s => s.id === incomingStream.id);
              if (existingStream) {
                // Add track only if not already present
                if (!existingStream.getTrackById(event.track.id)) {
                  existingStream.addTrack(event.track);
                }
              } else {
                updatedStreams.push(incomingStream);
              }
            } else {
              // Browser gave no streams array — wrap the track ourselves
              const fallback = new MediaStream([event.track]);
              updatedStreams.push(fallback);
            }

            // FIX (Bug 4): Only remove streams that are fully dead AND are NOT
            // the incoming stream. Previously, this filter ran without excluding
            // incomingStream, which could drop a stream whose tracks appeared
            // "ended" momentarily during renegotiation.
            updatedStreams = updatedStreams.filter(s =>
              (incomingStream && s.id === incomingStream.id) ||
              s.getTracks().some(t => t.readyState !== 'ended'),
            );

            return prev.map(p =>
              p.peerId === peerId ? { ...p, streams: updatedStreams } : p,
            );
          }

          // New peer — create entry with the incoming stream
          const stream = incomingStream ?? new MediaStream([event.track]);
          return [...prev, {
            peerId,
            username: participantAtEventTime?.name ?? 'Remote Peer',
            isHost: participantAtEventTime?.isHost,
            streams: [stream],
          }];
        });

        // Attach ended handler AFTER state update
        event.track.onended = () => {
          setRemotePeers(prev => prev.map(p => {
            if (p.peerId !== peerId) return p;
            return {
              ...p,
              streams: p.streams.filter(s =>
                s.getTracks().some(t => t.readyState !== 'ended'),
              ),
            };
          }));
        };
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
          track.enabled = isMicOnRef.current;
          const s = pc.addTrack(track, processed);
          roleMap.set(s, 'audio');
        });
      }
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getVideoTracks().forEach(track => {
          track.enabled = isCameraOnRef.current;
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
              params.encodings[0].priority = 'high';
              params.encodings[0].networkPriority = 'high';
              sender.setParameters(params).catch(() => {});
            }
          }
        });
      }, 0);

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
      const isPolite = gs?.isPolite ?? true;

      // FIX (Bug 6): Now correctly reads the live ref value, not a stale
      // snapshot captured at construction time.
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

      // FIX (Bug 6): Correctly reads the live ignoreOfferRef value.
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

    const handleViewersUpdate = ({ count }: { count: number }) => setViewerCount(count);

    const handleParticipantsUpdate = ({ participants: updated }: { participants: Participant[] }) => {
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
        gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.02);
      }
      processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
    };

    const handlePeerLeftEvent = ({ peerId }: { peerId: string }) => handlePeerLeft(peerId);
    const handleKicked = () => { window.location.href = '/'; };
    const handleBanned = () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; };
    const handleRoomEnded = () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; };

    socket.on('peer:joined', handlePeerJoined);
    socket.on('peer:offer', handlePeerOffer);
    socket.on('peer:answer', handlePeerAnswer);
    socket.on('peer:ice-candidate', handleIceCandidate);
    socket.on('room:viewers_update', handleViewersUpdate);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:muted', handleHostMuted);
    socket.on('peer:left', handlePeerLeftEvent);
    socket.on('host:kicked', handleKicked);
    socket.on('host:banned', handleBanned);
    socket.on('room:ended', handleRoomEnded);

    return () => {
      socket.off('peer:joined', handlePeerJoined);
      socket.off('peer:offer', handlePeerOffer);
      socket.off('peer:answer', handlePeerAnswer);
      socket.off('peer:ice-candidate', handleIceCandidate);
      socket.off('peer:left', handlePeerLeftEvent);
      socket.off('room:viewers_update', handleViewersUpdate);
      socket.off('room:participants_update', handleParticipantsUpdate);
      socket.off('host:kicked', handleKicked);
      socket.off('host:banned', handleBanned);
      socket.off('room:ended', handleRoomEnded);
      socket.off('host:muted', handleHostMuted);

      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, guestName, leaveRoom, handlePeerLeft, replaceTracksOnPeers, buildAudioPipeline]);

  // ─────────────────────────────────────────────────────────────────────────
  // updateLocalTracks
  //
  // FIX (Bug 1): buildAudioPipeline return value is now captured and explicitly
  //   assigned to processedStreamRef.current if not already set. Previously the
  //   return was discarded, leaving processedStreamRef null during the async
  //   gap between getUserMedia and buildAudioPipeline, causing replaceTracksOnPeers
  //   to skip audio sender creation for any peers joined in that window.
  // ─────────────────────────────────────────────────────────────────────────
  const updateLocalTracks = useCallback(async ({
    targetAudio,
    targetVideo,
    targetScreen,
  }: {
    targetAudio?: boolean;
    targetVideo?: boolean;
    targetScreen?: boolean;
  }) => {
    if (isUpdatingTracksRef.current) return;
    isUpdatingTracksRef.current = true;

    try {
      let currentMic = targetAudio !== undefined ? targetAudio : isMicOnRef.current;
      let currentVideo = targetVideo !== undefined ? targetVideo : isCameraOnRef.current;
      let currentScreen = targetScreen !== undefined ? targetScreen : isScreenOnRef.current;

      const needsUserMedia = currentMic || currentVideo;

      // ── Acquire / update userMedia ────────────────────────────────────
      if (needsUserMedia) {
        if (!userMediaStreamRef.current) {
          // Teardown any stale audio pipeline from a previous session first
          teardownAudioPipeline();

          const tryGetMedia = async (
            video: MediaTrackConstraints | boolean,
            audio: MediaTrackConstraints | boolean,
          ): Promise<MediaStream> => {
            return navigator.mediaDevices.getUserMedia({ video, audio });
          };

          try {
            userMediaStreamRef.current = await tryGetMedia(
              currentVideo ? buildVideoConstraints() : false,
              currentMic ? AUDIO_CONSTRAINTS : false,
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
          // Stream already exists — use track.enabled to toggle, never stop()
          if (targetVideo !== undefined) {
            userMediaStreamRef.current.getVideoTracks().forEach(t => {
              t.enabled = currentVideo;
            });
          }
        }

        // ── Build / update audio pipeline ─────────────────────────────────
        if (userMediaStreamRef.current?.getAudioTracks().length) {
          // FIX (Bug 1): Capture the return value and assign it explicitly.
          // The previous code called buildAudioPipeline() and discarded the
          // return, leaving processedStreamRef.current potentially null when
          // replaceTracksOnPeers was called immediately after.
          if (!processedStreamRef.current || !audioSourceNodeRef.current) {
            const built = buildAudioPipeline(userMediaStreamRef.current);
            if (!processedStreamRef.current && built) {
              processedStreamRef.current = built;
            }
          }

          // Resume context if it got suspended (browser autoplay policy)
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume().catch(console.warn);
          }

          if (currentMic) {
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
              gainNodeRef.current.gain.setTargetAtTime(
                1, audioContextRef.current.currentTime, 0.02,
              );
            }
            processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });
          } else {
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
              gainNodeRef.current.gain.setTargetAtTime(
                0, audioContextRef.current.currentTime, 0.02,
              );
            }
            setTimeout(() => {
              processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
            }, 60);
          }
        }
      }

      // ── Release hardware when both mic and camera are off ─────────────
      if (!needsUserMedia && userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(t => t.stop());
        userMediaStreamRef.current = null;
        teardownAudioPipeline();
      }

      // ── Screen share ──────────────────────────────────────────────────
      if (currentScreen) {
        if (!SCREEN_SHARE_SUPPORTED) {
          alert(
            IS_MOBILE
              ? 'Screen sharing is not supported on this mobile device/browser.\n\nUse a desktop browser for screen sharing.'
              : 'Screen sharing is not supported in this browser.',
          );
          currentScreen = false;
        } else if (!displayMediaStreamRef.current) {
          try {
            displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
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
              // User cancelled the picker — silent
            }
            currentScreen = false;
          }
        }
      } else if (!currentScreen && displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
        displayMediaStreamRef.current = null;
      }

      // ── Commit state ──────────────────────────────────────────────────
      isMicOnRef.current = currentMic;
      isCameraOnRef.current = currentVideo;
      isScreenOnRef.current = currentScreen;

      setIsMicOn(currentMic);
      setIsCameraOn(currentVideo);
      setIsScreenOn(currentScreen);

      setLocalStream(userMediaStreamRef.current);
      setLocalScreenStream(displayMediaStreamRef.current);

      if (socket && processedStreamRef.current) {
        await replaceTracksOnPeers(socket);
      }
    } finally {
      isUpdatingTracksRef.current = false;
    }
  }, [socket, replaceTracksOnPeers, buildAudioPipeline, teardownAudioPipeline]);

  const toggleMic = useCallback(
    () => updateLocalTracks({ targetAudio: !isMicOnRef.current }),
    [updateLocalTracks],
  );
  const toggleCamera = useCallback(
    () => updateLocalTracks({ targetVideo: !isCameraOnRef.current }),
    [updateLocalTracks],
  );
  const toggleScreenShare = useCallback(
    () => updateLocalTracks({ targetScreen: !isScreenOnRef.current }),
    [updateLocalTracks],
  );

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
    screenShareSupported: SCREEN_SHARE_SUPPORTED,
  };
}