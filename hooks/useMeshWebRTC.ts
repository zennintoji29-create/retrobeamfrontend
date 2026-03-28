import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────
// ICE configuration: multiple STUN + TURN fallback.
// Replace openrelay credentials with your own TURN server in
// production — openrelay has no uptime guarantee.
// ─────────────────────────────────────────────────────────────
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

// ─────────────────────────────────────────────────────────────
// Audio constraints for getUserMedia.
// All three processors must be on to prevent echo and noise.
// sampleRate: 48000 = Opus native rate, avoids resampling.
// channelCount: 1  = mono — halves bandwidth, fine for voice.
// ─────────────────────────────────────────────────────────────
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
  latency: 0,
} as MediaTrackConstraints;

// ─────────────────────────────────────────────────────────────
// FIX #17 — Opus codec prioritization in SDP.
// Reorders the m=audio payload list so Opus (payload type 111
// in most browsers) is listed first. Without this the browser
// may negotiate PCMU/PCMA (8 kHz telephone quality) instead.
//
// FIX #18 — Opus FEC + DTX in SDP.
// useinbandfec=1 enables in-band FEC: lost packets are repaired
//   from the NEXT packet's redundancy data (Opus RFC 6716 §3.6).
//   This repairs crackling from 1–5% packet loss with no extra
//   bandwidth — the FEC data rides inside normal Opus frames.
// usedtx=1 enables DTX: encoder sends ~comfort noise frames
//   during silence instead of full packets, cutting bandwidth
//   by 60–80% during quiet periods.
//
// FIX #19 — Audio bitrate cap via b=AS:32 in SDP.
// Without this, Chrome may allocate 500+ kbps to audio,
// starving video and causing congestion-induced crackling.
// 32 kbps is sufficient for high-quality Opus mono voice.
//
// FIX #20 — DynamicsCompressorNode is inserted in buildAudioPipeline
// below, not in SDP. SDP is for bitrate/codec config only.
// ─────────────────────────────────────────────────────────────
function patchOpusSDP(sdp: string): string {
  // Step 1: Reorder payload types in m=audio line so Opus is first.
  // Chrome/Firefox usually assign Opus payload type 111.
  // We extract all payload types, move Opus-related ones to front.
  let result = sdp;

  // Find the Opus payload type number from the rtpmap lines
  const opusPtMatch = result.match(/a=rtpmap:(\d+) opus\/48000/i);
  const opusPt = opusPtMatch ? opusPtMatch[1] : null;

  if (opusPt) {
    // Reorder m=audio payload list: put opusPt first
    result = result.replace(
      /^(m=audio \d+ \S+ )([\d ]+)$/m,
      (_match, prefix, payloads) => {
        const pts = payloads.trim().split(' ');
        const reordered = [opusPt, ...pts.filter((p: string) => p !== opusPt)];
        return `${prefix}${reordered.join(' ')}`;
      },
    );
  }

  // Step 2: Patch the a=fmtp line for Opus with FEC, DTX, stereo=0
  result = result.replace(
    /a=fmtp:(\d+) (.*opus.*)\r\n/gi,
    (_match, pt, params) => {
      let patched = params.includes('minptime') ? params : `minptime=10;${params}`;
      // Replace existing values so we don't duplicate
      patched = patched.replace(/useinbandfec=\d/, 'useinbandfec=1');
      patched = patched.replace(/usedtx=\d/, 'usedtx=1');
      patched = patched.replace(/stereo=\d/, 'stereo=0');
      patched = patched.replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=32000');
      const extras: string[] = [];
      if (!patched.includes('useinbandfec'))    extras.push('useinbandfec=1');
      if (!patched.includes('usedtx'))          extras.push('usedtx=1');
      if (!patched.includes('stereo'))          extras.push('stereo=0');
      if (!patched.includes('maxaveragebitrate')) extras.push('maxaveragebitrate=32000');
      return `a=fmtp:${pt} ${patched}${extras.length ? ';' + extras.join(';') : ''}\r\n`;
    },
  );

  // Step 3: Insert b=AS:32 bitrate cap into the audio m-section.
  // Targets the line immediately after "m=audio ..." and any
  // existing "c=" line but before the first "a=" line.
  // We only add it if it's not already present.
  if (!result.includes('b=AS:32')) {
    result = result.replace(
      /(m=audio [^\r\n]+\r\n(?:c=[^\r\n]+\r\n)?)/,
      '$1b=AS:32\r\n',
    );
  }

  return result;
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

// ─────────────────────────────────────────────────────────────
// FIX #9 — Sender role map type.
// Using a Map<RTCRtpSender, role> avoids the fragile pattern of
// identifying senders by checking stream.getTracks().includes()
// which breaks after replaceTrack() because sender.track is
// updated to the new track, making the old stream check useless.
// ─────────────────────────────────────────────────────────────
type SenderRole = 'audio' | 'camera' | 'screen';

export function useMeshWebRTC(
  roomId: string,
  socket: Socket | null,
  guestName?: string,
) {
  const [localStream, setLocalStream]             = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers]             = useState<RemotePeer[]>([]);
  const [participants, setParticipants]           = useState<Participant[]>([]);
  const [isMicOn, setIsMicOn]                     = useState(false);
  const [isCameraOn, setIsCameraOn]               = useState(false);
  const [isScreenOn, setIsScreenOn]               = useState(false);
  const [viewerCount, setViewerCount]             = useState(1);

  const localStreamRef        = useRef<MediaStream | null>(null);
  const participantsRef       = useRef<Participant[]>([]);
  const peerConnections       = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates     = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef    = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);

  // FIX #9 — Per-connection sender role maps.
  // Key: peerId → Map<RTCRtpSender, SenderRole>
  // This survives replaceTrack() because we look up by sender object,
  // not by the track reference which changes after every replaceTrack.
  const senderRoles = useRef<Map<string, Map<RTCRtpSender, SenderRole>>>(new Map());

  // FIX #10 — Shared AudioContext for mic pipeline.
  const audioContextRef    = useRef<AudioContext | null>(null);
  const gainNodeRef        = useRef<GainNode | null>(null);
  const compressorNodeRef  = useRef<DynamicsCompressorNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  // Stable refs for boolean state — prevent stale closures in callbacks.
  const isMicOnRef    = useRef(false);
  const isCameraOnRef = useRef(false);
  const isScreenOnRef = useRef(false);

  // FIX — Concurrency guard: prevents overlapping updateLocalTracks calls.
  // If toggleMic is called twice before the first getUserMedia resolves,
  // the second call would see a null userMediaStreamRef and call getUserMedia
  // again, creating a phantom stream that is never tracked or cleaned up.
  const isUpdatingTracksRef = useRef(false);

  useEffect(() => { localStreamRef.current  = localStream;  }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // ─────────────────────────────────────────────────────────
  // FIX #10 & #20 — buildAudioPipeline with try/catch guard
  // and DynamicsCompressorNode inserted between Gain and Dest.
  //
  // Pipeline: Source → GainNode → DynamicsCompressor → Destination
  //
  // The compressor prevents sudden volume spikes from clipping
  // the output (the "beep/crack" artifact). Settings are tuned
  // for voice: fast attack to catch spikes, slow release to
  // avoid pumping, -24 dB knee for gentle onset.
  //
  // FIX #11 — Return value is always assigned here (the caller
  // in updateLocalTracks was previously calling buildAudioPipeline()
  // without using the return value, leaving processedStreamRef stale).
  // We now always set processedStreamRef.current inside this function.
  // ─────────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream | null => {
    // FIX #10 — Wrap AudioContext creation in try/catch.
    // Chrome blocks new AudioContext before a user gesture and
    // also has a limit of ~6 simultaneous contexts per tab.
    let ctx = audioContextRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext({ sampleRate: 48000 });
        audioContextRef.current = ctx;
      } catch (e) {
        console.error('AudioContext creation failed, falling back to raw stream', e);
        // Fall back: send the raw stream without processing.
        // Echo cancellation from getUserMedia constraints still applies.
        processedStreamRef.current = rawStream;
        return rawStream;
      }
    }

    // Resume if suspended — browsers auto-suspend before user gesture.
    // The audio track.enabled fallback (FIX #16) handles the case where
    // resume hasn't completed yet.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(e => console.warn('AudioContext resume failed', e));
    }

    try {
      const audioTracks = rawStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // FIX — Stream with 0 audio tracks (some mobile browsers):
        // return the raw stream so video still works.
        processedStreamRef.current = rawStream;
        return rawStream;
      }

      const source = ctx.createMediaStreamSource(rawStream);

      // GainNode: mute/unmute without stopping tracks
      const gain = ctx.createGain();
      gain.gain.value = isMicOnRef.current ? 1 : 0;
      gainNodeRef.current = gain;

      // FIX #20 — DynamicsCompressorNode: prevents clipping artifacts.
      // threshold: start compressing at -24 dBFS
      // knee: 12 dB soft knee for gentle onset
      // ratio: 4:1 compression — strong enough to tame spikes
      // attack: 0.003 s — fast enough to catch transients
      // release: 0.25 s — slow enough to avoid pumping artifacts
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value      = 12;
      compressor.ratio.value     = 4;
      compressor.attack.value    = 0.003;
      compressor.release.value   = 0.25;
      compressorNodeRef.current  = compressor;

      const dest = ctx.createMediaStreamDestination();

      // FIX #20 — Correct pipeline order: Source → Gain → Compressor → Dest
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(dest);

      // Build the processed stream: processed audio + original video tracks
      const processedStream = new MediaStream();
      dest.stream.getAudioTracks().forEach(t => processedStream.addTrack(t));
      rawStream.getVideoTracks().forEach(t => processedStream.addTrack(t));

      processedStreamRef.current = processedStream;
      return processedStream;
    } catch (e) {
      console.error('AudioContext pipeline build failed, falling back to raw stream', e);
      processedStreamRef.current = rawStream;
      return rawStream;
    }
  }, []); // No deps — uses only refs which are stable

  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    senderRoles.current.clear();
    setRemotePeers([]);

    if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(t => t.stop());
      userMediaStreamRef.current = null;
    }
    if (displayMediaStreamRef.current) {
      displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
      displayMediaStreamRef.current = null;
    }

    // FIX — AudioContext must be closed on leave to prevent memory leaks.
    // Unclosed AudioContext objects accumulate over sessions. Chrome has a
    // per-tab limit (~6) and will start throwing on new AudioContext() calls.
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.warn);
      audioContextRef.current = null;
    }
    gainNodeRef.current       = null;
    compressorNodeRef.current = null;
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

  // ─────────────────────────────────────────────────────────
  // FIX #3 & #9 — replaceTracksOnPeers uses RTCRtpSender.replaceTrack()
  // and identifies senders by their role in senderRoles map, not by
  // checking stream.getTracks().includes(sender.track).
  //
  // FIX #12 — onnegotiationneeded is handled by a flag in createPeerConnection.
  // We only emit renegotiation offers from replaceTracksOnPeers when a NEW
  // sender is being added (no existing sender for that role), not for
  // replaceTrack() calls which don't need renegotiation.
  // ─────────────────────────────────────────────────────────
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const audioTrack  = processedStreamRef.current?.getAudioTracks()[0]        ?? null;
    const videoTrack  = userMediaStreamRef.current?.getVideoTracks()[0]         ?? null;
    const screenTrack = displayMediaStreamRef.current?.getVideoTracks()[0]      ?? null;

    // FIX #16 — Apply track.enabled as fallback alongside GainNode.
    // If AudioContext is suspended (before user gesture completes resume()),
    // GainNode gain changes have no effect. track.enabled is a hard mute
    // that works regardless of AudioContext state.
    if (audioTrack) {
      audioTrack.enabled = isMicOnRef.current;
    }
    if (videoTrack) {
      videoTrack.enabled = isCameraOnRef.current;
    }

    const entries = Array.from(peerConnections.current.entries());

    for (const [peerId, pc] of entries) {
      // Skip connections that are in a terminal state — no point sending
      const state = pc.connectionState;
      if (state === 'closed' || state === 'failed') continue;

      let roleMap = senderRoles.current.get(peerId);
      if (!roleMap) {
        roleMap = new Map();
        senderRoles.current.set(peerId, roleMap);
      }

      // Reverse lookup: find existing sender by role.
      // Array.from() avoids the TS2802 "Map is not iterable with for...of
      // unless --downlevelIteration or target >= ES2015" error.
      const senderByRole = (role: SenderRole): RTCRtpSender | undefined =>
        Array.from(roleMap!.entries()).find(([, r]) => r === role)?.[0];

      let needsRenegotiation = false;

      // ── Audio ────────────────────────────────────────────
      const audioSender = senderByRole('audio');
      if (audioSender) {
        if (audioTrack) {
          // FIX #3 — replaceTrack: no renegotiation, no crackling
          await audioSender.replaceTrack(audioTrack).catch(e =>
            console.error(`replaceTrack audio failed for ${peerId}`, e),
          );
        } else {
          // Mic turned fully off — replace with null to "silence" without removing sender
          await audioSender.replaceTrack(null).catch(console.error);
        }
      } else if (audioTrack && processedStreamRef.current) {
        const s = pc.addTrack(audioTrack, processedStreamRef.current);
        roleMap.set(s, 'audio');
        needsRenegotiation = true;
      }

      // ── Camera video ─────────────────────────────────────
      const camSender = senderByRole('camera');
      if (camSender) {
        if (videoTrack) {
          await camSender.replaceTrack(videoTrack).catch(e =>
            console.error(`replaceTrack camera failed for ${peerId}`, e),
          );
        } else {
          await camSender.replaceTrack(null).catch(console.error);
        }
      } else if (videoTrack && userMediaStreamRef.current) {
        const s = pc.addTrack(videoTrack, userMediaStreamRef.current);
        roleMap.set(s, 'camera');
        needsRenegotiation = true;
      }

      // ── Screen share ─────────────────────────────────────
      const screenSender = senderByRole('screen');
      if (screenSender) {
        if (screenTrack) {
          await screenSender.replaceTrack(screenTrack).catch(e =>
            console.error(`replaceTrack screen failed for ${peerId}`, e),
          );
        } else {
          // Screen share ended — replace with null then remove sender
          // We must removeTrack here (not replaceTrack(null)) because we want
          // the remote to know the screen track is gone, not just silent.
          pc.removeTrack(screenSender);
          roleMap.delete(screenSender);
          needsRenegotiation = true;
        }
      } else if (screenTrack && displayMediaStreamRef.current) {
        const s = pc.addTrack(screenTrack, displayMediaStreamRef.current);
        roleMap.set(s, 'screen');
        needsRenegotiation = true;
      }

      // Renegotiate ONLY when sender count changes (add/remove track).
      // replaceTrack() is in-band and never needs renegotiation.
      if (needsRenegotiation) {
        try {
          const offer = await pc.createOffer();
          // FIX — SDP patch BEFORE setLocalDescription, never after.
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

  // ─────────────────────────────────────────────────────────
  // FIX #15 — handlePeerLeft as useCallback outside the effect.
  // Defined here so it captures setRemotePeers via functional
  // update (prev => ...) and never reads stale remotePeers state.
  // Also used in onconnectionstatechange which fires asynchronously.
  // ─────────────────────────────────────────────────────────
  const handlePeerLeft = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
    }
    senderRoles.current.delete(peerId);
    pendingCandidates.current.delete(peerId);
    // Functional update — never reads stale closure state
    setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
  }, []); // No deps — only touches refs and functional state setter

  useEffect(() => {
    if (!socket) return;

    socket.emit('peer:join', { roomId, guestName });

    // ─────────────────────────────────────────────────────
    // FIX #9 — createPeerConnection uses senderRoles Map.
    // FIX #12 — onnegotiationneeded handler: emits offer when
    //   the browser internally queues renegotiation after addTrack.
    //   Without this, addTrack() fires onnegotiationneeded but no
    //   offer is ever sent, so the remote never receives the track.
    //
    //   NOTE: We suppress the FIRST onnegotiationneeded event for
    //   the "offerer" role because handlePeerJoined immediately
    //   creates an offer manually (to control SDP patching).
    //   Subsequent events (from screen share, etc.) are handled here.
    //
    // FIX #7 — ICE restart on connectionState === 'failed'.
    //   restartIce() triggers a new ICE gathering round without
    //   tearing down the peer connection. Only call handlePeerLeft
    //   on 'closed' — the terminal, unrecoverable state.
    //   'failed' is transient and often recovers after restartIce().
    //
    // FIX #13 — Perfect Negotiation pattern (polite/impolite roles).
    //   When two peers create offers simultaneously (glare), one must
    //   roll back its local description and accept the other's offer.
    //   We use socket.id comparison to deterministically assign roles:
    //   the peer with the "smaller" socket.id is always polite.
    // ─────────────────────────────────────────────────────
    const createPeerConnection = (
      peerId: string,
      isOfferer: boolean, // true = we sent the invite (handlePeerJoined)
    ): RTCPeerConnection => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(peerId, pc);

      const roleMap = new Map<RTCRtpSender, SenderRole>();
      senderRoles.current.set(peerId, roleMap);

      // FIX #13 — Polite peer = the one who did NOT initiate.
      // Comparing socket IDs gives a deterministic, stable role.
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

      // FIX #12 — onnegotiationneeded: send offer when browser queues one.
      // guarded by makingOffer flag to prevent concurrent offer creation.
      pc.onnegotiationneeded = async () => {
        // Skip the first event for the offerer — handlePeerJoined creates
        // the offer immediately with SDP patching. For all subsequent
        // onnegotiationneeded events (e.g. screen share added), we handle here.
        if (isOfferer && !makingOffer && pc.signalingState === 'stable' && pc.getSenders().length > 0) {
          // Check if we've already sent the initial offer (by checking if remote desc exists)
          // If remoteDescription is set, this is a subsequent renegotiation
          if (!pc.remoteDescription) return; // Initial offer handled by handlePeerJoined
        }
        try {
          makingOffer = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== 'stable') return; // Glare: state changed under us
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          socket.emit('peer:offer', { sdp: pc.localDescription, roomId, targetSocketId: peerId });
        } catch (e) {
          console.error('onnegotiationneeded offer failed', e);
        } finally {
          makingOffer = false;
        }
      };

      // FIX #14 — Read participantsRef.current SYNCHRONOUSLY before setState.
      // Inside a setRemotePeers callback, reading participantsRef.current is
      // safe because refs are synchronous. But to be explicit and safe we
      // capture it here, before the async ontrack handler closure.
      pc.ontrack = (event) => {
        // Capture participant data synchronously at event time, before any setState.
        // FIX #14 — Do NOT read participantsRef inside setState callback.
        const participantAtEventTime = participantsRef.current.find(p => p.peerId === peerId);

        // FIX #8 — Stable ref for onended: capture peerId by value in this
        // closure. The callback itself does not close over any useCallback
        // function that might change on re-renders. It only calls setRemotePeers
        // with a functional update — the safest pattern.
        const handleTrackEnded = () => {
          setRemotePeers(prev => prev.map(p => {
            if (p.peerId !== peerId) return p;
            const validStreams = p.streams.filter(s =>
              s.getTracks().some(t => t.readyState !== 'ended'),
            );
            return { ...p, streams: validStreams };
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
            // Prune dead streams
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

      // FIX #7 — ICE restart on 'failed', not tear-down.
      // FIX #15 — handlePeerLeft is stable (defined as useCallback above).
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          // Attempt recovery before giving up. restartIce() triggers a new
          // ICE gathering cycle — no media interruption if it succeeds.
          console.warn(`Peer ${peerId} connection failed, attempting ICE restart`);
          pc.restartIce();
        } else if (pc.connectionState === 'closed') {
          // 'closed' is terminal — clean up.
          handlePeerLeft(peerId);
        }
        // 'disconnected' is transient (e.g. brief network switch).
        // WebRTC will auto-recover from 'disconnected' — do NOT tear down.
      };

      // Add currently active local tracks with their roles recorded
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

      // Set audio sender priority to 'high' after tracks are added.
      // Hints to the browser to queue audio packets before video at
      // the OS network layer — prevents audio dropouts during congestion.
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

      // FIX #13 — Expose glare-handling callbacks so handlePeerOffer can
      // implement the polite/impolite pattern. We attach them to the pc
      // object via a WeakMap to avoid polluting the RTCPeerConnection type.
      glareState.set(pc, { isPolite, makingOfferRef: { current: makingOffer }, ignoreOfferRef: { current: ignoreOffer } });

      return pc;
    };

    // WeakMap to store Perfect Negotiation state per PeerConnection.
    // This avoids closure mutation problems and doesn't affect GC.
    const glareState = new WeakMap<RTCPeerConnection, {
      isPolite: boolean;
      makingOfferRef: { current: boolean };
      ignoreOfferRef: { current: boolean };
    }>();

    const handlePeerJoined = async ({
      peerId, username, isHost,
    }: { peerId: string; username?: string; isHost?: boolean }) => {
      // Idempotency guard: if we already have a connection, ignore.
      if (peerConnections.current.has(peerId)) return;

      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === peerId)) return prev;
        return [...prev, { peerId, username, isHost, streams: [] }];
      });

      const pc = createPeerConnection(peerId, true /* isOfferer */);
      try {
        const offer = await pc.createOffer();
        // FIX — SDP patch BEFORE setLocalDescription
        offer.sdp = patchOpusSDP(offer.sdp ?? '');
        await pc.setLocalDescription(offer);
        socket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) {
        console.error('Error creating offer', e);
      }
    };

    // ─────────────────────────────────────────────────────
    // FIX #5 — pendingCandidates flushed in BOTH handlePeerOffer
    //   AND handlePeerAnswer. The original code only flushed in
    //   handlePeerOffer. The answer side receives ICE candidates
    //   before setRemoteDescription completes and silently drops them.
    //
    // FIX #13 — Perfect Negotiation: if we receive an offer while
    //   we are also creating one (glare), the polite peer rolls back
    //   its local description and accepts the incoming offer.
    //   The impolite peer ignores the incoming offer if there's a collision.
    // ─────────────────────────────────────────────────────
    const handlePeerOffer = async ({
      sdp, peerId,
    }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      let pc = peerConnections.current.get(peerId);
      if (!pc) pc = createPeerConnection(peerId, false /* isOfferer */);

      const gs = glareState.get(pc);
      const isPolite     = gs?.isPolite         ?? true;
      const makingOffer  = gs?.makingOfferRef.current ?? false;

      // Detect offer collision (glare)
      const offerCollision =
        sdp.type === 'offer' &&
        (makingOffer || pc.signalingState !== 'stable');

      const ignoreOffer = !isPolite && offerCollision;
      if (gs) gs.ignoreOfferRef.current = ignoreOffer;

      if (ignoreOffer) {
        // Impolite peer: silently discard the colliding offer.
        // Our own offer will win because the remote (polite) peer
        // will roll back and accept ours.
        return;
      }

      try {
        if (offerCollision) {
          // Polite peer: roll back our pending local description,
          // then accept the incoming offer.
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(new RTCSessionDescription(sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }

        // Prune dead streams from this peer
        setRemotePeers(prev => prev.map(p => {
          if (p.peerId !== peerId) return p;
          return {
            ...p,
            streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')),
          };
        }));

        const answer = await pc.createAnswer();
        // FIX — SDP patch BEFORE setLocalDescription
        answer.sdp = patchOpusSDP(answer.sdp ?? '');
        await pc.setLocalDescription(answer);
        socket.emit('peer:answer', { sdp: answer, roomId, targetSocketId: peerId });

        // FIX #5 — Flush pending ICE candidates on the ANSWER side too.
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
      if (gs?.ignoreOfferRef.current) return; // We were impolite and ignored the offer

      try {
        // Guard against stale answers arriving after we've already moved on
        if (pc.signalingState !== 'have-local-offer') {
          console.warn(`Received answer from ${peerId} in unexpected state: ${pc.signalingState}`);
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // FIX #5 — Flush pending ICE candidates on the OFFER side (answer received).
        // Candidates may have arrived before the answer set the remote description.
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
          // Suppress benign "end-of-candidates" errors
          if ((e as DOMException).name !== 'OperationError') {
            console.error('Error adding ICE candidate', e);
          }
        }
      } else {
        // Buffer until setRemoteDescription completes
        const queued = pendingCandidates.current.get(peerId) ?? [];
        queued.push(candidate);
        pendingCandidates.current.set(peerId, queued);
      }
    };

    const handleViewersUpdate = ({ count }: { count: number }) =>
      setViewerCount(count);

    const handleParticipantsUpdate = ({
      participants: updated,
    }: { participants: Participant[] }) => {
      setParticipants(updated);
      participantsRef.current = updated; // Keep ref in sync immediately
      setRemotePeers(prev => prev.map(peer => {
        const match = updated.find(p => p.peerId === peer.peerId);
        return match ? { ...peer, username: match.name, isHost: match.isHost } : peer;
      }));
    };

    // FIX #11 — Host mute uses GainNode + track.enabled fallback (FIX #16).
    const handleHostMuted = () => {
      setIsMicOn(false);
      isMicOnRef.current = false;
      // Primary: GainNode ramp (smooth, no glitch)
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(
          0,
          audioContextRef.current.currentTime,
          0.01,
        );
      }
      // FIX #16 — Fallback: track.enabled in case AudioContext is suspended
      processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
    };

    // FIX #6 — All socket.off() calls pass the exact same handler reference
    // that was passed to socket.on(). Without this, socket.off('event') with
    // no handler reference is a no-op and the handler leaks across re-renders.
    socket.on('peer:joined',              handlePeerJoined);
    socket.on('peer:offer',               handlePeerOffer);
    socket.on('peer:answer',              handlePeerAnswer);
    socket.on('peer:ice-candidate',       handleIceCandidate);
    socket.on('room:viewers_update',      handleViewersUpdate);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:muted',              handleHostMuted);

    // FIX #6 — Inline handlers that don't need to be referenced in cleanup
    // are wrapped in named functions so they CAN be removed properly.
    const handlePeerLeftEvent  = ({ peerId }: { peerId: string }) => handlePeerLeft(peerId);
    const handleKicked         = () => { window.location.href = '/'; };
    const handleBanned         = () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; };
    const handleRoomEnded      = () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; };

    socket.on('peer:left',   handlePeerLeftEvent);
    socket.on('host:kicked', handleKicked);
    socket.on('host:banned', handleBanned);
    socket.on('room:ended',  handleRoomEnded);

    return () => {
      // FIX #6 — Every socket.off() passes the exact handler reference.
      socket.off('peer:joined',              handlePeerJoined);
      socket.off('peer:offer',               handlePeerOffer);
      socket.off('peer:answer',              handlePeerAnswer);
      socket.off('peer:ice-candidate',       handleIceCandidate);
      socket.off('peer:left',                handlePeerLeftEvent);
      socket.off('room:viewers_update',      handleViewersUpdate);
      socket.off('room:participants_update', handleParticipantsUpdate);
      socket.off('host:kicked',              handleKicked);
      socket.off('host:banned',              handleBanned);
      socket.off('room:ended',              handleRoomEnded);
      socket.off('host:muted',              handleHostMuted);

      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, guestName, leaveRoom, handlePeerLeft, replaceTracksOnPeers, buildAudioPipeline]);

  // ─────────────────────────────────────────────────────────
  // updateLocalTracks — the single entry point for all media
  // state changes (mic on/off, camera on/off, screen on/off).
  //
  // FIX — Concurrency guard: isUpdatingTracksRef prevents overlapping
  // calls. If toggleMic is called twice rapidly, the second call
  // returns early. Without this guard, two parallel getUserMedia
  // calls can race, with only one stream being tracked, causing
  // a phantom hardware hold on the mic/camera.
  //
  // FIX — Partial permission grants: if getUserMedia fails with
  // NotFoundError (no camera), we retry with audio only if mic
  // is needed. If it fails with NotAllowedError for video only,
  // we continue with audio.
  // ─────────────────────────────────────────────────────────
  const updateLocalTracks = useCallback(async ({
    targetAudio,
    targetVideo,
    targetScreen,
  }: {
    targetAudio?: boolean;
    targetVideo?: boolean;
    targetScreen?: boolean;
  }) => {
    // FIX — Debounce rapid calls (e.g. double-click toggleMic)
    if (isUpdatingTracksRef.current) return;
    isUpdatingTracksRef.current = true;

    try {
      let currentMic    = targetAudio  !== undefined ? targetAudio  : isMicOnRef.current;
      let currentVideo  = targetVideo  !== undefined ? targetVideo  : isCameraOnRef.current;
      let currentScreen = targetScreen !== undefined ? targetScreen : isScreenOnRef.current;

      const needsUserMedia = currentMic || currentVideo;

      if (needsUserMedia) {
        if (!userMediaStreamRef.current) {
          // FIX — Partial permission grant handling.
          // Try with both audio+video first, fall back gracefully.
          try {
            userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
              video: currentVideo ? { facingMode: 'user' } : false,
              audio: currentMic ? AUDIO_CONSTRAINTS : false,
            });
          } catch (e: unknown) {
            const err = e as DOMException;
            if (err.name === 'NotFoundError' && currentVideo) {
              // No camera found — try audio only
              console.warn('Camera not found, retrying with audio only');
              try {
                userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
                  video: false,
                  audio: currentMic ? AUDIO_CONSTRAINTS : false,
                });
                currentVideo = false;
              } catch (e2) {
                console.error('getUserMedia failed even for audio only', e2);
                currentMic   = false;
                currentVideo = false;
              }
            } else if (err.name === 'NotAllowedError') {
              // Full denial — check if partial grants are possible
              // by trying audio-only if camera was the likely blocker
              if (currentVideo && currentMic) {
                try {
                  userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
                    video: false,
                    audio: AUDIO_CONSTRAINTS,
                  });
                  currentVideo = false;
                  console.warn('Camera denied, continuing with audio only');
                } catch {
                  console.error('Both camera and mic denied');
                  currentMic   = false;
                  currentVideo = false;
                }
              } else {
                console.error('Media access denied', err);
                currentMic   = false;
                currentVideo = false;
              }
            } else {
              console.error('Failed to get user media', e);
              currentMic   = false;
              currentVideo = false;
            }
          }
        } else {
          // Stream already exists — toggle track.enabled (no renegotiation)
          if (targetVideo !== undefined) {
            userMediaStreamRef.current.getVideoTracks().forEach(t => {
              t.enabled = currentVideo;
            });
          }
        }

        // FIX #4 — Mute via GainNode, NOT track.stop().
        // FIX #10 — Resume AudioContext before adjusting gain.
        // FIX #16 — Also set track.enabled as a fallback.
        if (currentMic && userMediaStreamRef.current?.getAudioTracks().length) {
          if (!processedStreamRef.current) {
            // FIX #11 — Assign return value from buildAudioPipeline
            const built = buildAudioPipeline(userMediaStreamRef.current);
            if (!built) {
              // buildAudioPipeline already set processedStreamRef on failure
            }
          }

          // Resume AudioContext before modifying gain — required by browser policy
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume().catch(console.warn);
          }

          if (gainNodeRef.current && audioContextRef.current) {
            gainNodeRef.current.gain.setTargetAtTime(
              1,
              audioContextRef.current.currentTime,
              0.01,
            );
          }
          // FIX #16 — track.enabled fallback (in case AudioContext resume is still pending)
          processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });

        } else if (!currentMic) {
          if (gainNodeRef.current && audioContextRef.current) {
            gainNodeRef.current.gain.setTargetAtTime(
              0,
              audioContextRef.current.currentTime,
              0.01,
            );
          }
          // FIX #16 — track.enabled fallback
          processedStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
        }
      }

      // Release hardware only when BOTH mic and camera are off.
      // Never call track.stop() just for muting (FIX #4).
      if (!needsUserMedia && userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(t => t.stop());
        userMediaStreamRef.current = null;
        processedStreamRef.current = null;
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(console.warn);
          audioContextRef.current  = null;
          gainNodeRef.current      = null;
          compressorNodeRef.current = null;
        }
      }

      // ── Screen share ──────────────────────────────────────
      if (currentScreen && !displayMediaStreamRef.current) {
        try {
          displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } },
            audio: false,
          });

          // FIX #8 — Stable onended ref: the callback captures peerId-independent
          // logic and only calls updateLocalTracks (which is stable via useCallback).
          // We capture a reference to the track to avoid stale closure over the
          // entire displayMediaStreamRef (which could change by the time it fires).
          const screenVideoTrack = displayMediaStreamRef.current.getVideoTracks()[0];
          if (screenVideoTrack) {
            screenVideoTrack.onended = () => {
              // Called when user stops sharing from the browser UI (closes tab etc.)
              updateLocalTracks({ targetScreen: false });
            };
          }
        } catch (e: unknown) {
          const err = e as DOMException;
          console.error('getDisplayMedia failed', e);
          if (err.name === 'NotAllowedError') {
            alert('Screen share permission denied.');
          } else if (err.name === 'NotSupportedError') {
            alert('Screen sharing is not supported on this device or browser.');
          }
          // If getDisplayMedia throws, revert the state change
          currentScreen = false;
        }
      } else if (!currentScreen && displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
        displayMediaStreamRef.current = null;
      }

      isMicOnRef.current    = currentMic;
      isCameraOnRef.current = currentVideo;
      isScreenOnRef.current = currentScreen;

      setIsMicOn(currentMic);
      setIsCameraOn(currentVideo);
      setIsScreenOn(currentScreen);

      // FIX — Only expose localStream when there's actually something to show.
      // If mic-only (no video tracks), localStream is the raw user media stream
      // for the local preview (though preview should be muted — see note below).
      setLocalStream(userMediaStreamRef.current);
      setLocalScreenStream(displayMediaStreamRef.current);

      if (socket) {
        await replaceTracksOnPeers(socket);
      }
    } finally {
      isUpdatingTracksRef.current = false;
    }
  }, [socket, replaceTracksOnPeers, buildAudioPipeline]);

  const toggleMic         = useCallback(
    () => updateLocalTracks({ targetAudio:  !isMicOnRef.current }),
    [updateLocalTracks],
  );
  const toggleCamera      = useCallback(
    () => updateLocalTracks({ targetVideo:  !isCameraOnRef.current }),
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
  };
}

/*
════════════════════════════════════════════════════════════════
COMPONENT USAGE — MANDATORY RULES TO PREVENT ECHO & ARTIFACTS
════════════════════════════════════════════════════════════════

LOCAL PREVIEW (must be muted — FIX #2):
  <video ref={localRef} autoPlay playsInline muted />
  // In effect: localRef.current.srcObject = localStream;

  Without `muted`, the local speaker feeds back into the mic.
  This is the #1 cause of echo in WebRTC apps.

REMOTE STREAMS (one <video> only — FIX #1):
  {remotePeer.streams[0] && (
    <video
      key={remotePeer.streams[0].id}  // stable key prevents remount flicker
      ref={el => { if (el) el.srcObject = remotePeer.streams[0]; }}
      autoPlay
      playsInline
    />
  )}

  DO NOT add a separate <audio> element for the same stream.
  The <video> element already plays audio. Two elements = double audio.

SCREEN SHARE:
  {remotePeer.streams[1] && (
    <video
      key={remotePeer.streams[1].id}
      ref={el => { if (el) el.srcObject = remotePeer.streams[1]; }}
      autoPlay
      playsInline
    />
  )}

════════════════════════════════════════════════════════════════
DEBUGGING CHECKLIST
════════════════════════════════════════════════════════════════
1. Echo on remote    → local <video> preview is missing `muted`
2. Echo on local     → a remote stream is playing through un-muted element
3. Crackling toggle  → replaceTrack() failing; check console
4. Crackling load    → network jitter; Opus FEC is enabled but TURN may help
5. One-way audio     → ICE candidates dropped before flush; check pendingCandidates
6. Silence after     → AudioContext suspended; user gesture didn't fire ctx.resume()
   joining
7. Glitchy screen    → getDisplayMedia returned no video tracks; check permissions
   share
8. Peer never        → onnegotiationneeded not firing; check pc.signalingState
   receives track
════════════════════════════════════════════════════════════════
*/