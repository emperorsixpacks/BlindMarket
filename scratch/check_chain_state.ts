import { ethers } from 'ethers';

const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const ESCROW_ADDR = '0x037529B296a89E6Dd1abAF84D413cb2dD70C5be5';
const TOKEN_ADDR = '0x3af9232009c5da30ada366b6e09849a040162a1a';
const FROM_ADDR = '0x2afd3a7Dd4377097f5220d34fb4E577963FdB6a4';

const ESCROW_ABI = [
    'function allowedTokens(address) view returns (bool)',
    'function nextTaskId() view returns (uint256)',
    'function admin() view returns (address)'
];

const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)'
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const escrow = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, provider);
    const token = new ethers.Contract(TOKEN_ADDR, ERC20_ABI, provider);

    try {
        const [isAllowed, nextId, admin, decimals, balance, allowance] = await Promise.all([
            escrow.allowedTokens(TOKEN_ADDR),
            escrow.nextTaskId(),
            escrow.admin(),
            token.decimals(),
            token.balanceOf(FROM_ADDR),
            token.allowance(FROM_ADDR, ESCROW_ADDR)
        ]);

        console.log('BlindEscrow Info:');
        console.log('  Admin:', admin);
        console.log('  Next Task ID:', nextId.toString());
        console.log('  Token Allowed:', isAllowed);
        console.log('Token Info:');
        console.log('  Decimals:', decimals);
        console.log('  Balance:', ethers.formatUnits(balance, decimals), `(${balance.toString()})`);
        console.log('  Allowance:', ethers.formatUnits(allowance, decimals), `(${allowance.toString()})`);

    } catch (err) {
        console.error('Error:', err);
    }
}

main();
