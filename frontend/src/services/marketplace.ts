import { get, authedGet, authedPost, authedDelete } from '../lib/api';

export interface AgentSearchResult {
  address: string;
  name: string;
  capabilities: string[];
  reputation: number;
  tasksCompleted: number;
  avgRating: number;
  totalReviews: number;
  badges: { capability: string; type: string }[];
}

export interface AgentReview {
  id: number;
  task_id: string;
  agent_address: string;
  reviewer_address: string;
  rating: number;
  review: string | null;
  created_at: string;
}

export interface AgentReviewStats {
  avgRating: number;
  totalReviews: number;
  distribution: Record<number, number>;
}

export interface TaskTemplate {
  id: number;
  creator_address: string;
  name: string;
  category: string;
  description: string;
  required_capabilities: string[];
  verification_criteria: Record<string, unknown> | null;
  suggested_reward: string | null;
  is_public: boolean;
  use_count: number;
  created_at: string;
}

export interface AgentWebhook {
  id: number;
  url: string;
  events: string[];
  isActive: boolean;
}

export interface AgentBadge {
  id: number;
  agent_address: string;
  capability: string;
  badge_type: string;
  granted_at: string;
  expires_at: string | null;
}

export async function searchAgents(
  capability?: string,
  minRating?: number,
  limit?: number,
  page: number = 1,
): Promise<{ agents: AgentSearchResult[]; total: number }> {
  const params = new URLSearchParams();
  if (capability) params.set('capability', capability);
  if (minRating !== undefined) params.set('minRating', String(minRating));
  if (limit !== undefined) params.set('limit', String(limit));
  if (page !== 1) params.set('page', String(page));
  const qs = params.toString();
  return get<{ agents: AgentSearchResult[]; total: number }>(
    `/api/v1/marketplace/agents/search${qs ? `?${qs}` : ''}`,
  );
}

export async function submitReview(data: {
  taskId: string;
  agentAddress: string;
  rating: number;
  review?: string;
}): Promise<AgentReview> {
  return authedPost<AgentReview>('/api/v1/marketplace/reviews', data);
}

export async function getAgentReviews(
  agentAddress: string,
  limit = 20,
  offset = 0,
): Promise<{ reviews: AgentReview[]; stats: AgentReviewStats }> {
  return get<{ reviews: AgentReview[]; stats: AgentReviewStats }>(
    `/api/v1/marketplace/reviews/${agentAddress}?limit=${limit}&offset=${offset}`,
  );
}

export async function getPublicTemplates(
  limit = 20,
  offset = 0,
): Promise<{ templates: TaskTemplate[]; total: number }> {
  return get<{ templates: TaskTemplate[]; total: number }>(
    `/api/v1/marketplace/templates?limit=${limit}&offset=${offset}`,
  );
}

export async function getTemplate(id: number): Promise<TaskTemplate> {
  return get<TaskTemplate>(`/api/v1/marketplace/templates/${id}`);
}

export async function getMyTemplates(): Promise<TaskTemplate[]> {
  return authedGet<TaskTemplate[]>('/api/v1/marketplace/templates/mine');
}

export async function createTemplate(data: {
  name: string;
  category: string;
  description: string;
  requiredCapabilities?: string[];
  verificationCriteria?: Record<string, unknown>;
  suggestedReward?: string;
  isPublic?: boolean;
}): Promise<TaskTemplate> {
  return authedPost<TaskTemplate>('/api/v1/marketplace/templates', data);
}

export async function deleteTemplate(id: number): Promise<void> {
  await authedDelete(`/api/v1/marketplace/templates/${id}`);
}

export async function registerWebhook(data: {
  url: string;
  secret?: string;
  events?: string[];
}): Promise<{ id: number; url: string; events: string[]; secret: string }> {
  return authedPost('/api/v1/marketplace/webhooks', data);
}

export async function getWebhooks(): Promise<AgentWebhook[]> {
  return authedGet<AgentWebhook[]>('/api/v1/marketplace/webhooks');
}

export async function deleteWebhook(id: number): Promise<void> {
  await authedDelete(`/api/v1/marketplace/webhooks/${id}`);
}

export async function getAgentBadges(agentAddress: string): Promise<AgentBadge[]> {
  return get<AgentBadge[]>(`/api/v1/marketplace/badges/${agentAddress}`);
}

export async function grantBadge(data: {
  agentAddress: string;
  capability: string;
  badgeType?: string;
  expiresAt?: string;
}): Promise<AgentBadge> {
  return authedPost<AgentBadge>('/api/v1/marketplace/badges', data);
}

export async function revokeBadge(agentAddress: string, capability: string): Promise<void> {
  await authedDelete(`/api/v1/marketplace/badges/${agentAddress}/${capability}`);
}
