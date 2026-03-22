import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../lib/api';

export interface User {
  id: string;
  username: string;
  email: string;
}

export function useAuth(requireAuth = false) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await api.get('/auth/me');
        setUser(res.data.user);
      } catch (err) {
        setUser(null);
        if (requireAuth) {
          router.push('/auth/login');
        }
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [requireAuth, router]);

  const logout = async () => {
    try {
      await api.post('/auth/logout');
      setUser(null);
      router.push('/');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  return { user, loading, logout, setUser };
}
