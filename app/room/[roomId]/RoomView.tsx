'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import VideoMonitor from '@/components/VideoMonitor';
import { useSocket } from '@/hooks/useSocket';
import { useMeshWebRTC } from '@/hooks/useMeshWebRTC';
import { useAuth } from '@/hooks/useAuth';
import { 
  Users, Radio, Mic, MicOff, Camera as CameraIcon, CameraOff, 
  MonitorUp, Hand, Smile, LogOut, ShieldBan, VolumeX,
  Menu, X, Pin, PinOff, Tv, ShieldCheck
} from 'lucide-react';

function getEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let videoId = '';
    if (parsed.hostname === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('?')[0];
    } else if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v') || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        return url;
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.replace('/shorts/', '').split('?')[0];
      }
    }
    if (videoId) return `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1`;
  } catch { /* ignored */ }
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar / panel
// ─────────────────────────────────────────────────────────────────────────────
const SidePanel = ({
  room, participants, isHost, remotePeers, isConnected,
  videoUrlInput, setVideoUrlInput, syncedVideo, handleSyncVideo,
  handleStopVideo, sendReaction, handleMute, handleKick, handleBan,
  raisedHands, socket,
}: any) => (
  <div className="flex flex-col gap-6 p-5 h-full overflow-y-auto custom-scrollbar relative z-10 bg-brand-surface border-l border-brand-border/40">

    {/* Room Info */}
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold tracking-widest text-brand-gray uppercase">Session Details</h3>
      <div className="flex flex-col rounded-xl overflow-hidden glass-panel border-brand-border/30">
        <div className="flex justify-between items-center px-4 py-3 border-b border-brand-border/40 bg-brand-surface-2/40">
          <span className="text-sm font-medium text-brand-gray">Room ID</span>
          <span className="text-sm font-mono text-brand-white select-all bg-brand-base px-2 py-0.5 rounded-md border border-brand-border/50">{room.roomId}</span>
        </div>
        <div className="flex justify-between items-center px-4 py-3 border-b border-brand-border/40 bg-brand-surface-2/40">
          <span className="text-sm font-medium text-brand-gray">Active Nodes</span>
          <span className="text-sm font-medium text-brand-white bg-brand-accent/20 text-brand-accent px-2 py-0.5 rounded-md">{remotePeers.length + 1}</span>
        </div>
        <div className="flex justify-between items-center px-4 py-3 bg-brand-surface-2/40">
          <span className="text-sm font-medium text-brand-gray">Network</span>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-brand-success shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-brand-danger'}`} />
            <span className="text-xs font-semibold tracking-wide text-brand-white">{isConnected ? 'STABLE' : 'LOST'}</span>
          </div>
        </div>
      </div>
    </div>

    {/* Participants */}
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h3 className="text-[11px] font-semibold tracking-widest text-brand-gray uppercase">Participants</h3>
        <span className="text-[10px] font-medium bg-brand-surface-2 text-brand-white px-2 py-0.5 rounded-full">{participants.length}</span>
      </div>
      <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
        {participants.map((p: any) => (
          <div key={p.peerId} className="group flex flex-col p-3 rounded-xl border border-brand-border/30 bg-brand-surface-2/20 hover:bg-brand-surface-2/60 transition-all duration-200">
            <div className="flex justify-between items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-surface-2 to-brand-border flex items-center justify-center shrink-0 border border-brand-base">
                  <span className="text-xs font-medium text-brand-white">{p.name ? p.name.charAt(0).toUpperCase() : '?'}</span>
                </div>
                <div className="flex flex-col truncate">
                  <span className="text-sm font-medium text-brand-white truncate flex items-center gap-2">
                    {p.name} {p.peerId === socket?.id && <span className="text-[10px] font-medium text-brand-gray">(You)</span>}
                  </span>
                  {p.isHost && (
                    <span className="text-[10px] flex items-center gap-1 font-medium text-brand-accent">
                      <ShieldCheck size={10} /> Host
                    </span>
                  )}
                </div>
              </div>
              {raisedHands.has(p.peerId) && <Hand size={14} className="text-brand-accent animate-bounce" />}
            </div>

            {/* Host Controls for peer */}
            {isHost && p.peerId !== socket?.id && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-brand-border/30 opacity-0 h-0 overflow-hidden group-hover:opacity-100 group-hover:h-auto transition-all">
                <button onClick={() => handleMute(p.peerId)} className="flex-1 flex items-center justify-center gap-1 bg-brand-surface hover:bg-brand-border text-brand-gray hover:text-brand-white rounded-lg text-[10px] py-1.5 font-medium transition-colors border border-brand-border">
                  <VolumeX size={10} /> Mute
                </button>
                <button onClick={() => handleKick(p.peerId)} className="flex-1 flex items-center justify-center gap-1 bg-brand-surface hover:bg-brand-danger/20 text-brand-gray hover:text-brand-danger rounded-lg text-[10px] py-1.5 font-medium transition-colors border border-brand-border hover:border-brand-danger/30">
                  Kick
                </button>
                <button onClick={() => handleBan(p.peerId)} className="flex-1 flex items-center justify-center gap-1 bg-brand-surface hover:bg-brand-danger/20 text-brand-gray hover:text-brand-danger rounded-lg text-[10px] py-1.5 font-medium transition-colors border border-brand-border hover:border-brand-danger/30" title="Ban permanently">
                  <ShieldBan size={10} /> Ban
                </button>
              </div>
            )}
          </div>
        ))}
        {participants.length === 0 && (
          <div className="text-[11px] text-brand-gray text-center p-4 bg-brand-surface-2/20 rounded-xl border border-brand-border/30">
            Waiting for peers...
          </div>
        )}
      </div>
    </div>

    {/* Reactions */}
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold tracking-widest text-brand-gray uppercase">Quick Reactions</h3>
      <div className="grid grid-cols-3 gap-2">
        {['👍', '🎉', '😂', '👏', '💖', '👀'].map(emoji => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            className="text-xl bg-brand-surface-2/30 hover:bg-brand-surface-2 border border-brand-border/30 hover:border-brand-border/80 rounded-xl py-2 transition-all active:scale-95 flex items-center justify-center"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>

    {/* Host-only: Sync Stream */}
    {isHost && (
      <div className="flex flex-col gap-3 mt-auto pt-4 border-t border-brand-border/30">
        <h3 className="text-[11px] font-semibold tracking-widest text-brand-accent uppercase flex items-center gap-1.5">
          <Tv size={12} /> Sync Media
        </h3>
        <div className="flex flex-col gap-2">
          <input
            type="url"
            value={videoUrlInput}
            onChange={e => setVideoUrlInput(e.target.value)}
            placeholder="Paste YouTube or MP4 URL..."
            className="w-full glass-input px-3 py-2 text-sm"
          />
          {!syncedVideo ? (
            <button
              onClick={handleSyncVideo}
              disabled={!isConnected || !videoUrlInput}
              className="w-full bg-brand-accent hover:bg-brand-accent-hover text-white disabled:opacity-40 disabled:hover:bg-brand-accent py-2 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-[0_0_15px_rgba(99,102,241,0.2)] active:scale-[0.98]"
            >
              Start Sync
            </button>
          ) : (
            <button
              onClick={handleStopVideo}
              className="w-full bg-brand-danger/10 hover:bg-brand-danger/20 text-brand-danger border border-brand-danger/30 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all active:scale-[0.98]"
            >
              Stop Sync
            </button>
          )}
        </div>
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main RoomView component
// ─────────────────────────────────────────────────────────────────────────────
export default function RoomView({
  room,
  isHost,
}: {
  room: any;
  isHost: boolean;
}) {
  const router = useRouter();
  const { user, logout } = useAuth(true);
  const { socket, isConnected } = useSocket();

  const {
    localStream, localScreenStream, remotePeers, participants,
    isMicOn, isCameraOn, isScreenOn,
    toggleMic, toggleCamera, toggleScreenShare,
    viewerCount, leaveRoom,
    screenShareSupported,
  } = useMeshWebRTC(room.roomId, socket);

  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [syncedVideo, setSyncedVideo] = useState<{ url: string; isPlaying: boolean } | null>(null);
  const [reactions, setReactions] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [showMobilePanel, setShowMobilePanel] = useState(false);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.on('room:video_sync', (state: any) => {
      setSyncedVideo(state?.videoUrl ? { url: state.videoUrl, isPlaying: state.isPlaying } : null);
    });

    socket.on('peer:reaction', ({ reaction }: any) => {
      const id = Date.now() + Math.random();
      const left = Math.random() * 80 + 10;
      setReactions(prev => [...prev, { id, emoji: reaction, left }]);
      setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 4000);
    });

    socket.on('peer:hand_raised', ({ peerId }: { peerId: string }) => {
      setRaisedHands(prev => new Set(Array.from(prev).concat(peerId)));
    });
    socket.on('peer:hand_lowered', ({ peerId }: { peerId: string }) => {
      setRaisedHands(prev => {
        const n = new Set(Array.from(prev));
        n.delete(peerId);
        return n;
      });
    });

    return () => {
      socket.off('room:video_sync');
      socket.off('peer:reaction');
      socket.off('peer:hand_raised');
      socket.off('peer:hand_lowered');
    };
  }, [socket]);

  const toggleHand = () => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    socket?.emit(next ? 'peer:raise_hand' : 'peer:lower_hand', { roomId: room.roomId });
  };

  const sendReaction = (emoji: string) => {
    socket?.emit('peer:reaction', { roomId: room.roomId, reaction: emoji });
    const id = Date.now() + Math.random();
    const left = Math.random() * 80 + 10;
    setReactions(prev => [...prev, { id, emoji, left }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 4000);
  };

  const handleSyncVideo = () => {
    if (videoUrlInput && isHost) {
      const embedUrl = getEmbedUrl(videoUrlInput);
      socket?.emit('host:video_sync', { roomId: room.roomId, videoUrl: embedUrl, isPlaying: true });
      setSyncedVideo({ url: embedUrl, isPlaying: true });
    }
  };

  const handleStopVideo = () => {
    socket?.emit('host:video_sync', { roomId: room.roomId, videoUrl: null, isPlaying: false });
    setSyncedVideo(null);
    setVideoUrlInput('');
  };

  const handleKick = (peerId: string) => {
    if (isHost && confirm('Remove this user from the room?'))
      socket?.emit('host:kick_user', { roomId: room.roomId, targetSocketId: peerId });
  };

  const handleBan = (peerId: string) => {
    if (isHost && confirm('Permanently ban this user from the session?'))
      socket?.emit('host:ban_user', { roomId: room.roomId, targetSocketId: peerId });
  };

  const handleMute = (peerId: string) => {
    if (isHost) socket?.emit('host:mute_user', { roomId: room.roomId, targetSocketId: peerId });
  };

  const exitSequence = () => {
    leaveRoom();
    if (isHost) socket?.emit('host:end_room', { roomId: room.roomId });
    router.push('/');
  };

  // ── Build tile list ───────────────────────────────────────────────────────
  const allTiles = [
    ...(pinnedId !== 'local' ? [{
      id: 'local',
      element: (
        <VideoMonitor
          stream={localStream}
          muted={true}
          label={isHost ? 'You (Host)' : 'You'}
          isLive={isCameraOn || isMicOn}
          cameraEnabled={isCameraOn}
        />
      ),
    }] : []),

    ...(localScreenStream && pinnedId !== 'local-screen' ? [{
      id: 'local-screen',
      element: (
        <VideoMonitor
          stream={localScreenStream}
          muted={true}
          label="Your Screen"
          isLive={true}
        />
      ),
    }] : []),

    ...remotePeers.flatMap(peer => {
      const tiles: any[] = [];
      const camId = `${peer.peerId}-0`;
      
      if (camId !== pinnedId) {
        tiles.push({
          id: camId,
          peerId: peer.peerId,
          labelIdx: 0,
          raised: raisedHands.has(peer.peerId),
          element: (
            <VideoMonitor
              stream={peer.streams[0]}
              muted={false}
              label={peer.username || `Guest ${peer.peerId.slice(0, 4)}`}
              isLive={!!peer.streams[0]}
              interactive={false}
            />
          ),
        });
      }

      const screenStream = peer.streams[1];
      if (screenStream) {
        const screenId = `${peer.peerId}-1`;
        if (screenId !== pinnedId) {
          tiles.push({
            id: screenId,
            peerId: peer.peerId,
            labelIdx: 1,
            raised: false,
            element: (
              <VideoMonitor
                stream={screenStream}
                muted={false}
                label={`${peer.username || `Guest`} Screen`}
                isLive={true}
                interactive={false}
              />
            ),
          });
        }
      }
      return tiles;
    }),
  ].filter(Boolean) as any[];

  // Prioritize host tile
  allTiles.sort((a, b) => {
    if (a.id === 'local' || a.id === 'local-screen') return -1;
    if (b.id === 'local' || b.id === 'local-screen') return 1;

    const peerA = remotePeers.find(p => p.peerId === a.peerId);
    const peerB = remotePeers.find(p => p.peerId === b.peerId);
    if (peerA?.isHost && !peerB?.isHost) return -1;
    if (!peerA?.isHost && peerB?.isHost) return 1;
    return 0;
  });

  const gridColsClass =
    allTiles.length <= 1 ? 'grid-cols-1'
    : allTiles.length <= 2 ? 'grid-cols-1 sm:grid-cols-2'
    : allTiles.length <= 4 ? 'grid-cols-2 lg:grid-cols-2'
    : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  const resolvePinnedStream = () => {
    if (!pinnedId) return null;
    if (pinnedId === 'local') {
      return <VideoMonitor stream={localStream} muted={true} label={isHost ? 'You (Host)' : 'You'} isLive={true} cameraEnabled={isCameraOn} />;
    }
    if (pinnedId === 'local-screen' && localScreenStream) {
      return <VideoMonitor stream={localScreenStream} muted={true} label="Your Screen" isLive={true} />;
    }
    const lastDash = pinnedId.lastIndexOf('-');
    const pId = pinnedId.slice(0, lastDash);
    const sIdx = parseInt(pinnedId.slice(lastDash + 1), 10);
    const peer = remotePeers.find(p => p.peerId === pId);
    const stream = peer?.streams[sIdx as 0 | 1] ?? null;
    return stream
      ? <VideoMonitor stream={stream} muted={false} label={`${peer?.username || 'Guest'}${sIdx > 0 ? ' Screen' : ''}`} isLive={true} interactive={false} />
      : null;
  };

  return (
    <div className="flex flex-col bg-brand-base text-brand-white overflow-hidden w-full h-[100dvh]">
      
      {/* Floating Reactions */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {reactions.map(r => (
          <div
            key={r.id}
            className="absolute bottom-24 text-4xl sm:text-5xl animate-fly-up drop-shadow-2xl"
            style={{ left: `\${r.left}%` }}
          >
            {r.emoji}
          </div>
        ))}
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="relative z-20 bg-brand-surface border-b border-brand-border/50 flex items-center justify-between px-4 sm:px-6 py-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-accent to-brand-accent-hover flex items-center justify-center shadow-glow shrink-0">
            <Radio size={16} className="text-white" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm sm:text-base font-semibold text-brand-white tracking-tight truncate leading-tight">
              {room.name}
            </h1>
            <span className="text-[10px] font-medium text-brand-gray/80 tracking-widest uppercase">
              Encrypted Session
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="hidden sm:flex items-center gap-2 bg-brand-surface-2/60 border border-brand-border px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-danger animate-pulse" />
            <span className="text-[11px] font-bold tracking-widest uppercase text-brand-white">Live</span>
          </div>
          
          <button
            onClick={() => setShowMobilePanel(v => !v)}
            className="lg:hidden p-2 rounded-xl border border-brand-border bg-brand-surface-2 text-brand-white hover:bg-brand-border transition-colors"
          >
            <Menu size={18} />
          </button>

          <div className="hidden lg:flex items-center gap-3 pl-2 border-l border-brand-border/50">
            <span className="text-[13px] font-medium text-brand-white bg-brand-surface-2 px-3 py-1.5 rounded-full border border-brand-border/40">
              {user?.username}
            </span>
            <button 
              onClick={logout} 
              className="p-1.5 text-brand-gray hover:text-brand-danger hover:bg-brand-danger/10 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main body ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative z-10" style={{ minHeight: 0 }}>

        {/* Video area */}
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minHeight: 0 }}>
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 custom-scrollbar"
            style={{
              minHeight: 0,
              paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <div className="max-w-[1920px] mx-auto w-full h-full flex flex-col gap-3 sm:gap-4">
              
              {/* Pinned view */}
              {pinnedId && (
                <div className="relative group rounded-2xl border border-brand-accent/40 shadow-glow bg-[#050505] overflow-hidden shrink-0" style={{ aspectRatio: '16/9', maxHeight: '70vh' }}>
                  <div className="absolute top-4 left-4 bg-brand-surface/80 backdrop-blur-md text-brand-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-brand-border/50 z-20">
                    <Pin size={12} className="text-brand-accent" /> Pinned
                  </div>
                  <div className="absolute inset-0">
                    {resolvePinnedStream()}
                  </div>
                  <button
                    onClick={() => setPinnedId(null)}
                    className="absolute top-4 right-4 bg-brand-surface/80 backdrop-blur-md hover:bg-brand-surface text-brand-white border border-brand-border px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-20"
                  >
                    <PinOff size={12} /> Unpin
                  </button>
                </div>
              )}

              {/* Video grid */}
              <div className={`grid gap-3 sm:gap-4 \${gridColsClass} w-full h-full content-start`}>
                {allTiles.map((tile: any) => (
                  <div
                    key={tile.id}
                    className="relative group rounded-2xl border border-brand-border bg-[#0a0a0b] overflow-hidden hover:border-brand-border/80 transition-colors shadow-sm"
                    style={{ aspectRatio: '16/9' }}
                  >
                    <div className="absolute inset-0">{tile.element}</div>
                    
                    {tile.raised && (
                      <div className="absolute top-3 right-3 bg-brand-surface text-brand-white rounded-full p-2 shadow-lg border border-brand-border z-20 animate-bounce">
                        <Hand size={14} className="text-brand-accent" />
                      </div>
                    )}
                    
                    <button
                      onClick={() => setPinnedId(tile.id)}
                      className="absolute top-3 left-3 bg-brand-surface/80 backdrop-blur-md hover:bg-brand-surface text-brand-white border border-brand-border/50 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shadow-sm z-20"
                    >
                      <Pin size={10} /> Pin
                    </button>

                    {isHost && tile.labelIdx === 0 && tile.peerId && (
                      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <button
                          onClick={e => { e.stopPropagation(); handleMute(tile.peerId); }}
                          className="p-1.5 bg-brand-surface/80 backdrop-blur-md hover:bg-brand-surface rounded-md border border-brand-border/50 text-brand-gray hover:text-brand-white transition-colors"
                          title="Mute User"
                        >
                          <VolumeX size={12} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleKick(tile.peerId); }}
                          className="p-1.5 bg-brand-surface/80 backdrop-blur-md hover:bg-brand-danger/20 rounded-md border border-brand-border/50 text-brand-danger transition-colors"
                          title="Kick User"
                        >
                          <ShieldBan size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Synced video */}
                {syncedVideo && (
                  <div className="relative rounded-2xl border border-brand-accent/30 bg-[#050505] shadow-glow overflow-hidden col-span-full" style={{ aspectRatio: '16/9', maxHeight: '70vh' }}>
                    <div className="absolute top-4 left-4 bg-brand-accent/90 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-lg z-20">
                      <Tv size={12} /> Playing Media
                    </div>
                    <iframe
                      src={syncedVideo.url}
                      className="w-full h-full border-none"
                      allow="autoplay; fullscreen"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Control dock ──────────────────────────────────────────────── */}
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30"
          >
            <div className="glass-panel px-3 sm:px-5 py-2.5 sm:py-3 rounded-2xl flex items-center gap-2 sm:gap-3 flex-nowrap shadow-[0_20px_40px_-15px_rgba(0,0,0,0.8)] border-brand-border/60">

              <button
                onClick={toggleMic}
                className={`flex items-center justify-center p-3 sm:p-3.5 rounded-xl transition-all \${isMicOn ? 'bg-brand-surface-2 hover:bg-brand-border text-brand-white border border-brand-border/50' : 'bg-brand-danger/10 hover:bg-brand-danger/20 text-brand-danger border border-brand-danger/30'}`}
                title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isMicOn ? <Mic size={20} className="sm:w-5 sm:h-5 w-4 h-4" /> : <MicOff size={20} className="sm:w-5 sm:h-5 w-4 h-4" />}
              </button>

              <button
                onClick={toggleCamera}
                className={`flex items-center justify-center p-3 sm:p-3.5 rounded-xl transition-all \${isCameraOn ? 'bg-brand-surface-2 hover:bg-brand-border text-brand-white border border-brand-border/50' : 'bg-brand-danger/10 hover:bg-brand-danger/20 text-brand-danger border border-brand-danger/30'}`}
                title={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
              >
                {isCameraOn ? <CameraIcon size={20} className="sm:w-5 sm:h-5 w-4 h-4" /> : <CameraOff size={20} className="sm:w-5 sm:h-5 w-4 h-4" />}
              </button>

              {screenShareSupported && (
                <button
                  onClick={toggleScreenShare}
                  className={`flex items-center justify-center p-3 sm:p-3.5 rounded-xl transition-all \${isScreenOn ? 'bg-brand-accent hover:bg-brand-accent-hover text-white shadow-glow' : 'bg-brand-surface-2 hover:bg-brand-border text-brand-white border border-brand-border/50'}`}
                  title={isScreenOn ? 'Stop Screen Share' : 'Share Screen'}
                >
                  <MonitorUp size={20} className="sm:w-5 sm:h-5 w-4 h-4" />
                </button>
              )}

              <div className="w-px h-8 bg-brand-border/60 mx-1 hidden sm:block" />

              <button
                onClick={toggleHand}
                className={`flex items-center justify-center p-3 sm:p-3.5 rounded-xl transition-all \${isHandRaised ? 'bg-brand-accent hover:bg-brand-accent-hover text-white shadow-glow' : 'bg-brand-surface-2 hover:bg-brand-border text-brand-white border border-brand-border/50'}`}
                title="Raise Hand"
              >
                <Hand size={20} className="sm:w-5 sm:h-5 w-4 h-4" />
              </button>

              <div className="hidden sm:flex gap-1.5 border border-brand-border/50 bg-brand-base/40 rounded-xl p-1">
                {['👍', '🎉', '😂'].map(e => (
                  <button
                    key={e}
                    onClick={() => sendReaction(e)}
                    className="w-10 h-10 flex items-center justify-center text-lg hover:bg-brand-surface-2 rounded-lg transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>

              <div className="w-px h-8 bg-brand-border/60 mx-1" />

              <button
                onClick={exitSequence}
                className="flex items-center justify-center px-4 sm:px-5 py-3 sm:py-3.5 bg-brand-danger hover:bg-red-600 text-white rounded-xl transition-all font-semibold text-sm tracking-wide shadow-lg active:scale-95"
              >
                {isHost ? 'End' : 'Leave'}
              </button>
            </div>
          </div>
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-[320px] shrink-0 border-l border-brand-border/50 bg-brand-base overflow-hidden">
          <SidePanel
            room={room} participants={participants} isHost={isHost} remotePeers={remotePeers}
            isConnected={isConnected} videoUrlInput={videoUrlInput} setVideoUrlInput={setVideoUrlInput}
            syncedVideo={syncedVideo} handleSyncVideo={handleSyncVideo} handleStopVideo={handleStopVideo}
            sendReaction={sendReaction} handleMute={handleMute} handleKick={handleKick} handleBan={handleBan}
            raisedHands={raisedHands} socket={socket}
          />
        </aside>

        {/* Mobile slide-up panel */}
        {showMobilePanel && (
          <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setShowMobilePanel(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative z-50 bg-brand-surface border-t border-brand-border flex flex-col rounded-t-2xl shadow-[0_-20px_40px_rgba(0,0,0,0.5)]"
              style={{
                maxHeight: 'calc(80vh - env(safe-area-inset-bottom, 0px))',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border/50 bg-brand-surface rounded-t-2xl shrink-0">
                <h2 className="text-sm font-semibold tracking-wide text-brand-white">Meeting Info</h2>
                <button
                  onClick={() => setShowMobilePanel(false)}
                  className="text-brand-gray hover:text-brand-white p-1.5 rounded-lg hover:bg-brand-surface-2 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 bg-brand-base">
                <SidePanel
                  room={room} participants={participants} isHost={isHost} remotePeers={remotePeers}
                  isConnected={isConnected} videoUrlInput={videoUrlInput} setVideoUrlInput={setVideoUrlInput}
                  syncedVideo={syncedVideo} handleSyncVideo={handleSyncVideo} handleStopVideo={handleStopVideo}
                  sendReaction={sendReaction} handleMute={handleMute} handleKick={handleKick} handleBan={handleBan}
                  raisedHands={raisedHands} socket={socket}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes fly-up {
            0%   { transform: translateY(80px) scale(0.5); opacity: 0; }
            10%  { opacity: 1; transform: translateY(0) scale(1.2); }
            50%  { transform: translateY(-30vh) scale(1) rotate(5deg); }
            100% { transform: translateY(-70vh); opacity: 0; }
          }
          .animate-fly-up { animation: fly-up 3.5s ease-out forwards; }
          html, body { overscroll-behavior: none; }
        `,
      }} />
    </div>
  );
}