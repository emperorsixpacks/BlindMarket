import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type { CorsOptions } from 'cors';
import { verifyRegistrationToken } from '../middleware/auth.js';

let io: SocketServer | null = null;

// Rooms any client may join: broadcast feeds whose payloads are also served
// by unauthenticated REST endpoints.
const PUBLIC_ROOMS = new Set(['platform', 'tasks', 'disputes']);
// Per-task status rooms (numeric on-chain id or 0x task hash).
const TASK_ROOM = /^task:(\d+|0x[0-9a-fA-F]{64})$/;

/**
 * `agent:<address>` rooms carry targeted task offers, so joining requires
 * proving control of that address: the handshake must carry the agent's
 * platform/registration JWT (worker.js already sends it as
 * `auth: { token }`) whose `address` claim matches the room.
 */
export function canJoin(room: string, agentAddress: string | null): boolean {
  if (PUBLIC_ROOMS.has(room) || TASK_ROOM.test(room)) return true;
  if (room.startsWith('agent:')) {
    return !!agentAddress && room.toLowerCase() === `agent:${agentAddress}`;
  }
  // Unknown room shape (including raw socket ids) — never joinable.
  return false;
}

export function initSocket(httpServer: HttpServer, corsOptions: CorsOptions): SocketServer {
  io = new SocketServer(httpServer, { cors: corsOptions });

  io.on('connection', (socket) => {
    const token = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    const claims = typeof token === 'string' ? verifyRegistrationToken(token) : null;
    const agentAddress = claims?.address?.toLowerCase() ?? null;

    // Client joins a room by emitting 'join'
    socket.on('join', (room: unknown) => {
      if (typeof room !== 'string' || room.length > 128) return;
      if (canJoin(room, agentAddress)) {
        socket.join(room);
      } else {
        console.warn(`[socket] join denied: room=${room} authed=${agentAddress ?? 'anon'}`);
        socket.emit('join:denied', { room });
      }
    });

    socket.on('leave', (room: unknown) => {
      if (typeof room === 'string') socket.leave(room);
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

/**
 * Emit a scored offer to a specific agent.
 * The agent's WS client should join room `agent:<address>` at connect time.
 */
export function emitTaskOffer(
  agentAddress: string,
  taskId: string,
  meta: Record<string, unknown>,
  score: number,
  deadline: number,
): void {
  emit(`agent:${agentAddress.toLowerCase()}`, 'task:offer', {
    taskId,
    meta,
    score,
    expiresAt: deadline,
  });
}

/** Broadcast that a task is available for CAS-race (fallback when no offer taker). */
export function emitTaskAvailable(taskId: string, meta: Record<string, unknown>): void {
  rooms.tasks('task:available', { taskId, meta });
}
