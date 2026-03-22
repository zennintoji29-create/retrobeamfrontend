'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import VideoMonitor from '@/components/VideoMonitor';
import { useSocket } from '@/hooks/useSocket';
import { useMeshWebRTC } from '@/hooks/useMeshWebRTC';
import { useAuth } from '@/hooks/useAuth';

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

export default function RoomView({ room, isHost, joinToken, guestName }: { room: any, isHost: boolean, joinToken?: string, guestName?: string }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { socket, isConnected } = useSocket(joinToken);

  const {
    localStream, localScreenStream, remotePeers, participants,
    isMicOn, isCameraOn, isScreenOn,
    toggleMic, toggleCamera, toggleScreenShare,
    viewerCount, leaveRoom
  } = useMeshWebRTC(room.roomId, socket, guestName);

  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [syncedVideo, setSyncedVideo] = useState<{url: string, isPlaying: boolean} | null>(null);
  const [reactions, setReactions] = useState<{id: number, emoji: string, left: number}[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  // Mobile: 'videos' | 'info'
  const [mobileTab, setMobileTab] = useState<'videos' | 'info'>('videos');
  const [showMobilePanel, setShowMobilePanel] = useState(false);

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
      setRaisedHands(prev => new Set([...Array.from(prev), peerId]));
    });
    socket.on('peer:hand_lowered', ({ peerId }: { peerId: string }) => {
      setRaisedHands(prev => { const n = new Set(Array.from(prev)); n.delete(peerId); return n; });
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
    if (isHost && confirm('KICK THIS USER?')) socket?.emit('host:kick_user', { roomId: room.roomId, targetSocketId: peerId });
  };

  const handleBan = (peerId: string) => {
    if (isHost && confirm('BAN THIS USER PERMANENTLY FROM THIS SESSION?')) {
      socket?.emit('host:ban_user', { roomId: room.roomId, targetSocketId: peerId });
    }
  };

  const handleMute = (peerId: string) => {
    if (isHost) socket?.emit('host:mute_user', { roomId: room.roomId, targetSocketId: peerId });
  };

  const exitSequence = () => {
    leaveRoom();
    if (isHost) socket?.emit('host:end_room', { roomId: room.roomId });
    router.push('/');
  };

  // Build all video tiles
  const allTiles = [
    // Local cam tile — always shown
    ...(pinnedId !== 'local' ? [{
      id: 'local',
      element: <VideoMonitor stream={localStream} muted={true} label={isHost ? 'YOU (HOST)' : 'YOU'} isLive={isCameraOn || isMicOn} cameraEnabled={isCameraOn} />
    }] : []),
    // Local screen share tile
    ...(localScreenStream && pinnedId !== 'local-screen' ? [{
      id: 'local-screen',
      element: <VideoMonitor stream={localScreenStream} muted={true} label="YOUR SCREEN" isLive={true} />
    }] : []),
    // Remote peer tiles
    ...remotePeers.flatMap(peer =>
      peer.streams.map((stream, idx) => {
        const id = `${peer.peerId}-${idx}`;
        if (id === pinnedId) return null;
        return {
          id,
          peerId: peer.peerId,
          labelIdx: idx,
          element: <VideoMonitor stream={stream} muted={false} label={peer.username || `PEER_${peer.peerId.slice(0,4)}${idx > 0 ? ' (SCR)' : ''}`} isLive={true} interactive={false} />,
          raised: raisedHands.has(peer.peerId),
        };
      }).filter(Boolean)
    ),
  ].filter(Boolean) as any[];

  const gridColsClass = allTiles.length <= 1
    ? 'grid-cols-1'
    : allTiles.length <= 2
    ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  // --- Sidebar/Panel content (shared between desktop sidebar and mobile drawer/tab) ---
  const SidePanel = () => (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      {/* Room Info */}
      <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
        <div className="bg-[#313E17] px-4 py-2 border-b-[3px] border-[#4C5C2D]">
          <h3 className="font-heading text-xl font-black text-[#FFDE42] uppercase tracking-widest">Data Feed</h3>
        </div>
        <div className="p-3 flex flex-col gap-2">
          <div className="flex justify-between items-center border-[2px] border-[#313E17] bg-[#1B0C0C] px-3 py-2">
            <span className="text-[#4C5C2D] font-heading text-sm font-bold tracking-widest uppercase">Room ID</span>
            <span className="text-[#FFDE42] font-mono font-bold text-sm select-all">{room.roomId}</span>
          </div>
          <div className="flex justify-between items-center border-[2px] border-[#313E17] bg-[#1B0C0C] px-3 py-2">
            <span className="text-[#4C5C2D] font-heading text-sm font-bold tracking-widest uppercase">Units</span>
            <span className="text-[#1B0C0C] bg-[#FFDE42] font-black text-lg font-heading px-2 py-0.5">{remotePeers.length + 1}</span>
          </div>
          <div className="flex justify-between items-center border-[2px] border-[#313E17] bg-[#1B0C0C] px-3 py-2">
            <span className="text-[#4C5C2D] font-heading text-sm font-bold tracking-widest uppercase">Signal</span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[#FFDE42] font-heading text-sm font-bold">{isConnected ? 'LIVE' : 'LOST'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Participants List */}
      <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
        <div className="bg-[#313E17] px-4 py-2 border-b-[3px] border-[#4C5C2D] flex justify-between items-center">
          <h3 className="font-heading text-xl font-black text-[#FFDE42] uppercase tracking-widest">Network Nodes</h3>
          <span className="text-[10px] bg-[#FFDE42] text-[#1B0C0C] px-1.5 py-0.5 font-bold">{participants.length}</span>
        </div>
        <div className="p-2 flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar">
          {participants.map(p => (
            <div key={p.peerId} className="flex flex-col border border-[#313E17] p-2 bg-[#1B0C0C]/50 hover:bg-[#313E17]/20 transition-colors">
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 shrink-0 ${p.isHost ? 'bg-synth-cyan' : 'bg-[#FFDE42]'}`} />
                  <span className={`font-mono text-sm truncate ${p.isHost ? 'text-synth-cyan' : 'text-[#FFDE42]'}`}>
                    {p.name} {p.peerId === socket?.id && '(YOU)'}
                  </span>
                </div>
                {p.isHost && <span className="text-[8px] border border-synth-cyan text-synth-cyan px-1 font-bold shrink-0">HOST</span>}
                {raisedHands.has(p.peerId) && <span className="text-xs" title="Hand Raised">✋</span>}
              </div>
              
              {/* Host Admin Controls in List */}
              {isHost && p.peerId !== socket?.id && (
                <div className="flex gap-1 mt-2">
                  <button 
                    onClick={() => handleMute(p.peerId)}
                    className="flex-1 bg-[#1B0C0C] hover:bg-red-900/30 text-red-400 border border-[#4C5C2D] text-[9px] py-1 font-bold uppercase transition-colors"
                  >
                    MUTE
                  </button>
                  <button 
                    onClick={() => handleKick(p.peerId)}
                    className="flex-1 bg-[#1B0C0C] hover:bg-red-600 text-white border border-red-600 text-[9px] py-1 font-bold uppercase transition-colors"
                  >
                    KICK
                  </button>
                  <button 
                    onClick={() => handleBan(p.peerId)}
                    className="flex-1 border border-synth-dim text-synth-dim hover:bg-synth-void text-[8px] py-1 font-bold uppercase transition-colors"
                    title="BAN FROM SESSION"
                  >
                    BAN
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Reactions */}
      <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
        <div className="bg-[#313E17] px-4 py-2 border-b-[3px] border-[#4C5C2D]">
          <h3 className="font-heading text-xl font-black text-[#FFDE42] uppercase tracking-widest">Signals</h3>
        </div>
        <div className="p-3 grid grid-cols-3 gap-2">
          {['👍', '🔥', '😂', '💀', '💖', '👾'].map(emoji => (
            <button
              key={emoji}
              onClick={() => sendReaction(emoji)}
              className="text-2xl bg-[#1B0C0C] hover:bg-[#FFDE42] border-[2px] border-[#313E17] hover:border-[#1B0C0C] shadow-[3px_3px_0_#4C5C2D] py-3 transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center justify-center cursor-crosshair"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Host-only: Video Override */}
      {isHost && (
        <div className="border-[3px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#313E17]">
          <div className="bg-[#313E17] px-4 py-2 border-b-[3px] border-[#4C5C2D]">
            <h3 className="font-heading text-xl font-black text-[#FFDE42] uppercase tracking-widest">Override</h3>
          </div>
          <div className="p-3 flex flex-col gap-3">
            <input
              type="text"
              value={videoUrlInput}
              onChange={e => setVideoUrlInput(e.target.value)}
              placeholder="YOUTUBE URL..."
              className="w-full bg-[#1B0C0C] text-[#FFDE42] border-[2px] border-[#4C5C2D] p-3 font-mono text-sm font-bold placeholder:text-[#4C5C2D]/50 focus:outline-none focus:border-[#FFDE42] shadow-[3px_3px_0_#313E17] transition-colors"
            />
            {!syncedVideo ? (
              <button
                onClick={handleSyncVideo}
                disabled={!isConnected || !videoUrlInput}
                className="w-full bg-[#313E17] hover:bg-[#FFDE42] text-[#FFDE42] hover:text-[#1B0C0C] border-[2px] border-[#1B0C0C] disabled:opacity-40 py-3 text-base font-heading font-black tracking-widest uppercase transition-colors shadow-[4px_4px_0_#4C5C2D] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                Execute Transmission
              </button>
            ) : (
              <button
                onClick={handleStopVideo}
                className="w-full bg-red-600 hover:bg-red-500 text-white border-[2px] border-[#1B0C0C] py-3 text-base font-heading font-black tracking-widest uppercase transition-colors shadow-[4px_4px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                Halt Transmission
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col bg-[#1B0C0C] text-[#FFDE42] overflow-hidden" style={{ height: '100dvh' }}>
      {/* Noise texture overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none mix-blend-screen opacity-[0.06]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }} />

      {/* Floating Reactions */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {reactions.map(r => (
          <div key={r.id} className="absolute bottom-20 text-5xl animate-fly-up drop-shadow-2xl" style={{ left: `${r.left}%` }}>
            {r.emoji}
          </div>
        ))}
      </div>

      {/* ======== TOP HEADER ======== */}
      <header className="relative z-20 bg-[#1B0C0C] border-b-[4px] border-[#4C5C2D] flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="w-3 h-3 sm:w-4 sm:h-4 bg-[#FFDE42] border-2 border-[#1B0C0C] shadow-[2px_2px_0_#4C5C2D] shrink-0" />
          <h1 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-black text-[#FFDE42] uppercase tracking-widest truncate">
            {room.name}
          </h1>
          {isHost && <span className="shrink-0 text-[10px] font-heading font-black bg-[#FFDE42] text-[#1B0C0C] px-2 py-0.5 border border-[#1B0C0C] uppercase tracking-wider">HOST</span>}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Live badge */}
          <div className="hidden sm:flex items-center gap-2 bg-[#313E17] border-[3px] border-[#1B0C0C] shadow-[3px_3px_0_#4C5C2D] px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[#FFDE42] font-heading tracking-widest uppercase font-bold text-xs">LIVE</span>
          </div>
          {/* Participant count */}
          <div className="flex items-center gap-1.5 bg-[#313E17] border-[3px] border-[#1B0C0C] shadow-[3px_3px_0_#4C5C2D] px-3 py-1">
            <span className="text-[#FFDE42] font-heading font-bold text-xs sm:text-sm">👤 {remotePeers.length + 1}</span>
          </div>
          {/* Info panel toggle (mobile/tablet) */}
          <button
            onClick={() => setShowMobilePanel(v => !v)}
            className="lg:hidden bg-[#313E17] border-[3px] border-[#1B0C0C] shadow-[3px_3px_0_#4C5C2D] w-9 h-9 flex items-center justify-center text-[#FFDE42] font-heading font-black text-lg hover:bg-[#4C5C2D] transition-colors"
            title="Toggle Info Panel"
          >
            ≡
          </button>
          {/* User info (desktop) */}
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-[#4C5C2D] font-heading text-sm font-bold uppercase tracking-wider">{user?.username}</span>
            <button onClick={logout} className="text-[10px] text-[#FFDE42] border-[2px] border-[#4C5C2D] px-2 py-1 font-heading font-bold uppercase hover:bg-[#4C5C2D] transition-colors">SIGN OUT</button>
          </div>
        </div>
      </header>

      {/* ======== MAIN BODY ======== */}
      <div className="flex-1 flex overflow-hidden relative z-10" style={{ minHeight: 0 }}>

        {/* ---- VIDEO AREA ---- */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          
          {/* Scrollable video grid */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-3 pb-24" style={{ minHeight: 0 }}>

            {/* Pinned / Speaker view */}
            {pinnedId && (
              <div className="relative group border-[4px] border-[#FFDE42] bg-[#1B0C0C] shadow-[8px_8px_0_#4C5C2D] overflow-hidden mb-3" style={{ aspectRatio: '16/9' }}>
                <div className="absolute top-0 left-0 bg-[#FFDE42] text-[#1B0C0C] font-heading px-3 py-1 text-sm font-bold border-b-[3px] border-r-[3px] border-[#1B0C0C] z-10">
                  📌 PINNED
                </div>
                <div className="absolute inset-0">
                  {pinnedId === 'local' ? (
                    <VideoMonitor stream={localStream} muted={true} label={isHost ? 'YOU (HOST)' : 'YOU'} isLive={true} cameraEnabled={isCameraOn} />
                  ) : pinnedId === 'local-screen' && localScreenStream ? (
                    <VideoMonitor stream={localScreenStream} muted={true} label="YOUR SCREEN" isLive={true} />
                  ) : (
                    (() => {
                      const parts = pinnedId.split('-');
                      const pId = parts[0];
                      const sIdx = parseInt(parts[1]) || 0;
                      const peer = remotePeers.find(p => p.peerId === pId);
                      const stream = peer?.streams[sIdx];
                      return stream
                        ? <VideoMonitor stream={stream} muted={false} label={`PEER_${pId.slice(0,4)}${sIdx > 0 ? ' (SCR)' : ''}`} isLive={true} interactive={false} />
                        : null;
                    })()
                  )}
                </div>
                <button
                  onClick={() => setPinnedId(null)}
                  className="absolute top-2 right-2 bg-[#FFDE42] text-[#1B0C0C] border-[2px] border-[#1B0C0C] px-3 py-1 text-xs font-heading font-black uppercase shadow-[3px_3px_0_#1B0C0C] opacity-0 group-hover:opacity-100 transition-opacity active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                >
                  UNPIN
                </button>
              </div>
            )}

            {/* All video tiles grid */}
            <div className={`grid gap-2 sm:gap-3 ${gridColsClass}`}>
              {allTiles.map((tile: any) => (
                <div
                  key={tile.id}
                  className="relative group border-[3px] sm:border-[4px] border-[#313E17] bg-[#0f0a0a] overflow-hidden hover:border-[#FFDE42] transition-colors"
                  style={{ aspectRatio: '16/9' }}
                >
                  <div className="absolute inset-0">
                    {tile.element}
                  </div>
                  {/* Raised hand badge */}
                  {tile.raised && (
                    <div className="absolute top-0 right-0 bg-[#FFDE42] text-[#1B0C0C] font-heading font-black px-2 py-1 text-base border-b-[2px] border-l-[2px] border-[#1B0C0C] z-10 animate-bounce">✋</div>
                  )}
                  {/* Focus button */}
                  <button
                    onClick={() => setPinnedId(tile.id)}
                    className="absolute top-2 left-2 bg-[#FFDE42] text-[#1B0C0C] border-[2px] border-[#1B0C0C] px-2 py-1 text-[10px] font-heading font-black uppercase shadow-[2px_2px_0_#1B0C0C] opacity-0 group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity active:shadow-none"
                  >
                    FOCUS
                  </button>
                  {/* Host controls on peer tiles */}
                  {isHost && tile.labelIdx === 0 && tile.peerId && (
                    /*                     <div className="absolute bottom-8 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 scale-90 sm:scale-100 origin-right">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMute(tile.peerId); }} 
                        className="bg-[#1B0C0C] hover:bg-red-900/40 text-red-400 border-[2px] border-[#313E17] px-2 py-1 text-[10px] font-heading font-bold uppercase transition-colors"
                      >
                        MUTE
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleKick(tile.peerId); }} 
                        className="bg-red-700 hover:bg-red-600 text-white border-[2px] border-[#1B0C0C] px-2 py-1 text-[10px] font-heading font-bold uppercase transition-colors"
                      >
                        KICK
                      </button>
                    </div>     </div> */
                    <div className="absolute bottom-8 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 scale-90 sm:scale-100 origin-right">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMute(tile.peerId); }} 
                        className="bg-[#1B0C0C] hover:bg-red-900/40 text-red-400 border-[2px] border-[#313E17] px-2 py-1 text-[10px] font-heading font-bold uppercase transition-colors"
                      >
                        MUTE
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleKick(tile.peerId); }} 
                        className="bg-red-700 hover:bg-red-600 text-white border-[2px] border-[#1B0C0C] px-2 py-1 text-[10px] font-heading font-bold uppercase transition-colors"
                      >
                        KICK
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Synced Video */}
              {syncedVideo && (
                <div className="relative border-[3px] sm:border-[4px] border-[#4C5C2D] bg-[#1B0C0C] shadow-[4px_4px_0_#FFDE42] overflow-hidden col-span-full" style={{ aspectRatio: '16/9' }}>
                  <div className="absolute top-0 left-0 bg-[#FFDE42] text-[#1B0C0C] font-heading px-3 py-1 text-xs font-bold border-b-[2px] border-r-[2px] border-[#1B0C0C] z-10">📡 BROADCAST</div>
                  <iframe src={syncedVideo.url} className="w-full h-full border-none" allow="autoplay; fullscreen" />
                </div>
              )}
            </div>
          </div>

          {/* ======== CONTROL DOCK (bottom bar — full width on mobile) ======== */}
          <div className="absolute bottom-0 left-0 right-0 z-30 bg-[#313E17] border-t-[4px] border-[#1B0C0C] shadow-[0_-4px_0_#4C5C2D]">
            {/* Mobile layout: icon-only small buttons */}
            <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 gap-1.5 sm:gap-3 max-w-screen-xl mx-auto">

              {/* Connection dot */}
              <div className={`w-2.5 h-2.5 rounded-full border-2 border-[#1B0C0C] shrink-0 ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-600'}`} title={isConnected ? 'Connected' : 'Disconnected'} />

              {/* Control buttons */}
              <div className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2">
                {/* MIC */}
                <button
                  onClick={toggleMic}
                  className={`flex flex-col items-center justify-center gap-0.5 px-3 sm:px-4 py-2 sm:py-2.5 border-[3px] border-[#1B0C0C] font-heading font-black text-xs sm:text-sm uppercase tracking-widest transition-transform shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none min-w-[52px] sm:min-w-[70px] ${isMicOn ? 'bg-[#FFDE42] text-[#1B0C0C]' : 'bg-[#1B0C0C] text-red-400'}`}
                  title={isMicOn ? 'Mute' : 'Unmute'}
                >
                  <span className="text-lg sm:text-xl">{isMicOn ? '🎤' : '🔇'}</span>
                  <span className="hidden sm:block text-[9px] tracking-widest">{isMicOn ? 'MUTE' : 'UNMUTE'}</span>
                </button>

                {/* CAM */}
                <button
                  onClick={toggleCamera}
                  className={`flex flex-col items-center justify-center gap-0.5 px-3 sm:px-4 py-2 sm:py-2.5 border-[3px] border-[#1B0C0C] font-heading font-black text-xs sm:text-sm uppercase tracking-widest transition-transform shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none min-w-[52px] sm:min-w-[70px] ${isCameraOn ? 'bg-[#FFDE42] text-[#1B0C0C]' : 'bg-[#1B0C0C] text-red-400'}`}
                  title={isCameraOn ? 'Stop Camera' : 'Start Camera'}
                >
                  <span className="text-lg sm:text-xl">{isCameraOn ? '📷' : '📵'}</span>
                  <span className="hidden sm:block text-[9px] tracking-widest">{isCameraOn ? 'CAM ON' : 'CAM OFF'}</span>
                </button>

                {/* SCREEN */}
                <button
                  onClick={toggleScreenShare}
                  className={`flex flex-col items-center justify-center gap-0.5 px-3 sm:px-4 py-2 sm:py-2.5 border-[3px] border-[#1B0C0C] font-heading font-black text-xs sm:text-sm uppercase tracking-widest transition-transform shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none min-w-[52px] sm:min-w-[70px] ${isScreenOn ? 'bg-[#4C5C2D] text-[#FFDE42]' : 'bg-[#1B0C0C] text-[#FFDE42]'}`}
                  title={isScreenOn ? 'Stop Share' : 'Share Screen'}
                >
                  <span className="text-lg sm:text-xl">🖥️</span>
                  <span className="hidden sm:block text-[9px] tracking-widest">{isScreenOn ? 'SCR ON' : 'SHARE'}</span>
                </button>

                {/* HAND */}
                <button
                  onClick={toggleHand}
                  className={`flex flex-col items-center justify-center gap-0.5 px-3 sm:px-4 py-2 sm:py-2.5 border-[3px] border-[#1B0C0C] font-heading font-black text-xs sm:text-sm uppercase transition-transform shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none min-w-[52px] sm:min-w-[70px] ${isHandRaised ? 'bg-[#FFDE42] text-[#1B0C0C] animate-bounce' : 'bg-[#1B0C0C] text-[#FFDE42]'}`}
                  title={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
                >
                  <span className="text-lg sm:text-xl">✋</span>
                  <span className="hidden sm:block text-[9px] tracking-widest">HAND</span>
                </button>

                {/* Quick reactions (sm+) */}
                <div className="hidden sm:flex gap-1">
                  {['👍','🔥','😂'].map(e => (
                    <button key={e} onClick={() => sendReaction(e)} className="w-10 h-10 lg:w-12 lg:h-12 flex items-center justify-center text-lg lg:text-xl bg-[#1B0C0C] border-[2px] border-[#4C5C2D] hover:bg-[#4C5C2D] shadow-[2px_2px_0_#1B0C0C] transition-colors active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* LEAVE/END */}
              <button
                onClick={exitSequence}
                className="flex flex-col items-center justify-center gap-0.5 px-3 sm:px-5 py-2 sm:py-2.5 bg-red-600 hover:bg-red-500 text-white border-[3px] border-[#1B0C0C] font-heading font-black text-xs sm:text-sm uppercase tracking-widest transition-transform shadow-[3px_3px_0_#1B0C0C] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shrink-0"
              >
                <span className="text-lg sm:text-xl">🚪</span>
                <span className="text-[9px] sm:text-xs">{isHost ? 'END' : 'LEAVE'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ======== DESKTOP SIDEBAR ======== */}
        <aside className="hidden lg:flex w-[340px] xl:w-[380px] shrink-0 flex-col border-l-[4px] border-[#4C5C2D] bg-[#1B0C0C] overflow-hidden">
          <SidePanel />
        </aside>

        {/* ======== MOBILE/TABLET SLIDE-UP PANEL ======== */}
        {showMobilePanel && (
          <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setShowMobilePanel(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative z-50 bg-[#1B0C0C] border-t-[4px] border-[#4C5C2D] shadow-[0_-8px_0_#313E17] max-h-[70vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-[#4C5C2D] bg-[#313E17]">
                <h2 className="font-heading text-xl font-black text-[#FFDE42] uppercase tracking-widest">ROOM INFO</h2>
                <button onClick={() => setShowMobilePanel(false)} className="text-[#FFDE42] text-2xl font-heading font-black w-8 h-8 flex items-center justify-center border-[2px] border-[#4C5C2D] hover:bg-[#4C5C2D]">✕</button>
              </div>
              <div className="overflow-y-auto flex-1">
                <SidePanel />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fly-up {
          0% { transform: translateY(80px) scale(0.5); opacity: 0; }
          10% { opacity: 1; transform: translateY(0) scale(1.2); }
          50% { transform: translateY(-40vh) scale(1) rotate(10deg); }
          100% { transform: translateY(-80vh); opacity: 0; }
        }
        .animate-fly-up { animation: fly-up 4s ease-out forwards; }
      `}} />
    </div>
  );
}
