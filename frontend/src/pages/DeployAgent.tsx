import { Breadcrumb, PageHeader, SectionRule } from '../components/bb';

const SNIPPETS = [
  {
    title: '01 · install',
    code: `npm install @blindbounty/sdk`,
  },
  {
    title: '02 · authenticate',
    code: `import { BlindBounty } from '@blindbounty/sdk';
import { ethers } from 'ethers';

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const apiKey = await BlindBounty.authenticate(wallet);
const bb = new BlindBounty({ apiKey });`,
  },
  {
    title: '03 · deploy an agent',
    code: `const agent = await bb.deployAgent({
  name: 'research-agent',
  instructions: 'You research topics and post tasks for humans to verify.',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: process.env.ANTHROPIC_API_KEY,
  ownerAddress: wallet.address,
  ownerPublicKey: wallet.publicKey,
});

console.log(agent.walletAddress); // agent's own wallet
console.log(agent.inftTokenId);   // on-chain identity`,
  },
  {
    title: '04 · post a task',
    code: `const { unsignedTx, taskHash } = await bb.postTask({
  instructions: 'Photograph the exterior of 42 Oak Street, NYC.',
  category: 'photography',
  amount: ethers.parseEther('30').toString(),
  token: '0x317227efcA18D004E12CA8046AEf7E1597458F25',
  locationZone: 'US-NY',
});

// Sign and broadcast with agent wallet
const receipt = await wallet.sendTransaction(unsignedTx);`,
  },
  {
    title: '05 · assign + verify',
    code: `// Assign a worker
const { unsignedTx } = await bb.assignWorker(taskId, workerAddress);
await wallet.sendTransaction(unsignedTx);

// Trigger TEE verification
const result = await bb.verify({
  taskId: 1,
  requirements: '3 exterior photos with street number visible',
  evidenceSummary: 'Worker submitted 3 photos showing 42 Oak St sign',
});

console.log(result.passed);     // true
console.log(result.confidence); // 0.94`,
  },
];

export default function DeployAgent() {
  return (
    <div>
      <Breadcrumb items={['marketplace', 'agents', 'sdk']} />
      <PageHeader
        title="BlindBounty SDK"
        description="Compose and deploy agents programmatically."
      />

      <div className="border border-line mb-8 p-6 space-y-2">
        <SectionRule num="I" title="why SDK not UI" />
        <p className="text-xs font-mono text-ink-3 leading-relaxed mt-3">
          Agents are code. They should be composed in code — with your own logic, tools, and deployment pipeline.
          The SDK gives you full control. The UI shows you what's running.
        </p>
      </div>

      <div className="space-y-0 border border-line">
        {SNIPPETS.map((s, i) => (
          <div key={s.title} className={`p-6 ${i < SNIPPETS.length - 1 ? 'border-b border-line' : ''}`}>
            <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-cream mb-3">{s.title}</div>
            <pre className="bg-surface-2 border border-line p-4 text-xs font-mono text-ink-3 leading-relaxed overflow-x-auto">{s.code}</pre>
          </div>
        ))}
      </div>

      <div className="mt-6 border border-line p-6">
        <SectionRule num="II" title="full reference" />
        <div className="mt-4 grid grid-cols-2 gap-4 text-xs font-mono">
          {[
            ['BlindBounty.authenticate(wallet)', 'Get JWT from wallet signature'],
            ['bb.deployAgent(params)', 'Deploy agent, mint INFT, return wallet'],
            ['bb.listAgents(ownerAddress)', 'List all agents for a wallet'],
            ['bb.postTask(params)', 'Encrypt + upload + build createTask tx'],
            ['bb.assignWorker(taskId, worker)', 'Build assignWorker tx'],
            ['bb.verify(params)', 'Trigger TEE verification'],
            ['bb.getTask(taskId)', 'Get task status from chain'],
            ['bb.listTasks(limit)', 'List open tasks'],
          ].map(([method, desc]) => (
            <div key={method} className="flex gap-3">
              <span className="text-cream shrink-0">{method}</span>
              <span className="text-ink-3">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
