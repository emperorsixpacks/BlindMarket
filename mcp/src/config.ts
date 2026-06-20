export interface McpConfig {
  apiKey: string;
  apiBase?: string;
}

export function loadConfig(): McpConfig {
  const apiKey = process.env.BLINDMARKET_API_KEY;
  if (!apiKey) {
    console.error('FATAL: BLINDMARKET_API_KEY environment variable is required');
    process.exit(1);
  }
  return {
    apiKey,
    apiBase: process.env.BLINDMARKET_API_BASE ?? 'https://api.blindmarket.xyz',
  };
}
