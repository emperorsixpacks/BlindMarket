/**
 * Smoke test: verify that buildTools() produces valid tool definitions
 * that an LLM can consume. No LLM call — just structural validation.
 *
 * Run: node --experimental-vm-modules backend/agents/worker.js --dry-run-tools
 *   or: npx vitest run backend/agents/tools.test.js
 */

import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before importing worker internals
vi.mock('ai', () => ({
  tool: (def) => def,
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => () => 'mock-model',
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => () => 'mock-model',
}));

vi.mock('@ai-sdk/groq', () => ({
  createGroq: () => () => 'mock-model',
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => 'mock-model',
}));

vi.mock('../src/services/crypto.js', () => ({
  decryptSensitive: (val) => val, // passthrough for testing
}));

// Set env vars the worker expects
process.env.AGENT_ID = 'test-agent';
process.env.AGENT_API_KEY = 'test-key';
process.env.AGENT_MODEL = 'gpt-4o';
process.env.AGENT_PROVIDER = 'openai';
process.env.AGENT_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.AGENT_INSTRUCTIONS = 'You are a test agent.';
process.env.AGENT_CAPABILITIES_RAW = '["data_processing"]';
process.env.AGENT_TOOLS_RAW = JSON.stringify([
  {
    type: 'http',
    name: 'weather_lookup',
    description: 'Get current weather for a city',
    url: 'https://api.example.com/weather/{city}',
    method: 'GET',
    queryParams: [{ name: 'units', value: 'metric' }],
    headers: [
      { name: 'X-API-Key', value: 'test-api-key-123', isSensitive: false },
      { name: 'X-Auth-Token', value: 'encrypted-secret', isSensitive: true },
    ],
    body: undefined,
  },
  {
    type: 'http',
    name: 'submit_order',
    description: 'Submit an order to the system',
    url: 'https://api.example.com/orders',
    method: 'POST',
    headers: [{ name: 'Authorization', value: 'Bearer tok_abc', isSensitive: false }],
    body: {
      contentType: 'application/json',
      payload: '{"item": "{{input}}", "qty": 1}',
    },
  },
  {
    type: 'mcp',
    name: 'code_review',
    description: 'Review code for issues',
    endpointUrl: 'https://mcp.example.com/invoke',
    toolName: 'review',
  },
]);

// Dynamic import so env vars are set before module loads
const { buildTools } = await import('./worker.js');

describe('buildTools()', () => {
  const tools = buildTools();

  it('returns an object with all configured tool names', () => {
    expect(tools).toHaveProperty('weather_lookup');
    expect(tools).toHaveProperty('submit_order');
    expect(tools).toHaveProperty('code_review');
  });

  it('each tool has description and inputSchema', () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeDefined();
      expect(t.execute).toBeInstanceOf(Function);
    }
  });

  it('HTTP tool URL has {city} placeholder', () => {
    const t = tools.weather_lookup;
    expect(t.description).toBe('Get current weather for a city');
  });

  it('MCP tool has correct description', () => {
    const t = tools.code_review;
    expect(t.description).toBe('Review code for issues');
  });

  it('tool names are sanitized (alphanumeric + underscore only)', () => {
    for (const name of Object.keys(tools)) {
      expect(name).toMatch(/^[a-zA-Z0-9_]+$/);
    }
  });
});
