import { useState } from 'react';
import { useAgentRegistry } from '../hooks/useAgentRegistry';
import { AGENT_CONFIGS } from '../types';

interface CreateGroupModalProps {
  onClose: () => void;
  onCreate: (name: string, agents: string[], description?: string) => Promise<void>;
}

export function CreateGroupModal({ onClose, onCreate }: CreateGroupModalProps) {
  const { agents: registryAgents } = useAgentRegistry();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>(AGENT_CONFIGS.map(a => a.name));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Merge registry agents with static AGENT_CONFIGS for display
  const allAgentNames = Array.from(new Set([
    ...AGENT_CONFIGS.map(a => a.name),
    ...registryAgents.map(a => a.name),
  ]));

  const toggleAgent = (agentName: string) => {
    setSelectedAgents(prev =>
      prev.includes(agentName)
        ? prev.filter(n => n !== agentName)
        : [...prev, agentName]
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Group name is required'); return; }
    if (selectedAgents.length === 0) { setError('Select at least one agent'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), selectedAgents, description.trim() || undefined);
      onClose();
    } catch {
      setError('Failed to create group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 500,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0d1117',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          padding: 28,
          width: 400,
          maxWidth: '90vw',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 20 }}>
          New Group
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
            GROUP NAME *
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Research Team"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '8px 12px',
              color: '#e5e7eb',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
            AGENTS *
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {allAgentNames.map(agentName => {
              const selected = selectedAgents.includes(agentName);
              return (
                <button
                  key={agentName}
                  onClick={() => toggleAgent(agentName)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    background: selected ? 'rgba(77, 159, 255, 0.15)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${selected ? 'rgba(77, 159, 255, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                    color: selected ? '#4d9fff' : '#9ca3af',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {agentName}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
            DESCRIPTION (optional)
          </label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What does this group do?"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '8px 12px',
              color: '#e5e7eb',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 14 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '8px 18px',
              color: '#9ca3af',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              background: 'linear-gradient(135deg, #1a6cf5, #7c3aed)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 18px',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}
