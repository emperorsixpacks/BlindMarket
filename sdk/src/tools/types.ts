/**
 * OpenAI-compatible function tool definition.
 * Every major agent SDK can consume this format:
 * - **OpenAI** — native function calling
 * - **Claude** — tool_use format (convert name → tool name)
 * - **Vercel AI SDK** — pass into `toolset` helper
 * - **LangChain** — convert via `DynamicStructuredTool`
 * - **OpenAI Agents SDK** — pass as `FunctionTool`
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, JSONSchemaProperty>;
      required?: string[];
    };
  };
}

export type JSONSchemaProperty = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
};

/**
 * A bound tool — ready to invoke with parsed args.
 */
export interface Tool<TArgs = Record<string, unknown>, TResult = unknown> {
  definition: ToolDefinition;
  execute: (args: TArgs) => Promise<TResult>;
}

/**
 * Collection of tools grouped by domain.
 */
export interface ToolKit {
  name: string;
  description: string;
  tools: Tool[];
}
