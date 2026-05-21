import { get, authedGet, authedPost } from '../lib/api';
import type { OnChainTask, TaskMeta, Application, UnsignedTx } from '../types/api';

interface TasksResponse {
  tasks: TaskMeta[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export async function getOpenTasks(offset = 0, limit = 20): Promise<TaskMeta[]> {
  const res = await get<TasksResponse>(`/api/v1/tasks?offset=${offset}&limit=${limit}`);
  return res.tasks;
}

export async function getTask(taskId: string): Promise<{ onChain: OnChainTask; meta: TaskMeta }> {
  // Backend returns task fields at top level + nested meta
  const raw = await get<OnChainTask & { meta: TaskMeta | null }>(`/api/v1/tasks/${taskId}`);
  const { meta, ...onChain } = raw;
  return {
    onChain,
    meta: meta ?? {
      taskId,
      agent: onChain.agent,
      category: 'unknown',
      locationZone: 'Global',
      reward: onChain.amount,
      createdAt: onChain.createdAt,
      isOpen: onChain.status === 0,
    },
  };
}

export async function buildCreateTask(params: {
  taskHash: string;
  token: string;
  amount: string;
  category: string;
  locationZone: string;
  duration: string;
  targetExecutorType?: 'human' | 'agent';
  verificationMode?: 'manual' | 'auto' | 'oracle';
  requiredCapabilities?: string[];
  verificationCriteria?: {
    required_fields?: string[];
    min_length?: number;
    contains_keywords?: string[];
  };
}): Promise<UnsignedTx> {
  const res = await authedPost<{ unsignedTx: UnsignedTx }>('/api/v1/tasks', params);
  return res.unsignedTx;
}

export async function applyToTask(taskId: string, message?: string): Promise<{ application_id: string }> {
  return authedPost<{ application_id: string }>(`/api/v1/tasks/${taskId}/apply`, { message });
}

export async function getApplications(taskId: string): Promise<Application[]> {
  const res = await authedGet<{ applications: Application[] }>(`/api/v1/tasks/${taskId}/applications`);
  return res.applications;
}

export async function buildAssignTask(taskId: string, worker: string): Promise<UnsignedTx> {
  const res = await authedPost<{ unsignedTx: UnsignedTx }>(`/api/v1/tasks/${taskId}/assign`, { worker });
  return res.unsignedTx;
}

export async function buildCancelTask(taskId: string): Promise<UnsignedTx> {
  const res = await authedPost<{ unsignedTx: UnsignedTx }>(`/api/v1/tasks/${taskId}/cancel`, {});
  return res.unsignedTx;
}

export async function buildClaimTimeout(taskId: string): Promise<UnsignedTx> {
  const res = await authedPost<{ unsignedTx: UnsignedTx }>(`/api/v1/tasks/${taskId}/timeout`, {});
  return res.unsignedTx;
}
