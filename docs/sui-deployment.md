# Sui Chain Deployment Guide — BlindMarket

This doc covers what your teammate needs to deploy the Move contracts to Sui
and configure the backend/frontend to use them.

## Prerequisites

```bash
# Install Sui CLI
cargo install --locked --git https://github.com/MystenLabs/sui.git --branch testnet sui

# Configure for testnet
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
sui client switch --env testnet

# Fund your address
sui client faucet
sui client gas   # verify you have SUI
```

## 1. Deploy Move Contracts

```bash
cd contracts/sui

# Build
sui move build

# Run tests (if any)
sui move test

# Deploy to testnet
sui client publish --gas-budget 100000000
```

After publishing, you'll get output like:
```
Published Objects:
  PackageID: 0xd4296d049fbf05591b729434f9f73628f68d7fb939f24d2ac5b6c9d55ff0a44d
  Created Objects:
    - ObjectID: 0x642582b447f002fa7e0a6bbe8ea61915b74e46737469bdd6930600511f27402a  (BlindEscrow shared object)
    - ObjectID: 0x606dd42af017b8093fcd8eff10ad440a2d2ad424b6f67f4ef0789c4cf51218ff  (TaskRegistry shared object)
    - ObjectID: 0xfd56d47bf24cb3d9354b16971d43fa4a0aa72bcbbd62dbe386cb72b6d9b32a87  (BlindReputation shared object)
    - ObjectID: 0x2161b19b1dd3c9248016d53791c0e7947231df83184dc818bd0b99b9fc364fa0  (AdminCap — transfer to backend signer)
```

## 2. Fill In Backend `.env`

After deployment, update these values in `backend/.env`:

```bash
# Switch to Sui
CHAIN_TYPE=sui

# From publish output:
SUI_NETWORK_ID=testnet
SUI_PACKAGE_ID=0xd4296d049fbf05591b729434f9f73628f68d7fb939f24d2ac5b6c9d55ff0a44d
SUI_BLIND_ESCROW_OBJECT_ID=0x642582b447f002fa7e0a6bbe8ea61915b74e46737469bdd6930600511f27402a
SUI_TASK_REGISTRY_OBJECT_ID=0x606dd42af017b8093fcd8eff10ad440a2d2ad424b6f67f4ef0789c4cf51218ff
SUI_BLIND_REPUTATION_OBJECT_ID=0xfd56d47bf24cb3d9354b16971d43fa4a0aa72bcbbd62dbe386cb72b6d9b32a87
SUI_ADMIN_CAP_ID=0x2161b19b1dd3c9248016d53791c0e7947231df83184dc818bd0b99b9fc364fa0

# RPC (use a dedicated node for production, not the public one):
SUI_RPC_URL=https://fullnode.testnet.sui.io:443

# Generate a Sui key for the backend:
# sui keytool generate ed25519
SUI_AGENT_PRIVATE_KEY=suiprivkey...
```

## 3. Generate Agent Keys for Sui

Sui uses Ed25519 (not secp256k1 like 0G). Agent keys must be Sui-compatible:

```bash
# Generate one key per agent
sui keytool generate ed25519

# Output:
#   privateKey: suiprivkey1qz...
#   publicKey:  0x...
#   address:    0x...

# Store the private key as AGENT_PRIVATE_KEY for the worker
```

## 4. Update SDK Network Presets

Once deployed, update the placeholder `0x0` addresses in:

`sdk/src/network/presets.ts` — search for `sui-testnet` entries:

```typescript
'sui-testnet': {
  // ...
  packageId: '0xd4296d049fbf05591b729434f9f73628f68d7fb939f24d2ac5b6c9d55ff0a44d',
  sharedObjects: {
    blindEscrow: '0x642582b447f002fa7e0a6bbe8ea61915b74e46737469bdd6930600511f27402a',
    taskRegistry: '0x606dd42af017b8093fcd8eff10ad440a2d2ad424b6f67f4ef0789c4cf51218ff',
    blindReputation: '0xfd56d47bf24cb3d9354b16971d43fa4a0aa72bcbbd62dbe386cb72b6d9b32a87',
  },
},
```

Then rebuild the SDK:
```bash
cd sdk && npm run build
```

## 5. Verify

Start the backend with Sui mode:
```bash
cd backend
npm run dev
```

You should see in the logs:
```
[chain] Sui gRPC client connected to testnet
[chain] Sui signer: 0x...
```

## Contract Addresses (shared object IDs)

Sui shared objects are different from EVM contracts. You don't "call" a
contract address — you pass the shared object as an argument to Move
functions. The backend and SDK use these object IDs:

| Move Module | Shared Object ID | Purpose |
|---|---|---|
| `blindmarket::blind_escrow` | `0x642582b447f002fa7e0a6bbe8ea61915b74e46737469bdd6930600511f27402a` | Task lifecycle |
| `blindmarket::task_registry` | `0x606dd42af017b8093fcd8eff10ad440a2d2ad424b6f67f4ef0789c4cf51218ff` | Task discovery |
| `blindmarket::blind_reputation` | `0xfd56d47bf24cb3d9354b16971d43fa4a0aa72bcbbd62dbe386cb72b6d9b32a87` | Worker reputation |

The `AdminCap` is NOT a shared object — it's an owned object held by the
backend signer. Only the AdminCap holder can call admin functions
(cancel_task, complete_verification, resolve_dispute, etc.).

## Quick Reference: Env Vars

| Var | Example | Required? |
|---|---|---|
| `CHAIN_TYPE` | `sui` | Yes |
| `SUI_NETWORK_ID` | `testnet` | Yes |
| `SUI_PACKAGE_ID` | `0xd4296d049fbf05591b729434f9f73628f68d7fb939f24d2ac5b6c9d55ff0a44d` | Yes |
| `SUI_BLIND_ESCROW_OBJECT_ID` | `0x642582b447f002fa7e0a6bbe8ea61915b74e46737469bdd6930600511f27402a` | Yes |
| `SUI_TASK_REGISTRY_OBJECT_ID` | `0x606dd42af017b8093fcd8eff10ad440a2d2ad424b6f67f4ef0789c4cf51218ff` | Yes |
| `SUI_BLIND_REPUTATION_OBJECT_ID` | `0xfd56d47bf24cb3d9354b16971d43fa4a0aa72bcbbd62dbe386cb72b6d9b32a87` | Yes |
| `SUI_ADMIN_CAP_ID` | `0x2161b19b1dd3c9248016d53791c0e7947231df83184dc818bd0b99b9fc364fa0` | For admin ops |
| `SUI_AGENT_PRIVATE_KEY` | `suiprivkey...` | For server-side TX |
| `SUI_RPC_URL` | `https://fullnode.testnet.sui.io:443` | Has default |
| `AGENT_PRIVATE_KEY` | `suiprivkey...` | Per-agent (Sui format) |
