import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { AgentConfig } from '../types';

const POSITIONS: Array<[number, number, number]> = [
  [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2], [4, 0, 0], [-4, 0, 0]
];

interface AgentConfigsCtx {
  agentConfigs: AgentConfig[];
  loading: boolean;
}

export const AgentConfigsContext = createContext<AgentConfigsCtx>({ agentConfigs: [], loading: true });

export function useAgentConfigs() {
  return useContext(AgentConfigsContext);
}

export function AgentConfigsProvider({ children }: { children: ReactNode }) {
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then((data: { agents: Array<{ name: string; color: string; accentColor: string; role: string }> }) => {
        const configs: AgentConfig[] = data.agents.map((a, i) => ({
          name: a.name,
          color: a.color,
          accentColor: a.accentColor,
          role: a.role,
          emoji: '🤖',
          position: POSITIONS[i] ?? [i * 2, 0, 0],
        }));
        setAgentConfigs(configs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <AgentConfigsContext.Provider value={{ agentConfigs, loading }}>
      {children}
    </AgentConfigsContext.Provider>
  );
}
