import { useEffect, useState, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket } from '../lib/socket';

export function useSocket(token?: string) {
  const [isConnected, setIsConnected] = useState(false);

  // FIX — store socket in state, not just a ref.
  // Using only a ref means socketRef.current is always null on the
  // first render (the ref is populated inside useEffect, which runs
  // AFTER the component renders). Any consumer that destructures
  // `socket` from this hook gets null and never re-renders when the
  // socket connects. Storing it in state ensures consumers re-render
  // the moment the socket is ready.
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getSocket(token);
    socketRef.current = s;
    setSocket(s); // triggers re-render so consumers get the real socket

    const onConnect    = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    // Connect only if not already connected (getSocket may reuse an existing socket)
    if (!s.connected) s.connect();

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      // Do NOT disconnect here — the socket is shared across the app via getSocket().
      // Disconnecting on unmount would kill it for other consumers too.
    };
  }, [token]);

  return { socket, isConnected };
}