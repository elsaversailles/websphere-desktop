import { io, type Socket } from 'socket.io-client';
import { getAccessToken, request, socketBaseUrl } from '../api';

type Scope = 'group' | 'project';
let connection: Socket | undefined;
const rooms = new Map<string, { scope: Scope; id: string; listeners: number }>();

function workspaceSocket() {
  if (connection) return connection;
  const socket = io(socketBaseUrl(), {
    path: '/socket.io',
    auth: (callback) => callback({ token: getAccessToken() }),
    autoConnect: false,
  });
  socket.on('connect', () => {
    for (const room of rooms.values()) socket.emit(`${room.scope}:join`, room.id, () => undefined);
  });
  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    void request('/auth/session-valid').then(() => {
      if (connection === socket) socket.connect();
    }).catch(() => undefined);
  });
  connection = socket;
  socket.connect();
  return socket;
}

export function closeWorkspaceSocket() {
  const socket = connection;
  connection = undefined;
  rooms.clear();
  socket?.disconnect();
}

type WorkspaceSubscription = { socket: Socket; on(event: string, handler: (...args: any[]) => void): void; join(scope: Scope, id: string): void; dispose(): void };

export function workspaceSubscription(): WorkspaceSubscription {
  const socket = workspaceSocket();
  const cleanups: Array<() => void> = [];
  return {
    socket,
    on(event: string, handler: (...args: any[]) => void) {
      socket.on(event, handler);
      cleanups.push(() => socket.off(event, handler));
      if (event === 'connect' && socket.connected) handler();
    },
    join(scope, id) {
      if (!id) return;
      const key = `${scope}:${id}`;
      const room = rooms.get(key) ?? { scope, id, listeners: 0 };
      if (room.listeners === 0 && socket.connected) socket.emit(`${scope}:join`, id, () => undefined);
      room.listeners += 1;
      rooms.set(key, room);
      cleanups.push(() => {
        room.listeners -= 1;
        if (room.listeners > 0 || rooms.get(key) !== room) return;
        rooms.delete(key);
        if (socket.connected) socket.emit(`${scope}:leave`, id, () => undefined);
      });
    },
    dispose() { cleanups.forEach((cleanup) => cleanup()); },
  };
}
