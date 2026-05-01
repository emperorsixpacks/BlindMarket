import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { autoConnect: true, reconnectionDelay: 2000 });
  }
  return socket;
}

/**
 * Join a room and listen for events.
 * @param room   Room name to join (e.g. 'platform', 'tasks', 'disputes', 'task:1')
 * @param events Map of event name → handler
 */
export function useSocket(room: string, events: Record<string, (data: unknown) => void>) {
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    const s = getSocket();
    s.emit('join', room);

    const handlers: Array<[string, (data: unknown) => void]> = Object.entries(eventsRef.current).map(
      ([event, _]) => {
        const handler = (data: unknown) => eventsRef.current[event]?.(data);
        s.on(event, handler);
        return [event, handler];
      }
    );

    return () => {
      s.emit('leave', room);
      handlers.forEach(([event, handler]) => s.off(event, handler));
    };
  }, [room]);
}
