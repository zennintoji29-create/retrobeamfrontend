'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetroCard from '@/components/RetroCard';
import RetroInput from '@/components/RetroInput';
import RetroButton from '@/components/RetroButton';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function CreateRoom() {
  const { user, loading, logout } = useAuth(true); // Must be logged in
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [streamType, setStreamType] = useState('camera');
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  if (loading) return <div className="min-h-[100dvh] flex items-center justify-center font-sans text-brand-gray bg-brand-base text-brand-white">Initializing Interface...</div>;
  if (!user) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.post('/rooms/create', {
        name: name || `${user.username}'s Room`,
        password: password || undefined,
        streamType,
        maxParticipants: Number(maxParticipants)
      });
      router.push(`/room/${res.data.roomId}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to initialize session');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-brand-base text-brand-white">
      <Navbar user={user} logout={logout} />
      <main className="flex-1 flex items-center justify-center p-6">
        <RetroCard className="w-full max-w-lg">
          <div className="flex flex-col gap-2 mb-8">
            <h1 className="text-2xl font-sans font-bold tracking-tight text-white drop-shadow-sm">Create Session</h1>
            <p className="text-brand-gray text-sm">Configure your new secure meeting context.</p>
          </div>

          <form onSubmit={handleCreate} className="flex flex-col gap-5">
            <RetroInput 
              label="Room Alias" 
              placeholder={`${user.username}'s Session`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <RetroInput 
              label="Room Password (Optional)" 
              type="password"
              placeholder="Leave blank for public room"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex flex-col gap-2">
              <label className="text-brand-gray font-sans text-xs font-semibold tracking-widest uppercase">Stream Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer font-sans bg-brand-surface-2/40 px-4 py-3 rounded-xl border border-brand-border flex-1 border-opacity-70 hover:border-brand-accent/50 transition-colors">
                  <input 
                    type="radio" 
                    value="camera" 
                    checked={streamType === 'camera'} 
                    onChange={() => setStreamType('camera')}
                    className="accent-brand-accent w-4 h-4 cursor-pointer"
                  />
                  <span className="text-brand-white text-sm font-medium">Camera</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-sans bg-brand-surface-2/40 px-4 py-3 rounded-xl border border-brand-border flex-1 border-opacity-70 hover:border-brand-accent/50 transition-colors">
                  <input 
                    type="radio" 
                    value="screen" 
                    checked={streamType === 'screen'} 
                    onChange={() => setStreamType('screen')}
                    className="accent-brand-accent w-4 h-4 cursor-pointer"
                  />
                  <span className="text-brand-white text-sm font-medium">Screen Share</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-brand-gray font-sans text-xs font-semibold tracking-widest uppercase">Max Peers</label>
              <RetroInput 
                label=""
                type="number"
                min="2"
                max="50"
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(Number(e.target.value))}
                className="!mb-0"
              />
            </div>

            {error && <div className="text-brand-danger bg-brand-danger/10 p-3 rounded-xl border border-brand-danger/20 text-sm font-medium animate-pulse mt-2">{error}</div>}

            <RetroButton type="submit" fullWidth disabled={isSubmitting} className="mt-4 text-base shadow-lg">
              {isSubmitting ? 'Establishing Link...' : 'Create Room'}
            </RetroButton>
          </form>
        </RetroCard>
      </main>
    </div>
  );
}
