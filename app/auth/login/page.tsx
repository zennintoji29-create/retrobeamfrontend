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
      setError(err.response?.data?.message || 'Invalid credentials');
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-brand-base text-brand-white">
      <Navbar />
      <main className="flex-1 flex items-center justify-center p-6">
        <RetroCard className="w-full max-w-sm">
          <div className="flex flex-col gap-2 mb-8">
            <h1 className="text-2xl font-sans font-bold tracking-tight text-white drop-shadow-sm">Sign in</h1>
            <p className="text-brand-gray text-sm">Welcome back to your dashboard.</p>
          </div>
          
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <RetroInput 
              label="Username" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <RetroInput 
              label="Password" 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            
            {error && <div className="text-brand-danger bg-brand-danger/10 p-3 rounded-xl border border-brand-danger/20 text-sm font-medium animate-pulse mb-2">{error}</div>}
            
            <RetroButton type="submit" fullWidth className="mt-2 text-base shadow-lg">Sign In</RetroButton>
          </form>
          
          <div className="mt-8 text-center text-brand-gray text-sm font-medium">
            Don&apos;t have an account?{' '}
            <Link href="/auth/register" className="text-brand-accent hover:text-brand-accent-hover font-semibold transition-colors">Create one</Link>
          </div>
        </RetroCard>
      </main>
    </div>
  );
}
