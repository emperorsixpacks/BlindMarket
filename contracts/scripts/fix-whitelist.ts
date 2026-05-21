import { ethers } from "hardhat";

async function main() {
  const escrowAddr = "0xb97042C7249C112573181E40DC6702346C9fa18E";
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
