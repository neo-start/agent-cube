import { useEffect } from 'react';
import type { AgentConfig, AgentData } from '../types';

interface Props {
  agent: AgentConfig;
  data: AgentData;
  onClose: () => void;
  onAssign?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  pending: '⏳ Pending',
  working: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
};

const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  pending: '#a78bfa',
  working: '#22c55e',
  done: '#eab308',
  blocked: '#ef4444',
};

export function TaskModal({ agent, data, onClose, onAssign }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const statusColor = STATUS_COLORS[data.status] || '#6b7280';
  const statusLabel = STATUS_LABELS[data.status] || data.status;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f1117',
          border: `1px solid ${agent.accentColor}44`,
          borderRadius: 16,
          padding: '2rem',
          maxWidth: 560,
          width: '90%',
          boxShadow: `0 0 40px ${agent.color}33, 0 0 80px ${agent.color}11`,
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `${agent.color}22`,
            border: `2px solid ${agent.accentColor}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
            boxShadow: `0 0 16px ${agent.color}66`,
          }}>
            {agent.emoji}
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: agent.accentColor, letterSpacing: 1 }}>
              {agent.name}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{agent.role}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: statusColor,
              display: 'inline-block',
              boxShadow: `0 0 8px ${statusColor}`,
              animation: data.status === 'working' ? 'pulse 1.5s infinite' : 'none',
            }} />
            <span style={{ fontSize: 13, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#6b7280',
              fontSize: 20, cursor: 'pointer', padding: '4px 8px',
              marginLeft: 8,
            }}
          >×</button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: `${agent.accentColor}22`, marginBottom: 20 }} />

        {data.taskId ? (
          <>
            {/* Task ID */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Task</div>
              <div style={{ fontSize: 13, color: '#9ca3af', fontFamily: 'monospace' }}>{data.taskId}</div>
            </div>

            {/* Title */}
            {data.title && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Title</div>
                <div style={{ fontSize: 15, color: '#e5e7eb', fontWeight: 500 }}>{data.title}</div>
              </div>
            )}

            {/* By */}
            {data.by && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Requested By</div>
                <div style={{ fontSize: 13, color: '#9ca3af' }}>{data.by}</div>
              </div>
            )}

            {/* Description */}
            {data.description && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Goal</div>
                <div style={{
                  fontSize: 13, color: '#d1d5db', lineHeight: 1.6,
                  background: '#1a1d27', borderRadius: 8, padding: '10px 14px',
                  border: `1px solid ${agent.color}22`,
                }}>
                  {data.description}
                </div>
              </div>
            )}

            {/* Delegation chain */}
            {data.delegatedBy && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Delegated By</div>
                <div style={{
                  fontSize: 13, color: '#f59e0b', fontFamily: 'monospace',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 14 }}>↗</span>
                  {data.delegatedBy}
                  {data.parentTaskId && (
                    <span style={{ color: '#4b5563', fontSize: 11 }}>
                      {' '}· parent: {data.parentTaskId}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Latest Log */}
            {data.latestLog && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Latest Activity</div>
                <div style={{
                  fontSize: 12, color: '#9ca3af', lineHeight: 1.6,
                  background: '#1a1d27', borderRadius: 8, padding: '10px 14px',
                  border: `1px solid ${agent.color}22`,
                  fontFamily: 'monospace',
                  maxHeight: 120,
                  overflowY: 'auto',
                }}>
                  {data.latestLog}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: '#4b5563' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💤</div>
            <div style={{ fontSize: 14 }}>No active tasks</div>
          </div>
        )}

        {/* Assign Task button */}
        {onAssign && (
          <div style={{ marginTop: 20, borderTop: `1px solid ${agent.accentColor}22`, paddingTop: 16 }}>
            <button
              onClick={() => { onClose(); onAssign(); }}
              style={{
                width: '100%',
                background: `linear-gradient(135deg, ${agent.color}33, ${agent.accentColor}22)`,
                border: `1px solid ${agent.accentColor}44`,
                borderRadius: 10, color: agent.accentColor,
                padding: '10px 0', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, letterSpacing: 0.5,
              }}
            >
              ⚡ Assign Task to {agent.name}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
