'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import RetroCard from '@/components/RetroCard';
import RetroButton from '@/components/RetroButton';
import StatusBadge from '@/components/StatusBadge';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function Dashboard() {
  const { user, loading, logout } = useAuth(true);
  const [rooms, setRooms] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (user) {
      api.get('/rooms/user/all')
        .then(res => {
          setRooms(res.data.rooms);
          setFetching(false);
        })
        .catch(err => {
          console.error(err);
          setFetching(false);
        });
    }
  }, [user]);

  if (loading || fetching) return <div className="min-h-[100dvh] flex items-center justify-center font-sans text-brand-gray bg-brand-base">Loading Command Center...</div>;
  if (!user) return null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-brand-base text-brand-white">
      <Navbar user={user} logout={logout} />
      <main className="flex-1 p-6 md:p-12 max-w-7xl mx-auto w-full flex flex-col gap-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-sans font-bold tracking-tight text-white">Broadcast Center</h1>
            <p className="text-brand-gray text-sm font-medium">Manage and access your active rooms.</p>
          </div>
          <Link href="/room/create">
            <RetroButton>+ Create Room</RetroButton>
          </Link>
        </div>

        {rooms.length === 0 ? (
          <div className="text-brand-gray text-sm font-sans border border-brand-border/50 py-16 px-6 rounded-2xl text-center glass-panel bg-brand-surface-2/20">
            No active broadcasts detected. Start a new session to begin.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rooms.map(room => (
              <RetroCard key={room.roomId} className="flex flex-col h-full hover:shadow-lg transition-shadow bg-[#0a0a0b]">
                <div className="flex justify-between items-start mb-5">
                  <h2 className="text-lg font-bold font-sans text-brand-white truncate tracking-tight pr-4" title={room.name}>{room.name}</h2>
                  <StatusBadge isLive={room.isActive} />
                </div>
                
                <div className="flex flex-col gap-2 mb-8">
                  <div className="flex justify-between items-center bg-brand-surface-2/40 px-3 py-2 rounded-lg border border-brand-border/30">
                    <span className="font-sans text-xs font-medium text-brand-gray tracking-wide">ID</span>
                    <span className="font-sans text-xs font-semibold text-brand-white">{room.roomId}</span>
                  </div>
                  <div className="flex justify-between items-center bg-brand-surface-2/40 px-3 py-2 rounded-lg border border-brand-border/30">
                    <span className="font-sans text-xs font-medium text-brand-gray tracking-wide">Type</span>
                    <span className="font-sans text-xs font-medium text-brand-white bg-brand-accent/20 text-brand-accent px-2 py-0.5 rounded-md uppercase">{room.streamType}</span>
                  </div>
                  <div className="flex justify-between items-center bg-brand-surface-2/40 px-3 py-2 rounded-lg border border-brand-border/30">
                    <span className="font-sans text-xs font-medium text-brand-gray tracking-wide">Viewers</span>
                    <span className="font-sans text-xs font-semibold text-brand-white">{room.viewerCount || 0}</span>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-brand-border/40 flex gap-2">
                  <Link href={`/room/${room.roomId}`} className="flex-1">
                    <RetroButton variant="primary" fullWidth className="!py-2">
                      {room.isActive ? 'Monitor' : 'Launch'}
                    </RetroButton>
                  </Link>
                  <button 
                    onClick={async () => {
                      if(confirm('Are you sure you want to delete this room history?')) {
                        try {
                          await api.delete(`/rooms/${room.roomId}`);
                          setRooms(prev => prev.filter(r => r.roomId !== room.roomId));
                        } catch (err) {
                          alert('Failed to delete room');
                        }
                      }
                    }}
                    className="flex items-center justify-center px-4 bg-brand-danger/10 text-brand-danger hover:bg-brand-danger hover:text-white transition-colors uppercase font-bold text-xs rounded-xl shadow-sm active:scale-95"
                    title="Delete Room History"
                  >
                    Del
                  </button>
                </div>
              </RetroCard>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
