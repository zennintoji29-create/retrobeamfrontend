'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetroCard from '@/components/RetroCard';
import RetroInput from '@/components/RetroInput';
import RetroButton from '@/components/RetroButton';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function Join() {
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const { user, loading } = useAuth(); // Auth is optional for landing, but required to join

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      router.push('/auth/login');
      return;
    }
    try {
      await api.get(`/rooms/${roomId}`);
      router.push(`/room/${roomId}`);
    } catch (err) {
      setError('Room not found or unauthorized');
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-brand-base text-brand-white">
      <Navbar user={user} />
      <main className="flex-1 flex items-center justify-center p-6">
        <RetroCard className="w-full max-w-md">
          <div className="flex flex-col gap-2 mb-8">
            <h1 className="text-2xl font-sans font-bold tracking-tight text-white drop-shadow-sm">Join a session</h1>
            <p className="text-brand-gray text-sm">Enter the secure room ID to connect.</p>
          </div>

          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <RetroInput 
              label="Room ID" 
              placeholder="e.g. xk7m2"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            />
            
            {error && <div className="text-brand-danger bg-brand-danger/10 p-3 rounded-xl border border-brand-danger/20 text-sm font-medium animate-pulse mb-2">{error}</div>}
            
            <RetroButton type="submit" fullWidth className="mt-2 text-base shadow-lg">Connect</RetroButton>
          </form>
        </RetroCard>
      </main>
    </div>
  );
}
