/**
 * ToolManager — unified tool import & management component for BlindMarket.
 *
 * Supports three import paths (MCP > OpenAPI > manual) and normalizes
 * everything to the ToolDefinition schema. This is the single interface
 * agent builders use to hook their agents up to external APIs.
 */

import { useState, useCallback } from 'react';
import { Button, Tag, FormField, FormInput, FormSelect, FormTextarea } from './index';
import { HeaderManager } from './HeaderManager';
import { QueryParamManager } from './QueryParamManager';
import { authedPost } from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ToolParam {
  key: string;
  value?: string;
  required: boolean;
}

export interface ToolHeader {
  key: string;
  value?: string;
  required: boolean;
}

/** Legacy tool shape — kept for backward compat with existing deploy flow */
export interface LegacyTool {
  type: 'http' | 'mcp' | 'js' | 'sandbox';
  name: string;
  description: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  toolName?: string;
  headers: ToolHeader[];
  queryParams: ToolParam[];
  body: { contentType: 'application/json' | 'application/x-www-form-urlencoded'; payload: string };
  // js/sandbox specific
  code?: string;
  command?: string;
  setup?: string;
  timeout?: number;
}

/** Normalized ToolDefinition — the output of all import paths */
export interface ToolDef {
  type: 'tool';
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }>;
    required?: string[];
  };
  execution: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    param_mapping: Record<string, string>;
  };
  auth: {
    type: 'query_param' | 'header' | 'bearer' | 'none';
    key_name: string;
    secret_ref: string;
  };
}

export type AnyTool = LegacyTool | ToolDef;

interface ToolManagerProps {
  tools: AnyTool[];
  onChange: (tools: AnyTool[]) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

type ImportMode = 'manual' | 'mcp' | 'openapi';

export function ToolManager({ tools, onChange }: ToolManagerProps) {
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [showForm, setShowForm] = useState(false);

  // MCP state
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpHeaders, setMcpHeaders] = useState<ToolHeader[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState('');
  const [mcpTools, setMcpTools] = useState<ToolDef[]>([]);
  const [mcpSelected, setMcpSelected] = useState<Set<number>>(new Set());

  // OpenAPI state
  const [openApiSource, setOpenApiSource] = useState('');
  const [openApiLoading, setOpenApiLoading] = useState(false);
  const [openApiError, setOpenApiError] = useState('');
  const [openApiTools, setOpenApiTools] = useState<ToolDef[]>([]);
  const [openApiSelected, setOpenApiSelected] = useState<Set<number>>(new Set());
  const [openApiTitle, setOpenApiTitle] = useState('');

  // Manual state
  const [toolMode, setToolMode] = useState<'form' | 'json'>('form');
  const [manualTool, setManualTool] = useState<LegacyTool>(emptyLegacyTool);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [manualError, setManualError] = useState('');

  // ── MCP connect ────────────────────────────────────────────────────────

  const connectMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpError('');
    setMcpTools([]);
    try {
      const headers: Record<string, string> = {};
      for (const h of mcpHeaders) {
        if (h.key) headers[h.key] = h.value ?? '';
      }

      const res = await authedPost<{
        serverName: string;
        protocolVersion: string;
        toolCount: number;
        tools: ToolDef[];
      }>('/api/v1/tools/mcp/connect', { url: mcpUrl, headers });

      setMcpTools(res.tools);
      setMcpSelected(new Set(res.tools.map((_, i) => i)));
    } catch (e: any) {
      setMcpError(e.message || 'Failed to connect to MCP server');
    } finally {
      setMcpLoading(false);
    }
  }, [mcpUrl, mcpHeaders]);

  const importSelectedMcp = useCallback(() => {
    const selected = mcpTools.filter((_, i) => mcpSelected.has(i));
    onChange([...tools, ...selected]);
    setMode(null);
    setMcpTools([]);
    setMcpUrl('');
  }, [mcpTools, mcpSelected, tools, onChange]);

  // ── OpenAPI import ─────────────────────────────────────────────────────

  const importOpenApi = useCallback(async () => {
    setOpenApiLoading(true);
    setOpenApiError('');
    setOpenApiTools([]);
    try {
      const res = await authedPost<{
        title: string;
        serverUrl: string;
        toolCount: number;
        tools: ToolDef[];
      }>('/api/v1/tools/openapi/import', { source: openApiSource });

      setOpenApiTools(res.tools);
      setOpenApiTitle(res.title ?? '');
      setOpenApiSelected(new Set(res.tools.map((_, i) => i)));
    } catch (e: any) {
      setOpenApiError(e.message || 'Failed to import OpenAPI spec');
    } finally {
      setOpenApiLoading(false);
    }
  }, [openApiSource]);

  const importSelectedOpenApi = useCallback(() => {
    const selected = openApiTools.filter((_, i) => openApiSelected.has(i));
    onChange([...tools, ...selected]);
    setMode(null);
    setOpenApiTools([]);
    setOpenApiSource('');
  }, [openApiTools, openApiSelected, tools, onChange]);

  // ── Manual add ─────────────────────────────────────────────────────────

  const addManualTool = useCallback(() => {
    if (!manualTool.name.trim() || !manualTool.url.trim()) {
      setManualError('Name and URL are required');
      return;
    }
    if (tools.some(t => t.name === manualTool.name)) {
      setManualError('Tool name must be unique');
      return;
    }
    onChange([...tools, manualTool]);
    setManualTool({ ...emptyLegacyTool });
    setShowForm(false);
    setManualError('');
  }, [manualTool, tools, onChange]);

  const addJsonTool = useCallback(() => {
    try {
      const obj = JSON.parse(jsonText);
      // Accept both legacy and normalized shapes
      if (obj.type === 'tool') {
        onChange([...tools, obj as ToolDef]);
      } else {
        onChange([...tools, obj as LegacyTool]);
      }
      setJsonText('');
      setShowForm(false);
      setJsonError('');
    } catch {
      setJsonError('Invalid JSON');
    }
  }, [jsonText, tools, onChange]);

  // ── Remove tool ────────────────────────────────────────────────────────

  const removeTool = useCallback((index: number) => {
    onChange(tools.filter((_, i) => i !== index));
  }, [tools, onChange]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Existing tools list — scrollable if many tools */}
      <div className={`space-y-2 ${tools.length > 5 ? 'max-h-64 overflow-y-auto' : ''}`}>
        {tools.map((t, i) => (
          <div key={i} className="flex items-center justify-between gap-3 border border-line px-4 py-3 text-sm">
            <span className="text-ink font-medium truncate shrink-0">{t.name}</span>
            <span className="text-ink-3 font-mono text-xs truncate flex-1 text-right overflow-x-auto whitespace-nowrap">
              <Tag tone="neutral" className="mr-2 shrink-0">
              {t.type === 'tool' ? 'API' : t.type === 'mcp' ? 'MCP' : t.type === 'sandbox' ? 'Sandbox' : t.type === 'js' ? 'JS' : 'HTTP'}
            </Tag>
            {t.type === 'tool' ? t.execution.url : t.url}
          </span>
          <button
            type="button"
            onClick={() => removeTool(i)}
            className="text-ink-3 hover:text-err transition-colors shrink-0"
          >
            Remove
          </button>
        </div>
        ))}
      </div>

      {/* Add buttons */}
      {!showForm && !mode && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" label="+ Import from MCP" onClick={() => { setMode('mcp'); setShowForm(false); }} />
          <Button type="button" variant="outline" label="+ Import from OpenAPI" onClick={() => { setMode('openapi'); setShowForm(false); }} />
          <Button type="button" variant="outline" label="+ Add manually" onClick={() => { setMode('manual'); setShowForm(true); }} />
        </div>
      )}

      {/* ── MCP Connect ──────────────────────────────────────────────── */}
      {mode === 'mcp' && (
        <div className="border border-line p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Connect MCP Server</h4>
            <Button type="button" variant="ghost" label="Cancel" onClick={() => { setMode(null); setMcpTools([]); }} />
          </div>

          <FormField label="Server URL">
            <FormInput
              className="font-mono"
              value={mcpUrl}
              onChange={e => setMcpUrl(e.target.value)}
              placeholder="https://mcp-server.example.com/sse"
            />
          </FormField>

          <FormField label="Auth headers (optional)">
            <HeaderManager headers={mcpHeaders} onChange={setMcpHeaders} />
          </FormField>

          {mcpError && <p className="text-xs text-err">{mcpError}</p>}

          <Button
            type="button"
            variant="primary"
            label={mcpLoading ? 'Connecting…' : 'Connect & list tools'}
            onClick={connectMcp}
            disabled={mcpLoading || !mcpUrl.trim()}
          />

          {mcpTools.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-ink-3">{mcpTools.length} tools found. Select which to import:</p>
              {mcpTools.map((t, i) => (
                <label key={i} className="flex items-center gap-3 border border-line px-3 py-2 text-sm cursor-pointer hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={mcpSelected.has(i)}
                    onChange={e => {
                      const next = new Set(mcpSelected);
                      e.target.checked ? next.add(i) : next.delete(i);
                      setMcpSelected(next);
                    }}
                    className="accent-cream"
                  />
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="text-ink-3 text-xs truncate flex-1">{t.description}</span>
                </label>
              ))}
              <Button
                type="button"
                variant="primary"
                label={`Import ${mcpSelected.size} tool${mcpSelected.size !== 1 ? 's' : ''}`}
                onClick={importSelectedMcp}
                disabled={mcpSelected.size === 0}
              />
            </div>
          )}
        </div>
      )}

      {/* ── OpenAPI Import ───────────────────────────────────────────── */}
      {mode === 'openapi' && (
        <div className="border border-line p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Import from OpenAPI Spec</h4>
            <Button type="button" variant="ghost" label="Cancel" onClick={() => { setMode(null); setOpenApiTools([]); }} />
          </div>

          <FormField label="Spec URL or paste JSON">
            <FormInput
              className="font-mono"
              value={openApiSource}
              onChange={e => setOpenApiSource(e.target.value)}
              placeholder="https://api.example.com/openapi.json"
            />
          </FormField>

          {openApiError && <p className="text-xs text-err">{openApiError}</p>}

          <Button
            type="button"
            variant="primary"
            label={openApiLoading ? 'Importing…' : 'Parse & list tools'}
            onClick={importOpenApi}
            disabled={openApiLoading || !openApiSource.trim()}
          />

          {openApiTools.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-ink-3">
                {openApiTitle && <span className="font-medium">{openApiTitle} — </span>}
                {openApiTools.length} operations found. Select which to import:
              </p>
              {openApiTools.map((t, i) => (
                <label key={i} className="flex items-center gap-3 border border-line px-3 py-2 text-sm cursor-pointer hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={openApiSelected.has(i)}
                    onChange={e => {
                      const next = new Set(openApiSelected);
                      e.target.checked ? next.add(i) : next.delete(i);
                      setOpenApiSelected(next);
                    }}
                    className="accent-cream"
                  />
                  <Tag tone="neutral">{t.execution.method}</Tag>
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="text-ink-3 text-xs truncate flex-1">{t.description}</span>
                </label>
              ))}
              <Button
                type="button"
                variant="primary"
                label={`Import ${openApiSelected.size} tool${openApiSelected.size !== 1 ? 's' : ''}`}
                onClick={importSelectedOpenApi}
                disabled={openApiSelected.size === 0}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Manual Entry ─────────────────────────────────────────────── */}
      {mode === 'manual' && showForm && (
        <div className="border border-line p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Add Tool Manually</h4>
            <div className="flex items-center gap-0 border border-line w-fit">
              <button type="button" onClick={() => setToolMode('form')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${toolMode === 'form' ? 'bg-cream/10 text-cream' : 'text-ink-3 hover:text-ink-2'}`}>
                Form
              </button>
              <div className="w-px h-4 bg-line" />
              <button type="button" onClick={() => setToolMode('json')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${toolMode === 'json' ? 'bg-cream/10 text-cream' : 'text-ink-3 hover:text-ink-2'}`}>
                Paste JSON
              </button>
            </div>
          </div>

          {toolMode === 'form' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Type">
                  <FormSelect value={manualTool.type} onChange={e => setManualTool(t => ({ ...t, type: e.target.value as LegacyTool['type'] }))}>
                    <option value="http">HTTP</option>
                    <option value="mcp">MCP</option>
                    <option value="js">JS Eval</option>
                    <option value="sandbox">Sandbox</option>
                  </FormSelect>
                </FormField>
                <FormField label="Name">
                  <FormInput value={manualTool.name} onChange={e => setManualTool(t => ({ ...t, name: e.target.value }))} placeholder="web-search" />
                </FormField>
              </div>

              <FormField label="Description">
                <FormTextarea rows={2} value={manualTool.description} onChange={e => setManualTool(t => ({ ...t, description: e.target.value }))} placeholder="What this tool does" />
              </FormField>

              {manualTool.type === 'http' && <HttpForm tool={manualTool} onChange={setManualTool} />}
              {manualTool.type === 'mcp' && <McpForm tool={manualTool} onChange={setManualTool} />}
              {manualTool.type === 'js' && <JsForm tool={manualTool} onChange={setManualTool} />}
              {manualTool.type === 'sandbox' && <SandboxForm tool={manualTool} onChange={setManualTool} />}
            </>
          ) : (
            <FormField label="Tool JSON">
              <FormTextarea
                rows={10}
                className="font-mono text-xs"
                value={jsonText}
                onChange={e => { setJsonText(e.target.value); setJsonError(''); }}
                placeholder='{"type":"http","name":"...","url":"https://..."}'
              />
              {jsonError && <p className="text-xs text-err mt-1">{jsonError}</p>}
            </FormField>
          )}

          {manualError && <p className="text-xs text-err">{manualError}</p>}

          <div className="flex gap-2">
            <Button type="button" variant="primary" label="Add tool" onClick={toolMode === 'form' ? addManualTool : addJsonTool} />
            <Button type="button" variant="ghost" label="Cancel" onClick={() => { setMode(null); setShowForm(false); setManualError(''); }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-forms for each tool type ───────────────────────────────────────────

function HttpForm({ tool, onChange }: { tool: LegacyTool; onChange: (t: LegacyTool) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
        <FormField label="URL">
          <FormInput className="font-mono" value={tool.url} onChange={e => onChange({ ...tool, url: e.target.value })} placeholder="https://api.example.com/endpoint" />
        </FormField>
        <FormField label="Method">
          <FormSelect value={tool.method ?? 'POST'} onChange={e => onChange({ ...tool, method: e.target.value as LegacyTool['method'] })}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
          </FormSelect>
        </FormField>
      </div>
      <FormField label="Query parameters">
        <QueryParamManager params={tool.queryParams} onChange={p => onChange({ ...tool, queryParams: p })} />
      </FormField>
      <FormField label="Headers">
        <HeaderManager headers={tool.headers} onChange={h => onChange({ ...tool, headers: h })} />
      </FormField>
      {['POST', 'PUT', 'PATCH'].includes(tool.method ?? 'POST') && (
        <FormField label="Body payload">
          <FormTextarea rows={3} className="font-mono text-xs" value={tool.body.payload} onChange={e => onChange({ ...tool, body: { ...tool.body, payload: e.target.value } })} placeholder='{"key": "value"}' />
        </FormField>
      )}
    </div>
  );
}

function McpForm({ tool, onChange }: { tool: LegacyTool; onChange: (t: LegacyTool) => void }) {
  return (
    <div className="space-y-3">
      <FormField label="MCP Server URL">
        <FormInput className="font-mono" value={tool.url} onChange={e => onChange({ ...tool, url: e.target.value })} placeholder="https://mcp-server.example.com/sse" />
      </FormField>
      <FormField label="Tool name on server">
        <FormInput value={tool.toolName ?? ''} onChange={e => onChange({ ...tool, toolName: e.target.value })} placeholder="tool_name" />
      </FormField>
    </div>
  );
}

function JsForm({ tool, onChange }: { tool: LegacyTool; onChange: (t: LegacyTool) => void }) {
  return (
    <FormField label="JS code (receives `input`, returns string)">
      <FormTextarea rows={6} className="font-mono text-xs" value={tool.code ?? ''} onChange={e => onChange({ ...tool, code: e.target.value })} placeholder="return input.toUpperCase();" />
    </FormField>
  );
}

function SandboxForm({ tool, onChange }: { tool: LegacyTool; onChange: (t: LegacyTool) => void }) {
  return (
    <div className="space-y-3">
      <FormField label="Command ({input} is replaced with agent input)">
        <FormInput className="font-mono" value={tool.command ?? ''} onChange={e => onChange({ ...tool, command: e.target.value })} placeholder="python3 -c '{input}'" />
      </FormField>
      <FormField label="Setup commands (optional, runs first)">
        <FormInput className="font-mono" value={tool.setup ?? ''} onChange={e => onChange({ ...tool, setup: e.target.value })} placeholder="pip install pandas" />
      </FormField>
      <FormField label="Timeout (seconds)">
        <FormInput type="number" value={tool.timeout ?? 300} onChange={e => onChange({ ...tool, timeout: parseInt(e.target.value) || 300 })} />
      </FormField>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

const emptyLegacyTool: LegacyTool = {
  type: 'http', name: '', description: '', url: '', method: 'POST',
  headers: [], queryParams: [], body: { contentType: 'application/json', payload: '' },
};
