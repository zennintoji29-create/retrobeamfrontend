'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import VideoMonitor from '@/components/VideoMonitor';
import { useSocket } from '@/hooks/useSocket';
import { useMeshWebRTC } from '@/hooks/useMeshWebRTC';
import { useAuth } from '@/hooks/useAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let videoId = '';
    if (parsed.hostname === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('?')[0];
    } else if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch')            videoId = parsed.searchParams.get('v') || '';
      else if (parsed.pathname.startsWith('/embed/'))  return url;
      else if (parsed.pathname.startsWith('/shorts/')) videoId = parsed.pathname.replace('/shorts/', '').split('?')[0];
    }
    if (videoId) return `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1`;
  } catch { /* ignored */ }
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast — lightweight in-app notification (no external deps)
// ─────────────────────────────────────────────────────────────────────────────
interface Toast { id: number; message: string; type: 'info' | 'warn' | 'error' }

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-[90vw] sm:max-w-xs">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 border-[2px] border-[#1B0C0C] px-3 py-2 shadow-[4px_4px_0_#1B0C0C] font-heading text-sm font-bold uppercase tracking-wide
            ${t.type === 'error' ? 'bg-red-600 text-white'
            : t.type === 'warn'  ? 'bg-[#FFDE42] text-[#1B0C0C]'
            :                      'bg-[#313E17] text-[#FFDE42]'}`}
          onClick={() => dismiss(t.id)}
        >
          <span className="flex-1 leading-snug">{t.message}</span>
          <span className="shrink-0 opacity-60 cursor-pointer">✕</span>
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, type: Toast['type'] = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);
  const dismiss = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, push, dismiss };
}

// ─────────────────────────────────────────────────────────────────────────────
// Speaking detection — lightweight VAD via AnalyserNode
// Returns a Set of MediaStream IDs that are currently speaking
// ─────────────────────────────────────────────────────────────────────────────
function useSpeakingDetection(streams: { id: string; stream: MediaStream | null }[]) {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const analysersRef = useRef<Map<string, { ctx: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; raf: number }>>(new Map());

  useEffect(() => {
    const threshold = 15; // RMS threshold — increase to reduce sensitivity

    streams.forEach(({ id, stream }) => {
      if (!stream || analysersRef.current.has(id)) return;
      if (!stream.getAudioTracks().length) return;

      try {
        const ctx      = new AudioContext();
        const source   = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const data  = new Uint8Array(analyser.frequencyBinCount);
        let   raf   = 0;

        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let rms = 0;
          for (let i = 0; i < data.length; i++) rms += (data[i] - 128) ** 2;
          rms = Math.sqrt(rms / data.length);
          setSpeaking(prev => {
            const next = new Set(prev);
            rms > threshold ? next.add(id) : next.delete(id);
            return next;
          });
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        analysersRef.current.set(id, { ctx, source, analyser, raf });
      } catch { /* AudioContext may fail on some platforms */ }
    });

    // Clean up stale entries
    const activeIds = new Set(streams.map(s => s.id));
    analysersRef.current.forEach((entry, id) => {
      if (!activeIds.has(id)) {
        cancelAnimationFrame(entry.raf);
        entry.ctx.close().catch(() => {});
        analysersRef.current.delete(id);
        setSpeaking(prev => { const n = new Set(prev); n.delete(id); return n; });
      }
    });
  }, [streams]);

  // Cleanup on unmount
  useEffect(() => () => {
    analysersRef.current.forEach(entry => {
      cancelAnimationFrame(entry.raf);
      entry.ctx.close().catch(() => {});
    });
    analysersRef.current.clear();
  }, []);

  return speaking;
}

// ─────────────────────────────────────────────────────────────────────────────
// SidePanel
// ─────────────────────────────────────────────────────────────────────────────
interface SidePanelProps {
  room: any; participants: any[]; isHost: boolean; remotePeers: any[];
  isConnected: boolean; videoUrlInput: string;
  setVideoUrlInput: (v: string) => void; syncedVideo: any;
  handleSyncVideo: () => void; handleStopVideo: () => void;
  sendReaction: (e: string) => void; handleMute: (id: string) => void;
  handleKick: (id: string) => void; handleBan: (id: string) => void;
  raisedHands: Set<string>; socket: any; onCopyRoomId: () => void;
}

const SidePanel = ({
  room, participants, isHost, remotePeers, isConnected,
  videoUrlInput, setVideoUrlInput, syncedVideo, handleSyncVideo,
  handleStopVideo, sendReaction, handleMute, handleKick, handleBan,
  raisedHands, socket, onCopyRoomId,
}: SidePanelProps) => (
  <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto custom-scrollbar">

    {/* ── Data Feed ── */}
    <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
      <div className="bg-[#313E17] px-3 py-2 border-b-[3px] border-[#4C5C2D]">
        <h3 className="font-heading text-base font-black text-[#FFDE42] uppercase tracking-widest">Data Feed</h3>
      </div>
      <div className="p-2 flex flex-col gap-1.5">
        {/* Room ID with copy button */}
        <div className="flex justify-between items-center border-[2px] border-[#313E17] bg-[#1B0C0C] px-3 py-1.5">
          <span className="text-[#4C5C2D] font-heading text-[10px] font-bold tracking-widest uppercase shrink-0">Room ID</span>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#FFDE42] font-mono font-bold text-xs select-all truncate">{room.roomId}</span>
            <button
              onClick={onCopyRoomId}
              title="Copy Room ID"
              className="shrink-0 text-[#4C5C2D] hover:text-[#FFDE42] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex justify-between items-center border-[2px] border-[#313E17] bg-[#1B0C0C] px-3 py-1.5">
          <span className="text-[#4C5C2D] font-heading text-[10px] font-bold tracking-widest uppercase">Nodes</span>
          <span className="text-[#1B0C0C] bg-[#FFDE42] font-black text-sm font-heading px-2 py-0.5">{remotePeers.length + 1}</span>
        </div>
        <div className="flex justify-between items-center border-[2px] border-[#313E17] bg-[#1B0C0C] px-3 py-1.5">
          <span className="text-[#4C5C2D] font-heading text-[10px] font-bold tracking-widest uppercase">Signal</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
            <span className={`font-heading text-xs font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
              {isConnected ? 'LIVE' : 'LOST'}
            </span>
          </div>
        </div>
      </div>
    </div>

    {/* ── Participants ── */}
    <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
      <div className="bg-[#313E17] px-3 py-2 border-b-[3px] border-[#4C5C2D] flex justify-between items-center">
        <h3 className="font-heading text-base font-black text-[#FFDE42] uppercase tracking-widest">Network Nodes</h3>
        <span className="text-[10px] bg-[#FFDE42] text-[#1B0C0C] px-1.5 py-0.5 font-black">{participants.length}</span>
      </div>
      <div className="p-2 flex flex-col gap-1.5 max-h-[220px] overflow-y-auto custom-scrollbar">
        {participants.length === 0 ? (
          <p className="text-[10px] text-[#4C5C2D] font-mono p-2 animate-pulse">SCANNING FOR NODES...</p>
        ) : participants.map((p: any) => (
          <div key={p.peerId}
            className="flex flex-col border border-[#313E17] p-2 bg-[#1B0C0C]/50 hover:bg-[#313E17]/30 transition-colors rounded-sm">
            <div className="flex justify-between items-center gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.isHost ? 'bg-cyan-400' : 'bg-[#FFDE42]'}`} />
                <span className={`font-mono text-xs truncate ${p.isHost ? 'text-cyan-400' : 'text-[#FFDE42]'}`}>
                  {p.name}
                  {p.peerId === socket?.id && <span className="text-[#4C5C2D] ml-1">(YOU)</span>}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {p.isHost     && <span className="text-[8px] border border-cyan-400 text-cyan-400 px-1 font-bold">HOST</span>}
                {raisedHands.has(p.peerId) && <span className="text-xs animate-bounce" title="Hand Raised">✋</span>}
              </div>
            </div>
            {/* Host controls per participant */}
            {isHost && p.peerId !== socket?.id && (
              <div className="flex gap-1 mt-1.5">
                <button onClick={() => handleMute(p.peerId)}
                  className="flex-1 bg-[#1B0C0C] hover:bg-red-900/30 text-red-400 border border-[#4C5C2D] text-[9px] py-1 font-bold uppercase transition-colors">
                  MUTE
                </button>
                <button onClick={() => handleKick(p.peerId)}
                  className="flex-1 bg-[#1B0C0C] hover:bg-red-600 text-white border border-red-600 text-[9px] py-1 font-bold uppercase transition-colors">
                  KICK
                </button>
                <button onClick={() => handleBan(p.peerId)}
                  className="flex-1 border border-[#313E17] text-[#4C5C2D] hover:bg-[#313E17] text-[9px] py-1 font-bold uppercase transition-colors">
                  BAN
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>

    {/* ── Reactions ── */}
    <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
      <div className="bg-[#313E17] px-3 py-2 border-b-[3px] border-[#4C5C2D]">
        <h3 className="font-heading text-base font-black text-[#FFDE42] uppercase tracking-widest">Signals</h3>
      </div>
      <div className="p-2 grid grid-cols-6 gap-1.5">
        {['👍', '🔥', '😂', '💀', '💖', '👾'].map(emoji => (
          <button key={emoji} onClick={() => sendReaction(emoji)}
            className="aspect-square text-xl bg-[#1B0C0C] hover:bg-[#FFDE42] border-[2px] border-[#313E17]
              hover:border-[#1B0C0C] shadow-[2px_2px_0_#4C5C2D] transition-all
              active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
              flex items-center justify-center cursor-crosshair rounded-sm">
            {emoji}
          </button>
        ))}
      </div>
    </div>

    {/* ── Host: Video Override ── */}
    {isHost && (
      <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
        <div className="bg-[#313E17] px-3 py-2 border-b-[3px] border-[#4C5C2D]">
          <h3 className="font-heading text-base font-black text-[#FFDE42] uppercase tracking-widest">Override</h3>
        </div>
        <div className="p-2 flex flex-col gap-2">
          <input
            type="url"
            value={videoUrlInput}
            onChange={e => setVideoUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !syncedVideo && videoUrlInput && handleSyncVideo()}
            placeholder="PASTE YOUTUBE URL..."
            className="w-full bg-[#0f0a0a] text-[#FFDE42] border-[2px] border-[#4C5C2D] px-3 py-2
              font-mono text-xs font-bold placeholder:text-[#4C5C2D]/40
              focus:outline-none focus:border-[#FFDE42] transition-colors"
          />
          {!syncedVideo ? (
            <button onClick={handleSyncVideo}
              disabled={!isConnected || !videoUrlInput}
              className="w-full bg-[#313E17] hover:bg-[#FFDE42] text-[#FFDE42] hover:text-[#1B0C0C]
                border-[2px] border-[#1B0C0C] disabled:opacity-40 disabled:cursor-not-allowed
                py-2 text-sm font-heading font-black tracking-widest uppercase transition-colors
                shadow-[3px_3px_0_#4C5C2D] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
              ▶ EXECUTE TRANSMISSION
            </button>
          ) : (
            <button onClick={handleStopVideo}
              className="w-full bg-red-700 hover:bg-red-600 text-white border-[2px] border-[#1B0C0C]
                py-2 text-sm font-heading font-black tracking-widest uppercase transition-colors
                shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
              ■ HALT TRANSMISSION
            </button>
          )}
        </div>
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// RoomView
// ─────────────────────────────────────────────────────────────────────────────
export default function RoomView({
  room,
  isHost,
  joinToken,
  guestName,
}: {
  room: any;
  isHost: boolean;
  joinToken?: string;
  guestName?: string;
}) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { socket, isConnected } = useSocket(joinToken);

  const {
    localStream, localScreenStream, remotePeers, participants,
    isMicOn, isCameraOn, isScreenOn,
    toggleMic, toggleCamera, toggleScreenShare,
    leaveRoom, screenShareSupported,
  } = useMeshWebRTC(room.roomId, socket, guestName);

  const [videoUrlInput,   setVideoUrlInput]   = useState('');
  const [syncedVideo,     setSyncedVideo]     = useState<{ url: string } | null>(null);
  const [reactions,       setReactions]       = useState<{ id: number; emoji: string; left: number }[]>([]);
  const [pinnedId,        setPinnedId]        = useState<string | null>(null);
  const [isHandRaised,    setIsHandRaised]    = useState(false);
  const [raisedHands,     setRaisedHands]     = useState<Set<string>>(new Set());
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  // Edge case: show "Reconnecting..." banner when socket drops mid-call
  const [wasConnected,    setWasConnected]    = useState(false);
  const { toasts, push: toast, dismiss }      = useToast();

  // Track connection drops vs initial connect
  useEffect(() => {
    if (isConnected) setWasConnected(true);
  }, [isConnected]);

  const showReconnecting = wasConnected && !isConnected;

  // ── Speaking detection ────────────────────────────────────────────────────
  // For each remote peer, pick the stream that actually carries audio tracks
  // (streams[0] is not always the audio-bearing stream when screen share is active).
  const speakingStreams = [
    { id: 'local', stream: localStream },
    ...remotePeers.map(p => {
      const audioStream = p.streams.find(s => s.getAudioTracks().length > 0) ?? p.streams[0] ?? null;
      return { id: p.peerId, stream: audioStream };
    }),
  ];
  const speaking = useSpeakingDetection(speakingStreams);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onVideoSync = (state: any) =>
      setSyncedVideo(state?.videoUrl ? { url: state.videoUrl } : null);
    const onReaction = ({ reaction }: any) => spawnReaction(reaction);
    const onHandRaised  = ({ peerId }: any) =>
      setRaisedHands(prev => new Set(prev).add(peerId));
    const onHandLowered = ({ peerId }: any) =>
      setRaisedHands(prev => { const n = new Set(prev); n.delete(peerId); return n; });
    const onPeerJoined = ({ username }: any) =>
      toast(`${username || 'Someone'} joined`, 'info');
    const onPeerLeft = ({ peerId }: any) => {
      const peer = remotePeers.find(p => p.peerId === peerId);
      if (peer) toast(`${peer.username || 'A peer'} left`, 'warn');
    };

    socket.on('room:video_sync',       onVideoSync);
    socket.on('peer:reaction',         onReaction);
    socket.on('peer:hand_raised',      onHandRaised);
    socket.on('peer:hand_lowered',     onHandLowered);
    socket.on('peer:joined',           onPeerJoined);
    socket.on('peer:left',             onPeerLeft);
    return () => {
      socket.off('room:video_sync',    onVideoSync);
      socket.off('peer:reaction',      onReaction);
      socket.off('peer:hand_raised',   onHandRaised);
      socket.off('peer:hand_lowered',  onHandLowered);
      socket.off('peer:joined',        onPeerJoined);
      socket.off('peer:left',          onPeerLeft);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, remotePeers]);

  const spawnReaction = (emoji: string) => {
    const id   = Date.now() + Math.random();
    const left = Math.random() * 80 + 10;
    setReactions(prev => [...prev, { id, emoji, left }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 4000);
  };

  const sendReaction = (emoji: string) => {
    socket?.emit('peer:reaction', { roomId: room.roomId, reaction: emoji });
    spawnReaction(emoji);
  };

  const toggleHand = () => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    socket?.emit(next ? 'peer:raise_hand' : 'peer:lower_hand', { roomId: room.roomId });
  };

  const handleSyncVideo = () => {
    if (!videoUrlInput || !isHost) return;
    const url = getEmbedUrl(videoUrlInput);
    socket?.emit('host:video_sync', { roomId: room.roomId, videoUrl: url, isPlaying: true });
    setSyncedVideo({ url });
    toast('Broadcast started', 'info');
  };

  const handleStopVideo = () => {
    socket?.emit('host:video_sync', { roomId: room.roomId, videoUrl: null, isPlaying: false });
    setSyncedVideo(null);
    setVideoUrlInput('');
    toast('Broadcast stopped', 'warn');
  };

  const handleKick = (peerId: string) => {
    if (isHost && confirm('KICK THIS USER?'))
      socket?.emit('host:kick_user', { roomId: room.roomId, targetSocketId: peerId });
  };
  const handleBan  = (peerId: string) => {
    if (isHost && confirm('BAN THIS USER?'))
      socket?.emit('host:ban_user',  { roomId: room.roomId, targetSocketId: peerId });
  };
  const handleMute = (peerId: string) => {
    if (isHost) socket?.emit('host:mute_user', { roomId: room.roomId, targetSocketId: peerId });
  };

  const exitSequence = () => {
    leaveRoom();
    if (isHost) socket?.emit('host:end_room', { roomId: room.roomId });
    router.push('/');
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(room.roomId).then(() => toast('Room ID copied!', 'info'));
  };

  // ── Build tile list ───────────────────────────────────────────────────────
  type Tile = {
    id: string;
    peerId?: string;
    labelIdx?: number;
    raised: boolean;
    initials?: string;
    element: React.ReactNode;
  };

  const allTiles: Tile[] = [
    ...(pinnedId !== 'local' ? [{
      id: 'local',
      raised: false,
      initials: user?.username?.slice(0, 2).toUpperCase(),
      element: (
        <VideoMonitor
          stream={localStream}
          muted={true}
          label={isHost ? `${user?.username || 'YOU'} ★` : (user?.username || 'YOU')}
          isLive={isCameraOn || isMicOn}
          cameraEnabled={isCameraOn}
          isSpeaking={isMicOn && speaking.has('local')}
          initials={user?.username?.slice(0, 2).toUpperCase()}
        />
      ),
    }] : []),

    ...(localScreenStream && pinnedId !== 'local-screen' ? [{
      id: 'local-screen',
      raised: false,
      element: (
        <VideoMonitor
          stream={localScreenStream}
          muted={true}
          label="YOUR SCREEN"
          isLive={true}
          isSpeaking={false}
        />
      ),
    }] : []),

    ...remotePeers.flatMap(peer => {
      const tiles: Tile[] = [];
      const camStream    = peer.streams[0] ?? null;
      const screenStreams = peer.streams.slice(1);
      const initials     = (peer.username || 'P').slice(0, 2).toUpperCase();
      const camId        = `${peer.peerId}-0`;

      if (camId !== pinnedId) {
        tiles.push({
          id:       camId,
          peerId:   peer.peerId,
          labelIdx: 0,
          raised:   raisedHands.has(peer.peerId),
          initials,
          element: (
            <VideoMonitor
              stream={camStream}
              muted={false}
              label={peer.username || `PEER_${peer.peerId.slice(0, 4)}`}
              isLive={true}
              interactive={false}
              isSpeaking={speaking.has(peer.peerId)}
              initials={initials}
            />
          ),
        });
      }

      screenStreams.forEach((stream, i) => {
        const id = `${peer.peerId}-${i + 1}`;
        if (id === pinnedId) return;
        tiles.push({
          id,
          peerId:   peer.peerId,
          labelIdx: i + 1,
          raised:   false,
          initials,
          element: (
            <VideoMonitor
              stream={stream}
              muted={false}
              label={`${peer.username || `PEER_${peer.peerId.slice(0, 4)}`} (SCR)`}
              isLive={true}
              interactive={false}
            />
          ),
        });
      });
      return tiles;
    }),
  ];

  // Edge case: solo — one tile only, stretch to fill space instead of small grid
  const isSolo = allTiles.length === 1;

  const gridClass = isSolo
    ? 'grid-cols-1'
    : allTiles.length === 2
    ? 'grid-cols-1 sm:grid-cols-2'
    : allTiles.length <= 4
    ? 'grid-cols-2 sm:grid-cols-2'
    : allTiles.length <= 6
    ? 'grid-cols-2 sm:grid-cols-3'
    : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

  return (
    <div className="flex flex-col bg-[#1B0C0C] text-[#FFDE42] overflow-hidden" style={{ height: '100dvh' }}>

      {/* Noise overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none mix-blend-screen opacity-[0.04]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }} />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} dismiss={dismiss} />

      {/* Floating reactions */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {reactions.map(r => (
          <div key={r.id} className="absolute bottom-20 text-4xl sm:text-5xl animate-fly-up drop-shadow-lg"
            style={{ left: `${r.left}%` }}>
            {r.emoji}
          </div>
        ))}
      </div>

      {/* ── Reconnecting banner ─────────────────────────────────────────── */}
      {showReconnecting && (
        <div className="relative z-30 bg-red-700 border-b-[3px] border-[#1B0C0C] flex items-center justify-center gap-2 py-1.5 px-4 shrink-0">
          <div className="w-2 h-2 rounded-full bg-white animate-ping" />
          <span className="font-heading text-xs font-black text-white uppercase tracking-widest">
            SIGNAL LOST — RECONNECTING...
          </span>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-20 bg-[#1B0C0C] border-b-[4px] border-[#4C5C2D]
        flex items-center justify-between px-3 sm:px-5 py-2 shrink-0 gap-2">

        {/* Left: room name */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-3 h-3 bg-[#FFDE42] border-2 border-[#1B0C0C] shadow-[2px_2px_0_#4C5C2D] shrink-0" />
          <h1 className="font-heading text-lg sm:text-2xl lg:text-3xl font-black text-[#FFDE42] uppercase tracking-widest truncate leading-none">
            {room.name}
          </h1>
          {isHost && (
            <span className="shrink-0 hidden sm:inline text-[9px] font-heading font-black bg-[#FFDE42] text-[#1B0C0C] px-1.5 py-0.5 border border-[#1B0C0C] uppercase">
              HOST
            </span>
          )}
        </div>

        {/* Right: meta + controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* LIVE badge */}
          <div className="hidden sm:flex items-center gap-1.5 bg-[#313E17] border-[3px] border-[#1B0C0C] shadow-[2px_2px_0_#4C5C2D] px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[#FFDE42] font-heading tracking-widest uppercase font-bold text-[10px]">LIVE</span>
          </div>
          {/* Peer count */}
          <div className="flex items-center gap-1 bg-[#313E17] border-[3px] border-[#1B0C0C] shadow-[2px_2px_0_#4C5C2D] px-2 py-1">
            <span className="text-[#FFDE42] font-heading font-bold text-xs">👤 {remotePeers.length + 1}</span>
          </div>
          {/* Mobile panel toggle */}
          <button
            onClick={() => setShowMobilePanel(v => !v)}
            className="lg:hidden bg-[#313E17] border-[3px] border-[#1B0C0C] shadow-[2px_2px_0_#4C5C2D]
              w-8 h-8 flex items-center justify-center text-[#FFDE42] font-heading font-black text-lg
              hover:bg-[#4C5C2D] transition-colors"
            aria-label="Toggle info panel"
          >
            ≡
          </button>
          {/* Desktop user info */}
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-[#4C5C2D] font-heading text-xs font-bold uppercase tracking-wider truncate max-w-[100px]">
              {user?.username}
            </span>
            <button onClick={logout}
              className="text-[9px] text-[#FFDE42] border-[2px] border-[#4C5C2D] px-2 py-1
                font-heading font-bold uppercase hover:bg-[#4C5C2D] transition-colors">
              OUT
            </button>
          </div>
        </div>
      </header>

      {/* ── Main body ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative z-10" style={{ minHeight: 0 }}>

        {/* Video area */}
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minHeight: 0 }}>

          {/* Scrollable grid */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 pb-[72px] sm:pb-[80px]" style={{ minHeight: 0 }}>

            {/* Pinned / speaker view */}
            {pinnedId && (
              <div
                className="relative group border-[4px] border-[#FFDE42] bg-[#1B0C0C] overflow-hidden mb-2 shadow-[6px_6px_0_#4C5C2D]"
                style={{ aspectRatio: '16/9' }}
              >
                <span className="absolute top-0 left-0 z-10 bg-[#FFDE42] text-[#1B0C0C] font-heading
                  px-2 py-1 text-[10px] font-black border-b-[2px] border-r-[2px] border-[#1B0C0C] uppercase tracking-widest">
                  📌 PINNED
                </span>
                <div className="absolute inset-0">
                  {pinnedId === 'local' ? (
                    <VideoMonitor stream={localStream} muted={true}
                      label={isHost ? `${user?.username || 'YOU'} ★` : 'YOU'}
                      isLive={true} cameraEnabled={isCameraOn}
                      isSpeaking={isMicOn && speaking.has('local')}
                      initials={user?.username?.slice(0, 2).toUpperCase()} />
                  ) : pinnedId === 'local-screen' && localScreenStream ? (
                    <VideoMonitor stream={localScreenStream} muted={true} label="YOUR SCREEN" isLive={true} />
                  ) : (() => {
                    const [pId, sIdxStr] = pinnedId.split('-');
                    const sIdx  = parseInt(sIdxStr) || 0;
                    const peer  = remotePeers.find(p => p.peerId === pId);
                    const s     = peer?.streams[sIdx];
                    const label = `${peer?.username || `PEER_${pId.slice(0, 4)}`}${sIdx > 0 ? ' (SCR)' : ''}`;
                    return s
                      ? <VideoMonitor stream={s} muted={false} label={label} isLive={true} interactive={false}
                          isSpeaking={sIdx === 0 && speaking.has(pId)}
                          initials={peer?.username?.slice(0, 2).toUpperCase()} />
                      : <div className="w-full h-full flex items-center justify-center text-[#4C5C2D] font-heading text-sm">STREAM ENDED</div>;
                  })()}
                </div>
                <button
                  onClick={() => setPinnedId(null)}
                  className="absolute top-1 right-1 z-10 bg-[#FFDE42] text-[#1B0C0C] border-[2px] border-[#1B0C0C]
                    px-2 py-0.5 text-[10px] font-heading font-black uppercase shadow-[2px_2px_0_#1B0C0C]
                    opacity-0 group-hover:opacity-100 transition-opacity active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                  UNPIN
                </button>
              </div>
            )}

            {/* Edge case: solo mode — single tile stretched tall */}
            {isSolo ? (
              <div className="w-full" style={{ aspectRatio: '16/9' }}>
                <div className="relative w-full h-full border-[3px] border-[#313E17] bg-[#0f0a0a] overflow-hidden
                  hover:border-[#FFDE42] transition-colors group">
                  <div className="absolute inset-0">{allTiles[0].element}</div>
                  {/* Waiting-for-peers overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                    {remotePeers.length === 0 && !isCameraOn && !isMicOn && (
                      <div className="bg-[#1B0C0C]/80 border-[2px] border-[#4C5C2D] px-6 py-4 flex flex-col items-center gap-2">
                        <div className="flex gap-1 items-end h-4">
                          {[1,2,3].map(i => (
                            <div key={i} className="w-1 bg-[#4C5C2D] rounded-sm animate-bounce"
                              style={{ height: `${i * 5}px`, animationDelay: `${i * 150}ms` }} />
                          ))}
                        </div>
                        <span className="text-[#4C5C2D] font-heading text-xs tracking-widest uppercase font-bold">
                          WAITING FOR PEERS...
                        </span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setPinnedId(allTiles[0].id)}
                    className="absolute top-2 left-2 bg-[#FFDE42] text-[#1B0C0C] border-[2px] border-[#1B0C0C]
                      px-2 py-0.5 text-[10px] font-heading font-black uppercase shadow-[2px_2px_0_#1B0C0C]
                      opacity-0 group-hover:opacity-100 transition-opacity active:shadow-none">
                    FOCUS
                  </button>
                </div>
              </div>
            ) : (
              /* Multi-peer grid */
              <div className={`grid gap-1.5 sm:gap-2 ${gridClass}`}>
                {allTiles.map(tile => (
                  <div
                    key={tile.id}
                    className="relative group border-[3px] border-[#313E17] bg-[#0f0a0a] overflow-hidden
                      hover:border-[#FFDE42] transition-colors"
                    style={{ aspectRatio: '16/9' }}
                  >
                    <div className="absolute inset-0">{tile.element}</div>

                    {/* Raised hand badge */}
                    {tile.raised && (
                      <div className="absolute top-0 right-0 bg-[#FFDE42] text-[#1B0C0C] font-heading font-black
                        px-2 py-0.5 text-sm border-b-[2px] border-l-[2px] border-[#1B0C0C] z-10 animate-bounce">
                        ✋
                      </div>
                    )}

                    {/* Focus button */}
                    <button
                      onClick={() => setPinnedId(tile.id)}
                      className="absolute top-1.5 left-1.5 bg-[#FFDE42] text-[#1B0C0C] border-[2px] border-[#1B0C0C]
                        px-2 py-0.5 text-[9px] font-heading font-black uppercase shadow-[2px_2px_0_#1B0C0C]
                        opacity-0 group-hover:opacity-100 transition-opacity active:shadow-none z-10">
                      FOCUS
                    </button>

                    {/* Host controls on tile hover */}
                    {isHost && tile.labelIdx === 0 && tile.peerId && (
                      <div className="absolute bottom-7 right-1.5 flex gap-1
                        opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button onClick={e => { e.stopPropagation(); handleMute(tile.peerId!); }}
                          className="bg-[#1B0C0C]/90 hover:bg-red-900/60 text-red-400 border border-[#4C5C2D]
                            px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase transition-colors">
                          MUTE
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleKick(tile.peerId!); }}
                          className="bg-red-700 hover:bg-red-600 text-white border border-[#1B0C0C]
                            px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase transition-colors">
                          KICK
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Synced video tile — always full width */}
                {syncedVideo && (
                  <div className="col-span-full relative border-[3px] border-[#4C5C2D] bg-[#1B0C0C]
                    shadow-[4px_4px_0_#FFDE42] overflow-hidden"
                    style={{ aspectRatio: '16/9' }}>
                    <span className="absolute top-0 left-0 z-10 bg-[#FFDE42] text-[#1B0C0C] font-heading
                      px-2 py-0.5 text-[10px] font-black border-b-[2px] border-r-[2px] border-[#1B0C0C] uppercase tracking-widest">
                      📡 BROADCAST
                    </span>
                    <iframe src={syncedVideo.url} className="w-full h-full border-none" allow="autoplay; fullscreen" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Control dock ──────────────────────────────────────────── */}
          <div className="absolute bottom-0 left-0 right-0 z-30
            bg-[#313E17] border-t-[4px] border-[#1B0C0C] shadow-[0_-3px_0_#4C5C2D]">
            <div className="flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2 gap-1 sm:gap-2 max-w-screen-xl mx-auto">

              {/* Connection dot */}
              <div
                className={`w-2 h-2 rounded-full border-2 border-[#1B0C0C] shrink-0
                  ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-600 animate-ping'}`}
                title={isConnected ? 'Connected' : 'Disconnected'}
              />

              {/* Buttons */}
              <div className="flex-1 flex items-center justify-center gap-1 sm:gap-1.5">

                {/* MIC */}
                <CtrlBtn
                  onClick={toggleMic}
                  active={isMicOn}
                  activeClass="bg-[#FFDE42] text-[#1B0C0C]"
                  inactiveClass="bg-[#1B0C0C] text-red-400"
                  icon={isMicOn ? '🎤' : '🔇'}
                  label={isMicOn ? 'MUTE' : 'MIC'}
                  title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
                  pulsing={isMicOn && speaking.has('local')}
                />

                {/* CAM */}
                <CtrlBtn
                  onClick={toggleCamera}
                  active={isCameraOn}
                  activeClass="bg-[#FFDE42] text-[#1B0C0C]"
                  inactiveClass="bg-[#1B0C0C] text-red-400"
                  icon={isCameraOn ? '📷' : '📵'}
                  label={isCameraOn ? 'CAM' : 'CAM'}
                  title={isCameraOn ? 'Stop camera' : 'Start camera'}
                />

                {/* SCREEN */}
                {screenShareSupported && (
                  <CtrlBtn
                    onClick={toggleScreenShare}
                    active={isScreenOn}
                    activeClass="bg-[#4C5C2D] text-[#FFDE42] ring-1 ring-[#FFDE42]"
                    inactiveClass="bg-[#1B0C0C] text-[#FFDE42]"
                    icon="🖥️"
                    label={isScreenOn ? 'SCR' : 'SCR'}
                    title={isScreenOn ? 'Stop screen share' : 'Share screen'}
                  />
                )}

                {/* HAND */}
                <CtrlBtn
                  onClick={toggleHand}
                  active={isHandRaised}
                  activeClass="bg-[#FFDE42] text-[#1B0C0C]"
                  inactiveClass="bg-[#1B0C0C] text-[#FFDE42]"
                  icon="✋"
                  label="HAND"
                  title={isHandRaised ? 'Lower hand' : 'Raise hand'}
                  pulsing={isHandRaised}
                />

                {/* Quick reactions — sm+ only */}
                <div className="hidden sm:flex items-center gap-1">
                  {['👍', '🔥', '😂'].map(e => (
                    <button key={e} onClick={() => sendReaction(e)}
                      className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-base sm:text-lg
                        bg-[#1B0C0C] border-[2px] border-[#4C5C2D] hover:bg-[#4C5C2D]
                        shadow-[2px_2px_0_#1B0C0C] transition-colors
                        active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* LEAVE / END */}
              <button onClick={exitSequence}
                className="flex flex-col items-center justify-center gap-0 px-2.5 sm:px-4 py-1.5 sm:py-2
                  bg-red-700 hover:bg-red-600 text-white border-[3px] border-[#1B0C0C]
                  font-heading font-black uppercase tracking-widest
                  shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
                  transition-all shrink-0"
                title={isHost ? 'End room for everyone' : 'Leave room'}
              >
                <span className="text-base sm:text-lg">🚪</span>
                <span className="text-[8px] sm:text-[10px]">{isHost ? 'END' : 'LEAVE'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Desktop sidebar ─────────────────────────────────────────── */}
        <aside className="hidden lg:flex w-[300px] xl:w-[340px] shrink-0 flex-col
          border-l-[4px] border-[#4C5C2D] bg-[#1B0C0C] overflow-hidden">
          <SidePanel
            room={room} participants={participants} isHost={isHost} remotePeers={remotePeers}
            isConnected={isConnected} videoUrlInput={videoUrlInput} setVideoUrlInput={setVideoUrlInput}
            syncedVideo={syncedVideo} handleSyncVideo={handleSyncVideo} handleStopVideo={handleStopVideo}
            sendReaction={sendReaction} handleMute={handleMute} handleKick={handleKick} handleBan={handleBan}
            raisedHands={raisedHands} socket={socket} onCopyRoomId={handleCopyRoomId}
          />
        </aside>

        {/* ── Mobile slide-up panel ────────────────────────────────────── */}
        {showMobilePanel && (
          <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end"
            onClick={() => setShowMobilePanel(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative z-50 bg-[#1B0C0C] border-t-[4px] border-[#4C5C2D]
                shadow-[0_-6px_0_#313E17] max-h-[75dvh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b-[3px] border-[#4C5C2D] bg-[#313E17] shrink-0">
                <h2 className="font-heading text-lg font-black text-[#FFDE42] uppercase tracking-widest">ROOM INFO</h2>
                <button onClick={() => setShowMobilePanel(false)}
                  className="text-[#FFDE42] w-8 h-8 flex items-center justify-center
                    border-[2px] border-[#4C5C2D] font-heading font-black hover:bg-[#4C5C2D] transition-colors text-lg">
                  ✕
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                <SidePanel
                  room={room} participants={participants} isHost={isHost} remotePeers={remotePeers}
                  isConnected={isConnected} videoUrlInput={videoUrlInput} setVideoUrlInput={setVideoUrlInput}
                  syncedVideo={syncedVideo} handleSyncVideo={handleSyncVideo} handleStopVideo={handleStopVideo}
                  sendReaction={sendReaction} handleMute={handleMute} handleKick={handleKick} handleBan={handleBan}
                  raisedHands={raisedHands} socket={socket} onCopyRoomId={handleCopyRoomId}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fly-up {
          0%   { transform: translateY(60px) scale(0.5); opacity: 0; }
          10%  { opacity: 1; transform: translateY(0) scale(1.2); }
          50%  { transform: translateY(-35vh) scale(1) rotate(8deg); }
          100% { transform: translateY(-70vh) scale(0.9); opacity: 0; }
        }
        .animate-fly-up { animation: fly-up 3.5s ease-out forwards; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #1B0C0C; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #4C5C2D; }
      `}} />
    </div>
  );
}

// ── CtrlBtn — reusable control dock button ──────────────────────────────────
function CtrlBtn({
  onClick, active, activeClass, inactiveClass, icon, label, title, pulsing = false,
}: {
  onClick: () => void;
  active: boolean;
  activeClass: string;
  inactiveClass: string;
  icon: string;
  label: string;
  title: string;
  pulsing?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative flex flex-col items-center justify-center gap-0
        px-2 sm:px-3 py-1.5 sm:py-2 border-[3px] border-[#1B0C0C]
        font-heading font-black uppercase tracking-widest
        shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
        transition-all min-w-[40px] sm:min-w-[52px]
        ${active ? activeClass : inactiveClass}
        ${pulsing ? 'ring-2 ring-offset-1 ring-offset-[#313E17] ring-[#FFDE42]' : ''}`}
    >
      <span className="text-base sm:text-xl leading-none">{icon}</span>
      <span className="text-[8px] sm:text-[9px] tracking-[0.1em] leading-none mt-0.5">{label}</span>
    </button>
  );
}