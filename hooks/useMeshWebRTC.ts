'use client';

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
const DEFAULT_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' }
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO & VIDEO CONSTRAINTS
// ─────────────────────────────────────────────────────────────────────────────
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ...(IS_ANDROID_WEBVIEW ? {} : { sampleRate: 48000, channelCount: 1, latency: 0.01 }),
};

function buildVideoConstraints(facingMode: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  if (IS_ANDROID_WEBVIEW) return { facingMode: { ideal: facingMode } };
  if (IS_MOBILE) {
    return {
      facingMode: { ideal: facingMode },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
    };
  }
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
}

// ─────────────────────────────────────────────────────────────────────────────
// SDP PATCHING
// ─────────────────────────────────────────────────────────────────────────────
function patchOpusSDP(sdp: string): string {
  let result = sdp;
  const opusPtMatch = result.match(/a=rtpmap:(\d+) opus\/48000/i);
  const opusPt = opusPtMatch ? opusPtMatch[1] : null;

  if (opusPt) {
    result = result.replace(/^(m=audio \d+ \S+ )([\d ]+)$/m, (_match, prefix, payloads) => {
      const pts = payloads.trim().split(' ');
      const reordered = [opusPt, ...pts.filter((p: string) => p !== opusPt)];
      return `${prefix}${reordered.join(' ')}`;
    });
  }

  result = result.replace(/a=fmtp:(\d+) (.*opus.*)\r\n/gi, (_match, pt, params) => {
    let patched = params.includes('minptime') ? params : `minptime=10;${params}`;
    patched = patched.replace(/useinbandfec=\d/, 'useinbandfec=1');
    patched = patched.replace(/usedtx=\d/, 'usedtx=1');
    patched = patched.replace(/stereo=\d/, 'stereo=0');
    patched = patched.replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=128000');
    const extras: string[] = [];
    if (!patched.includes('useinbandfec')) extras.push('useinbandfec=1');
    if (!patched.includes('usedtx')) extras.push('usedtx=1');
    if (!patched.includes('stereo')) extras.push('stereo=0');
    if (!patched.includes('maxaveragebitrate')) extras.push('maxaveragebitrate=128000');
    return `a=fmtp:${pt} ${patched}${extras.length ? ';' + extras.join(';') : ''}\r\n`;
  });

  if (!result.includes('b=AS:')) {
    result = result.replace(/(m=audio [^\r\n]+\r\n(?:c=[^\r\n]+\r\n)?)/, '$1b=AS:128\r\n');
  } else {
    result = result.replace(/b=AS:\d+(\r\n)/, 'b=AS:128$1');
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
// SIGNALING STATE HELPER
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

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
export interface RemotePeer {
  peerId: string;
  username?: string;
  isHost?: boolean;
  /**
   * Always a fixed-length-2 tuple:
   *   [0] = camera/audio MediaStream (or null)
   *   [1] = screen-share MediaStream (or null)
   *
   * Using null sentinels instead of a sparse/growing array means
   * VideoMonitor always gets a stable prop shape and React re-renders
   * predictably when either slot changes.
   */
  streams: [MediaStream | null, MediaStream | null];
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
export function useMeshWebRTC(roomId: string, socket: Socket | null) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenOn, setIsScreenOn] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);
  const iceServersRef = useRef<RTCConfiguration>(DEFAULT_ICE_SERVERS);

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const senderRoles = useRef<Map<string, Map<RTCRtpSender, SenderRole>>>(new Map());

  // FIX: track which mid (m-line index) belongs to which role per peer,
  // so ontrack can reliably categorise incoming tracks without relying on
  // unreliable track.label strings.
  const midRoles = useRef<Map<string, Map<string, SenderRole>>>(new Map());

  const participantsRef = useRef<Participant[]>([]);
  const isMicOnRef = useRef(false);
  const isCameraOnRef = useRef(false);
  const isScreenOnRef = useRef(false);
  const isUpdatingTracksRef = useRef(false);

  // Audio pipeline
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Initialize ICE servers securely from backend on mount
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/ice`)
      .then(r => r.json())
      .then(data => {
        if (data.iceServers) {
          iceServersRef.current = { ...DEFAULT_ICE_SERVERS, iceServers: data.iceServers };
        }
      })
      .catch(err => console.error('Failed to fetch premium ICE servers', err));
  }, []);

  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO PIPELINE BUILD
  // ─────────────────────────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream | null => {
    // If we already have a live pipeline, reuse it.
    if (processedStreamRef.current && audioSourceNodeRef.current) {
      return processedStreamRef.current;
    }

    let ctx = audioContextRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext({ sampleRate: IS_ANDROID_WEBVIEW ? undefined : 48000 });
        audioContextRef.current = ctx;
      } catch (e) {
        console.warn('AudioContext creation failed, using raw stream', e);
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
      const source    = ctx.createMediaStreamSource(rawStream);
      const gain      = ctx.createGain();
      // Always init to 1 — isMicOnRef hasn't been updated yet when this
      // pipeline is first built (the ref is set at the end of updateLocalTracks).
      // The track's .enabled flag is the real gate; gain handles smooth ramp.
      gain.gain.value = 1;
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
  // AUDIO PIPELINE TEARDOWN
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
  // LEAVE ROOM
  // ─────────────────────────────────────────────────────────────────────────
  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    senderRoles.current.clear();
    midRoles.current.clear();
    pendingCandidates.current.clear();

    userMediaStreamRef.current?.getTracks().forEach(t => t.stop());
    userMediaStreamRef.current = null;

    displayMediaStreamRef.current?.getTracks().forEach(t => t.stop());
    displayMediaStreamRef.current = null;

    teardownAudioPipeline();

    setLocalStream(null);
    setLocalScreenStream(null);
    setRemotePeers([]);

    isMicOnRef.current = false;
    isCameraOnRef.current = false;
    isScreenOnRef.current = false;

    setIsMicOn(false);
    setIsCameraOn(false);
    setIsScreenOn(false);
  }, [teardownAudioPipeline]);

  // ─────────────────────────────────────────────────────────────────────────
  // REPLACE TRACKS ON ALL PEERS
  //
  // FIX (vs original):
  //  1. Dead-code audio-removal branch is corrected — it is now outside the
  //     `if (audioSender)` block so it can actually execute.
  //  2. After adding any new sender we record the mid in midRoles so the
  //     remote ontrack handler can use it for reliable categorisation.
  //  3. We never call replaceTrack with a null track — instead we use
  //     replaceTrack(null) only when the API allows it; otherwise we remove
  //     the sender and renegotiate.
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

      let peerMidRoles = midRoles.current.get(peerId);
      if (!peerMidRoles) {
        peerMidRoles = new Map();
        midRoles.current.set(peerId, peerMidRoles);
      }

      const senderByRole = (role: SenderRole): RTCRtpSender | undefined =>
        Array.from(roleMap!.entries()).find(([, r]) => r === role)?.[0];

      let needsRenegotiation = false;

      // ── AUDIO ──────────────────────────────────────────────────────────
      const audioSender = senderByRole('audio');
      if (audioTrack) {
        if (audioSender) {
          if (audioSender.track?.id !== audioTrack.id) {
            await audioSender.replaceTrack(audioTrack).catch(e =>
              console.error(`replaceTrack audio failed for ${peerId}:`, e),
            );
          }
          // Always sync enabled state
          if (audioSender.track) audioSender.track.enabled = isMicOnRef.current;
        } else if (processedStreamRef.current) {
          const s = pc.addTrack(audioTrack, processedStreamRef.current);
          roleMap.set(s, 'audio');
          // Record mid once transceiver is available
          const tc = pc.getTransceivers().find(t => t.sender === s);
          if (tc?.mid) peerMidRoles.set(tc.mid, 'audio');
          needsRenegotiation = true;
        }
      } else if (audioSender) {
        // FIX: was dead code in original — now correctly outside the
        // `if (audioTrack)` block so it executes when track is removed.
        pc.removeTrack(audioSender);
        roleMap.delete(audioSender);
        needsRenegotiation = true;
      }

      // ── CAMERA ─────────────────────────────────────────────────────────
      const camSender = senderByRole('camera');
      if (videoTrack) {
        if (camSender) {
          if (camSender.track?.id !== videoTrack.id) {
            await camSender.replaceTrack(videoTrack).catch(e =>
              console.error(`replaceTrack camera failed for ${peerId}:`, e),
            );
          }
          if (camSender.track) camSender.track.enabled = isCameraOnRef.current;
        } else if (userMediaStreamRef.current) {
          const s = pc.addTrack(videoTrack, userMediaStreamRef.current);
          roleMap.set(s, 'camera');
          const tc = pc.getTransceivers().find(t => t.sender === s);
          if (tc?.mid) peerMidRoles.set(tc.mid, 'camera');
          needsRenegotiation = true;
        }
      } else if (camSender) {
        // Camera turned off — disable the track but keep the sender so we
        // don't need a full renegotiation just for a mute toggle.
        if (camSender.track) camSender.track.enabled = false;
      }

      // ── SCREEN SHARE ───────────────────────────────────────────────────
      const screenSender = senderByRole('screen');
      if (screenTrack) {
        if (screenSender) {
          if (screenSender.track?.id !== screenTrack.id) {
            await screenSender.replaceTrack(screenTrack).catch(e =>
              console.error(`replaceTrack screen failed for ${peerId}:`, e),
            );
          }
        } else if (displayMediaStreamRef.current) {
          const s = pc.addTrack(screenTrack, displayMediaStreamRef.current);
          roleMap.set(s, 'screen');
          const tc = pc.getTransceivers().find(t => t.sender === s);
          if (tc?.mid) peerMidRoles.set(tc.mid, 'screen');
          needsRenegotiation = true;
        }
      } else if (screenSender) {
        pc.removeTrack(screenSender);
        roleMap.delete(screenSender);
        needsRenegotiation = true;
      }

      senderRoles.current.set(peerId, roleMap);

      if (needsRenegotiation) {
        (pc as any).__suppressNegotiation = true;
        try {
          const isStable = await waitForStableState(pc);
          if (!isStable) {
            console.warn(`Peer ${peerId}: signaling state never became stable, skipping renegotiation`);
            continue;
          }
          const offer = await pc.createOffer();
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          currentSocket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
        } catch (e) {
          console.error('Renegotiation failed for peer', peerId, e);
        } finally {
          (pc as any).__suppressNegotiation = false;
        }
      }
    }
  }, [roomId]);

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLE PEER LEFT
  // ─────────────────────────────────────────────────────────────────────────
  const handlePeerLeft = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
    }
    senderRoles.current.delete(peerId);
    midRoles.current.delete(peerId);
    pendingCandidates.current.delete(peerId);
    setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SOCKET & WEBRTC SETUP
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // FIX (Bug 9): Only emit peer:join after socket is confirmed connected.
    // useSocket already guarantees socket is non-null only after connect,
    // but we double-check here defensively.
    const initConnection = async () => {
      // Get media FIRST, then join — so tracks exist when the first offer fires
      await updateLocalTracks({ targetAudio: true, targetVideo: true });
      socket.emit('peer:join', { roomId });
    };

    if (!socket.connected) {
      socket.once('connect', initConnection);
    } else {
      initConnection();
    }

    // Per-connection glare state stored in a WeakMap to avoid memory leaks
    const glareState = new WeakMap<RTCPeerConnection, {
      isPolite: boolean;
      makingOfferRef: { current: boolean };
      ignoreOfferRef: { current: boolean };
    }>();

    // ── CREATE PEER CONNECTION ──────────────────────────────────────────
    const createPeerConnection = (peerId: string, isOfferer: boolean): RTCPeerConnection => {
      const pc = new RTCPeerConnection(iceServersRef.current);
      peerConnections.current.set(peerId, pc);

      const roleMap = new Map<RTCRtpSender, SenderRole>();
      senderRoles.current.set(peerId, roleMap);

      const peerMidRoles = new Map<string, SenderRole>();
      midRoles.current.set(peerId, peerMidRoles);

      const isPolite = !isOfferer;
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

      // FIX: onnegotiationneeded is suppressed here because the caller
      // (handlePeerJoined) creates the offer immediately after addTrack.
      // Allowing onnegotiationneeded to also fire would cause a double-offer
      // race and m-line ordering crashes.
      (pc as any).__suppressNegotiation = false;
      pc.onnegotiationneeded = () => {};

      // ── ONTRACK — FIX ────────────────────────────────────────────────
      // The original code tried to detect screen vs camera tracks by
      // `event.track.label`, which is unreliable across browsers (Chrome,
      // Firefox, Safari all use different label formats; mobile browsers
      // often return empty strings).
      //
      // The reliable approach is to use the transceiver's `mid` (media
      // section identifier), which we record on the *sender* side when we
      // call addTrack / replaceTrack. The receiver mid matches the sender
      // mid after negotiation, so we can look up the role from midRoles.
      //
      // FIX: We also build two fixed MediaStream slots (camera at [0],
      // screen at [1]) instead of a growing array, so VideoMonitor always
      // receives a stable prop shape.
      pc.ontrack = (event) => {
        const track = event.track;
        const transceiver = pc.getTransceivers().find(t => t.receiver.track === track);
        const mid = transceiver?.mid ?? null;

        // Determine role: prefer mid-based lookup, fall back to label heuristic
        let role: SenderRole | null = null;
        if (mid) {
          role = midRoles.current.get(peerId)?.get(mid) ?? null;
        }
        if (!role) {
          // Heuristic fallback: audio tracks are never screen/camera video
          if (track.kind === 'audio') {
            role = 'audio';
          } else {
            // Screen share labels across browsers:
            // Chrome: "screen:...", "window:...", "tab:..."
            // Firefox: "Screen", "Window", "Monitor ..."
            // OBS virtual cam: often contains "OBS"
            const lbl = track.label.toLowerCase();
            if (
              lbl.includes('screen') ||
              lbl.includes('window') ||
              lbl.includes('monitor') ||
              lbl.includes('tab') ||
              lbl.includes('obs') ||
              lbl.includes('display')
            ) {
              role = 'screen';
            } else {
              role = 'camera';
            }
          }
        }

        // Record mid → role for future ontrack events on this peer
        if (mid && role) {
          const peerMids = midRoles.current.get(peerId) ?? new Map();
          peerMids.set(mid, role);
          midRoles.current.set(peerId, peerMids);
        }

        if (role === 'audio') {
          // Audio tracks travel on the camera MediaStream slot [0].
          // We attach the audio track to the existing stream if present,
          // or create a new one. No separate slot needed.
          setRemotePeers(prev => {
            const participant = participantsRef.current.find(p => p.peerId === peerId);
            const existing = prev.find(p => p.peerId === peerId);
            if (!existing) {
              const stream = event.streams[0] ?? new MediaStream([track]);
              return [...prev, {
                peerId,
                username: participant?.name ?? 'Remote Peer',
                isHost: participant?.isHost,
                streams: [stream, null],
              }];
            }
            // If there's already a camera stream, add the audio track to it
            if (existing.streams[0]) {
              // Replace stale audio tracks
              existing.streams[0].getAudioTracks().forEach(t => existing.streams[0]!.removeTrack(t));
              existing.streams[0].addTrack(track);
              // Return same array reference to avoid unnecessary re-render
              return prev;
            }
            const stream = event.streams[0] ?? new MediaStream([track]);
            return prev.map(p =>
              p.peerId === peerId
                ? { ...p, streams: [stream, p.streams[1]] as [MediaStream | null, MediaStream | null] }
                : p,
            );
          });
          return;
        }

        // Video track — camera or screen
        const isScreen = role === 'screen';

        // FIX: Build a dedicated MediaStream for this slot so that camera
        // and screen share are always on separate stream objects.
        // We cannot reuse event.streams[0] because with max-bundle all
        // tracks from a peer share the same underlying transport stream.
        const dedicatedStream = new MediaStream([track]);

        setRemotePeers(prev => {
          const participant = participantsRef.current.find(p => p.peerId === peerId);
          const existing = prev.find(p => p.peerId === peerId);

          if (!existing) {
            const slots: [MediaStream | null, MediaStream | null] = isScreen
              ? [null, dedicatedStream]
              : [dedicatedStream, null];
            return [...prev, {
              peerId,
              username: participant?.name ?? 'Remote Peer',
              isHost: participant?.isHost,
              streams: slots,
            }];
          }

          const updatedSlots: [MediaStream | null, MediaStream | null] = [
            existing.streams[0],
            existing.streams[1],
          ];

          if (isScreen) {
            updatedSlots[1] = dedicatedStream;
          } else {
            // Camera slot: preserve existing audio tracks from slot[0] if any
            if (existing.streams[0]) {
              const audioTracks = existing.streams[0].getAudioTracks();
              audioTracks.forEach(t => dedicatedStream.addTrack(t));
            }
            updatedSlots[0] = dedicatedStream;
          }

          return prev.map(p =>
            p.peerId === peerId ? { ...p, streams: updatedSlots } : p,
          );
        });

        // When track ends, clear the appropriate slot
        track.onended = () => {
          setRemotePeers(prev => prev.map(p => {
            if (p.peerId !== peerId) return p;
            const slots: [MediaStream | null, MediaStream | null] = [...p.streams] as [MediaStream | null, MediaStream | null];
            if (isScreen) {
              slots[1] = null;
            } else {
              slots[0] = null;
            }
            return { ...p, streams: slots };
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

      // ── ADD ACTIVE LOCAL TRACKS ────────────────────────────────────
      // Suppress onnegotiationneeded while we batch-add tracks so the
      // caller can make the offer in one shot.
      (pc as any).__suppressNegotiation = true;

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

      // Re-enable onnegotiationneeded after the batch
      (pc as any).__suppressNegotiation = false;

      // Record mid → role after transceivers are created
      pc.getTransceivers().forEach(tc => {
        const senderRole = roleMap.get(tc.sender);
        if (senderRole && tc.mid) {
          peerMidRoles.set(tc.mid, senderRole);
        }
      });

      // Boost audio encoding priority
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

    // ── PEER JOINED ──────────────────────────────────────────────────
    const handlePeerJoined = async ({
      peerId, username, isHost,
    }: { peerId: string; username?: string; isHost?: boolean }) => {
      if (peerConnections.current.has(peerId)) return;

      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === peerId)) return prev;
        return [...prev, { peerId, username, isHost, streams: [null, null] }];
      });

      const pc = createPeerConnection(peerId, true);

      // FIX: Record mids now that transceivers exist (mids may be null until
      // after createOffer, so we update them post-offer below too).
      const roleMap = senderRoles.current.get(peerId)!;
      const peerMidRoles = midRoles.current.get(peerId)!;

      try {
        const offer = await pc.createOffer();
        offer.sdp = patchOpusSDP(offer.sdp ?? '');
        await pc.setLocalDescription(offer);

        // Mids are assigned after setLocalDescription
        pc.getTransceivers().forEach(tc => {
          const senderRole = roleMap.get(tc.sender);
          if (senderRole && tc.mid) {
            peerMidRoles.set(tc.mid, senderRole);
          }
        });

        socket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) {
        console.error('Error creating offer for new peer', e);
      }
    };

    // ── PEER OFFER ───────────────────────────────────────────────────
    const handlePeerOffer = async ({
      sdp, peerId, username, isHost,
    }: { sdp: RTCSessionDescriptionInit; peerId: string; username?: string; isHost?: boolean }) => {
      
      // Ensure peer is represented in state even if they currently send no tracks
      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === peerId)) return prev;
        return [...prev, { peerId, username, isHost, streams: [null, null] }];
      });

      let pc = peerConnections.current.get(peerId);
      if (!pc) pc = createPeerConnection(peerId, false);

      const gs = glareState.get(pc);
      const isPolite = gs?.isPolite ?? true;
      const makingOffer = gs?.makingOfferRef.current ?? false;

      const offerCollision =
        sdp.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
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

        // FIX: Flush queued ICE candidates after every setRemoteDescription
        await flushPendingCandidates(pc, peerId);
      } catch (e) {
        console.error('Error handling offer', e);
      }
    };

    // ── PEER ANSWER ──────────────────────────────────────────────────
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

        // FIX: Always flush after setRemoteDescription
        await flushPendingCandidates(pc, peerId);

        // Update mid → role map from the negotiated transceivers
        const roleMap = senderRoles.current.get(peerId);
        const peerMidRoles = midRoles.current.get(peerId);
        if (roleMap && peerMidRoles) {
          pc.getTransceivers().forEach(tc => {
            const senderRole = roleMap.get(tc.sender);
            if (senderRole && tc.mid) {
              peerMidRoles.set(tc.mid, senderRole);
            }
          });
        }
      } catch (e) {
        console.error('Error handling answer', e);
      }
    };

    // ── ICE CANDIDATE ────────────────────────────────────────────────
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

    // ── HELPERS ──────────────────────────────────────────────────────
    const flushPendingCandidates = async (pc: RTCPeerConnection, peerId: string) => {
      const queued = pendingCandidates.current.get(peerId) ?? [];
      pendingCandidates.current.delete(peerId);
      for (const c of queued) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e =>
          console.warn('addIceCandidate flush failed:', e),
        );
      }
    };

    // ── ROOM EVENTS ──────────────────────────────────────────────────
    const handleViewersUpdate = ({ count }: { count: number }) => setViewerCount(count);

    const handleParticipantsUpdate = ({
      participants: updated,
    }: { participants: Participant[] }) => {
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

    const handleReconnect = () => {
      console.log('[useMeshWebRTC] socket reconnected — re-joining room');
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
      senderRoles.current.clear();
      midRoles.current.clear();
      pendingCandidates.current.clear();
      setRemotePeers([]);
      socket.emit('peer:join', { roomId });
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
    socket.on('reconnect', handleReconnect);

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
      socket.off('reconnect', handleReconnect);

      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, leaveRoom, handlePeerLeft, replaceTracksOnPeers, buildAudioPipeline]);

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE LOCAL TRACKS
  //
  // FIX: When userMediaStreamRef already exists on toggle, we do NOT skip
  // the audio pipeline rebuild — instead we check whether the pipeline is
  // still live (audioSourceNodeRef.current !== null) before reusing it.
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

      if (needsUserMedia) {
        if (!userMediaStreamRef.current) {
          // Fresh acquisition — tear down any stale audio pipeline first
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
              try {
                userMediaStreamRef.current = await tryGetMedia(false, currentMic ? AUDIO_CONSTRAINTS : false);
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
                } catch {
                  currentMic = currentVideo = false;
                }
              } else {
                currentMic = currentVideo = false;
              }
            } else if (e.name === 'OverconstrainedError' && currentVideo) {
              try {
                userMediaStreamRef.current = await tryGetMedia(
                  { facingMode: { ideal: 'user' } },
                  currentMic ? AUDIO_CONSTRAINTS : false,
                );
              } catch {
                currentMic = currentVideo = false;
              }
            } else {
              currentMic = currentVideo = false;
            }
          }
        } else {
          // Stream already exists — just toggle video track enabled state
          if (targetVideo !== undefined) {
            userMediaStreamRef.current.getVideoTracks().forEach(t => {
              t.enabled = currentVideo;
            });
          }
        }

        // ── AUDIO PIPELINE ────────────────────────────────────────────
        // FIX: Rebuild if pipeline is missing OR if the source node is
        // gone (happens after teardownAudioPipeline was called on a
        // previous toggle cycle).
        if (userMediaStreamRef.current?.getAudioTracks().length) {
          if (!processedStreamRef.current || !audioSourceNodeRef.current) {
            const built = buildAudioPipeline(userMediaStreamRef.current);
            if (built) processedStreamRef.current = built;
          }

          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume().catch(console.warn);
          }

          if (currentMic) {
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
              gainNodeRef.current.gain.setTargetAtTime(1, audioContextRef.current.currentTime, 0.02);
            }
            processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });
          } else {
            if (gainNodeRef.current && audioContextRef.current) {
              gainNodeRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
              gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.02);
            }
            setTimeout(() => {
              processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
            }, 60);
          }
        }
      }

      // Release user media when both mic and camera are off
      if (!needsUserMedia && userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(t => t.stop());
        userMediaStreamRef.current = null;
        teardownAudioPipeline();
      }

      // ── SCREEN SHARE ──────────────────────────────────────────────
      if (currentScreen) {
        if (!SCREEN_SHARE_SUPPORTED) {
          alert(
            IS_MOBILE
              ? 'Screen sharing is not supported on this mobile device/browser.'
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
              screenVideoTrack.onended = () => updateLocalTracks({ targetScreen: false });
            }
          } catch (err: unknown) {
            const e = err as DOMException;
            console.error('getDisplayMedia failed', e);
            if (e.name === 'NotAllowedError') {
              alert('Screen share permission denied.');
            } else if (e.name === 'NotSupportedError') {
              alert('Screen sharing is not supported on this device or browser.');
            }
            currentScreen = false;
          }
        }
      } else if (!currentScreen && displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
        displayMediaStreamRef.current = null;
      }

      // ── COMMIT STATE ─────────────────────────────────────────────
      isMicOnRef.current = currentMic;
      isCameraOnRef.current = currentVideo;
      isScreenOnRef.current = currentScreen;

      setIsMicOn(currentMic);
      setIsCameraOn(currentVideo);
      setIsScreenOn(currentScreen);

      setLocalStream(userMediaStreamRef.current);
      setLocalScreenStream(displayMediaStreamRef.current);

      // Push track changes to all active peer connections
      if (socket) {
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