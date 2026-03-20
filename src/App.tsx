import { useState } from 'react';
import { Scene } from './components/Scene';
import { GroupChat } from './components/GroupChat';
import { GroupSidebar } from './components/GroupSidebar';
import { CreateGroupModal } from './components/CreateGroupModal';
import { TokenDashboard } from './components/TokenDashboard';
import { useTasks } from './hooks/useTasks';
import { useGroups } from './hooks/useGroups';
import { AGENT_CONFIGS } from './types';

const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  pending: '#a78bfa',
  working: '#22c55e',
  done: '#eab308',
  blocked: '#ef4444',
};

function StatusDot({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8, height: 8,
      borderRadius: '50%',
      background: STATUS_COLORS[status] || '#6b7280',
      boxShadow: `0 0 6px ${STATUS_COLORS[status] || '#6b7280'}`,
      marginRight: 6,
    }} />
  );
}

export default function App() {
  const { agents, loading, error, lastUpdated } = useTasks(3000);
  const { groups, selectedGroupId, setSelectedGroupId, selectedGroup, createGroup } = useGroups();
  const [toast, setToast] = useState<{ text: string; color: string } | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [groupChatOpen, setGroupChatOpen] = useState(false);
  const [groupChatChannel, setGroupChatChannel] = useState<string | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [tokenDashCollapsed, setTokenDashCollapsed] = useState(true);

  const showToast = (text: string, color: string) => {
    setToast({ text, color });
    setTimeout(() => setToast(null), 3000);
  };
  void showToast; // suppress unused warning

  const theme = darkMode
    ? {
        bg: '#050810',
        topBar: 'rgba(5, 8, 16, 0.85)',
        topBorder: 'rgba(77, 159, 255, 0.15)',
        title: '#e5e7eb',
        version: '#374151',
        statusLabel: '#374151',
        hint: '#1f2937',
        hintBg: 'rgba(5, 8, 16, 0.7)',
        hintBorder: 'rgba(255,255,255,0.05)',
      }
    : {
        bg: '#f0f4ff',
        topBar: 'rgba(240, 244, 255, 0.92)',
        topBorder: 'rgba(59, 130, 246, 0.2)',
        title: '#1e293b',
        version: '#94a3b8',
        statusLabel: '#64748b',
        hint: '#64748b',
        hintBg: 'rgba(240, 244, 255, 0.85)',
        hintBorder: 'rgba(0,0,0,0.08)',
      };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', background: theme.bg }}>
      {/* Left sidebar — G button only */}
      <GroupSidebar
        isGroupChatOpen={groupChatOpen}
        onToggleGroupChat={() => setGroupChatOpen(o => !o)}
      />

      {/* Main area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* 3D Scene */}
        <Scene
          agents={agents}
          onAssignTask={undefined}
          darkMode={darkMode}
          onDeskClick={(agentName: string) => {
            setGroupChatChannel(agentName);
            setGroupChatOpen(true);
          }}
        />

        {/* Top bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: 52,
          background: theme.topBar,
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${theme.topBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #1a6cf5, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14,
            }}>⬡</div>
            <span style={{ fontSize: 16, fontWeight: 700, color: theme.title, letterSpacing: 1 }}>
              AGENT CUBE
            </span>
            <span style={{ fontSize: 11, color: theme.version, letterSpacing: 2 }}>v0.1</span>
          </div>

          {/* Agent status pills */}
          <div style={{ display: 'flex', gap: 16 }}>
            {AGENT_CONFIGS.map(config => {
              const data = agents[config.name];
              const status = data?.status || 'idle';
              return (
                <div key={config.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot status={status} />
                  <span style={{ fontSize: 12, color: config.accentColor, fontWeight: 600 }}>{config.name}</span>
                  <span style={{ fontSize: 11, color: theme.statusLabel }}>{status}</span>
                </div>
              );
            })}
          </div>

          {/* Dark/Light mode toggle */}
          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
              borderRadius: 8,
              cursor: 'pointer',
              padding: '5px 10px',
              fontSize: 16,
              lineHeight: 1,
              color: theme.title,
              transition: 'all 0.2s',
            }}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>

          {/* Last updated */}
          <div style={{ fontSize: 11, color: theme.statusLabel }}>
            {loading && <span style={{ color: '#4d9fff' }}>Loading...</span>}
            {error && <span style={{ color: '#ef4444' }}>Error: {error}</span>}
            {lastUpdated && !loading && (
              <span>Updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </div>
        </div>

        <GroupChat
          isOpen={groupChatOpen}
          initialChannel={groupChatChannel}
          groupId={selectedGroupId}
          groupAgents={selectedGroup?.agents}
          groupName={selectedGroup?.name}
          onToggle={(open) => {
            setGroupChatOpen(open);
            if (!open) setGroupChatChannel(null);
          }}
          onCreateGroup={() => setCreateGroupOpen(true)}
        />

        {/* Toast notification */}
        {toast && (
          <div style={{
            position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(5, 8, 20, 0.95)',
            border: `1px solid ${toast.color}`,
            borderRadius: 10, padding: '10px 20px',
            color: '#e5e7eb', fontSize: 14, fontWeight: 600,
            boxShadow: `0 0 20px ${toast.color}60`,
            zIndex: 500,
            animation: 'fadeInDown 0.2s ease',
            whiteSpace: 'nowrap',
          }}>
            {toast.text}
          </div>
        )}

        {/* Token Dashboard — bottom-right floating panel */}
        <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 100, width: 260 }}>
          <TokenDashboard
            collapsed={tokenDashCollapsed}
            onToggle={() => setTokenDashCollapsed(c => !c)}
          />
        </div>

        {/* Bottom hint */}
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          fontSize: 11, color: theme.hint,
          background: theme.hintBg,
          padding: '6px 16px', borderRadius: 20,
          border: `1px solid ${theme.hintBorder}`,
          zIndex: 100,
          userSelect: 'none',
        }}>
          Click a desk to view task details · Drag to orbit · Scroll to zoom
        </div>
      </div>

      {/* Create Group modal */}
      {createGroupOpen && (
        <CreateGroupModal
          onClose={() => setCreateGroupOpen(false)}
          onCreate={async (name, agentList, description) => {
            await createGroup(name, agentList, description);
          }}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${theme.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      `}</style>
    </div>
  );
}
