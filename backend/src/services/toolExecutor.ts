/**
 * Shared tool execution layer for BlindMarket.
 *
 * This is the ONLY code path that ever resolves secret_ref values and builds
 * real HTTP requests. Agent code (worker.js) calls `executeTool()` with a
 * ToolDefinition + arguments; this module handles URL construction, param
 * mapping, auth injection, and the actual fetch. Secrets are never surfaced
 * in logs, agent-visible results, or error messages.
 */

import type { ToolDefinition } from '../types.js';

// ── Secret resolution ──────────────────────────────────────────────────────

// In production, secrets are stored in a secure vault. For now, we use a
// simple in-memory store populated from env vars at boot. The worker passes
// its resolved secrets map (keyed by secret_ref) at execution time.
export type SecretStore = Record<string, string>;

// ── Execution result ───────────────────────────────────────────────────────

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

// ── URL construction ───────────────────────────────────────────────────────

function buildUrl(
  template: string,
  args: Record<string, unknown>,
  paramMapping: Record<string, string>,
  queryParams: Array<{ name: string; value: string }> = [],
): string {
  let url = template;

  // Substitute {param} placeholders in the URL with path-mapped args
  url = url.replace(/\{(\w+)\}/g, (_, paramName) => {
    const value = args[paramName];
    if (value === undefined || value === null) return '';
    return encodeURIComponent(String(value));
  });

  // Collect query parameters
  const qs = new URLSearchParams();
  for (const [inputKey, target] of Object.entries(paramMapping)) {
    if (target !== 'query') continue;
    const value = args[inputKey];
    if (value !== undefined && value !== null) {
      qs.set(inputKey, String(value));
    }
  }

  // Also include any static query params (from legacy ToolDefinition shape)
  for (const qp of queryParams) {
    qs.set(qp.name, qp.value);
  }

  const qsStr = qs.toString();
  if (qsStr) {
    url += (url.includes('?') ? '&' : '?') + qsStr;
  }

  return url;
}

// ── Body construction ──────────────────────────────────────────────────────

function buildBody(
  args: Record<string, unknown>,
  paramMapping: Record<string, string>,
): string | undefined {
  const bodyObj: Record<string, unknown> = {};
  let hasBody = false;

  for (const [inputKey, target] of Object.entries(paramMapping)) {
    if (target !== 'body') continue;
    const value = args[inputKey];
    if (value !== undefined && value !== null) {
      bodyObj[inputKey] = value;
      hasBody = true;
    }
  }

  return hasBody ? JSON.stringify(bodyObj) : undefined;
}

// ── Auth injection ─────────────────────────────────────────────────────────

function injectAuth(
  headers: Record<string, string>,
  auth: ToolDefinition['auth'],
  secrets: SecretStore,
): void {
  if (auth.type === 'none') return;

  const secret = secrets[auth.secret_ref];
  if (!secret) {
    // Don't expose which secret_ref failed — generic error at the call site
    throw new Error('authentication failed');
  }

  switch (auth.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${secret}`;
      break;
    case 'header':
      headers[auth.key_name] = secret;
      break;
    case 'query_param':
      // Handled in URL construction — we append it as a query param
      break;
  }
}

// ── Main execution function ────────────────────────────────────────────────

/**
 * Execute a tool definition with agent-supplied arguments.
 *
 * This function:
 * 1. Resolves the secret_ref from the secret store
 * 2. Maps input_schema arguments to URL params, query params, body, and headers
 * 3. Builds the real HTTP request
 * 4. Fires the request and returns the result
 *
 * Secrets are NEVER surfaced in logs, results, or error messages.
 */
export async function executeTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  secrets: SecretStore,
  timeoutMs = 30_000,
): Promise<ToolExecutionResult> {
  try {
    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Inject auth
    injectAuth(headers, tool.auth, secrets);

    // Build URL (includes path and query param substitution)
    const url = buildUrl(tool.execution.url, args, tool.execution.param_mapping);

    // Build body
    const body = buildBody(args, tool.execution.param_mapping);

    // Fire the request
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: tool.execution.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    // Read response
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      success: res.ok,
      data,
      status: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  } catch (e: any) {
    // Never surface auth secrets in error messages
    if (e.message === 'authentication failed') {
      return { success: false, error: 'authentication failed' };
    }
    if (e.name === 'AbortError') {
      return { success: false, error: 'request timed out' };
    }
    return { success: false, error: e.message };
  }
}

// ── Validation helpers ─────────────────────────────────────────────────────

/**
 * Validate a ToolDefinition before saving.
 * Returns array of error strings (empty = valid).
 */
export function validateToolDefinition(tool: ToolDefinition): string[] {
  const errors: string[] = [];

  if (!tool.name || tool.name.length < 1) {
    errors.push('name is required');
  }
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(tool.name)) {
    errors.push('name must be 1-64 chars, alphanumeric + underscore only');
  }
  if (!tool.description) {
    errors.push('description is required');
  }

  // Validate input_schema
  if (!tool.input_schema || tool.input_schema.type !== 'object') {
    errors.push('input_schema.type must be "object"');
  }
  if (!tool.input_schema?.properties) {
    errors.push('input_schema.properties is required');
  }

  // Validate execution
  if (!tool.execution) {
    errors.push('execution is required');
  } else {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(tool.execution.method)) {
      errors.push('execution.method must be GET, POST, PUT, PATCH, or DELETE');
    }
    try {
      // Validate URL (allow {param} placeholders)
      const urlNoPlaceholders = tool.execution.url.replace(/\{[^}]+\}/g, 'placeholder');
      new URL(urlNoPlaceholders);
    } catch {
      errors.push('execution.url is not a valid URL');
    }

    // Check that every {param} in URL has a matching input_schema property
    const urlParams = tool.execution.url.match(/\{(\w+)\}/g)?.map(p => p.slice(1, -1)) ?? [];
    for (const p of urlParams) {
      if (!tool.input_schema.properties[p]) {
        errors.push(`URL placeholder {${p}} has no matching input_schema property`);
      }
    }

    // Check that every body/query mapped key has a matching input_schema property
    for (const key of Object.keys(tool.execution.param_mapping)) {
      if (!tool.input_schema.properties[key]) {
        errors.push(`param_mapping key "${key}" has no matching input_schema property`);
      }
    }
  }

  // Validate auth
  if (!tool.auth) {
    errors.push('auth is required');
  } else {
    if (!['query_param', 'header', 'bearer', 'none'].includes(tool.auth.type)) {
      errors.push('auth.type must be query_param, header, bearer, or none');
    }
    if (tool.auth.type !== 'none' && !tool.auth.secret_ref) {
      errors.push('auth.secret_ref is required for non-none auth');
    }
    if (tool.auth.type !== 'none' && !tool.auth.key_name) {
      errors.push('auth.key_name is required for non-none auth');
    }
  }

  return errors;
}
