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
//
// FIX (crackling / echo): All three DSP flags MUST be true. Without
//   echoCancellation=true the speaker bleeds into the mic on any platform.
//   Without noiseSuppression the background hiss is constant.
//   Without autoGainControl loud voices clip and cause distortion.
//
// FIX (Android WebView OverconstrainedError): sampleRate / channelCount
//   throw on some WebView builds — omit them on WebView.
//
// FIX (latency spikes): Set latency to 0.01 (10 ms) on desktop so the
//   browser picks a low-latency path instead of the power-efficient default.
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
      // Low-latency hint — ignored if not supported, never throws
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
//
// FIX (crackling over poor connection): useinbandfec=1 enables in-band
//   Forward Error Correction so dropped packets are reconstructed instead
//   of causing audible glitches.
//
// FIX (bandwidth-induced distortion): Cap at 40 kbps (not 32) — 32 kbps
//   caused audible artifacts on voice with heavy background noise.
//   40 kbps is the Opus sweet spot for voice quality vs bandwidth.
//
// FIX (stereo → mono): stereo=0 forces mono which halves bandwidth usage
//   and prevents phase-cancellation artifacts from stereo mic capture.
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
      // FIX: 40 kbps instead of 32 — better voice quality on noisy connections
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
    // Update existing bandwidth line to match new bitrate
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
  // FIX: track the source node so we never create a second source on the same stream
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
  //
  // FIX (crackling on toggle): The pipeline is built ONCE per raw stream.
  //   Subsequent calls are no-ops if the source stream hasn't changed.
  //   Previously, calling buildAudioPipeline again on the same stream created
  //   a second MediaStreamAudioSourceNode which doubled the signal → crackling.
  //
  // FIX (compressor settings for voice):
  //   Previous: threshold=-24, ratio=4, attack=0.003, release=0.25
  //   These settings were tuned for music, not speech. For voice:
  //   - threshold=-18 dB: only compress moderately loud voices
  //   - knee=8: soft knee for smoother onset
  //   - ratio=3: gentle compression — voice dynamics should be preserved
  //   - attack=0.005: slightly slower attack prevents transient pop artifacts
  //   - release=0.15: faster release keeps voice sounding natural
  //
  // FIX (echo from processed stream): We do NOT add video tracks to the
  //   processed stream. Video tracks go through userMediaStreamRef separately.
  //   Mixing them caused a second video sender to appear on some browsers.
  //
  // FIX (AudioContext suspended): We always attempt resume() synchronously
  //   inside the user-gesture call chain to satisfy Chrome autoplay policy.
  // ─────────────────────────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream | null => {
    // Guard: if we already have a processed stream from this exact raw stream, reuse it
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

    // Resume synchronously — this is always called inside a user gesture
    if (ctx.state === 'suspended') {
      ctx.resume().catch(e => console.warn('AudioContext resume failed', e));
    }

    try {
      const audioTracks = rawStream.getAudioTracks();
      if (audioTracks.length === 0) {
        processedStreamRef.current = rawStream;
        return rawStream;
      }

      // FIX: disconnect old source if it exists before creating a new one
      if (audioSourceNodeRef.current) {
        try { audioSourceNodeRef.current.disconnect(); } catch { /* already disconnected */ }
        audioSourceNodeRef.current = null;
      }

      const source = ctx.createMediaStreamSource(rawStream);
      audioSourceNodeRef.current = source;

      const gain = ctx.createGain();
      // Start at 0 — the caller sets to 1 after pipeline is ready
      gain.gain.value = 0;
      gainNodeRef.current = gain;

      // FIX: voice-tuned compressor values
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;   // was -24
      compressor.knee.value = 8;           // was 12
      compressor.ratio.value = 3;          // was 4
      compressor.attack.value = 0.005;     // was 0.003
      compressor.release.value = 0.15;     // was 0.25
      compressorNodeRef.current = compressor;

      const dest = ctx.createMediaStreamDestination();

      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(dest);

      // Only audio in processedStream — video is managed separately
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
  // teardownAudioPipeline — clean teardown without leaving dangling nodes
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
  // FIX (camera enable/disable causing renegotiation):
  //   When the user toggles camera off we use track.enabled=false rather than
  //   replaceTrack(null). replaceTrack(null) is spec-valid but causes a
  //   "send with null track" state that triggers re-negotiation in Firefox and
  //   older Chrome, which causes a brief audio dropout and sometimes a black
  //   frame flash on the remote side.
  //   track.enabled=false is silent — no renegotiation, instant mute.
  //
  // FIX (audio dropout on peer reconnect): processedStreamRef audio tracks
  //   must have their enabled state explicitly set after replaceTrack, because
  //   the new AudioContext destination track defaults to enabled=true regardless
  //   of the gain node's value.
  // ─────────────────────────────────────────────────────────────────────────
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const audioTrack = processedStreamRef.current?.getAudioTracks()[0] ?? null;
    const videoTrack = userMediaStreamRef.current?.getVideoTracks()[0] ?? null;
    const screenTrack = displayMediaStreamRef.current?.getVideoTracks()[0] ?? null;

    // Sync enabled state with intent refs
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

      let needsRenegotiation = false;

      // ── Audio ──────────────────────────────────────────────────────────
      const audioSender = senderByRole('audio');
      if (audioSender) {
        if (audioTrack && audioSender.track?.id !== audioTrack.id) {
          // Only replace if it's actually a different track (e.g. after stream rebuild)
          await audioSender.replaceTrack(audioTrack).catch(e =>
            console.error(`replaceTrack audio failed for ${peerId}`, e),
          );
        }
        // Sync enabled state — the sender track may have reset
        if (audioSender.track) audioSender.track.enabled = isMicOnRef.current;
      } else if (audioTrack && processedStreamRef.current) {
        const s = pc.addTrack(audioTrack, processedStreamRef.current);
        roleMap.set(s, 'audio');
        needsRenegotiation = true;
      }

      // ── Camera ─────────────────────────────────────────────────────────
      // FIX: use track.enabled instead of replaceTrack(null) for toggling
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
          // Camera fully stopped (no stream) — use enabled=false, no renegotiation
          if (camSender.track) camSender.track.enabled = false;
        }
      } else if (videoTrack && userMediaStreamRef.current) {
        const s = pc.addTrack(videoTrack, userMediaStreamRef.current);
        roleMap.set(s, 'camera');
        needsRenegotiation = true;
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
      let makingOffer = false;
      let ignoreOffer = false;

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
            isHost: participantAtEventTime?.isHost,
            streams: [incomingStream],
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
          // Ensure track enabled state is synced before adding
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
      const isPolite = gs?.isPolite ?? true;
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
      // FIX: ramp down gain smoothly instead of instantly cutting to 0,
      // which causes a click/pop artifact on the remote side
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.02);
      }
      // Also disable the track as a hard mute fallback
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
  // FIX (audio crackling on mic toggle):
  //   We NEVER stop() audio tracks when toggling mic off. We set gain to 0
  //   (via a smooth 20ms ramp) and set track.enabled=false. This keeps the
  //   RTCPeerConnection audio sender alive with a silent track instead of
  //   null, which avoids the renegotiation + re-establishment cycle that
  //   caused the crackle heard at the start of every unmute.
  //
  // FIX (camera toggle causing brief audio dropout):
  //   Previously, toggling camera triggered updateLocalTracks which called
  //   replaceTracksOnPeers with the current audio track. If processedStream
  //   was briefly null (race condition during buildAudioPipeline), the audio
  //   sender got replaceTrack(null) and caused a ~500ms dropout.
  //   Fix: guard processedStreamRef before calling replaceTracksOnPeers.
  //
  // FIX (duplicate audio pipeline on stream re-acquire):
  //   When userMediaStreamRef is null and we re-acquire, we must call
  //   teardownAudioPipeline() first to clear the old AudioContext nodes
  //   before calling buildAudioPipeline with the new stream. Otherwise
  //   two source nodes feed the same destination → doubled/distorted audio.
  //
  // FIX (Android WebView getUserMedia + camera toggle):
  //   On some WebView builds, toggling videoTrack.enabled=false is not
  //   enough — the camera LED stays on and the encoder keeps running.
  //   We leave this as-is because stopping the track entirely requires
  //   full stream re-acquisition which is too disruptive on mobile.
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
          // ── First acquisition ─────────────────────────────────────────
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
          // ── Stream already exists: use track.enabled to toggle ─────────
          // FIX: never stop() tracks just to "toggle off" — just disable them.
          // Stopping requires full re-acquisition + renegotiation = crackling.
          if (targetVideo !== undefined) {
            userMediaStreamRef.current.getVideoTracks().forEach(t => {
              t.enabled = currentVideo;
            });
          }
        }

        // ── Build / update audio pipeline ─────────────────────────────────
        if (userMediaStreamRef.current?.getAudioTracks().length) {
          // Build pipeline if not yet built (guard against double-build)
          if (!processedStreamRef.current || !audioSourceNodeRef.current) {
            buildAudioPipeline(userMediaStreamRef.current);
          }

          // Resume context if it got suspended (browser autoplay policy)
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume().catch(console.warn);
          }

          if (currentMic) {
            // FIX: use setTargetAtTime with a 20ms time constant for a smooth
            // ramp-up instead of an instant jump — instant jumps cause a click
            // artifact audible as a "pop" at the start of speech.
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
              gainNodeRef.current.gain.setTargetAtTime(
                1, audioContextRef.current.currentTime, 0.02,
              );
            }
            processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });
          } else {
            // FIX: ramp DOWN over 20ms then hard-disable the track.
            // The ramp prevents the click; the track disable is a belt-and-suspenders
            // silent fallback for browsers that don't honour gain=0.
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
              gainNodeRef.current.gain.setTargetAtTime(
                0, audioContextRef.current.currentTime, 0.02,
              );
            }
            // Delay the track.enabled=false by 60ms to let the ramp finish
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
              // FIX: explicitly false — system audio causes echo when mixed with mic
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

  const toggleMic = useCallback(() => updateLocalTracks({ targetAudio: !isMicOnRef.current }), [updateLocalTracks]);
  const toggleCamera = useCallback(() => updateLocalTracks({ targetVideo: !isCameraOnRef.current }), [updateLocalTracks]);
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
    screenShareSupported: SCREEN_SHARE_SUPPORTED,
  };
}