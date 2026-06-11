import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from '../config/constants';

interface DataPoint {
  t: number;
  cpu: number;
  ramMb: number;
}

const MAX_POINTS = 30;
const POLL_MS = 10_000;

export default function AgentMetricsPanel({ agentId }: { agentId: string }) {
  const [data, setData] = useState<DataPoint[]>([]);
  const dataRef = useRef<DataPoint[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/agents/${agentId}/stats`);
        if (!res.ok) return;
        const json = await res.json();
        if (!json.success || !json.data) return;
        const { cpu, ramMb } = json.data;
        const pt: DataPoint = { t: Date.now(), cpu, ramMb };
        dataRef.current = [...dataRef.current.slice(-(MAX_POINTS - 1)), pt];
        setData([...dataRef.current]);
      } catch (err) {
        console.warn('Failed to fetch agent metrics:', err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, POLL_MS);
    return () => clearInterval(interval);
  }, [agentId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMinutes()}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  if (data.length < 2) {
    return (
      <div className="text-sm text-dim py-6 text-center">
        Collecting metrics… (waiting for data points)
      </div>
    );
  }

  const cpuMin = 0;
  const cpuMax = Math.max(100, ...data.map(d => d.cpu));

  const ramValues = data.map(d => d.ramMb);
  const ramMin = Math.max(0, Math.floor(Math.min(...ramValues) - 10));
  const ramMax = Math.ceil(Math.max(...ramValues) + 10);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">CPU (%)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="t" tickFormatter={formatTime} stroke="rgba(255,255,255,0.3)" fontSize={11} />
            <YAxis domain={[cpuMin, cpuMax]} stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={v => v.toFixed(1)} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 } as any} formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'CPU']} />
            <Line type="monotone" dataKey="cpu" stroke="#6366f1" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Memory (MB)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="t" tickFormatter={formatTime} stroke="rgba(255,255,255,0.3)" fontSize={11} />
            <YAxis domain={[ramMin, ramMax]} stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={v => v.toFixed(0)} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 } as any} formatter={(value: any) => [`${Number(value).toFixed(1)} MB`, 'RSS']} />
            <Line type="monotone" dataKey="ramMb" stroke="#22c55e" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
