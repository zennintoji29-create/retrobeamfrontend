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

  if (loading || fetching) return <div className="min-h-screen p-6 font-body text-synth-dim bg-synth-void">LOADING COMMAND CENTER...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-synth-void">
      <Navbar user={user} logout={logout} />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <h1 className="text-3xl font-heading tracking-widest text-synth-cyan glow-text uppercase">{`> COMMAND CENTER`}</h1>
          <Link href="/room/create">
            <RetroButton>+ NEW BROADCAST</RetroButton>
          </Link>
        </div>

        {rooms.length === 0 ? (
          <div className="text-synth-dim font-body border border-white/10/30 p-8 text-center glass-panel">
            {`> NO ACTIVE BROADCASTS DETECTED.`}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rooms.map(room => (
              <RetroCard key={room.roomId} className="flex flex-col h-full hover:shadow-[0_0_20px_rgba(0,255,65,0.2)] transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-body text-synth-cyan truncate" title={room.name}>{room.name}</h2>
                  <StatusBadge isLive={room.isActive} />
                </div>
                <div className="font-body text-sm text-synth-dim mb-2">ID: {room.roomId}</div>
                <div className="font-body text-sm text-synth-dim mb-4">TYPE: {room.streamType.toUpperCase()}</div>
                <div className="font-body text-sm text-synth-dim mb-6">VIEWERS: {room.viewerCount || 0}</div>
                <div className="mt-auto flex gap-2">
                  <Link href={`/room/${room.roomId}`} className="flex-1">
                    <RetroButton variant="ghost" fullWidth className="border border-synth-cyan">
                      {room.isActive ? 'MONITOR' : 'LAUNCH'}
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
                    className="px-3 border border-synth-red text-synth-red hover:bg-synth-red hover:text-white transition-colors uppercase font-bold text-xs rounded"
                    title="Delete Room History"
                  >
                    DEL
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
