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
  const { user, loading, logout } = useAuth(true);
  const router = useRouter();
  
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [streamType, setStreamType] = useState('screen');
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.post('/rooms/create', { 
        name, 
        password, 
        streamType, 
        videoUrl: streamType === 'video' ? videoUrl : undefined 
      });
      router.push(`/room/${res.data.room.roomId}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'FAILED TO INITIALIZE ROOM');
      setIsSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen flex flex-col bg-synth-void">
      <Navbar user={user} logout={logout} />
      <main className="flex-1 flex items-center justify-center p-6">
        <RetroCard className="w-full max-w-lg">
          <h1 className="text-2xl font-heading tracking-widest text-synth-cyan mb-6 glow-text">{`> INITIALIZE NEW BROADCAST`}</h1>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <RetroInput 
              label="TRANSMISSION TITLE" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            
            <RetroInput 
              label="SECURITY KEY (OPTIONAL)" 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="mb-4">
              <label className="text-synth-dim font-body mb-2 uppercase text-sm block">TRANSMISSION SOURCE_</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 border border-synth-cyan flex items-center justify-center ${streamType === 'screen' ? 'bg-retro-green/20' : ''}`}>
                    {streamType === 'screen' && <div className="w-2 h-2 bg-retro-green" />}
                  </div>
                  <input 
                    type="radio" 
                    name="streamType" 
                    value="screen" 
                    checked={streamType === 'screen'} 
                    onChange={() => setStreamType('screen')}
                    className="hidden" 
                  />
                  <span className="font-body text-synth-cyan group-hover:glow-text">SCREEN SHARE</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 border border-synth-cyan flex items-center justify-center ${streamType === 'video' ? 'bg-retro-green/20' : ''}`}>
                    {streamType === 'video' && <div className="w-2 h-2 bg-retro-green" />}
                  </div>
                  <input 
                    type="radio" 
                    name="streamType" 
                    value="video" 
                    checked={streamType === 'video'} 
                    onChange={() => setStreamType('video')}
                    className="hidden" 
                  />
                  <span className="font-body text-synth-cyan group-hover:glow-text">VIDEO URL</span>
                </label>
              </div>
            </div>

            {streamType === 'video' && (
              <RetroInput 
                label="VIDEO SOURCE URL" 
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                required={streamType === 'video'}
              />
            )}

            {error && <div className="text-synth-cyan animate-pulse mb-4 text-sm font-body">{`! ERROR: ${error}`}</div>}
            
            <RetroButton type="submit" fullWidth disabled={isSubmitting}>
              {isSubmitting ? 'INITIALIZING...' : 'LAUNCH TRANSMISSION'}
            </RetroButton>
          </form>
        </RetroCard>
      </main>
    </div>
  );
}
