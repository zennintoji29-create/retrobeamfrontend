'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import RetroCard from '@/components/RetroCard';
import RetroInput from '@/components/RetroInput';
import RetroButton from '@/components/RetroButton';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function Join() {
  const { user, loading } = useAuth(true);
  const [roomId, setRoomId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/rooms/join/${roomId}`, { password });
      router.push(`/room/${roomId}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'ACCESS DENIED');
    }
  };

  if (loading) return <div className="min-h-screen p-6 font-mono text-retro-dim bg-synth-void">LOADING...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-synth-void">
      <Navbar user={user} />
      <main className="flex-1 flex items-center justify-center p-6 bg-synth-void">
        <RetroCard className="w-full max-w-md">
          <h1 className="text-2xl font-heading tracking-widest text-synth-cyan mb-6 glow-text">{`> CONNECT TO BROADCAST`}</h1>
          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <RetroInput 
              label="ROOM ID" 
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            />
            <RetroInput 
              label="PASSWORD (IF SECURED)" 
              type="password"
              placeholder="Leave blank if none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <div className="text-synth-cyan animate-pulse mb-4 text-sm font-body">{`! ERROR: ${error}`}</div>}
            <RetroButton type="submit" fullWidth>ESTABLISH CONNECTION</RetroButton>
          </form>
          <div className="mt-6 text-center text-synth-dim text-sm font-body">
            {`OR `}
            <Link href="/" className="text-synth-cyan hover:underline">RETURN TO MAIN MENU</Link>
          </div>
        </RetroCard>
      </main>
    </div>
  );
}
