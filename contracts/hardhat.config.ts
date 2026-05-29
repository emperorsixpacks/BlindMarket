import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    "0g-testnet": {
      url: "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    "0g-mainnet": {
      url: "https://evmrpc.0g.ai",
      chainId: 16661,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // Celo — multi-chain expansion. See docs/CELO-MULTI-CHAIN.md.
    // Alfajores is being deprecated; Celo Sepolia (11142220) is the current testnet.
    // CELO_PRIVATE_KEY is preferred; falls back to PRIVATE_KEY for parity.
    "celo-sepolia": {
      url: process.env.CELO_SEPOLIA_RPC_URL ?? "https://forno.celo-sepolia.celo-testnet.org",
      chainId: 11142220,
      accounts: (process.env.CELO_PRIVATE_KEY ?? process.env.PRIVATE_KEY)
        ? [(process.env.CELO_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as string]
        : [],
    },
    celo: {
      url: process.env.CELO_MAINNET_RPC_URL ?? "https://forno.celo.org",
      chainId: 42220,
      accounts: (process.env.CELO_PRIVATE_KEY ?? process.env.PRIVATE_KEY)
        ? [(process.env.CELO_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as string]
        : [],
    },
  },
};

export default config;
