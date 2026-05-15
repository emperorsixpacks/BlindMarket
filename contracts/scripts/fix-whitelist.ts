import { ethers } from "hardhat";

async function main() {
  const escrowAddr = "0x7B420523E2b5d6C0f0e5deF75b1D9a901167f041";
  const nativeAddr = "0x0000000000000000000000000000000000000000";

  const BlindEscrow = await ethers.getContractFactory("BlindEscrow");
  const escrow = BlindEscrow.attach(escrowAddr);

  console.log("Checking whitelist for native token:", nativeAddr);
  const isAllowed = await escrow.allowedTokens(nativeAddr);
  console.log("Is native token allowed?", isAllowed);

  if (!isAllowed) {
    console.log("Whitelisting native token...");
    await (await escrow.allowToken(nativeAddr)).wait();
    console.log("Native token whitelisted successfully.");
  } else {
    console.log("Native token is already whitelisted.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
