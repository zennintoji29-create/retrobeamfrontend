'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import RoomView from './RoomView';

export default function RoomPage() {
  const params = useParams() as { roomId: string };
  const { user, loading } = useAuth();
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
          setError('ROOM NOT FOUND');
        } else if (err.response?.status === 401) {
          router.push('/join');
        } else {
          setError('COMMUNICATION ERROR');
        }
      } finally {
        setFetching(false);
      }
    };
    
    fetchRoom();
  }, [params.roomId, loading, router]);

  if (loading || fetching) return <div className="min-h-screen p-6 font-mono text-retro-dim bg-retro-bg">SECURING CONNECTION...</div>;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-retro-bg font-mono text-retro-red uppercase">
        {`! ${error}`}
      </div>
    );
  }

  const isBroadcaster = user && room && user.id === room.hostId;
  const joinToken = typeof window !== 'undefined' ? sessionStorage.getItem(`joinToken_${params.roomId}`) : null;
  
  if (!isBroadcaster && !joinToken && user?.id !== room.hostId) {
    router.push('/join');
    return null;
  }

  const isHost = isBroadcaster || (user && room && user.id === room.hostId);

  return <RoomView room={room} isHost={!!isHost} joinToken={joinToken || undefined} />;
}
