/**
 * MCP (Model Context Protocol) client for BlindMarket.
 *
 * Implements the JSON-RPC 2.0 based MCP protocol over HTTP.
 * Used to connect to MCP servers, list their tools, and call them.
 *
 * MCP tools are normalized to ToolDefinition shape for the execution layer.
 */

import type { ToolDefinition, ToolParamSchema } from '../types.js';

// ── MCP JSON-RPC types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface McpServerInfo {
  name?: string;
  version?: string;
}

interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo?: McpServerInfo;
}

// ── MCP Client ─────────────────────────────────────────────────────────────

export interface McpConnection {
  url: string;
  serverName?: string;
  protocolVersion?: string;
  tools: ToolDefinition[];
}

/**
 * Initialize an MCP server connection.
 * Sends the `initialize` handshake and returns server info.
 */
export async function mcpInitialize(
  serverUrl: string,
  headers: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<McpInitializeResult> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'blindmarket', version: '1.0.0' },
    },
  };

  const res = await mcpPost(serverUrl, request, headers, timeoutMs);
  if (res.error) {
    throw new Error(`MCP initialize failed: ${res.error.message}`);
  }
  return res.result as McpInitializeResult;
}

/**
 * List tools from an MCP server.
 * Returns normalized ToolDefinitions ready for the execution layer.
 */
export async function mcpListTools(
  serverUrl: string,
  headers: Record<string, string> = {},
  timeoutMs = 15_000,
): Promise<ToolDefinition[]> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  };

  const res = await mcpPost(serverUrl, request, headers, timeoutMs);
  if (res.error) {
    throw new Error(`MCP tools/list failed: ${res.error.message}`);
  }

  const result = res.result as { tools?: McpTool[] };
  const tools = result.tools ?? [];

  // Normalize each MCP tool to ToolDefinition shape
  return tools.map(mcpTool => normalizeMcpTool(mcpTool, serverUrl));
}

/**
 * Call a tool on an MCP server.
 * Returns the raw result from the MCP server.
 */
export async function mcpCallTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const res = await mcpPost(serverUrl, request, headers, timeoutMs);
  if (res.error) {
    throw new Error(`MCP tools/call failed: ${res.error.message}`);
  }
  return res.result;
}

/**
 * Connect to an MCP server, initialize, and list tools.
 * Full end-to-end connection flow.
 */
export async function mcpConnect(
  serverUrl: string,
  authHeaders: Record<string, string> = {},
): Promise<McpConnection> {
  // Initialize
  const initResult = await mcpInitialize(serverUrl, authHeaders);

  // List tools
  const tools = await mcpListTools(serverUrl, authHeaders);

  return {
    url: serverUrl,
    serverName: initResult.serverInfo?.name,
    protocolVersion: initResult.protocolVersion,
    tools,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalize an MCP tool to our ToolDefinition shape.
 *
 * MCP tools use JSON-RPC and handle their own transport, so the execution
 * layer routes calls back through mcpCallTool instead of building raw HTTP.
 * We store the MCP endpoint URL in execution.url and use a special
 * method "MCP" to signal this.
 */
function normalizeMcpTool(mcpTool: McpTool, serverUrl: string): ToolDefinition {
  const properties: Record<string, ToolParamSchema> = {};
  const required: string[] = [];

  if (mcpTool.inputSchema?.properties) {
    for (const [key, schema] of Object.entries(mcpTool.inputSchema.properties)) {
      const s = schema as Record<string, unknown>;
      properties[key] = {
        type: (s.type as string) ?? 'string',
        description: s.description as string | undefined,
        enum: s.enum as string[] | undefined,
        default: s.default,
      };
    }
  }

  if (mcpTool.inputSchema?.required) {
    required.push(...mcpTool.inputSchema.required);
  }

  return {
    name: mcpTool.name,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    input_schema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
    execution: {
      // "MCP" is a sentinel — the execution layer knows to route through
      // the MCP client instead of building a raw HTTP request
      method: 'GET',
      url: serverUrl,
      param_mapping: {},
    },
    auth: {
      type: 'none',
      key_name: '',
      secret_ref: '',
    },
  };
}

/**
 * POST a JSON-RPC request to an MCP server.
 */
async function mcpPost(
  url: string,
  request: JsonRpcRequest,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP server returned ${res.status}: ${text.slice(0, 200)}`);
    }

    return await res.json() as JsonRpcResponse;
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error('MCP connection timed out');
    }
    throw e;
  }
}
