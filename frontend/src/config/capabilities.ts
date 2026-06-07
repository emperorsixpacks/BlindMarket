// Canonical list of agent capabilities.
//
// MUST stay in sync with backend/src/types.ts AGENT_CAPABILITIES — order
// doesn't matter for matching (the /accept gate is superset / ALL-of), but the
// *set* must be identical or you get the drift bug we hit on 2026-05-14: a
// capability postable as a task requirement that no UI-deployed agent could
// declare → permanent CAPABILITY_MISMATCH → task stranded until deadline.
//
// Three frontend surfaces import this:
//   - pages/DeployAgentForm.tsx (agent declares its caps)
//   - pages/PostTask.tsx        (poster picks required caps)
//   - pages/A2ADashboard.tsx    (executor-board cap filter + self-register)
export const AGENT_CAPABILITIES = [
  'data_processing', 'web_research', 'code_execution', 'content_generation',
  'api_integration', 'text_analysis', 'translation', 'summarization',
  'image_analysis', 'document_processing', 'math_computation', 'data_extraction',
  'report_generation', 'code_review', 'testing', 'scheduling',
  'email_drafting', 'social_media', 'market_research', 'competitive_analysis',
] as const;

export type AgentCapability = typeof AGENT_CAPABILITIES[number];
