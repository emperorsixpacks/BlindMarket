import { getPool } from './neonDb.js';
import type { DeployedAgent, AgentCapability, AgentTool, LLMProvider, AgentStatus } from '../types.js';

function rowToAgent(row: Record<string, unknown>): DeployedAgent {
  return {
    id: row.id as string,
    ownerAddress: row.owner_address as string,
    authorizedOwners: (row.authorized_owners as string[])?.length ? (row.authorized_owners as string[]) : undefined,
    name: row.name as string,
    instructions: row.instructions as string,
    provider: row.provider as LLMProvider,
    model: row.model as string,
    apiKey: row.api_key as string,
    encryptedApiKey: row.encrypted_api_key as string,
    capabilities: (row.capabilities as AgentCapability[]) ?? [],
    tools: (row.tools as AgentTool[]) ?? [],
    status: (row.status as AgentStatus) ?? 'stopped',
    deployedAt: (row.deployed_at as string) ?? new Date().toISOString(),
    lastActiveAt: (row.last_active_at as string) ?? undefined,
    storageRef: (row.storage_ref as string) ?? undefined,
    platformToken: (row.platform_token as string) ?? undefined,
    walletAddress: row.wallet_address as string,
    publicKey: row.public_key as string,
    encryptedPrivateKey: row.encrypted_private_key as string,
    rawPrivateKey: (row.raw_private_key as string) ?? undefined,
    inftTokenId: (row.inft_token_id as number) ?? undefined,
    minReward: (row.min_reward as string) ?? undefined,
  };
}

export async function saveAgent(agent: DeployedAgent): Promise<void> {
  const db = await getPool();
  await db.query(
    `INSERT INTO deployed_agents
       (id, owner_address, authorized_owners, name, instructions,
        provider, model, api_key, encrypted_api_key, capabilities,
        tools, status, deployed_at, last_active_at, storage_ref,
        platform_token, wallet_address, public_key, encrypted_private_key,
        raw_private_key, inft_token_id, min_reward, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20, $21, $22, NOW())
     ON CONFLICT (id) DO UPDATE SET
       owner_address = EXCLUDED.owner_address,
       authorized_owners = EXCLUDED.authorized_owners,
       name = EXCLUDED.name,
       instructions = EXCLUDED.instructions,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       api_key = EXCLUDED.api_key,
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       capabilities = EXCLUDED.capabilities,
       tools = EXCLUDED.tools,
       status = EXCLUDED.status,
       last_active_at = EXCLUDED.last_active_at,
       storage_ref = EXCLUDED.storage_ref,
       platform_token = EXCLUDED.platform_token,
       wallet_address = EXCLUDED.wallet_address,
       public_key = EXCLUDED.public_key,
       encrypted_private_key = EXCLUDED.encrypted_private_key,
       raw_private_key = EXCLUDED.raw_private_key,
       inft_token_id = EXCLUDED.inft_token_id,
       min_reward = EXCLUDED.min_reward,
       updated_at = NOW()`,
    [
      agent.id, agent.ownerAddress, agent.authorizedOwners ?? [],
      agent.name, agent.instructions, agent.provider, agent.model,
      agent.apiKey, agent.encryptedApiKey, agent.capabilities,
      JSON.stringify(agent.tools ?? []), agent.status,
      agent.deployedAt, agent.lastActiveAt ?? null, agent.storageRef ?? null,
      agent.platformToken ?? null, agent.walletAddress, agent.publicKey,
      agent.encryptedPrivateKey, agent.rawPrivateKey ?? null,
      agent.inftTokenId ?? null, agent.minReward ?? null,
    ],
  );
}

export async function loadAgent(id: string): Promise<DeployedAgent | null> {
  const db = await getPool();
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM deployed_agents WHERE id = $1',
    [id],
  );
  return rows[0] ? rowToAgent(rows[0]) : null;
}

export async function loadAgentByWallet(walletAddress: string): Promise<DeployedAgent | null> {
  const db = await getPool();
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM deployed_agents WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1',
    [walletAddress],
  );
  return rows[0] ? rowToAgent(rows[0]) : null;
}

export async function loadAllAgents(): Promise<DeployedAgent[]> {
  const db = await getPool();
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM deployed_agents ORDER BY deployed_at DESC',
  );
  return rows.map(rowToAgent);
}

export async function deleteAgent(id: string): Promise<void> {
  const db = await getPool();
  await db.query('DELETE FROM deployed_agents WHERE id = $1', [id]);
}