import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';

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

// Audio constraints optimized for speech clarity — no cracking/cutting
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1, // mono is better for voice, reduces bandwidth and artifacts
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

  const localStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const userMediaStreamRef = useRef<MediaStream | null>(null);
  const displayMediaStreamRef = useRef<MediaStream | null>(null);

  // Sync refs safely
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // Cleanly close everything
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
    
    setLocalStream(null);
    setLocalScreenStream(null);
    localStreamRef.current = null;

    if (socket) {
      socket.emit('peer:leave', { roomId });
    }
  }, [socket, roomId]);

  // Initialize Socket Event Listeners
  useEffect(() => {
    if (!socket) return;
    
    // Announce presence
    socket.emit('peer:join', { roomId });

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

      // Receive remote stream tracks — each track may come from a different stream (cam vs screen)
      pc.ontrack = (event) => {
        setRemotePeers(prev => {
          const peerIdMatch = prev.find(p => p.peerId === peerId);
          const incomingStream = event.streams[0] || new MediaStream([event.track]);
          
          if (peerIdMatch) {
            const existingStream = peerIdMatch.streams.find(s => s.id === incomingStream.id);
            if (existingStream) {
              const trackExists = existingStream.getTracks().find(t => t.id === event.track.id);
              if (!trackExists) {
                existingStream.addTrack(event.track);
              }
            } else {
              peerIdMatch.streams = [...peerIdMatch.streams, incomingStream];
            }
            return [...prev];
          }
          
          // Use Ref to avoid staleness without re-triggering effect
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
          handlePeerLeft(peerId);
        }
      };

      // Add our existing local tracks when creating a connection to a new peer
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

    const handlePeerLeft = (peerId: string) => {
      const pc = peerConnections.current.get(peerId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(peerId);
      }
      setRemotePeers(prev => prev.filter(p => p.peerId !== peerId));
    };

    const handlePeerJoined = async ({ peerId, username, isHost }: { peerId: string, username?: string, isHost?: boolean }) => {
      // Create PC and update peer info immediately to show name even before tracks arrive
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

    const handlePeerOffer = async ({ sdp, peerId }: { sdp: any, peerId: string }) => {
      let pc = peerConnections.current.get(peerId);
      if (!pc) {
        pc = createPeerConnection(peerId);
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('peer:answer', { sdp: answer, roomId, targetSocketId: peerId });

        // Process any queued ICE candidates
        const queued = pendingCandidates.current.get(peerId) || [];
        for (const candidate of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidates.current.delete(peerId);
      } catch (e) {
        console.error('Error handling offer', e);
      }
    };

    const handlePeerAnswer = async ({ sdp, peerId }: { sdp: any, peerId: string }) => {
      const pc = peerConnections.current.get(peerId);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (e) {
          console.error('Error handling answer', e);
        }
      }
    };

    const handleIceCandidate = async ({ candidate, peerId }: { candidate: any, peerId: string }) => {
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

    const handleViewersUpdate = ({ count }: { count: number }) => {
      setViewerCount(count);
    };

    const handleParticipantsUpdate = ({ participants }: { participants: Participant[] }) => {
      setParticipants(participants);
      // Update remotePeers usernames if they joined before the participants list sync
      setRemotePeers(prev => prev.map(peer => {
        const match = participants.find(p => p.peerId === peer.peerId);
        if (match) {
          return { ...peer, username: match.name, isHost: match.isHost };
        }
        return peer;
      }));
    };

    socket.on('peer:joined', handlePeerJoined);
    socket.on('peer:offer', handlePeerOffer);
    socket.on('peer:answer', handlePeerAnswer);
    socket.on('peer:ice-candidate', handleIceCandidate);
    socket.on('peer:left', (data) => handlePeerLeft(data.peerId));
    socket.on('room:viewers_update', handleViewersUpdate);
    socket.on('room:participants_update', handleParticipantsUpdate);
    socket.on('host:kicked', () => window.location.href = '/');
    socket.on('host:banned', () => { alert('YOU HAVE BEEN BANNED'); window.location.href = '/'; });
    socket.on('room:ended', () => { alert('THE MEETING HAS ENDED'); window.location.href = '/'; });
    
    socket.on('host:muted', () => {
      setIsMicOn(false);
      if (userMediaStreamRef.current) {
        userMediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
      }
    });

    return () => {
      socket.off('peer:joined', handlePeerJoined);
      socket.off('peer:offer', handlePeerOffer);
      socket.off('peer:answer', handlePeerAnswer);
      socket.off('peer:ice-candidate', handleIceCandidate);
      socket.off('peer:left');
      socket.off('room:viewers_update');
      socket.off('room:participants_update');
      socket.off('host:kicked');
      socket.off('host:banned');
      socket.off('room:ended');
      socket.off('host:muted');
      leaveRoom();
    };
  }, [socket, roomId, leaveRoom]);

  // Announce presence with guestName
  useEffect(() => {
    if (socket && roomId) {
      socket.emit('peer:join', { roomId, guestName });
    }
  }, [socket, roomId, guestName]);

  // Renegotiate all peer connections when streams change
  const replaceTracksOnPeers = async () => {
    peerConnections.current.forEach(async (pc, peerId) => {
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
        socket?.emit('peer:offer', { sdp: offer, roomId, targetSocketId: peerId });
      } catch (e) {
        console.error('Renegotiate error', e);
      }
    });
  };

  // Handle stream updates — camera/mic/screen toggles
  const updateLocalTracks = async ({ targetAudio, targetVideo, targetScreen }: {
    targetAudio?: boolean, targetVideo?: boolean, targetScreen?: boolean
  }) => {
    let currentMic = targetAudio !== undefined ? targetAudio : isMicOn;
    let currentVideo = targetVideo !== undefined ? targetVideo : isCameraOn;
    let currentScreen = targetScreen !== undefined ? targetScreen : isScreenOn;

    // 1. Manage UserMedia (Mic/Camera)
    const needsUserMedia = currentMic || currentVideo;

    if (needsUserMedia && !userMediaStreamRef.current) {
      try {
        // Request both audio and video — we enable/disable tracks after acquisition
        userMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user' },
          audio: AUDIO_CONSTRAINTS,
        });
        userMediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = currentMic; });
        userMediaStreamRef.current.getVideoTracks().forEach(t => { t.enabled = currentVideo; });
      } catch (e) {
        console.error('Failed to get user media', e);
        currentMic = false;
        currentVideo = false;
      }
    } else if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = currentMic; });
      userMediaStreamRef.current.getVideoTracks().forEach(t => { t.enabled = currentVideo; });
    }

    // Stop and release userMedia entirely when both cam and mic are off
    if (!needsUserMedia && !currentMic && !currentVideo && userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach(t => t.stop());
      userMediaStreamRef.current = null;
    }
    
    // 2. Manage DisplayMedia (Screen Share)
    if (currentScreen && !displayMediaStreamRef.current) {
      try {
        displayMediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({ 
          video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } },
          audio: false 
        });
        displayMediaStreamRef.current.getVideoTracks()[0].onended = () => {
          updateLocalTracks({ targetScreen: false });
        };
      } catch(e) {
        console.error('Failed to get display media', e);
        currentScreen = false;
      }
    } else if (!currentScreen && displayMediaStreamRef.current) {
      displayMediaStreamRef.current.getTracks().forEach(t => t.stop());
      displayMediaStreamRef.current = null;
    }

    // Update state
    setIsMicOn(currentMic);
    setIsCameraOn(currentVideo);
    setIsScreenOn(currentScreen);
    setLocalStream(userMediaStreamRef.current);
    setLocalScreenStream(displayMediaStreamRef.current);

    // Renegotiate with existing peers
    replaceTracksOnPeers();
  };

  const toggleMic = () => updateLocalTracks({ targetAudio: !isMicOn });
  const toggleCamera = () => updateLocalTracks({ targetVideo: !isCameraOn });
  const toggleScreenShare = () => updateLocalTracks({ targetScreen: !isScreenOn });

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
