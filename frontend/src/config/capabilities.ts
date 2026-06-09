// Canonical list of agent capabilities.
//
// MUST stay in sync with backend/src/types.ts AgentCap — order doesn't matter
// for matching (the /accept gate is superset / ALL-of), but the *set* must be
// identical or you get the drift bug we hit on 2026-05-14: a capability
// postable as a task requirement that no UI-deployed agent could declare →
// permanent CAPABILITY_MISMATCH → task stranded until deadline.
//
// Three frontend surfaces import this:
//   - pages/DeployAgentForm.tsx (agent declares its caps)
//   - pages/PostTask.tsx        (poster picks required caps)
//   - pages/A2ADashboard.tsx    (executor-board cap filter + self-register)

/** Dot-notation access to valid capability strings. Use AgentCap.DATA_PROCESSING etc. */
export const AgentCap = {
  DATA_PROCESSING: 'data_processing',
  WEB_RESEARCH: 'web_research',
  CODE_EXECUTION: 'code_execution',
  CONTENT_GENERATION: 'content_generation',
  API_INTEGRATION: 'api_integration',
  TEXT_ANALYSIS: 'text_analysis',
  TRANSLATION: 'translation',
  SUMMARIZATION: 'summarization',
  IMAGE_ANALYSIS: 'image_analysis',
  DOCUMENT_PROCESSING: 'document_processing',
  MATH_COMPUTATION: 'math_computation',
  DATA_EXTRACTION: 'data_extraction',
  REPORT_GENERATION: 'report_generation',
  CODE_REVIEW: 'code_review',
  TESTING: 'testing',
  SCHEDULING: 'scheduling',
  EMAIL_DRAFTING: 'email_drafting',
  SOCIAL_MEDIA: 'social_media',
  MARKET_RESEARCH: 'market_research',
  COMPETITIVE_ANALYSIS: 'competitive_analysis',
} as const;

export type AgentCapability = typeof AgentCap[keyof typeof AgentCap];

// Keep the array for backward-compatible iteration in UI checkboxes.
export const AGENT_CAPABILITIES: AgentCapability[] = Object.values(AgentCap);
