import { useState } from 'react';
import { AgentConfig } from '../types';

interface Props {
  agent: AgentConfig;
  onClose: () => void;
  onAssigned: (agentName: string, message: string) => void;
}

export function AssignTaskModal({ agent, onClose, onAssigned }: Props) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ action: string; position?: number; similarity?: string } | null>(null);

  const assign = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/tasks/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, description: description.trim(), by: 'User' }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      onAssigned(agent.name, description.trim());
      if (data.action === 'assigned') {
        // parent closes us via onAssigned callback
      } else {
        setResult(data);
        setTimeout(onClose, 2000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const resultMsg = result
    ? result.action === 'merged'
      ? `✅ Merged into current task (similarity ${Math.round(Number(result.similarity) * 100)}%)`
      : `⏸ Queued at position ${result.position}`
    : null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300,
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 420,
          background: 'rgba(5, 8, 20, 0.98)',
          border: `1px solid ${agent.accentColor}40`,
          borderRadius: 16,
          padding: 24,
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: `0 0 40px ${agent.color}30`,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{agent.emoji}</span>
            <div>
              <div style={{ color: agent.accentColor, fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
              <div style={{ color: '#4b5563', fontSize: 12 }}>{agent.role}</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#4b5563',
            cursor: 'pointer', fontSize: 18,
          }}>✕</button>
        </div>

        <div style={{ borderTop: `1px solid ${agent.accentColor}20`, paddingTop: 16 }}>
          <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 6 }}>Task Description</div>
          <textarea
            autoFocus
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) assign(); }}
            placeholder={`Tell ${agent.name} what to do...`}
            rows={5}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${agent.accentColor}40`,
              borderRadius: 8, color: '#e5e7eb', fontSize: 14,
              padding: '10px 12px', outline: 'none',
              resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6,
            }}
          />
          <div style={{ color: '#374151', fontSize: 11, marginTop: 4 }}>⌘↵ Quick assign</div>
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
        {resultMsg && <div style={{ color: '#4ade80', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>{resultMsg}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, color: '#6b7280', padding: '8px 16px',
            cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button
            onClick={assign}
            disabled={loading || !description.trim()}
            style={{
              background: `linear-gradient(135deg, ${agent.color}, ${agent.accentColor}80)`,
              border: 'none', borderRadius: 8, color: '#fff',
              padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              opacity: loading || !description.trim() ? 0.5 : 1,
            }}
          >
            {loading ? 'Assigning...' : '⚡ Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
