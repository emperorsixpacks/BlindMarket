/**
 * Standalone Redis → PG migration.
 *
 * Run from the backend/ directory where both Redis Cloud and Neon PG
 * are reachable.
 *
 * Usage:
 *   node scripts/migrate-redis-to-pg.js
 *
 * Reads REDIS_URL and DATABASE_URL from environment.
 */
import { Redis } from 'ioredis';
import pg from 'pg';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set — source backend/.env first');
  process.exit(1);
}

const r = new Redis(REDIS_URL);
const p = new pg.Pool({ connectionString: DATABASE_URL });

const TS = new Date().toISOString();

async function migrateAgents() {
  const keys = await r.keys('agent:*');
  const agentKeys = keys.filter(k =>
    !k.includes(':logs') && !k.includes(':heartbeat') &&
    !k.startsWith('agent:executor:') && k !== 'agent:executor:all'
  );

  let ok = 0, fail = 0;
  for (const key of agentKeys) {
    try {
      const raw = await r.get(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      const id = data.id || data.agentId;
      if (!id) { fail++; continue; }

      const ownerAddress = data.ownerAddress || data.owner_address || '';
      const name = data.name || data.displayName || 'Unnamed Agent';
      const instructions = data.instructions || '';
      const provider = data.provider || 'openai';
      const model = data.model || 'gpt-4o';
      const apiKey = data.apiKey || data.api_key || '';
      const encryptedApiKey = data.encryptedApiKey || data.encrypted_api_key || '';
      const capabilities = data.capabilities ?? [];
      const tools = data.tools ?? [];
      const status = data.status || 'stopped';
      const deployedAt = data.deployedAt || data.deployed_at || TS;
      const lastActiveAt = data.lastActiveAt || data.last_active_at || null;
      const storageRef = data.storageRef || data.storage_ref || null;
      const platformToken = data.platformToken || data.platform_token || null;
      const walletAddress = data.walletAddress || data.wallet_address || '';
      const publicKey = data.publicKey || data.public_key || '';
      const encryptedPrivateKey = data.encryptedPrivateKey || data.encrypted_private_key || '';
      const rawPrivateKey = data.rawPrivateKey || data.raw_private_key || null;
      const inftTokenId = data.inftTokenId ?? data.inft_token_id ?? null;
      const minReward = data.minReward ?? data.min_reward ?? null;
      const authorizedOwners = data.authorizedOwners ?? data.authorized_owners ?? [];

      await p.query(
        `INSERT INTO deployed_agents
           (id, owner_address, authorized_owners, name, instructions,
            provider, model, api_key, encrypted_api_key, capabilities,
            tools, status, deployed_at, last_active_at, storage_ref,
            platform_token, wallet_address, public_key, encrypted_private_key,
            raw_private_key, inft_token_id, min_reward, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
           $14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
         ON CONFLICT (id) DO NOTHING`,
        [id, ownerAddress, authorizedOwners, name, instructions,
         provider, model, apiKey, encryptedApiKey, capabilities,
         JSON.stringify(tools), status, deployedAt,
         lastActiveAt, storageRef, platformToken,
         walletAddress, publicKey, encryptedPrivateKey, rawPrivateKey,
         inftTokenId, minReward],
      );
      ok++;
    } catch (err) {
      fail++;
      console.error(`  FAIL agent ${key}:`, err.message);
    }
  }
  console.log(`  done: ${ok} ok, ${fail} failed`);
}

async function migrateExecutors() {
  const type = await r.type('agent:executor:all');
  let entries = [];

  if (type === 'set') {
    const members = await r.smembers('agent:executor:all');
    for (const addr of members) {
      const raw = await r.get(`agent:executor:${addr}`);
      if (!raw) continue;
      try { entries.push([addr, JSON.parse(raw)]); } catch {}
    }
  } else {
    const raw = await r.get('agent:executor:all');
    if (raw) {
      try { entries = Object.entries(JSON.parse(raw)); } catch {}
    }
  }

  let ok = 0, fail = 0;
  for (const [addr, d] of entries) {
    try {
      if (!addr || !d.displayName) { fail++; continue; }
      await p.query(
        `INSERT INTO agent_executors
           (address, display_name, capabilities, public_key, reputation,
            tasks_completed, total_earned_raw, min_reward,
            preferred_capabilities, agent_card_url, mcp_endpoint_url,
            registered_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (address) DO UPDATE SET
           capabilities = EXCLUDED.capabilities,
           public_key = EXCLUDED.public_key,
           reputation = EXCLUDED.reputation,
           tasks_completed = EXCLUDED.tasks_completed,
           total_earned_raw = EXCLUDED.total_earned_raw,
           min_reward = EXCLUDED.min_reward,
           preferred_capabilities = EXCLUDED.preferred_capabilities,
           agent_card_url = EXCLUDED.agent_card_url,
           mcp_endpoint_url = EXCLUDED.mcp_endpoint_url,
           updated_at = NOW()`,
        [addr, d.displayName, d.capabilities ?? [],
         d.publicKey ?? '', d.reputation ?? 50,
         d.tasksCompleted ?? 0, d.totalEarnedRaw ?? '0',
         d.minReward ?? null, d.preferredCapabilities ?? [],
         d.agentCardUrl ?? null, d.mcpEndpointUrl ?? null,
         d.registeredAt ?? TS],
      );
      ok++;
    } catch (err) {
      fail++;
      console.error(`  FAIL executor ${addr.slice(0,10)}…:`, err.message);
    }
  }
  console.log(`  done: ${ok} ok, ${fail} failed`);
}

async function main() {
  console.log('Migrating deployed agents…');
  await migrateAgents();

  console.log('Migrating executors…');
  await migrateExecutors();

  const da = await p.query('SELECT count(*) FROM deployed_agents');
  const ae = await p.query('SELECT count(*) FROM agent_executors');
  console.log(`\nPG now has: ${da.rows[0].count} agents, ${ae.rows[0].count} executors`);

  // Registered users
  let cursor = '0';
  const registered = new Set();
  do {
    const [next, batch] = await r.scan(cursor, 'MATCH', 'a2a:poster:*', 'COUNT', 500);
    cursor = next;
    for (const k of batch) {
      const a = k.replace(/^a2a:poster:/, '');
      if (a.startsWith('0x')) registered.add(a);
    }
  } while (cursor !== '0');
  const owners = await p.query("SELECT DISTINCT owner_address FROM deployed_agents WHERE owner_address IS NOT NULL");
  for (const row of owners.rows) {
    registered.add(row.owner_address.toLowerCase());
  }
  console.log(`Registered users (posters ∪ owners): ${registered.size}`);

  await r.quit();
  await p.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
