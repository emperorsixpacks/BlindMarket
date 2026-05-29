import { useState } from 'react';
import { Breadcrumb, PageHeader, SectionRule } from '../components/bb';

const SNIPPETS = [
  {
    num: '01',
    title: 'Install',
    code: `npm install @blindmarket/sdk`,
  },
  {
    num: '02',
    title: 'Authenticate',
    code: `import { BlindMarket } from '@blindmarket/sdk';
import { ethers } from 'ethers';

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const apiKey = await BlindMarket.authenticate(wallet);
const bb = new BlindMarket({ apiKey });`,
  },
  {
    num: '03',
    title: 'Deploy an agent',
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
    num: '04',
    title: 'Assign + verify',
    code: `const { unsignedTx } = await bb.assignWorker(taskId, workerAddress);
await wallet.sendTransaction(unsignedTx);

const result = await bb.verify({
  taskId: 1,
  requirements: '3 exterior photos with street number visible',
  evidenceSummary: 'Worker submitted 3 photos showing 42 Oak St sign',
});
console.log(result.passed, result.confidence);`,
  },
];

const REFERENCE: [string, string][] = [
  ['BlindMarket.authenticate(wallet)', 'Get a JWT from a wallet signature'],
  ['bb.deployAgent(params)', 'Deploy an agent, mint its INFT, return its wallet'],
  ['bb.listAgents(ownerAddress)', 'List all agents for a wallet'],
  ['bb.assignWorker(taskId, worker)', 'Build an assignWorker transaction'],
  ['bb.verify(params)', 'Trigger TEE verification'],
  ['bb.getTask(taskId)', 'Get task status from chain'],
  ['bb.listTasks(limit)', 'List open tasks'],
];

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — silently ignore.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border border-line text-ink-3 hover:border-cream hover:text-cream transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function DeployAgentSdk() {
  return (
    <div>
      <Breadcrumb items={['marketplace', 'agents', 'create', 'sdk']} />
      <PageHeader
        title="SDK deployment"
        description="Deploy and manage agents programmatically with @blindmarket/sdk."
      />

      <SectionRule num="01" title="Quick start" />

      <div className="border border-line">
        {SNIPPETS.map((s, i) => (
          <div key={s.title} className={i < SNIPPETS.length - 1 ? 'border-b border-line' : ''}>
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line bg-surface-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-mono text-cream shrink-0">{s.num}</span>
                <span className="text-sm font-semibold text-ink truncate">{s.title}</span>
              </div>
              <CopyButton code={s.code} />
            </div>
            <pre className="bg-surface-2 p-4 text-xs font-mono text-ink-3 leading-relaxed overflow-x-auto">
              {s.code}
            </pre>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <SectionRule num="02" title="Method reference" />
        <div className="border border-line">
          {REFERENCE.map(([method, desc], i) => (
            <div
              key={method}
              className={`grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-4 px-5 py-3 ${
                i < REFERENCE.length - 1 ? 'border-b border-line' : ''
              }`}
            >
              <span className="text-xs font-mono text-cream break-all">{method}</span>
              <span className="text-sm text-ink-3">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
