'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import RoomView from './RoomView';

export default function RoomPage() {
  const params = useParams() as { roomId: string };
  const { user, loading } = useAuth(true);
  const router = useRouter();
  
  const [room, setRoom] = useState<any>(null);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (loading) return;

    const fetchRoom = async () => {
      try {
        const res = await api.get(`/rooms/${params.roomId}`);
        setRoom(res.data.room);
      } catch (err: any) {
        if (err.response?.status === 404) {
          setError('Room not found');
        } else if (err.response?.status === 401) {
          router.push('/join');
        } else {
          setError('Connection error');
        }
      } finally {
        setFetching(false);
      }
    };
    
    fetchRoom();
  }, [params.roomId, loading, router]);

  if (loading || fetching) return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-brand-base text-brand-gray font-sans text-sm">
      Securing connection...
    </div>
  );

  if (error) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-brand-base text-brand-white">
        <div className="text-brand-danger font-semibold text-lg">{error}</div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-brand-accent hover:text-brand-accent-hover text-sm font-medium transition-colors"
        >
          ← Return to Dashboard
        </button>
      </div>
    );
  }

  const isHost = user && room && user.id === room.hostId;

  if (!user && !loading) return null;

  return <RoomView room={room} isHost={!!isHost} />;
}
