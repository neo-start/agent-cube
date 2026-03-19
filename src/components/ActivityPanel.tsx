import { useState, useEffect, useRef } from 'react';
import { AGENT_CONFIGS } from '../types';

interface ActivityTask {
  id: string;
  agent: string;
  by: string;
  description: string;
  status: 'working' | 'done' | 'blocked' | 'pending';
  result: string | null;
  latestLog: string | null;
  delegatedBy: string | null;
  parentTaskId: string | null;
  source: string;
  createdAt: string;
  completedAt: string | null;
}

const AGENT_COLOR: Record<string, string> = Object.fromEntries(
  AGENT_CONFIGS.map(a => [a.name, a.accentColor])
);
const AGENT_EMOJI: Record<string, string> = Object.fromEntries(
  AGENT_CONFIGS.map(a => [a.name, a.emoji])
);

const STATUS_COLOR: Record<string, string> = {
  working: '#22c55e',
  done: '#4d9fff',
  blocked: '#ef4444',
  pending: '#a78bfa',
};

function timeSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function TaskCard({ task, depth, expanded, onToggle }: {
  task: ActivityTask;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = AGENT_COLOR[task.agent] || '#6b7280';
  const emoji = AGENT_EMOJI[task.agent] || '🤖';
  const isDelegate = !!task.delegatedBy;

  return (
    <div style={{ marginLeft: depth * 16, position: 'relative' }}>
      {/* Connector line for delegated tasks */}
      {isDelegate && (
        <div style={{
          position: 'absolute', left: -12, top: 0, bottom: 0,
          width: 1, background: 'rgba(255,255,255,0.08)',
        }} />
      )}
      {isDelegate && (
        <div style={{
          position: 'absolute', left: -12, top: 16,
          width: 10, height: 1, background: 'rgba(255,255,255,0.08)',
        }} />
      )}

      <div
        onClick={onToggle}
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${expanded ? color + '40' : 'rgba(255,255,255,0.06)'}`,
          borderLeft: `2px solid ${color}`,
          borderRadius: 8,
          padding: '8px 10px',
          cursor: 'pointer',
          marginBottom: 6,
          transition: 'all 0.15s',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 13 }}>{emoji}</span>
          <span style={{ color, fontWeight: 600, fontSize: 12 }}>{task.agent}</span>
          {isDelegate && (
            <span style={{
              fontSize: 10, color: '#6b7280',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 4, padding: '1px 5px',
            }}>← {task.delegatedBy}</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: STATUS_COLOR[task.status] || '#6b7280',
              display: 'inline-block',
              boxShadow: task.status === 'working' ? `0 0 6px ${STATUS_COLOR[task.status]}` : 'none',
            }} />
            <span style={{ fontSize: 10, color: '#4b5563' }}>{timeSince(task.createdAt)}</span>
          </div>
        </div>

        {/* Description */}
        <div style={{
          fontSize: 11, color: '#9ca3af', lineHeight: 1.4,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: expanded ? 100 : 2,
          WebkitBoxOrient: 'vertical' as const,
        }}>
          {task.description}
        </div>

        {/* Result / log (expanded) */}
        {expanded && (task.result || task.latestLog) && (
          <div style={{
            marginTop: 8,
            padding: '6px 8px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 6,
            fontSize: 11, color: '#6b7280', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {task.result || task.latestLog}
          </div>
        )}

        {/* Footer */}
        {expanded && (
          <div style={{ marginTop: 6, fontSize: 10, color: '#374151' }}>
            {task.id} · {task.source}
            {task.completedAt && ` · ${timeSince(task.completedAt)}`}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityPanel() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<ActivityTask[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/activity');
        const data = await res.json();
        setTasks(data.tasks || []);
        // Auto-expand new tasks
        if (data.tasks.length > prevCountRef.current) {
          const newTasks = data.tasks.slice(prevCountRef.current);
          setExpanded(prev => {
            const next = new Set(prev);
            newTasks.forEach((t: ActivityTask) => next.add(t.id));
            return next;
          });
          prevCountRef.current = data.tasks.length;
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [open]);

  useEffect(() => {
    if (autoScroll && open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tasks, autoScroll, open]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build tree: root tasks + their children
  const rootTasks = tasks.filter(t => !t.parentTaskId);
  const childrenOf = (id: string) => tasks.filter(t => t.parentTaskId === id);

  function renderTree(task: ActivityTask, depth = 0): React.ReactNode {
    return (
      <div key={task.id}>
        <TaskCard
          task={task}
          depth={depth}
          expanded={expanded.has(task.id)}
          onToggle={() => toggleExpand(task.id)}
        />
        {childrenOf(task.id).map(child => renderTree(child, depth + 1))}
      </div>
    );
  }

  const workingCount = tasks.filter(t => t.status === 'working').length;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Activity Feed — agent task chain"
        style={{
          position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)',
          width: 36, height: 72,
          background: open ? 'rgba(77,159,255,0.15)' : 'rgba(5,8,20,0.85)',
          border: `1px solid ${open ? 'rgba(77,159,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 8,
          cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          color: open ? '#4d9fff' : '#4b5563',
          fontSize: 16,
          zIndex: 200,
          transition: 'all 0.2s',
        }}
      >
        <span style={{ writingMode: 'vertical-rl', fontSize: 10, letterSpacing: 1, color: 'inherit', transform: 'rotate(180deg)', userSelect: 'none' }}>
          {workingCount > 0 ? `${workingCount} active` : 'feed'}
        </span>
        {workingCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            width: 14, height: 14, borderRadius: '50%',
            background: '#22c55e',
            fontSize: 9, color: '#000', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 6px #22c55e',
          }}>{workingCount}</span>
        )}
      </button>

      {/* Panel */}
      <div style={{
        position: 'fixed', right: open ? 64 : -340, top: 52, bottom: 0,
        width: 320,
        background: 'rgba(5, 8, 20, 0.97)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        zIndex: 199,
        transition: 'right 0.25s cubic-bezier(0.4,0,0.2,1)',
        backdropFilter: 'blur(12px)',
      }}>
        {/* Panel header */}
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
            Activity Feed
            {tasks.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 10, color: '#4b5563', fontWeight: 400 }}>
                {tasks.length} tasks
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => setAutoScroll(a => !a)}
              title="Auto-scroll"
              style={{
                background: autoScroll ? 'rgba(77,159,255,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${autoScroll ? 'rgba(77,159,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 5, color: autoScroll ? '#4d9fff' : '#4b5563',
                cursor: 'pointer', fontSize: 10, padding: '2px 7px',
              }}
            >↓ auto</button>
            <button
              onClick={() => setExpanded(new Set(tasks.map(t => t.id)))}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: '#4b5563', cursor: 'pointer', fontSize: 10, padding: '2px 7px' }}
            >expand all</button>
          </div>
        </div>

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }}>
          {tasks.length === 0 ? (
            <div style={{ color: '#374151', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              No activity yet.<br />
              <span style={{ fontSize: 11, color: '#1f2937' }}>Tasks appear here when agents are working.</span>
            </div>
          ) : (
            rootTasks.map(t => renderTree(t))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Legend */}
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', gap: 10, flexShrink: 0,
        }}>
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, display: 'inline-block' }} />
              <span style={{ fontSize: 9, color: '#374151' }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
