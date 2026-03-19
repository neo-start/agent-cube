import { useState, useEffect, useRef } from 'react';
import type { AgentsResponse, AgentData } from '../types';

const DEFAULT_AGENTS: Record<string, AgentData> = {
  Claw: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, by: null, raw: null, delegatedBy: null, parentTaskId: null, source: null },
  Deep: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, by: null, raw: null, delegatedBy: null, parentTaskId: null, source: null },
};

export function useTasks(pollInterval = 30000) {
  const [agents, setAgents] = useState<Record<string, AgentData>>(DEFAULT_AGENTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Keep latest agents in a ref so SSE handler can merge without stale closure
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AgentsResponse = await res.json();
      setAgents({ ...DEFAULT_AGENTS, ...data.agents });
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  // SSE: real-time status overlay
  useEffect(() => {
    const es = new EventSource('/api/status/stream');
    es.onmessage = (e) => {
      try {
        const statusData: Record<string, { status: string; task?: string; log?: string; updated?: string }> = JSON.parse(e.data);
        setLastUpdated(new Date());
        setAgents(prev => {
          const next = { ...prev };
          for (const [name, s] of Object.entries(statusData)) {
            if (next[name]) {
              next[name] = {
                ...next[name],
                status: s.status as AgentData['status'],
                title: s.task || next[name].title,
                latestLog: s.log || next[name].latestLog,
              };
            }
          }
          return next;
        });
      } catch {}
    };
    es.onerror = () => {
      // SSE disconnected — will auto-reconnect; fall back to poll
    };
    return () => es.close();
  }, []);

  // Slower poll for full task data
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval]);

  return { agents, loading, error, lastUpdated, refetch: fetchTasks };
}
