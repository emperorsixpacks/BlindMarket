// Whitelist the native 0G token (address(0)) on the LIVE BlindEscrow.
//
// Background: until this script lands correctly, posters using native-0G saw
// every `createTask` revert with `TokenNotAllowed()`. The previous version of
// this file hardcoded an address that no longer matched the deployed contract,
// so re-running it had no effect on the live system — phantom tasks (Redis
// meta written speculatively before the tx, no on-chain counterpart) piled up
// and agents got stuck retrying NOT_INDEXED forever.
//
// Address resolution order:
//   1. CLI arg:    pnpm hardhat run scripts/fix-whitelist.ts --network <net> -- <address>
//   2. ENV:        BLIND_ESCROW_ADDRESS (same source of truth as backend/.env)
//   3. Deployments file for the active network
//
// The script refuses to run if no address is resolvable, instead of falling
// back to a hardcoded value that goes stale across redeploys.

import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

function resolveEscrowAddress(): string {
  const fromArg = process.argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  if (fromArg) return ethers.getAddress(fromArg);

  const fromEnv = process.env.BLIND_ESCROW_ADDRESS;
  if (fromEnv && /^0x[0-9a-fA-F]{40}$/.test(fromEnv)) return ethers.getAddress(fromEnv);

  const netName = network.name.includes("mainnet") ? "0g-mainnet" : "0g-testnet";
  const path = join(__dirname, "..", "deployments", `${netName}.json`);
  try {
    const j = JSON.parse(readFileSync(path, "utf-8")) as { contracts?: { BlindEscrow?: string } };
    const addr = j?.contracts?.BlindEscrow;
    if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) return ethers.getAddress(addr);
  } catch {}

  throw new Error(
    "Could not resolve BlindEscrow address. Pass as CLI arg, set BLIND_ESCROW_ADDRESS env, " +
      `or populate contracts/deployments/${netName}.json`,
  );
}

async function main() {
  const escrowAddr = resolveEscrowAddress();
  const nativeAddr = "0x0000000000000000000000000000000000000000";

  console.log(`Network:  ${network.name}`);
  console.log(`Escrow:   ${escrowAddr}`);

  const BlindEscrow = await ethers.getContractFactory("BlindEscrow");
  const escrow = BlindEscrow.attach(escrowAddr);

  const [signer] = await ethers.getSigners();
  const admin = await escrow.admin();
  console.log(`Admin:    ${admin}`);
  console.log(`Signer:   ${signer.address}`);
  if (admin.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not the contract admin (${admin}). ` +
        `Use the admin key — allowToken is admin-gated.`,
    );
  }

  const before = await escrow.allowedTokens(nativeAddr);
  console.log(`native allowed (before): ${before}`);

  if (before) {
    console.log("Already whitelisted — nothing to do.");
    return;
  }

  console.log("Sending allowToken(0x0)…");
  const tx = await escrow.allowToken(nativeAddr);
  console.log(`tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed: block=${receipt?.blockNumber} status=${receipt?.status}`);

  const after = await escrow.allowedTokens(nativeAddr);
  console.log(`native allowed (after):  ${after}`);
  if (!after) throw new Error("Whitelist tx confirmed but allowedTokens still false — investigate.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
