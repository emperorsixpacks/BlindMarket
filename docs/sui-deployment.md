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
  PackageID: 0xe74d57b9f55eba50b9c6f0b3c09e4892a1b00f842461df16eb5bebe02a4a3f35
  Created Objects:
    - ObjectID: 0x14c90c14d60b918706e04688f1bb6df617e8134462c56822bf4d546c37a9f6ef  (BlindEscrow shared object)
    - ObjectID: 0x379864da638d2212aa11b9048dfe7ab48860075b06f8c2470681cd052bdccdf5  (TaskRegistry shared object)
    - ObjectID: 0x1769c6f22a00fcf4a4493c07eb7cf063915e664768a12aae61feea1b9e5e2fb7  (BlindReputation shared object)
    - ObjectID: 0xb2af5cecccf84f5b908def68d52eee07c6cfa1f403412e31fa6b47f7786f958d  (AdminCap — kept by deployer)
    - ObjectID: 0xc019ac36f1d073c72f9bcb89715bf8fc58b69687b26cd5dd5defa6ce64090ac2  (UpgradeCap — kept by deployer)
```

After publish, set the verifier and treasury on the escrow before the bridge
will accept any settlement calls — they default to `0x0` and the
verifier-gated entrypoints fail with `ENotVerifier` until set:

```bash
ESCROW=<BLIND_ESCROW_OBJECT_ID>
ADMIN_CAP=<ADMIN_CAP_ID>
VERIFIER=<backend SUI_AGENT_PRIVATE_KEY's address>
TREASURY=<treasury address>

sui client call --package <PACKAGE_ID> --module blind_escrow \
  --function set_verifier --args $ESCROW $VERIFIER $ADMIN_CAP --gas-budget 10000000
sui client call --package <PACKAGE_ID> --module blind_escrow \
  --function set_treasury --args $ESCROW $TREASURY $ADMIN_CAP --gas-budget 10000000
```

## 2. Fill In Backend `.env`

After deployment, update these values in `backend/.env`:

```bash
# Switch to Sui
CHAIN_TYPE=sui

# From publish output:
SUI_NETWORK_ID=testnet
SUI_PACKAGE_ID=0xe74d57b9f55eba50b9c6f0b3c09e4892a1b00f842461df16eb5bebe02a4a3f35
SUI_BLIND_ESCROW_OBJECT_ID=0x14c90c14d60b918706e04688f1bb6df617e8134462c56822bf4d546c37a9f6ef
SUI_TASK_REGISTRY_OBJECT_ID=0x379864da638d2212aa11b9048dfe7ab48860075b06f8c2470681cd052bdccdf5
SUI_BLIND_REPUTATION_OBJECT_ID=0x1769c6f22a00fcf4a4493c07eb7cf063915e664768a12aae61feea1b9e5e2fb7
SUI_ADMIN_CAP_ID=0xb2af5cecccf84f5b908def68d52eee07c6cfa1f403412e31fa6b47f7786f958d

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
  packageId: '0xe74d57b9f55eba50b9c6f0b3c09e4892a1b00f842461df16eb5bebe02a4a3f35',
  sharedObjects: {
    blindEscrow: '0x14c90c14d60b918706e04688f1bb6df617e8134462c56822bf4d546c37a9f6ef',
    taskRegistry: '0x379864da638d2212aa11b9048dfe7ab48860075b06f8c2470681cd052bdccdf5',
    blindReputation: '0x1769c6f22a00fcf4a4493c07eb7cf063915e664768a12aae61feea1b9e5e2fb7',
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
| `blindmarket::blind_escrow` | `0x14c90c14d60b918706e04688f1bb6df617e8134462c56822bf4d546c37a9f6ef` | Task lifecycle |
| `blindmarket::task_registry` | `0x379864da638d2212aa11b9048dfe7ab48860075b06f8c2470681cd052bdccdf5` | Task discovery |
| `blindmarket::blind_reputation` | `0x1769c6f22a00fcf4a4493c07eb7cf063915e664768a12aae61feea1b9e5e2fb7` | Worker reputation |

The `AdminCap` is NOT a shared object — it's an owned object held by the
backend signer. Only the AdminCap holder can call admin functions
(cancel_task, complete_verification, resolve_dispute, etc.).

## Quick Reference: Env Vars

| Var | Example | Required? |
|---|---|---|
| `CHAIN_TYPE` | `sui` | Yes |
| `SUI_NETWORK_ID` | `testnet` | Yes |
| `SUI_PACKAGE_ID` | `0xe74d57b9f55eba50b9c6f0b3c09e4892a1b00f842461df16eb5bebe02a4a3f35` | Yes |
| `SUI_BLIND_ESCROW_OBJECT_ID` | `0x14c90c14d60b918706e04688f1bb6df617e8134462c56822bf4d546c37a9f6ef` | Yes |
| `SUI_TASK_REGISTRY_OBJECT_ID` | `0x379864da638d2212aa11b9048dfe7ab48860075b06f8c2470681cd052bdccdf5` | Yes |
| `SUI_BLIND_REPUTATION_OBJECT_ID` | `0x1769c6f22a00fcf4a4493c07eb7cf063915e664768a12aae61feea1b9e5e2fb7` | Yes |
| `SUI_ADMIN_CAP_ID` | `0xb2af5cecccf84f5b908def68d52eee07c6cfa1f403412e31fa6b47f7786f958d` | For admin ops |
| `SUI_AGENT_PRIVATE_KEY` | `suiprivkey...` | For server-side TX |
| `SUI_RPC_URL` | `https://fullnode.testnet.sui.io:443` | Has default |
| `AGENT_PRIVATE_KEY` | `suiprivkey...` | Per-agent (Sui format) |
