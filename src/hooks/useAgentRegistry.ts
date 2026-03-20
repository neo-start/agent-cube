import { useState, useEffect } from 'react';
import type { AgentRegistryEntry } from '../types';

const API = 'http://localhost:3020';

export function useAgentRegistry() {
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then(data => {
        const list: AgentRegistryEntry[] = Array.isArray(data) ? data : (data.agents || []);
        setAgents(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { agents, loading };
}
