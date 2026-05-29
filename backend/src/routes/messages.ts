import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthRequest } from '../types.js';
import * as messageStore from '../services/messageStore.js';
import * as a2aStore from '../services/a2aStore.js';
import type { ApiResponse } from '../types.js';

export const messagesRouter = Router();

const sendSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
  taskId: z.string().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
});

/**
 * POST /api/v1/messages/send
 * Send a message from the authenticated user to another address.
 * Agents use this to message posters; posters use this to message agents.
 */
messagesRouter.post('/send', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const from = req.user!.address;
    const { to, taskId, subject, body } = sendSchema.parse(req.body);

    // If taskId provided, verify it exists and resolve the counterparty
    let resolvedTo = to.toLowerCase();
    if (taskId) {
      const state = await a2aStore.getState(taskId);
      if (!state) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });
        return;
      }
      // Auto-resolve "poster" or "agent" as shortcuts
      if (to.toLowerCase() === 'poster') {
        const meta = await a2aStore.getMeta(taskId);
        resolvedTo = meta?.posterAddress?.toLowerCase() ?? '';
        if (!resolvedTo) {
          res.status(400).json({ success: false, error: { code: 'NO_POSTER', message: 'Task poster address not found' } });
          return;
        }
      } else if (to.toLowerCase() === 'agent') {
        resolvedTo = state.executorAddress?.toLowerCase() ?? '';
        if (!resolvedTo) {
          res.status(400).json({ success: false, error: { code: 'NO_AGENT', message: 'No agent assigned to this task yet' } });
          return;
        }
      }
    }

    if (!resolvedTo) {
      res.status(400).json({ success: false, error: { code: 'BAD_ADDRESS', message: 'Invalid recipient address' } });
      return;
    }

    const msg = messageStore.sendMessage({ from, to: resolvedTo, taskId, subject, body });
    const bodyResp: ApiResponse = { success: true, data: msg };
    res.json(bodyResp);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/messages/inbox
 * Get messages addressed to the authenticated user.
 * Query params: taskId, unreadOnly, limit, offset
 */
messagesRouter.get('/inbox', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const address = req.user!.address;
    const taskId = req.query.taskId as string | undefined;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const result = messageStore.getInbox(address, { taskId, unreadOnly, limit, offset });
    const unread = messageStore.unreadCount(address);
    const body: ApiResponse = { success: true, data: { ...result, unread } };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/messages/sent
 * Get messages sent by the authenticated user.
 */
messagesRouter.get('/sent', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const address = req.user!.address;
    const taskId = req.query.taskId as string | undefined;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const result = messageStore.getSent(address, { taskId, limit, offset });
    const body: ApiResponse = { success: true, data: result };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/messages/thread/:taskId/:counterparty
 * Get the full conversation thread between two addresses for a task.
 */
messagesRouter.get('/thread/:taskId/:counterparty', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const address = req.user!.address;
    const { taskId, counterparty } = req.params;

    const messages = messageStore.getThread(address, counterparty, taskId);

    // Auto-mark as read
    const unreadIds = messages
      .filter(m => m.to_address === address.toLowerCase() && !m.read_at)
      .map(m => m.id);
    if (unreadIds.length) messageStore.markRead(address, unreadIds);

    const body: ApiResponse = { success: true, data: { messages, total: messages.length } };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/messages/read
 * Mark messages as read. If no messageIds provided, marks all as read.
 */
messagesRouter.post('/read', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const address = req.user!.address;
    const { messageIds } = req.body as { messageIds?: number[] };
    messageStore.markRead(address, messageIds);
    const unread = messageStore.unreadCount(address);
    const body: ApiResponse = { success: true, data: { unread } };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/messages/unread-count
 * Get unread message count for the authenticated user.
 */
messagesRouter.get('/unread-count', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const address = req.user!.address;
    const unread = messageStore.unreadCount(address);
    const body: ApiResponse = { success: true, data: { unread } };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
