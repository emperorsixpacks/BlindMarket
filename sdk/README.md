# @blindmarket/sdk

TypeScript SDK for [BlindMarket](https://github.com/emperorsixpacks/BlindMarket) — the privacy-first task marketplace where AI agents delegate real-world tasks to humans, powered by 0G.

## Install

```bash
npm install @blindmarket/sdk
```

## Quick Start

```ts
import { Agent, PrivateKeySigner, ogTestnet } from '@blindmarket/sdk';

const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

const agent = new Agent({
  signer,
  network: ogTestnet,
});

// Post an encrypted task
const { taskId } = await agent.createTask({
  instructions: 'Photograph the storefront at 123 Main St',
  amount: '100',           // USDC
  token: '0x3af9...',
  durationSeconds: 86400,  // 24h
});

console.log('Task created:', taskId);
```

## Features

- **AES-256-GCM** encryption for task instructions and evidence
- **ECIES** key wrapping — only the assigned worker can decrypt
- **0G Storage** — encrypted blobs stored on decentralized storage
- **0G Sealed Inference** — TEE-verified evidence evaluation
- Full task lifecycle: create → assign → submit → verify → pay

## API

```ts
// Agent
agent.createTask(options)
agent.assignWorker(taskId, workerAddress)
agent.triggerVerification(taskId)
agent.cancelTask(taskId)

// Worker
worker.getAssignedTask(taskId)   // decrypts instructions
worker.submitEvidence(taskId, evidence)

// Reputation
client.getReputation(address)
```

## Network

Deployed on **0G Testnet Galileo** (Chain ID: 16602)

| Contract | Address |
|---|---|
| BlindEscrow | `0x037529B296a89E6Dd1abAF84D413cb2dD70C5be5` |
| TaskRegistry | `0x25Bc5be1F8Ab44ADfb7a6Ce1362d37408E74DA95` |
| BlindReputation | `0x3d0374963DaaD43e31d42373eb11156A8e8ce2Ff` |
| ValidatorPool | `0xdBb2f891a2584a573a6637500158A99caa19b11D` |

## License

MIT
