import { useState, useEffect, useRef } from 'react';

interface ScratchEntry {
  key: string;
  value: string;
  agent: string;
  ts: string;
}

function formatTs(iso: string) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export function ScratchpadPanel() {
  const [entries, setEntries] = useState<ScratchEntry[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [glowing, setGlowing] = useState(false);
  const prevCountRef = useRef(0);

  const fetchEntries = async () => {
    try {
      const res = await fetch('/api/scratchpad');
      const data = await res.json();
      const list: ScratchEntry[] = data.entries || [];
      if (list.length > prevCountRef.current) {
        setGlowing(true);
        setTimeout(() => setGlowing(false), 1500);
      }
      prevCountRef.current = list.length;
      setEntries(list);
    } catch {}
  };

  useEffect(() => {
    fetchEntries();
    const iv = setInterval(fetchEntries, 3000);
    return () => clearInterval(iv);
  }, []);

  const deleteEntry = async (key: string) => {
    try {
      await fetch(`/api/scratchpad/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(e => e.key !== key));
      prevCountRef.current = Math.max(0, prevCountRef.current - 1);
    } catch {}
  };

  const addEntry = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      const res = await fetch('/api/scratchpad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim(), value: newValue.trim(), agent: 'user' }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewKey('');
        setNewValue('');
        setAdding(false);
        fetchEntries();
      }
    } catch {}
  };

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 80,
      width: collapsed ? 'auto' : 280,
      zIndex: 200,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Toggle button / collapsed state */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: glowing
              ? 'rgba(99,102,241,0.4)'
              : 'rgba(10, 14, 30, 0.92)',
            border: `1px solid ${glowing ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.3)'}`,
            borderRadius: 10,
            color: '#a5b4fc',
            padding: '7px 12px',
            cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: glowing ? '0 0 16px rgba(99,102,241,0.5)' : '0 2px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.3s',
          }}
        >
          📋 <span style={{ fontSize: 11 }}>{entries.length}</span>
        </button>
      ) : (
        <div style={{
          background: 'rgba(8, 12, 28, 0.96)',
          border: `1px solid ${glowing ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.25)'}`,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: glowing
            ? '0 0 24px rgba(99,102,241,0.4), 0 4px 20px rgba(0,0,0,0.5)'
            : '0 4px 20px rgba(0,0,0,0.5)',
          transition: 'box-shadow 0.3s',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid rgba(99,102,241,0.15)',
            background: 'rgba(99,102,241,0.08)',
          }}>
            <span style={{ color: '#a5b4fc', fontSize: 12, fontWeight: 700 }}>
              📋 Scratchpad
              <span style={{ marginLeft: 6, color: '#6366f1', fontSize: 10 }}>{entries.length}</span>
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setAdding(a => !a)}
                title="Add entry"
                style={{
                  background: adding ? 'rgba(99,102,241,0.3)' : 'none',
                  border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 5, color: '#a5b4fc',
                  cursor: 'pointer', fontSize: 13, width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>+</button>
              <button
                onClick={() => setCollapsed(true)}
                style={{
                  background: 'none', border: 'none',
                  color: '#4b5563', cursor: 'pointer', fontSize: 14, padding: 0,
                  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>−</button>
            </div>
          </div>

          {/* Add form */}
          {adding && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(99,102,241,0.1)', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="key"
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 5, color: '#e5e7eb', fontSize: 11, padding: '4px 8px', outline: 'none',
                }}
              />
              <input
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEntry()}
                placeholder="value"
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 5, color: '#e5e7eb', fontSize: 11, padding: '4px 8px', outline: 'none',
                }}
              />
              <button
                onClick={addEntry}
                style={{
                  background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.4)',
                  borderRadius: 5, color: '#c4b5fd', fontSize: 11, cursor: 'pointer', padding: '3px 8px',
                }}>Save</button>
            </div>
          )}

          {/* Entries */}
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: '6px 0' }}>
            {entries.length === 0 ? (
              <div style={{ color: '#374151', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>
                No entries yet
              </div>
            ) : (
              entries.map(e => (
                <div
                  key={e.key}
                  onClick={() => deleteEntry(e.key)}
                  title="Click to delete"
                  style={{
                    padding: '5px 12px',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 1,
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={el => (el.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                  onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ color: '#a5b4fc', fontSize: 11, fontWeight: 600 }}>{e.key}</span>
                    <span style={{ color: '#6b7280', fontSize: 9 }}>: </span>
                    <span style={{ color: '#d1d5db', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.value}</span>
                  </div>
                  <div style={{ color: '#374151', fontSize: 9 }}>
                    {e.agent} · {formatTs(e.ts)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
