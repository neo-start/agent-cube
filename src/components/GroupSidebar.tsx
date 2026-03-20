import type { Group } from '../types';

interface GroupSidebarProps {
  groups: Group[];
  selectedGroupId: string;
  onSelectGroup: (id: string) => void;
  onCreateGroup: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const AGENT_COLORS = ['#4d9fff', '#a78bfa', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

function agentDotColor(name: string, idx: number): string {
  const fixed: Record<string, string> = { Claw: '#4d9fff', Deep: '#a78bfa' };
  return fixed[name] || AGENT_COLORS[idx % AGENT_COLORS.length];
}

export function GroupSidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  collapsed,
  onToggleCollapse,
}: GroupSidebarProps) {
  const w = collapsed ? 48 : 220;

  return (
    <div style={{
      width: w,
      minWidth: w,
      height: '100%',
      background: 'rgba(8, 10, 20, 0.98)',
      borderRight: '1px solid rgba(255,255,255,0.07)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease, min-width 0.2s ease',
      overflow: 'hidden',
      flexShrink: 0,
      zIndex: 50,
    }}>
      {/* Header */}
      <div style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '0' : '0 12px 0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1.5 }}>
            GROUPS
          </span>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#6b7280',
            fontSize: 14,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Group list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {groups.map(group => {
          const isSelected = group.id === selectedGroupId;
          return (
            <button
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
              title={collapsed ? group.name : undefined}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: collapsed ? 0 : 10,
                padding: collapsed ? '10px 0' : '10px 14px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: isSelected ? 'rgba(77, 159, 255, 0.12)' : 'transparent',
                borderLeft: isSelected ? '3px solid #4d9fff' : '3px solid transparent',
                border: 'none',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                borderLeftWidth: 3,
                borderLeftStyle: 'solid',
                borderLeftColor: isSelected ? '#4d9fff' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s',
                textAlign: 'left',
              }}
            >
              {/* Group icon */}
              <div style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: isSelected ? 'rgba(77, 159, 255, 0.2)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${isSelected ? 'rgba(77, 159, 255, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                color: isSelected ? '#4d9fff' : '#9ca3af',
                flexShrink: 0,
              }}>
                {group.name[0].toUpperCase()}
              </div>

              {!collapsed && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isSelected ? '#e5e7eb' : '#9ca3af',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {group.name}
                  </div>
                  {/* Agent dots */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                    {group.agents.slice(0, 5).map((agent, i) => (
                      <span
                        key={agent}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: agentDotColor(agent, i),
                          background: `${agentDotColor(agent, i)}18`,
                          border: `1px solid ${agentDotColor(agent, i)}33`,
                          borderRadius: 4,
                          padding: '1px 5px',
                        }}
                      >
                        {agent}
                      </span>
                    ))}
                    {group.agents.length > 5 && (
                      <span style={{ fontSize: 9, color: '#6b7280' }}>+{group.agents.length - 5}</span>
                    )}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* New Group button */}
      <div style={{
        padding: collapsed ? '12px 0' : '12px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'center',
      }}>
        <button
          onClick={onCreateGroup}
          title="New Group"
          style={{
            width: collapsed ? 30 : '100%',
            height: 30,
            background: 'rgba(77, 159, 255, 0.1)',
            border: '1px solid rgba(77, 159, 255, 0.25)',
            borderRadius: 8,
            cursor: 'pointer',
            color: '#4d9fff',
            fontSize: collapsed ? 16 : 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'background 0.15s',
          }}
        >
          {collapsed ? '+' : '+ New Group'}
        </button>
      </div>
    </div>
  );
}
