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

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const { setUser } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', { username, password });
      setUser(res.data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'INVALID CREDENTIALS');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center p-6">
        <RetroCard className="w-full max-w-md">
          <h1 className="text-2xl font-heading tracking-widest text-synth-cyan mb-6 glow-text">{`> SYSTEM ACCESS`}</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <RetroInput 
              label="USERNAME" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <RetroInput 
              label="PASSWORD" 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <div className="text-synth-cyan animate-pulse mb-4 text-sm font-body">{`! ERROR: ${error}`}</div>}
            <RetroButton type="submit" fullWidth>AUTHENTICATE</RetroButton>
          </form>
          <div className="mt-6 text-center text-synth-dim text-sm font-body">
            {`NO ACCESS YET? `}
            <Link href="/auth/register" className="text-synth-cyan hover:underline">REGISTER</Link>
          </div>
        </RetroCard>
      </main>
    </div>
  );
}
