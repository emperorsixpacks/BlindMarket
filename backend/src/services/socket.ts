import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type { CorsOptions } from 'cors';

let io: SocketServer | null = null;

export function initSocket(httpServer: HttpServer, corsOptions: CorsOptions): SocketServer {
  io = new SocketServer(httpServer, { cors: corsOptions });

  io.on('connection', (socket) => {
    // Client joins a room by emitting 'join'
    socket.on('join', (room: string) => {
      socket.join(room);
    });

    socket.on('leave', (room: string) => {
      socket.leave(room);
    });
  });

  return io;
}

export function emit(room: string, event: string, data: unknown): void {
  io?.to(room).emit(event, data);
}

// Convenience emitters per room
export const rooms = {
  platform: (event: string, data: unknown) => emit('platform', event, data),
  tasks:    (event: string, data: unknown) => emit('tasks', event, data),
  disputes: (event: string, data: unknown) => emit('disputes', event, data),
  task:     (id: string | number, event: string, data: unknown) => emit(`task:${id}`, event, data),
};
