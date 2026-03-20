import { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { useAgentConfigs } from '../hooks/useAgentConfigs';

export function MessagePanel() {
  const { agentConfigs: AGENT_CONFIGS } = useAgentConfigs();
  const ALL_SENDERS = ['User', ...AGENT_CONFIGS.map(a => a.name)];
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [from, setFrom] = useState('User');
  const [to, setTo] = useState('Forge');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch('/api/messages');
      const data = await res.json();
      setMessages(data.messages || []);
      setUnread((data.messages || []).filter((m: Message) => !m.read && m.to === 'User').length);
    } catch {}
  };

  useEffect(() => {
    fetchMessages();
    const t = setInterval(fetchMessages, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, text: text.trim() }),
      });
      setText('');
      await fetchMessages();
    } finally {
      setSending(false);
    }
  };

  const agentColor = (name: string) =>
    AGENT_CONFIGS.find(a => a.name === name)?.accentColor || '#9ca3af';

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 20, right: 20,
          width: 48, height: 48, borderRadius: '50%',
          background: 'linear-gradient(135deg, #1a6cf5, #7c3aed)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, zIndex: 200,
          boxShadow: '0 4px 20px rgba(26,108,245,0.4)',
        }}
      >
        💬
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff',
            fontSize: 10, fontWeight: 700,
            width: 18, height: 18, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{unread}</span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 80, right: 20,
          width: 380, height: 520,
          background: 'rgba(5, 8, 20, 0.96)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(77, 159, 255, 0.2)',
          borderRadius: 16,
          display: 'flex', flexDirection: 'column',
          zIndex: 200,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(77,159,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 14 }}>Agent Messages</span>
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', color: '#6b7280',
              cursor: 'pointer', fontSize: 16, padding: '0 4px',
            }}>✕</button>
          </div>

          {/* Messages list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ color: '#374151', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
                No messages yet
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                alignItems: m.from === 'User' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#4b5563' }}>
                  <span style={{ color: m.from === 'User' ? '#60a5fa' : agentColor(m.from) }}>{m.from}</span>
                  <span>→</span>
                  <span style={{ color: m.to === 'User' ? '#60a5fa' : agentColor(m.to) }}>{m.to}</span>
                  <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                </div>
                <div style={{
                  maxWidth: '80%', padding: '8px 12px',
                  borderRadius: m.from === 'User' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: m.from === 'User'
                    ? 'rgba(26,108,245,0.25)'
                    : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${m.from === 'User' ? 'rgba(26,108,245,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  color: '#d1d5db', fontSize: 13, lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Compose */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(77,159,255,0.1)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={from}
                onChange={e => setFrom(e.target.value)}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#d1d5db', fontSize: 12, padding: '4px 8px',
                }}
              >
                {ALL_SENDERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ color: '#4b5563', alignSelf: 'center', fontSize: 12 }}>→</span>
              <select
                value={to}
                onChange={e => setTo(e.target.value)}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#d1d5db', fontSize: 12, padding: '4px 8px',
                }}
              >
                {ALL_SENDERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Type a message..."
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(77,159,255,0.2)',
                  borderRadius: 8, color: '#d1d5db', fontSize: 13,
                  padding: '8px 12px', outline: 'none',
                }}
              />
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                style={{
                  background: 'linear-gradient(135deg, #1a6cf5, #7c3aed)',
                  border: 'none', borderRadius: 8, color: '#fff',
                  padding: '8px 14px', cursor: 'pointer', fontSize: 14,
                  opacity: sending || !text.trim() ? 0.5 : 1,
                }}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
