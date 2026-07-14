/**
 * Migrate admin / ownership of the mainnet contracts to a Gnosis Safe.
 *
 * Roles today are a single hot EOA — this hands control to a multisig. Run
 * while the deployer EOA is still admin (it signs the propose/transfer txs).
 *
 *   - BlindEscrow / BlindReputation / TaskRegistry: `proposeAdmin(SAFE)`.
 *     TWO-STEP and reversible — the Safe must then call `acceptAdmin()` from the
 *     Safe UI to actually take control. Until it does, the EOA stays admin.
 *   - INFT: `transferOwnership(SAFE)`. ONE-STEP and IRREVERSIBLE. Gated behind
 *     INCLUDE_INFT=yes so it can't happen by accident. INFT is dormant (see
 *     MAINNET-DECISIONS.md §5); you may prefer to leave it and move it when the
 *     iNFT feature is activated.
 *
 * Guards: SAFE_ADDRESS must be a DEPLOYED CONTRACT (has bytecode) — this is the
 * main defense against handing the protocol to a mistyped EOA. Each contract is
 * skipped if the EOA isn't its current admin/owner (idempotent-ish).
 *
 * Usage:
 *   I_HAVE_READ_MAINNET_CHECKLIST=yes SAFE_ADDRESS=0xSafe \
 *     npx hardhat run scripts/migrate-admin-to-safe.ts --network 0g-mainnet
 *   # add INCLUDE_INFT=yes to also transfer INFT ownership (irreversible)
 *
 * AFTER this runs: from the Safe, call acceptAdmin() on BlindEscrow,
 * BlindReputation, and TaskRegistry. Verify with verify-deployment-config.ts.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { assertSafeNetwork } from "./_guard";

async function main() {
  await assertSafeNetwork();

  const safe = process.env.SAFE_ADDRESS;
  if (!safe || !ethers.isAddress(safe) || safe === ethers.ZeroAddress) {
    throw new Error(`SAFE_ADDRESS must be a valid non-zero address. Got: ${safe}`);
  }
  const safeAddr = ethers.getAddress(safe);

  // Primary guard: a real Safe is a contract. Refuse to hand control to an EOA.
  const code = await ethers.provider.getCode(safeAddr);
  if (code === "0x") {
    throw new Error(`SAFE_ADDRESS ${safeAddr} has NO bytecode — it is not a deployed contract. ` +
      `Refusing to migrate control to a possibly-mistyped EOA.`);
  }

  const dep = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../deployments/${network.name}.json`), "utf-8"));
  const c = dep.contracts;
  const [signer] = await ethers.getSigners();
  console.log(`network: ${network.name}\nsigner (deployer EOA): ${signer.address}\ntarget Safe: ${safeAddr}\n`);

  // 2-step UUPS contracts: proposeAdmin (reversible; Safe must acceptAdmin after).
  const twoStep = [
    { name: "BlindEscrow", addr: c.BlindEscrow, art: "BlindEscrow" },
    { name: "BlindReputation", addr: c.BlindReputation, art: "BlindReputation" },
    { name: "TaskRegistry", addr: c.TaskRegistry, art: "TaskRegistry" },
  ];
  for (const t of twoStep) {
    const ct = await ethers.getContractAt(t.art, t.addr);
    const admin = await (ct as any).admin();
    if (admin.toLowerCase() !== signer.address.toLowerCase()) {
      console.log(`- ${t.name}: admin is ${admin} (not the signer) — SKIP.`);
      continue;
    }
    const tx = await (ct as any).proposeAdmin(safeAddr);
    await tx.wait();
    console.log(`- ${t.name}: proposeAdmin(${safeAddr}) ✓ (tx ${tx.hash}) — Safe must acceptAdmin().`);
  }

  // 1-step INFT (irreversible) — opt-in only.
  if (process.env.INCLUDE_INFT === "yes") {
    const inft = await ethers.getContractAt("INFT", c.INFT);
    const owner = await (inft as any).owner();
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      console.log(`- INFT: owner is ${owner} (not the signer) — SKIP.`);
    } else {
      const tx = await (inft as any).transferOwnership(safeAddr);
      await tx.wait();
      console.log(`- INFT: transferOwnership(${safeAddr}) ✓ (tx ${tx.hash}) — IRREVERSIBLE, done.`);
    }
  } else {
    console.log(`- INFT: skipped (set INCLUDE_INFT=yes to transfer its ownership — irreversible).`);
  }

  console.log(`\nNEXT: from the Safe UI, call acceptAdmin() on BlindEscrow, BlindReputation, TaskRegistry.`);
  console.log(`Then verify: EXPECTED_ADMIN=${safeAddr} npx hardhat run scripts/verify-deployment-config.ts --network ${network.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
