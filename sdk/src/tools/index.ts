import { BlindMarket } from '../index.js';
import {
  createBlindMarketTools, createTaskTools, createAgentManagementTools, createA2ATools,
} from './helpers.js';
import {
  toLangChainTools, toVercelTools, toClaudeTools,
} from './adapters.js';
import type { Tool, ToolKit, ToolDefinition } from './types.js';

// ── Single entry-point ───────────────────────────────────────────────────────

/**
 * Returns all framework tool formats from one call. No need to remember
 * `toLangChainTools`, `toVercelTools`, etc. — just pick a property.
 *
 * @example
 * ```ts
 * import { BlindMarket, tools } from '@blindmarket/sdk';
 * const bb = new BlindMarket({ apiKey });
 *
 * // OpenAI / Vercel
 * openai.chat.completions.create({ model: 'gpt-4', tools: tools(bb).definitions });
 *
 * // LangChain
 * createReactAgent({ llm, tools: tools(bb).langchain });
 *
 * // Claude
 * anthropic.messages.create({ model, tools: tools(bb).claude });
 * ```
 */
export function tools(bb: BlindMarket): BlindMarketTools {
  const all = createBlindMarketTools(bb);
  const definitions = all.map(t => t.definition);
  const langchain = toLangChainTools(bb);
  const vercel = toVercelTools(bb);
  const claude = toClaudeTools(bb);
  return { definitions, langchain, vercel, claude };
}

export interface BlindMarketTools {
  /** OpenAI-compatible tool definitions (array of `{type, function}`). */
  definitions: ToolDefinition[];
  /** LangChain `StructuredTool` instances. */
  langchain: ReturnType<typeof toLangChainTools>;
  /** Vercel AI SDK tool map (`Record<string, VercelTool>`). */
  vercel: ReturnType<typeof toVercelTools>;
  /** Claude tool shapes (`{name, description, input_schema}[]`). */
  claude: ReturnType<typeof toClaudeTools>;
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export type { Tool, ToolKit, ToolDefinition } from './types.js';
export {
  createBlindMarketTools, createTaskTools, createAgentManagementTools, createA2ATools,
} from './helpers.js';
export {
  toLangChainTools, toVercelTools, toOpenAITools, toClaudeTools,
} from './adapters.js';
