import { useEffect, useState, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket } from '../lib/socket';

// ─────────────────────────────────────────────────────────────────────────────
// useSocket
//
// FIX (Bug 9 — socket passed to useMeshWebRTC before connected):
//   The original hook called setSocket(s) immediately after getSocket(),
//   which caused RoomView to pass the socket object to useMeshWebRTC right
//   away. useMeshWebRTC's useEffect saw a non-null socket and immediately
//   emitted 'peer:join' — but the socket was NOT yet connected (autoConnect
//   is false and connect() hadn't been called yet). The server never received
//   peer:join, so no peer connections were ever established.
//
//   Fix: Only expose the socket to consumers (via state) AFTER it has
//   actually connected. Until then, return null. This means useMeshWebRTC's
//   useEffect won't fire until the socket is genuinely ready.
//
// FIX (Bug 10 — isConnected flickers on token change):
//   The token prop changes when a guest joins with a token. The original
//   code had `[token]` in the dependency array, which caused the entire
//   effect to re-run — teardown + re-setup — on every token change, even
//   if the socket was already live. This momentarily set socket to null,
//   which destroyed all peer connections.
//
//   Fix: Use a ref for the token so it can be updated without re-running
//   the effect. The token is only needed at socket creation time (handled
//   by getSocket) and on reconnect (handled by socket.auth mutation in
//   getSocket). The effect only runs once on mount.
// ─────────────────────────────────────────────────────────────────────────────
export function useSocket(token?: string) {
  // FIX (Bug 9): Start as null — only set to the real socket once connected
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Keep token in a ref so we can update it without re-running the effect
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    // FIX (Bug 7 + 9): getSocket now embeds the token in the handshake.
    // We call it once and never recreate the socket during the session.
    const s = getSocket(tokenRef.current);

    const onConnect = () => {
      setIsConnected(true);
      // FIX (Bug 9): Expose socket to consumers ONLY after it's connected.
      // This prevents useMeshWebRTC from emitting peer:join on an unconnected socket.
      setSocket(s);
    };

    const onDisconnect = () => {
      setIsConnected(false);
      // FIX: Do NOT null out the socket on disconnect — the socket object
      // is still valid and will reconnect. Nulling it out causes
      // useMeshWebRTC to tear down all peer connections unnecessarily.
      // The hook's own reconnection logic handles the re-join.
    };

    const onConnectError = (err: Error) => {
      console.error('[useSocket] connect_error:', err.message);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);

    // If somehow already connected (e.g. HMR, shared singleton),
    // resolve immediately without waiting for the 'connect' event
    if (s.connected) {
      setIsConnected(true);
      setSocket(s);
    } else {
      s.connect();
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      // Do NOT disconnect here — the socket is a singleton shared across
      // the app. Disconnecting on unmount kills it for everyone.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — socket is a singleton, runs once on mount

  return { socket, isConnected };
}