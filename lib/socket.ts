import { io, Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON SOCKET
//
// FIX (Bug 7 — token race): The original code set socket.auth AFTER the
// socket object was created and potentially already connected (on re-calls
// with a reused instance). For guest users the token arrived AFTER the
// first connect attempt, meaning the server received an unauthenticated
// handshake, rejected it or gave a different socket.id, and then the
// WebRTC peer:join was emitted with the wrong/missing identity.
//
// Fix: Accept token at creation time and embed it in the io() options so
// it is included in the very first handshake. On subsequent calls where
// the socket already exists, update auth and re-auth via socket.auth —
// this is safe because the socket is not yet connected when getSocket()
// is first called (autoConnect: false).
//
// FIX (Bug 8 — stale singleton after disconnect): disconnectSocket() sets
// socket = null. If getSocket() is called again afterwards (e.g. re-joining
// a room) a fresh socket is created correctly with the new token.
// ─────────────────────────────────────────────────────────────────────────────
let socket: Socket | null = null;

export const getSocket = (token?: string): Socket => {
  if (!socket) {
    // FIX (Bug 7): Pass auth in the io() constructor so it is part of the
    // initial HTTP handshake, not set after the fact.
    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000', {
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      // FIX: auth goes here — in the constructor — not set separately later
      auth: token ? { token } : {},
      transports: ['websocket', 'polling'],
    });
  } else if (token && socket.auth) {
    // Socket already exists — update auth for future reconnections.
    // This is safe: socket.auth is read on every (re)connect attempt.
    (socket.auth as Record<string, string>).token = token;
  }

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};