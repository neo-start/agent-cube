interface GroupSidebarProps {
  isGroupChatOpen: boolean;
  onToggleGroupChat: () => void;
}

export function GroupSidebar({ isGroupChatOpen, onToggleGroupChat }: GroupSidebarProps) {
  return (
    <div style={{
      width: 48,
      minWidth: 48,
      height: '100%',
      background: 'rgba(8, 10, 20, 0.98)',
      borderRight: '1px solid rgba(255,255,255,0.07)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 12,
      flexShrink: 0,
      zIndex: 50,
    }}>
      <button
        onClick={onToggleGroupChat}
        title="Groups"
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          background: isGroupChatOpen ? 'rgba(77, 159, 255, 0.2)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${isGroupChatOpen ? 'rgba(77, 159, 255, 0.5)' : 'rgba(255,255,255,0.1)'}`,
          cursor: 'pointer',
          color: isGroupChatOpen ? '#4d9fff' : '#9ca3af',
          fontSize: 13,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        G
      </button>
    </div>
  );
}
