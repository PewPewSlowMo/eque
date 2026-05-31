import { io, Socket } from 'socket.io-client';

export type AuthMode =
  | { kind: 'staff'; token: string }
  | { kind: 'board'; slug: string };

let socket: Socket | null = null;
let currentMode: AuthMode | null = null;

function sameMode(a: AuthMode, b: AuthMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'staff' && b.kind === 'staff') return a.token === b.token;
  if (a.kind === 'board' && b.kind === 'board') return a.slug === b.slug;
  return false;
}

export function getSocket(mode: AuthMode): Socket {
  if (socket && currentMode && sameMode(currentMode, mode)) return socket;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentMode = mode;
  socket = io(import.meta.env.VITE_WS_URL || 'http://localhost:3002', {
    transports: ['websocket'],
    autoConnect: true,
    auth: mode.kind === 'staff'
      ? { token: mode.token }
      : { boardSlug: mode.slug },
  });

  const triggerUnauthorizedReload = () => {
    // Не зацикливать ретрай — отключаемся и форсируем reload для подхвата нового кода/токена
    socket?.disconnect();
    socket = null;
    currentMode = null;
    // Чуть-чуть задержки чтобы не сделать reload до того, как пользователь успел увидеть UI
    setTimeout(() => window.location.reload(), 1000);
  };

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized' || err.message?.startsWith?.('unauthorized')) {
      triggerUnauthorizedReload();
    }
  });

  // Сервер шлёт custom 'unauthorized' event перед disconnect (вместо зарезервированного 'connect_error').
  // Слушаем оба варианта для надёжности.
  socket.on('unauthorized', (info) => {
    console.log('[WS] Server rejected connection:', info?.message ?? '(no message)');
    triggerUnauthorizedReload();
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  currentMode = null;
}
