import { ethers } from 'ethers';

const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const REGISTRY_ADDR = '0x25Bc5be1F8Ab44ADfb7a6Ce1362d37408E74DA95';

const REGISTRY_ABI = [
    'function totalTasks() view returns (uint256)',
    'function openTaskCount() view returns (uint256)',
    'function getOpenTasks(uint256 offset, uint256 limit) view returns (tuple(uint256 taskId, address agent, string category, string locationZone, uint256 reward, uint256 createdAt, bool isOpen)[])'
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const registry = new ethers.Contract(REGISTRY_ADDR, REGISTRY_ABI, provider);

    try {
        const [total, openCount, openTasks] = await Promise.all([
            registry.totalTasks(),
            registry.openTaskCount(),
            registry.getOpenTasks(0, 50)
        ]);

        console.log('TaskRegistry Info:');
        console.log('  Total Tasks:', total.toString());
        console.log('  Open Task Count:', openCount.toString());
        console.log('  Open Tasks:', openTasks.length);
        
        openTasks.forEach((t: any) => {
            console.log(`    - Task #${t.taskId}: ${t.category} (${t.reward.toString()} wei)`);
        });

    } catch (err) {
        console.error('Error:', err);
    }
}

main();
