import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { RetroAudioFilter } from '@/utils/audioEffects';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,   // keep — works at capture level before AudioContext
  noiseSuppression: true,   // keep
  autoGainControl: false,   // DISABLE — this fights your compressor node, causing pumping
  sampleRate: 48000,
  channelCount: 1,
};

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

export function useMeshWebRTC(roomId: string, socket: Socket | null, guestName?: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenOn, setIsScreenOn] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);

  const audioFilterRef = useRef<RetroAudioFilter | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);

  // FIX 1: Track media state in refs to avoid stale closures inside callbacks
  const isMicOnRef = useRef(false);
  const isCameraOnRef = useRef(false);
  const isScreenOnRef = useRef(false);

  // Sync state refs
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // FIX 2: leaveRoom is stable — no deps that change. Uses refs only.
  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    setRemotePeers([]);

    if (audioFilterRef.current) {
      audioFilterRef.current.destroy();
      audioFilterRef.current = null;
    }
    if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(t => t.stop());
      userMediaStreamRef.current = null;
    }
    if (displayMediaStreamRef.current) {
      displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
      displayMediaStreamRef.current = null;
    }

    setLocalStream(null);
    setLocalScreenStream(null);
    localStreamRef.current = null;
  }, []); // No socket dep — caller emits separately to avoid double emit on cleanup

  // FIX 3: replaceTracksOnPeers reads socket from arg/ref, not closure
  const replaceTracksOnPeers = useCallback(async (currentSocket: Socket) => {
    const entries = Array.from(peerConnections.current.entries());
    for (const [peerId, pc] of entries) {
      // Remove all existing senders
      pc.getSenders().forEach(sender => pc.removeTrack(sender));

      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, userMediaStreamRef.current!);
        });
      }
      if (displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, displayMediaStreamRef.current!);
        });
      }

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        currentSocket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) {
        console.error('Renegotiate error for peer', peerId, e);
      }
    }
  }, [roomId]);

  // Initialize socket event listeners
  useEffect(() => {
    if (!socket) return;

    // FIX 4: Only one peer:join emit, with guestName included from the start
    socket.emit('peer:join', { roomId, guestName });

    // FIX 5: handlePeerLeft defined at effect scope so onconnectionstatechange can reference it
    const handlePeerLeft = (peerId: string) => {
      const pc = peerConnections.current.get(peerId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(peerId);
      }
      setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
    };

    const createPeerConnection = (peerId: string) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(peerId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('peer:ice-candidate', {
            candidate: event.candidate,
            roomId,
            targetSocketId: peerId
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
            return prev.map(p => p.peerId === peerId ? { ...p, streams: updatedStreams } : p);
          }

          const participant = participantsRef.current.find(p => p.peerId === peerId);
          return [...prev, {
            peerId,
            username: participant?.name || 'Remote Peer',
            isHost: participant?.isHost,
            streams: [incomingStream]
          }];
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          handlePeerLeft(peerId); // FIX 5: now safely in scope
        }
      };

      // Add existing local tracks
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, userMediaStreamRef.current!);
        });
      }
      if (displayMediaStreamRef.current) {
        displayMediaStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, displayMediaStreamRef.current!);
        });
      }

      return pc;
    };

    const handlePeerJoined = async ({ peerId, username, isHost }: {
      peerId: string; username?: string; isHost?: boolean;
    }) => {
      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === peerId)) return prev;
        return [...prev, { peerId, username, isHost, streams: [] }];
      });

      const pc = createPeerConnection(peerId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) {
        console.error('Error creating offer', e);
      }
    };

    const handlePeerOffer = async ({ sdp, peerId }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      let pc = peerConnections.current.get(peerId);
      if (!pc) {
        pc = createPeerConnection(peerId);
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        setRemotePeers(prev => prev.map(p => {
          if (p.peerId !== peerId) return p;
          return { ...p, streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')) };
        }));

        const answer = await pc.createAnswer();
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

    const handlePeerAnswer = async ({ sdp, peerId }: { sdp: RTCSessionDescriptionInit; peerId: string }) => {
      const pc = peerConnections.current.get(peerId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        setRemotePeers(prev => prev.map(p => {
          if (p.peerId !== peerId) return p;
          return { ...p, streams: p.streams.filter(s => s.getTracks().some(t => t.readyState !== 'ended')) };
        }));
      } catch (e) {
        console.error('Error handling answer', e);
      }
    };

    const handleIceCandidate = async ({ candidate, peerId }: { candidate: RTCIceCandidateInit; peerId: string }) => {
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

    const handleViewersUpdate = ({ count }: { count: number }) => setViewerCount(count);

    const handleParticipantsUpdate = ({ participants: updated }: { participants: Participant[] }) => {
      setParticipants(updated);
      setRemotePeers(prev => prev.map(peer => {
        const match = updated.find(p => p.peerId === peer.peerId);
        return match ? { ...peer, username: match.name, isHost: match.isHost } : peer;
      }));
    };

    const handleHostMuted = () => {
      setIsMicOn(false);
      isMicOnRef.current = false;
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
      }
    };

    socket.on('peer:joined', handlePeerJoined);
    socket.on('peer:offer', handlePeerOffer);
    socket.on('peer:answer', handlePeerAnswer);
    socket.on('peer:ice-candidate', handleIceCandidate);
    socket.on('peer:left', ({ peerId }: { peerId: string }) => handlePeerLeft(peerId));
    socket.on('room:viewers_update', handleViewersUpdate);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:kicked', () => { window.location.href = '/'; });
    socket.on('host:banned', () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; });
    socket.on('room:ended', () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; });
    socket.on('host:muted', handleHostMuted);

    return () => {
      socket.off('peer:joined', handlePeerJoined);
      socket.off('peer:offer', handlePeerOffer);
      socket.off('peer:answer', handlePeerAnswer);
      socket.off('peer:ice-candidate', handleIceCandidate);
      socket.off('peer:left');
      socket.off('room:viewers_update', handleViewersUpdate);
      socket.off('room:participants_update', handleParticipantsUpdate);
      socket.off('host:kicked');
      socket.off('host:banned');
      socket.off('room:ended');
      socket.off('host:muted', handleHostMuted);

      // FIX 6: Emit leave here (once), not inside leaveRoom, to keep leaveRoom dep-free
      socket.emit('peer:leave', { roomId });
      leaveRoom();
    };
  }, [socket, roomId, guestName, leaveRoom, replaceTracksOnPeers]);
  // FIX 4: Removed the separate guestName effect — it's now handled in the main effect above

  // FIX 7: updateLocalTracks reads state from refs to avoid stale closures
  const updateLocalTracks = useCallback(async ({
    targetAudio, targetVideo, targetScreen
  }: {
    targetAudio?: boolean; targetVideo?: boolean; targetScreen?: boolean;
  }) => {
    let currentMic    = targetAudio  !== undefined ? targetAudio  : isMicOnRef.current;
    let currentVideo  = targetVideo  !== undefined ? targetVideo  : isCameraOnRef.current;
    let currentScreen = targetScreen !== undefined ? targetScreen : isScreenOnRef.current;

    const needsUserMedia = currentMic || currentVideo;

    if (needsUserMedia && !userMediaStreamRef.current) {
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: AUDIO_CONSTRAINTS,
        });

        // FIX 8: Apply audio filter to a COPY of the stream, keep original ref intact
        if (!audioFilterRef.current) {
          audioFilterRef.current = new RetroAudioFilter();
        }
        userMediaStreamRef.current = audioFilterRef.current.applyToStream(rawStream);
        userMediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = currentMic; });
        userMediaStreamRef.current.getVideoTracks().forEach(t => { t.enabled = currentVideo; });
      } catch (e) {
        console.warn('Failed to get both media, trying separate fallback', e);
        try {
          userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
            video: currentVideo ? { facingMode: 'user' } : false,
            audio: currentMic ? AUDIO_CONSTRAINTS : false,
          });
        } catch (fallbackE) {
          console.error('Fallback failed', fallbackE);
          alert('Could not access requested camera/microphone.');
          currentMic = false;
          currentVideo = false;
        }
      }
    } else if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = currentMic; });
      userMediaStreamRef.current.getVideoTracks().forEach(t => { t.enabled = currentVideo; });
    }

    if (!currentMic && !currentVideo && userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(t => t.stop());
      userMediaStreamRef.current = null;

      // Also destroy audio filter when releasing media
      if (audioFilterRef.current) {
        audioFilterRef.current.destroy();
        audioFilterRef.current = null;
      }
    }

    if (currentScreen && !displayMediaStreamRef.current) {
      try {
        displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } },
          audio: false
        });
        displayMediaStreamRef.current.getVideoTracks()[0].onended = () => {
          updateLocalTracks({ targetScreen: false });
        };
      } catch (e: any) {
        console.error('Failed to get display media', e);
        alert(e.name === 'NotAllowedError'
          ? 'Screen share permission denied.'
          : 'Screen sharing is not supported on this device or browser.'
        );
        currentScreen = false;
      }
    } else if (!currentScreen && displayMediaStreamRef.current) {
      displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
      displayMediaStreamRef.current = null;
    }

    // Update refs first, then state
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
  }, [socket, replaceTracksOnPeers]);

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
    leaveRoom
  };
}