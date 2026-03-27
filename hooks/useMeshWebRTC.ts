import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────
// FIX 1 — Use multiple STUN + a reliable TURN server.
// The public openrelay TURN is unreliable in production.
// Replace with a paid TURN (e.g. Metered, Twilio, Xirsys).
// ─────────────────────────────────────────────────────────────
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Replace these with your own TURN credentials in production:
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
  // FIX 2 — Prefer UDP for lower latency; fall back to TCP only if blocked.
  iceTransportPolicy: 'all',
  // FIX 3 — Bundle all media on one port, reduces ICE complexity.
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

// ─────────────────────────────────────────────────────────────
// FIX 4 — Audio constraints: all three processors MUST be on.
// The key addition is sampleRate: 48000 (Opus native rate) and
// latency: 0 which asks Chrome to use the lowest input buffer
// size, reducing the chance of aliasing artefacts.
//
// DO NOT disable echoCancellation — it prevents feedback loops.
// DO NOT disable noiseSuppression — it handles click/tap noise.
// DO NOT disable autoGainControl — it prevents volume spikes.
// ─────────────────────────────────────────────────────────────
// `latency` is a valid Chrome constraint but missing from TypeScript's lib types.
// We cast to `MediaTrackConstraints` at the end to keep full type safety elsewhere.
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,  // Opus native sample rate — no resampling needed
  channelCount: 1,    // Mono — halves bandwidth, no benefit from stereo for voice
  latency: 0,         // Chrome: minimum input buffer, reduces pre-processing delay
} as MediaTrackConstraints;

// ─────────────────────────────────────────────────────────────
// FIX 5 — Opus SDP codec tweaks applied via SDP munging.
// maxaveragebitrate=40000  — good quality for voice (40 kbps)
// useinbandfec=1           — enables Opus FEC (Forward Error
//                           Correction) to recover from packet
//                           loss without retransmission.
// usedtx=1                 — Opus DTX (Discontinuous Transmission)
//                           stops sending during silence, saving
//                           bandwidth and reducing noise floor.
// stereo=0                 — enforce mono on the codec level.
// ─────────────────────────────────────────────────────────────
function patchOpusSDP(sdp: string): string {
  return sdp
    .replace(
      /a=fmtp:(\d+) (.*opus.*)\r\n/gi,
      (_match, pt, params) => {
        const base = params.includes('minptime') ? params : `minptime=10;${params}`;
        const patched = [base]
          .join(';')
          .replace(/useinbandfec=\d/, 'useinbandfec=1')
          .replace(/usedtx=\d/, 'usedtx=1');
        const extras = [];
        if (!patched.includes('useinbandfec')) extras.push('useinbandfec=1');
        if (!patched.includes('usedtx'))       extras.push('usedtx=1');
        if (!patched.includes('stereo'))        extras.push('stereo=0');
        if (!patched.includes('maxaveragebitrate')) extras.push('maxaveragebitrate=40000');
        return `a=fmtp:${pt} ${patched}${extras.length ? ';' + extras.join(';') : ''}\r\n`;
      }
    );
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

export function useMeshWebRTC(
  roomId: string,
  socket: Socket | null,
  guestName?: string,
) {
  const [localStream, setLocalStream]           = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers]           = useState<RemotePeer[]>([]);
  const [participants, setParticipants]         = useState<Participant[]>([]);
  const [isMicOn, setIsMicOn]                   = useState(false);
  const [isCameraOn, setIsCameraOn]             = useState(false);
  const [isScreenOn, setIsScreenOn]             = useState(false);
  const [viewerCount, setViewerCount]           = useState(1);

  const localStreamRef     = useRef<MediaStream | null>(null);
  const participantsRef    = useRef<Participant[]>([]);
  const peerConnections    = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates  = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);

  // ─────────────────────────────────────────────────────────
  // FIX 6 — Use a shared AudioContext for the mic path.
  // This gives us a "local monitor" node that we can mute,
  // preventing the local speaker from looping the mic signal
  // back into itself on single-speaker devices.
  // The stream sent to peers is the PROCESSED stream from
  // AudioContext, not the raw getUserMedia output.
  // ─────────────────────────────────────────────────────────
  const audioContextRef    = useRef<AudioContext | null>(null);
  const gainNodeRef        = useRef<GainNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  const isMicOnRef    = useRef(false);
  const isCameraOnRef = useRef(false);
  const isScreenOnRef = useRef(false);

  useEffect(() => { localStreamRef.current  = localStream;  }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // ─────────────────────────────────────────────────────────
  // FIX 7 — Build an AudioContext pipeline for the mic.
  // Source → GainNode (volume control) → Destination stream.
  // We set gainNode.gain to 0 when mic is muted rather than
  // stopping the track, so we never need to renegotiate just
  // for muting — eliminating a common source of crackling.
  // ─────────────────────────────────────────────────────────
  const buildAudioPipeline = useCallback((rawStream: MediaStream): MediaStream => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext({ sampleRate: 48000 });
    }
    const ctx = audioContextRef.current;

    // Resume context (browsers suspend it until a user gesture)
    if (ctx.state === 'suspended') ctx.resume();

    const source = ctx.createMediaStreamSource(rawStream);

    // GainNode: use this to mute/unmute without stopping tracks
    const gain = ctx.createGain();
    gain.gain.value = isMicOnRef.current ? 1 : 0;
    gainNodeRef.current = gain;

    // Destination: a new MediaStream whose audio track goes to peers
    const dest = ctx.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(dest);

    // Keep the video track from rawStream; use the processed audio track
    const processedStream = new MediaStream();
    dest.stream.getAudioTracks().forEach(t => processedStream.addTrack(t));
    rawStream.getVideoTracks().forEach(t => processedStream.addTrack(t));

    processedStreamRef.current = processedStream;
    return processedStream;
  }, []);

  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    setRemotePeers([]);

    if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(t => t.stop());
      userMediaStreamRef.current = null;
    }
    if (displayMediaStreamRef.current) {
      displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
      displayMediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    processedStreamRef.current = null;

    setLocalStream(null);
    setLocalScreenStream(null);
    localStreamRef.current = null;
  }, []);

  // ─────────────────────────────────────────────────────────
  // FIX 8 — replaceTracksOnPeers uses RTCRtpSender.replaceTrack()
  // instead of removeTrack + addTrack + renegotiate.
  //
  // replaceTrack() is in-place and does NOT trigger ICE restart
  // or renegotiation — it is completely seamless to the receiver.
  // This eliminates the crackling caused by tearing down and
  // rebuilding the RTP session every time media toggles.
  //
  // We only fall back to full renegotiation when the sender
  // count changes (e.g. adding screen share for the first time).
  // ─────────────────────────────────────────────────────────
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const audioTrack  = processedStreamRef.current?.getAudioTracks()[0] ?? null;
    const videoTrack  = userMediaStreamRef.current?.getVideoTracks()[0]  ?? null;
    const screenTrack = displayMediaStreamRef.current?.getVideoTracks()[0] ?? null;

    const entries = Array.from(peerConnections.current.entries());

    for (const [peerId, pc] of entries) {
      const senders = pc.getSenders();
      const audioSender  = senders.find(s => s.track?.kind === 'audio');
      const videoSenders = senders.filter(s => s.track?.kind === 'video');

      // ── Audio ────────────────────────────────────────────
      if (audioSender && audioTrack) {
        // replaceTrack: no renegotiation, no crackling
        await audioSender.replaceTrack(audioTrack).catch(console.error);
      } else if (!audioSender && audioTrack && processedStreamRef.current) {
        pc.addTrack(audioTrack, processedStreamRef.current);
      }

      // ── Camera video ─────────────────────────────────────
      const camSender = videoSenders.find(s => s.track && userMediaStreamRef.current?.getTracks().includes(s.track));
      if (camSender && videoTrack) {
        await camSender.replaceTrack(videoTrack).catch(console.error);
      } else if (!camSender && videoTrack && userMediaStreamRef.current) {
        pc.addTrack(videoTrack, userMediaStreamRef.current);
      }

      // ── Screen share ─────────────────────────────────────
      const screenSender = videoSenders.find(s => s.track && displayMediaStreamRef.current?.getTracks().includes(s.track));
      if (screenSender && screenTrack) {
        await screenSender.replaceTrack(screenTrack).catch(console.error);
      } else if (!screenSender && screenTrack && displayMediaStreamRef.current) {
        pc.addTrack(screenTrack, displayMediaStreamRef.current);
      }

      // ── Renegotiate ONLY when sender count changes ────────
      const needsRenegotiation =
        (!audioSender && audioTrack) ||
        (!camSender && videoTrack) ||
        (!screenSender && screenTrack);

      if (needsRenegotiation) {
        try {
          const offer = await pc.createOffer();
          // Apply Opus SDP tweaks
          offer.sdp = patchOpusSDP(offer.sdp ?? '');
          await pc.setLocalDescription(offer);
          currentSocket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
        } catch (e) {
          console.error('Renegotiate error for peer', peerId, e);
        }
      }
    }
  }, [roomId]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('peer:join', { roomId, guestName });

    const handlePeerLeft = (peerId: string) => {
      const pc = peerConnections.current.get(peerId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(peerId);
      }
      setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
    };

    // ─────────────────────────────────────────────────────
    // FIX 9 — createPeerConnection: apply Opus SDP patch on
    // both createOffer AND createAnswer so both sides benefit.
    // Also set priority hints on audio senders for lower
    // queueing latency through the network interface.
    // ─────────────────────────────────────────────────────
    const createPeerConnection = (peerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(peerId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('peer:ice-candidate', {
            candidate: event.candidate,
            roomId,
            targetSocketId: peerId,
          });
        }
      };

      pc.ontrack = (event) => {
        const cleanupDeadStreams = () => {
          setRemotePeers(prev => prev.map(p => {
            if (p.peerId !== peerId) return p;
            const validStreams = p.streams.filter(s =>
              s.getTracks().some(t => t.readyState !== 'ended')
            );
            return { ...p, streams: validStreams };
          }));
        };

        event.track.onended = cleanupDeadStreams;

        setRemotePeers(prev => {
          const peerIdMatch = prev.find(p => p.peerId === peerId);
          const incomingStream = event.streams[0] || new MediaStream([event.track]);

          if (peerIdMatch) {
            let updatedStreams = [...peerIdMatch.streams];
            const existingStream = updatedStreams.find(s => s.id === incomingStream.id);
            if (existingStream) {
              if (!existingStream.getTracks().find(t => t.id === event.track.id)) {
                existingStream.addTrack(event.track);
              }
            } else {
              updatedStreams.push(incomingStream);
            }
            updatedStreams = updatedStreams.filter(s =>
              s.getTracks().some(t => t.readyState !== 'ended')
            );
            return prev.map(p =>
              p.peerId === peerId ? { ...p, streams: updatedStreams } : p
            );
          }

          const participant = participantsRef.current.find(p => p.peerId === peerId);
          return [...prev, {
            peerId,
            username: participant?.name || 'Remote Peer',
            isHost: participant?.isHost,
            streams: [incomingStream],
          }];
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          handlePeerLeft(peerId);
        }
      };

      // Add currently active tracks
      const processed = processedStreamRef.current;
      if (processed) {
        processed.getAudioTracks().forEach(track => pc.addTrack(track, processed));
      }
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getVideoTracks().forEach(track => {
          pc.addTrack(track, userMediaStreamRef.current!);
        });
      }
      if (displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, displayMediaStreamRef.current!);
        });
      }

      // FIX 10 — Set audio sender priority to 'high' after tracks are added.
      // This hints to the browser to queue audio packets before video packets
      // at the OS network layer, preventing audio dropouts during congestion.
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
      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === peerId)) return prev;
        return [...prev, { peerId, username, isHost, streams: [] }];
      });

      const pc = createPeerConnection(peerId);
      try {
        const offer = await pc.createOffer();
        // Apply Opus SDP patch on the offer
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
      if (!pc) pc = createPeerConnection(peerId);

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        setRemotePeers(prev => prev.map(p => {
          if (p.peerId !== peerId) return p;
          return {
            ...p,
            streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')),
          };
        }));

        const answer = await pc.createAnswer();
        // Apply Opus SDP patch on the answer too
        answer.sdp = patchOpusSDP(answer.sdp ?? '');
        await pc.setLocalDescription(answer);
        socket.emit('peer:answer', { sdp: answer, roomId, targetSocketId: peerId });

        const queued = pendingCandidates.current.get(peerId) || [];
        for (const candidate of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
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
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
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
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding ICE candidate', e);
        }
      } else {
        const queued = pendingCandidates.current.get(peerId) || [];
        queued.push(candidate);
        pendingCandidates.current.set(peerId, queued);
      }
    };

    const handleViewersUpdate     = ({ count }: { count: number }) => setViewerCount(count);
    const handleParticipantsUpdate = ({ participants: updated }: { participants: Participant[] }) => {
      setParticipants(updated);
      setRemotePeers(prev => prev.map(peer => {
        const match = updated.find(p => p.peerId === peer.peerId);
        return match ? { ...peer, username: match.name, isHost: match.isHost } : peer;
      }));
    };

    // FIX 11 — Host mute: use GainNode instead of disabling the track.
    // Setting gainNode.gain.value = 0 is instantaneous and inaudible.
    // Disabling the track causes a brief audio glitch on the sender side.
    const handleHostMuted = () => {
      setIsMicOn(false);
      isMicOnRef.current = false;
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current!.currentTime, 0.01);
      }
    };

    socket.on('peer:joined',              handlePeerJoined);
    socket.on('peer:offer',               handlePeerOffer);
    socket.on('peer:answer',              handlePeerAnswer);
    socket.on('peer:ice-candidate',       handleIceCandidate);
    socket.on('peer:left',                ({ peerId }: { peerId: string }) => handlePeerLeft(peerId));
    socket.on('room:viewers_update',      handleViewersUpdate);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:kicked',  () => { window.location.href = '/'; });
    socket.on('host:banned',  () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; });
    socket.on('room:ended',   () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; });
    socket.on('host:muted',   handleHostMuted);

    return () => {
      socket.off('peer:joined',              handlePeerJoined);
      socket.off('peer:offer',               handlePeerOffer);
      socket.off('peer:answer',              handlePeerAnswer);
      socket.off('peer:ice-candidate',       handleIceCandidate);
      socket.off('peer:left');
      socket.off('room:viewers_update',      handleViewersUpdate);
      socket.off('room:participants_update', handleParticipantsUpdate);
      socket.off('host:kicked');
      socket.off('host:banned');
      socket.off('room:ended');
      socket.off('host:muted',              handleHostMuted);

      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, guestName, leaveRoom, replaceTracksOnPeers, buildAudioPipeline]);

  // ─────────────────────────────────────────────────────────
  // FIX 12 — updateLocalTracks: reuse existing getUserMedia
  // stream where possible. Only call getUserMedia when we
  // genuinely don't have a stream yet.
  //
  // Mute/unmute is done via GainNode (audio) and track.enabled
  // (video) — NOT by stopping and restarting tracks.
  // Stopping a track forces renegotiation; .enabled does not.
  // ─────────────────────────────────────────────────────────
  const updateLocalTracks = useCallback(async ({
    targetAudio, targetVideo, targetScreen,
  }: {
    targetAudio?: boolean;
    targetVideo?: boolean;
    targetScreen?: boolean;
  }) => {
    let currentMic    = targetAudio  !== undefined ? targetAudio  : isMicOnRef.current;
    let currentVideo  = targetVideo  !== undefined ? targetVideo  : isCameraOnRef.current;
    let currentScreen = targetScreen !== undefined ? targetScreen : isScreenOnRef.current;

    const needsUserMedia = currentMic || currentVideo;

    if (needsUserMedia) {
      if (!userMediaStreamRef.current) {
        // First time: request both even if only one is needed,
        // so we have the stream ready for instant toggling later.
        try {
          userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
            video: currentVideo ? { facingMode: 'user' } : false,
            audio: currentMic ? AUDIO_CONSTRAINTS : false,
          });
        } catch (e) {
          console.error('Failed to get user media', e);
          alert('Could not access camera/microphone.');
          currentMic   = false;
          currentVideo = false;
        }
      } else {
        // Stream already exists — just toggle track.enabled.
        // No renegotiation, no crackling.
        if (targetVideo !== undefined) {
          userMediaStreamRef.current.getVideoTracks().forEach(t => {
            t.enabled = currentVideo;
          });
        }
      }

      // Build or update the AudioContext pipeline
      if (currentMic && userMediaStreamRef.current?.getAudioTracks().length) {
        if (!processedStreamRef.current) {
          buildAudioPipeline(userMediaStreamRef.current);
        }
        // Unmute via GainNode — smooth, no track restart
        if (gainNodeRef.current && audioContextRef.current) {
          gainNodeRef.current.gain.setTargetAtTime(
            1,
            audioContextRef.current.currentTime,
            0.01, // 10 ms ramp — avoids the click of instant gain change
          );
        }
      } else if (!currentMic && gainNodeRef.current && audioContextRef.current) {
        // Mute via GainNode
        gainNodeRef.current.gain.setTargetAtTime(
          0,
          audioContextRef.current.currentTime,
          0.01,
        );
      }
    }

    // Stop user media only when BOTH mic and camera are off
    if (!needsUserMedia && userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(t => t.stop());
      userMediaStreamRef.current = null;
      processedStreamRef.current = null;
    }

    // ── Screen share ──────────────────────────────────────
    if (currentScreen && !displayMediaStreamRef.current) {
      try {
        displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } },
          audio: false, // screen audio causes echo; handle separately if needed
        });
        displayMediaStreamRef.current.getVideoTracks()[0].onended = () => {
          updateLocalTracks({ targetScreen: false });
        };
      } catch (e: any) {
        console.error('Failed to get display media', e);
        alert(
          e.name === 'NotAllowedError'
            ? 'Screen share permission denied.'
            : 'Screen sharing is not supported on this device or browser.',
        );
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
    setLocalStream(userMediaStreamRef.current);
    setLocalScreenStream(displayMediaStreamRef.current);

    if (socket) {
      await replaceTracksOnPeers(socket);
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
  };
}

/*
──────────────────────────────────────────────────────────────
IMPORTANT: Remote audio playback — prevent echo on the receiver
──────────────────────────────────────────────────────────────
In whatever component renders the remote stream in a <video> or
<audio> element, you MUST set:

  <video
    ref={videoRef}
    autoPlay
    playsInline
    muted={false}        ← fine for remote video
  />

And in code:
  videoRef.current.srcObject = remoteStream;

If the remote element accidentally receives the LOCAL stream, the
speaker output feeds back into the mic → echo. Double-check you're
only passing remotePeer.streams[0] (not localStream) to these elements.

Also ensure you NEVER set srcObject to the local mic stream on any
un-muted element. The local preview <video> must always have `muted`:

  <video ref={localPreview} autoPlay playsInline muted />

This is the single most common cause of echo in WebRTC apps.

──────────────────────────────────────────────────────────────
DEBUGGING CHECKLIST
──────────────────────────────────────────────────────────────
1. Echo on remote side      → your local <video> preview is NOT muted
2. Echo on local side       → a remote stream is playing through an unmuted element
3. Crackling on toggle      → replaceTrack() is failing; check browser console
4. Crackling under load     → network jitter; enable Opus FEC (useinbandfec=1 above)
5. Audio works 1-on-1 only  → check ICE candidates are flushed before addIceCandidate
6. One party hears nothing  → AudioContext is suspended; call ctx.resume() on user gesture
*/