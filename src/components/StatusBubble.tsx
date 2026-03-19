import { Html } from '@react-three/drei';

interface Props {
  status: string;
  task: string | null;
  agentColor: string;
  position: [number, number, number];
}

const STATUS_STYLES: Record<string, { bg: string; border: string; color: string; icon: string; label: string }> = {
  idle:    { bg: 'rgba(30,32,48,0.9)',    border: 'rgba(107,114,128,0.3)', color: '#6b7280', icon: '💤', label: 'Idle' },
  working: { bg: 'rgba(26,50,80,0.92)',   border: 'rgba(77,159,255,0.4)',  color: '#4d9fff', icon: '⚡', label: 'Working' },
  done:    { bg: 'rgba(20,40,20,0.9)',    border: 'rgba(34,197,94,0.4)',   color: '#22c55e', icon: '✅', label: 'Done' },
  blocked: { bg: 'rgba(50,20,20,0.9)',    border: 'rgba(239,68,68,0.4)',   color: '#ef4444', icon: '🚫', label: 'Blocked' },
};

export function StatusBubble({ status, task, position }: Props) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.idle;
  const isWorking = status === 'working';

  const label = isWorking && task
    ? `⚡ ${task.length > 28 ? task.slice(0, 28) + '…' : task}`
    : `${style.icon} ${style.label}`;

  return (
    <Html position={position} center occlude={false} style={{ pointerEvents: 'none' }}>
      <div style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 20,
        padding: '3px 10px',
        fontSize: 11,
        color: style.color,
        whiteSpace: 'nowrap',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        backdropFilter: 'blur(8px)',
        boxShadow: isWorking ? `0 0 10px ${style.color}44, 0 2px 8px rgba(0,0,0,0.6)` : '0 2px 8px rgba(0,0,0,0.5)',
        letterSpacing: '0.3px',
        fontWeight: 500,
        animation: isWorking ? 'statusPulse 2s ease-in-out infinite' : 'none',
      }}>
        {label}
      </div>
      <style>{`
        @keyframes statusPulse {
          0%, 100% { box-shadow: 0 0 10px ${style.color}44, 0 2px 8px rgba(0,0,0,0.6); }
          50% { box-shadow: 0 0 18px ${style.color}88, 0 2px 8px rgba(0,0,0,0.6); }
        }
      `}</style>
    </Html>
  );
}
