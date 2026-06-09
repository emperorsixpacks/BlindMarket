/**
 * Framework adapters — convert BlindMarket tools into ready-to-use tool arrays
 * for each major agent SDK. No manual schema conversion needed.
 *
 * @example
 * ```ts
 * // LangChain
 * import { toLangChainTools } from '@blindmarket/sdk/tools';
 * const tools = toLangChainTools(bb);
 *
 * // Vercel AI SDK
 * import { toVercelTools } from '@blindmarket/sdk/tools';
 * const tools = toVercelTools(bb);
 * ```
 */

import type { BlindMarket } from '../index.js';
import { createBlindMarketTools } from './helpers.js';
import type { Tool } from './types.js';

export type { Tool, ToolKit, ToolDefinition } from './types.js';

// ── LangChain adapter ───────────────────────────────────────────────────────

export interface LangChainStructuredTool {
  name: string;
  description: string;
  schema: { shape: Record<string, unknown>; parse: (raw: unknown) => Record<string, unknown> };
  func: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Convert BlindMarket tools to LangChain `DynamicStructuredTool`-compatible objects.
 * Pass them directly into `createReactAgent`, `initializeAgentExecutorWithOptions`, etc.
 *
 * ```ts
 * import { ChatOpenAI } from '@langchain/openai';
 * import { createReactAgent } from '@langchain/langgraph/prebuilt';
 *
 * const tools = toLangChainTools(bb);
 * const agent = createReactAgent({ llm: new ChatOpenAI({ model: 'gpt-4' }), tools });
 * ```
 */
export function toLangChainTools(bb: BlindMarket): LangChainStructuredTool[] {
  return createBlindMarketTools(bb).map(mapToLangChain);
}

function mapToLangChain(t: Tool): LangChainStructuredTool {
  const shape: Record<string, unknown> = {};
  const props = t.definition.function.parameters.properties;
  const required = t.definition.function.parameters.required ?? [];

  for (const [key, prop] of Object.entries(props)) {
    const p = prop as any;
    const type = p.type === 'number' ? 'number'
      : p.type === 'array' ? 'array'
      : 'string';
    shape[key] = { type, enum: p.enum, required: required.includes(key) };
  }

  return {
    name: t.definition.function.name,
    description: t.definition.function.description,
    schema: {
      shape,
      parse: (raw: unknown) => raw as Record<string, unknown>,
    },
    func: async (args) => JSON.stringify(await t.execute(args)),
  };
}

// ── Vercel AI SDK adapter ──────────────────────────────────────────────────

export interface VercelTool {
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Convert BlindMarket tools to Vercel AI SDK `tool()` compatible objects.
 *
 * ```ts
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const tools = toVercelTools(bb);
 * const { text } = await generateText({ model: openai('gpt-4'), tools });
 * ```
 */
export function toVercelTools(bb: BlindMarket): Record<string, VercelTool> {
  const result: Record<string, VercelTool> = {};
  for (const t of createBlindMarketTools(bb)) {
    const props = t.definition.function.parameters.properties;
    const required = t.definition.function.parameters.required;

    const converted: Record<string, { type: string; description?: string; enum?: string[] }> = {};
    for (const [key, prop] of Object.entries(props)) {
      const p = prop as any;
      converted[key] = {
        type: p.type === 'number' ? 'number' : p.type === 'array' ? 'array' : 'string',
        description: p.description,
        ...(p.enum ? { enum: p.enum } : {}),
      };
    }

    result[t.definition.function.name] = {
      description: t.definition.function.description,
      parameters: { type: 'object', properties: converted, required },
      execute: (args) => t.execute(args),
    };
  }
  return result;
}

// ── OpenAI adapter ──────────────────────────────────────────────────────────

/**
 * Get raw OpenAI-compatible tool definitions.
 *
 * ```ts
 * const tools = toOpenAITools(bb);
 * const response = await openai.chat.completions.create({ model: 'gpt-4', tools });
 * ```
 */
export function toOpenAITools(bb: BlindMarket) {
  return createBlindMarketTools(bb).map(t => t.definition);
}

// ── Claude (Anthropic SDK) adapter ─────────────────────────────────────────

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

/**
 * Convert BlindMarket tools to Claude SDK tool format.
 *
 * ```ts
 * const tools = toClaudeTools(bb);
 * const response = await anthropic.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   tools,
 *   messages: [{ role: 'user', content: 'Find tasks' }],
 * });
 * ```
 */
export function toClaudeTools(bb: BlindMarket): ClaudeTool[] {
  return createBlindMarketTools(bb).map(t => {
    const props = t.definition.function.parameters.properties;
    const required = t.definition.function.parameters.required;
    const converted: Record<string, { type: string; description?: string; enum?: string[] }> = {};
    for (const [key, prop] of Object.entries(props)) {
      const p = prop as any;
      converted[key] = {
        type: p.type === 'number' ? 'number' : p.type === 'array' ? 'array' : 'string',
        description: p.description,
        ...(p.enum ? { enum: p.enum } : {}),
      };
    }
    return {
      name: t.definition.function.name,
      description: t.definition.function.description,
      input_schema: { type: 'object', properties: converted, required },
    };
  });
}
