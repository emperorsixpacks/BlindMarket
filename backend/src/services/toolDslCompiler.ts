/**
 * Tool Definition DSL Compiler
 *
 * Compiles raw input from every import path (OpenAPI, MCP, manual) into a
 * ToolDSL — the rich intermediate representation that captures semantic
 * meaning, error semantics, sequencing, and parameter groups.
 */

import type {
  ToolDSL,
  ToolDSLParameter,
  ToolDSLParameterGroup,
  ToolDSLSideEffect,
  ToolDSLSemanticType,
} from '../types.js';

// ── OpenAPI → DSL ──────────────────────────────────────────────────────────

/** OpenAPI operation shape (subset we care about) */
export interface OpenApiOperationInput {
  operationId?: string;
  summary?: string;
  description?: string;
  method: string;
  path: string;
  parameters?: Array<{
    name: string;
    in: 'query' | 'path' | 'header' | 'cookie';
    description?: string;
    required?: boolean;
    schema?: { type?: string; enum?: string[]; format?: string; default?: unknown };
  }>;
  requestBody?: {
    content?: Record<string, { schema?: { type?: string; properties?: Record<string, { type?: string; description?: string; enum?: string[]; format?: string }>; required?: string[] } }>;
  };
  security?: Array<Record<string, string[]>>;
  securitySchemes?: Record<string, { type: string; name?: string; in?: string }>;
}

/**
 * Infer semantic_type from parameter name and schema.
 * Never returns blank — always falls back to free_text.
 */
function inferSemanticType(
  name: string,
  schema?: { type?: string; enum?: string[]; format?: string },
): ToolDSLSemanticType {
  const lower = name.toLowerCase();

  if (schema?.enum?.length) return 'enum';
  if (schema?.format === 'date' || schema?.format === 'date-time') return 'date';
  if (lower.includes('email')) return 'email';
  if (lower.includes('domain') || lower.includes('hostname')) return 'domain';
  if (lower.includes('url') || lower.includes('uri') || lower.includes('link')) return 'url';
  if (lower.includes('name') && (lower.includes('person') || lower.includes('user') || lower.includes('first') || lower.includes('last'))) return 'person_name';
  if (lower.includes('id') || lower.endsWith('_id') || lower.endsWith('Id')) return 'id';
  if (schema?.type === 'number' || schema?.type === 'integer') return 'number';

  return 'free_text';
}

/** Build format_hint from parameter name and schema */
function inferFormatHint(
  name: string,
  semanticType: ToolDSLSemanticType,
  schema?: { type?: string; format?: string; enum?: string[] },
): string | undefined {
  if (semanticType === 'domain') return 'bare domain, no protocol, e.g. example.com';
  if (semanticType === 'email') return 'user@example.com';
  if (semanticType === 'url') return 'full URL with protocol';
  if (semanticType === 'date') return schema?.format === 'date-time' ? 'ISO 8601 datetime' : 'YYYY-MM-DD';
  if (semanticType === 'enum' && schema?.enum) return `one of: ${schema.enum.join(', ')}`;
  return undefined;
}

/** Infer side_effects from HTTP method */
function inferSideEffects(method: string): ToolDSLSideEffect {
  switch (method.toUpperCase()) {
    case 'GET': case 'HEAD': case 'OPTIONS': return 'none';
    case 'POST': return 'creates_resource';
    case 'PUT': case 'PATCH': return 'modifies_resource';
    case 'DELETE': return 'destructive';
    default: return 'none';
  }
}

/** Determine if method is safe to retry (idempotent) */
function inferRetrySafe(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'PUT' || m === 'DELETE' || m === 'OPTIONS';
}

/**
 * Build a ToolDSL from a parsed OpenAPI operation.
 * Heuristic-inferred fields are filled; sequencing/error_semantics are left
 * empty (flagged needs_review) since they can't be inferred from the spec.
 */
export function compileFromOpenApi(op: OpenApiOperationInput): ToolDSL {
  const name = op.operationId ?? `${op.method}_${op.path}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const intent = op.summary ?? op.description ?? `${op.method.toUpperCase()} ${op.path}`;

  // Build parameters from path/query params
  const parameters: ToolDSLParameter[] = [];
  for (const param of op.parameters ?? []) {
    const semanticType = inferSemanticType(param.name, param.schema);
    parameters.push({
      name: param.name,
      semantic_type: semanticType,
      json_type: param.schema?.type === 'integer' ? 'number' : (param.schema?.type as any) ?? 'string',
      required: param.required ?? false,
      description: param.description ?? `${param.name} parameter`,
      format_hint: inferFormatHint(param.name, semanticType, param.schema),
      example: undefined,
      enum_values: param.schema?.enum,
    });
  }

  // Build parameters from request body
  const jsonContent = op.requestBody?.content?.['application/json'];
  if (jsonContent?.schema?.properties) {
    for (const [key, propSchema] of Object.entries(jsonContent.schema.properties)) {
      const semanticType = inferSemanticType(key, propSchema);
      parameters.push({
        name: key,
        semantic_type: semanticType,
        json_type: (propSchema.type as any) ?? 'string',
        required: jsonContent.schema.required?.includes(key) ?? false,
        description: propSchema.description ?? `${key} field`,
        format_hint: inferFormatHint(key, semanticType, propSchema),
        example: undefined,
        enum_values: propSchema.enum,
      });
    }
  }

  // Build parameter_groups from oneOf/anyOf in the spec
  // (If a param has `oneOf` or the spec has `anyOf` at the param level,
  // we don't have a clean way to detect mutual exclusion from OpenAPI alone —
  // leave parameter_groups empty and flag for review.)
  const parameter_groups: ToolDSLParameterGroup[] = [];

  return {
    name,
    intent,
    when_to_use: '', // cannot infer from OpenAPI — flag for review
    parameters,
    parameter_groups: parameter_groups.length > 0 ? parameter_groups : undefined,
    output: undefined, // cannot infer from OpenAPI
    side_effects: inferSideEffects(op.method),
    retry_safe: inferRetrySafe(op.method),
    error_semantics: [], // cannot infer — flag for review
    sequencing: undefined, // cannot infer — flag for review
    execution: {
      method: op.method.toUpperCase() as ToolDSL['execution']['method'],
      url: op.path,
      param_mapping: Object.fromEntries(
        parameters.map(p => [p.name, p.name === 'body' ? 'body' : op.parameters?.find(ep => ep.name === p.name)?.in === 'path' ? 'path' : op.parameters?.find(ep => ep.name === p.name)?.in === 'header' ? 'header' : 'query']),
      ),
    },
    auth: { type: 'none', key_name: '', secret_ref: '' },
    needs_review: true, // OpenAPI imports always need review for semantic fields
  };
}

// ── MCP → DSL ──────────────────────────────────────────────────────────────

/** MCP tool shape from tools/list response */
export interface McpToolInput {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

/**
 * Build a ToolDSL from an MCP tool definition.
 * MCP gives us name/description/input_schema — semantic fields beyond that
 * need human review.
 */
export function compileFromMcp(mcpTool: McpToolInput, endpointUrl: string): ToolDSL {
  const description = mcpTool.description ?? '';

  // Try to split intent from when_to_use if description contains a decision phrase
  const intent = description.split(/\n\n/)[0]?.trim() ?? description;

  const parameters: ToolDSLParameter[] = [];
  if (mcpTool.inputSchema?.properties) {
    for (const [key, propSchema] of Object.entries(mcpTool.inputSchema.properties)) {
      const semanticType = inferSemanticType(key, propSchema);
      parameters.push({
        name: key,
        semantic_type: semanticType,
        json_type: (propSchema.type as any) ?? 'string',
        required: mcpTool.inputSchema.required?.includes(key) ?? false,
        description: propSchema.description ?? `${key} parameter`,
        format_hint: inferFormatHint(key, semanticType, propSchema),
        example: undefined,
        enum_values: propSchema.enum,
      });
    }
  }

  return {
    name: mcpTool.name,
    intent,
    when_to_use: '', // cannot infer from MCP — flag for review
    parameters,
    output: undefined,
    side_effects: 'none',
    retry_safe: true,
    error_semantics: [],
    sequencing: undefined,
    execution: {
      method: 'POST' as const,
      url: endpointUrl,
      param_mapping: Object.fromEntries(parameters.map(p => [p.name, 'body'])),
    },
    auth: { type: 'none', key_name: '', secret_ref: '' },
    needs_review: true,
  };
}

// ── Manual → DSL (pass-through with validation) ────────────────────────────

/**
 * Validate a manually-created ToolDSL. Returns list of issues (empty = valid).
 */
export function validateManualDsl(dsl: ToolDSL): string[] {
  const issues: string[] = [];
  if (!dsl.name?.trim()) issues.push('name is required');
  if (!dsl.intent?.trim()) issues.push('intent is required');
  if (!dsl.when_to_use?.trim()) issues.push('when_to_use is recommended for better agent performance');
  if (dsl.parameters.length === 0) issues.push('at least one parameter is required');

  // Validate parameter_groups reference existing params
  const paramNames = new Set(dsl.parameters.map(p => p.name));
  for (const group of dsl.parameter_groups ?? []) {
    for (const p of group.params) {
      if (!paramNames.has(p)) {
        issues.push(`parameter_groups references unknown parameter "${p}"`);
      }
    }
  }

  return issues;
}

/**
 * Determine if a DSL needs review (missing semantic fields that affect agent performance).
 */
export function dslNeedsReview(dsl: ToolDSL): boolean {
  return !dsl.when_to_use?.trim()
    || (dsl.error_semantics?.length ?? 0) === 0
    || !dsl.sequencing;
}
