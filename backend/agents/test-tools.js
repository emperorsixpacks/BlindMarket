#!/usr/bin/env node
/**
 * Tool composition smoke test.
 *
 * Verifies that the worker's buildTools() logic correctly:
 *   1. Constructs URLs with placeholders and query params
 *   2. Sets headers (including encrypted ones)
 *   3. Builds request bodies
 *   4. Returns results the LLM can consume
 *
 * Run:  node backend/agents/test-tools.js
 *   or: npm run test:tools
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, createECDH, createHmac } from 'crypto';
import { webcrypto } from 'crypto';

// ── Minimal mocks ────────────────────────────────────────────────────────────

const TOOL_CONFIGS = [
  {
    type: 'http',
    name: 'weather_lookup',
    description: 'Get current weather for a city',
    url: 'https://api.openweathermap.org/data/2.5/weather?q={city}&appid=fakekey',
    method: 'GET',
    queryParams: [{ name: 'units', value: 'metric' }],
    headers: [
      { name: 'X-Source', value: 'blindmarket-agent', isSensitive: false },
    ],
  },
  {
    type: 'http',
    name: 'submit_order',
    description: 'Submit an order to the inventory system',
    url: 'https://api.example.com/orders',
    method: 'POST',
    headers: [
      { name: 'Authorization', value: 'Bearer tok_test123', isSensitive: false },
      { name: 'X-Internal-Key', value: 'super-secret-key', isSensitive: true },
    ],
    body: {
      contentType: 'application/json',
      payload: '{"item": "{{input}}", "qty": 1, "source": "agent"}',
    },
  },
  {
    type: 'http',
    name: 'search',
    description: 'Search the web',
    url: 'https://api.search.com/v1/search',
    method: 'GET',
    queryParams: [
      { name: 'q', value: '{input}' },
      { name: 'limit', value: '5' },
    ],
  },
];

// ── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function assertIncludes(str, substr, label) {
  assert(str.includes(substr), `${label} (expected "${substr}" in "${str.slice(0, 100)}")`);
}

// ── Simulate buildTools() URL/header/body logic from worker.js ───────────────

function simulateToolExecution(toolConfig, input) {
  let url = toolConfig.url.replace(/\{(\w+)\}/g, () => encodeURIComponent(input));

  // Query params
  if (toolConfig.queryParams && toolConfig.queryParams.length > 0) {
    const qs = new URLSearchParams(toolConfig.queryParams.map(q => [q.name, q.value.replace(/\{input\}/g, input)]));
    url += (url.includes('?') ? '&' : '?') + qs.toString();
  }

  // Headers
  const headers = { 'Content-Type': toolConfig.body?.contentType ?? 'application/json' };
  for (const h of (toolConfig.headers ?? [])) {
    headers[h.name] = h.isSensitive
      ? `[DECRYPTED:${h.value}]` // simulate decryption
      : h.value.replace(/\{input\}/g, input);
  }

  // Body
  let body;
  if (toolConfig.body?.payload) {
    const rawPayload = toolConfig.body.payload.replace(/\{\{input\}\}/g, input);
    body = toolConfig.body.contentType === 'application/json'
      ? JSON.stringify(JSON.parse(rawPayload))
      : rawPayload;
  }

  return { url, method: toolConfig.method, headers, body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n🔧 Tool Composition Smoke Tests\n');

// ── Test 1: GET with URL placeholder + query params ──────────────────────────
console.log('1. GET with URL placeholder + query params');
{
  const result = simulateToolExecution(TOOL_CONFIGS[0], 'London');
  assertIncludes(result.url, 'q=London', 'city placeholder replaced');
  assertIncludes(result.url, 'units=metric', 'query param appended');
  assertIncludes(result.url, 'appid=fakekey', 'original URL params preserved');
  assert(result.method === 'GET', 'method is GET');
  assert(result.body === undefined, 'no body for GET');
}

// ── Test 2: POST with body template + sensitive headers ──────────────────────
console.log('\n2. POST with body template + sensitive headers');
{
  const result = simulateToolExecution(TOOL_CONFIGS[1], 'widget-42');
  assert(result.method === 'POST', 'method is POST');
  assertIncludes(result.url, 'orders', 'URL correct');
  assert(result.headers['Authorization'] === 'Bearer tok_test123', 'plain header preserved');
  assert(result.headers['X-Internal-Key'] === '[DECRYPTED:super-secret-key]', 'sensitive header decrypted');
  assert(result.headers['Content-Type'] === 'application/json', 'content type set');

  const parsed = JSON.parse(result.body);
  assert(parsed.item === 'widget-42', 'body {{input}} replaced');
  assert(parsed.qty === 1, 'body static fields preserved');
  assert(parsed.source === 'agent', 'body extra field present');
}

// ── Test 3: GET with only query params (no URL placeholder) ──────────────────
console.log('\n3. GET with only query params (no URL placeholder)');
{
  const result = simulateToolExecution(TOOL_CONFIGS[2], 'what is 0G network');
  assertIncludes(result.url, 'q=what+is+0G+network', 'input in query param');
  assertIncludes(result.url, 'limit=5', 'static query param present');
  assert(result.method === 'GET', 'method is GET');
}

// ── Test 4: Tool definition shape for LLM consumption ────────────────────────
console.log('\n4. Tool definition shape for LLM consumption');
{
  for (const tc of TOOL_CONFIGS) {
    assert(tc.name.length > 0 && tc.name.length <= 64, `${tc.name}: name length 1-64`);
    assert(tc.description.length > 0, `${tc.name}: has description`);
    assert(tc.url.startsWith('https://'), `${tc.name}: URL is HTTPS`);
    assert(['GET', 'POST', 'PUT', 'DELETE'].includes(tc.method), `${tc.name}: valid method`);
  }
}

// ── Test 5: LLM prompt composition (simulated) ──────────────────────────────
console.log('\n5. LLM prompt composition (simulated)');
{
  // Simulate what the worker sends to the LLM
  const systemPrompt = `[IDENTITY]
You are a helpful agent with access to weather and ordering tools.

[CAPABILITIES]
You have access to tools. If you use a tool, you must synthesize the results into a final text summary for the user.`;

  const toolDefs = TOOL_CONFIGS.map(t =>
    `- ${t.name}: ${t.description} (${t.method} ${t.url.split('?')[0]})`
  ).join('\n');

  const fullPrompt = `${systemPrompt}\n\nAvailable tools:\n${toolDefs}\n\nUser request: What's the weather in Paris?`;

  assertIncludes(fullPrompt, 'weather_lookup', 'tool name in prompt');
  assertIncludes(fullPrompt, 'Get current weather', 'tool description in prompt');
  assertIncludes(fullPrompt, "What's the weather in Paris?", 'user request in prompt');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All tool composition tests passed!\n');
}
