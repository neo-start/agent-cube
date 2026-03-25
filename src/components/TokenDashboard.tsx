import { useState, useEffect } from 'react';

const API = '';

interface AgentStats {
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalCost: number;
  provider: string;
}

interface TokenSummary {
  all: Record<string, AgentStats>;
  today: Record<string, AgentStats>;
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  if (usd < 1) return '$' + usd.toFixed(3);
  return '$' + usd.toFixed(2);
}

const AGENT_COLORS: Record<string, string> = {
  Forge: '#4d9fff',
  Arc: '#34d399',
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s ease' }} />
    </div>
  );
}

interface TokenDashboardProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function TokenDashboard({ collapsed = false, onToggle }: TokenDashboardProps) {
  const [summary, setSummary] = useState<TokenSummary | null>(null);

  useEffect(() => {
    if (collapsed) return;
    const load = () => {
      fetch(`${API}/api/tokens/summary`)
        .then(r => r.json())
        .then(d => setSummary(d))
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [collapsed]);

  const agents = summary ? Object.keys(summary.all) : [];
  const maxTotal = agents.reduce((m, a) => Math.max(m, (summary?.all[a]?.totalInput || 0) + (summary?.all[a]?.totalOutput || 0)), 0);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
      overflow: 'hidden',
      minWidth: 240,
    }}>
      {/* Header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '8px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1 }}>
          TOKEN USAGE
        </span>
        <span style={{ fontSize: 10, color: '#4b5563' }}>{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agents.length === 0 && (
            <div style={{ fontSize: 11, color: '#4b5563', textAlign: 'center', padding: '8px 0' }}>
              No token data yet
            </div>
          )}

          {agents.map(agent => {
            const allStats = summary!.all[agent];
            const todayStats = summary!.today[agent];
            const color = AGENT_COLORS[agent] || '#6b7280';
            const totalTokens = allStats.totalInput + allStats.totalOutput;

            return (
              <div key={agent}>
                {/* Agent name + cost */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{agent}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>{fmtCost(allStats.totalCost)} total</span>
                </div>

                {/* Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Bar value={totalTokens} max={maxTotal} color={color} />
                  <span style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>{fmt(totalTokens)}</span>
                </div>

                {/* In / Out breakdown */}
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#4b5563' }}>
                  <span>in {fmt(allStats.totalInput)}</span>
                  <span>out {fmt(allStats.totalOutput)}</span>
                  {allStats.totalCache > 0 && <span>cache {fmt(allStats.totalCache)}</span>}
                  {todayStats && (
                    <span style={{ color: '#22c55e', marginLeft: 'auto' }}>
                      today {fmtCost(todayStats.totalCost)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
