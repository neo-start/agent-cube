import { useState, useEffect, useRef, useCallback } from 'react';
import { AGENT_CONFIGS, UploadedFile } from '../types';
import { ChatModal } from './ChatModal';

interface GroupMessage {
  id: string;
  type: 'user' | 'reply' | 'delegate' | 'status' | 'stream';
  from: string;
  content: string;
  timestamp: string;
  target?: string;
  toAgent?: string;
  taskId?: string;
  status?: string;
  partial?: boolean;
  attachments?: UploadedFile[];
}

type Channel = 'group' | 'Claw' | 'Deep';

const API = 'http://localhost:3020';

const AGENT_COLORS: Record<string, string> = {
  Claw: '#4d9fff',
  Deep: '#a78bfa',
  Orchestrator: '#f59e0b',
  User: '#22c55e',
};

const AGENT_LABELS: Record<string, string> = {
  Claw: 'Claw (Claude)',
  Deep: 'Deep (DeepSeek)',
  Orchestrator: 'Orchestrator',
  User: 'You',
};

const CHANNELS: { id: Channel; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'group', label: 'Group', icon: 'G', color: '#f59e0b', desc: 'All agents' },
  { id: 'Claw', label: 'Claw', icon: 'C', color: '#4d9fff', desc: 'Claude · Coder' },
  { id: 'Deep', label: 'Deep', icon: 'D', color: '#a78bfa', desc: 'DeepSeek · Thinker' },
];

const MENTIONABLE = AGENT_CONFIGS.map(a => a.name); // ['Claw', 'Deep']

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function MessageText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^\w*\n/, '');
          return (
            <pre key={i} style={{
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              padding: '8px 12px',
              margin: '6px 0',
              fontSize: 12,
              overflow: 'auto',
              fontFamily: 'monospace',
            }}>{code}</pre>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

interface GroupChatProps {
  isOpen?: boolean;
  initialChannel?: Channel | null;
  onToggle?: (open: boolean) => void;
}

export function GroupChat({ isOpen, initialChannel, onToggle }: GroupChatProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (onToggle) onToggle(next);
    else setInternalOpen(next);
  };
  const [channel, setChannel] = useState<Channel>('group');

  // Sync channel when opened from external (desk click)
  useEffect(() => {
    if (isOpen && initialChannel) {
      setChannel(initialChannel as Channel);
    }
  }, [isOpen, initialChannel]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load initial messages
  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/group`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))
      .catch(() => {});
  }, [open]);

  // Fetch agent statuses for sidebar
  useEffect(() => {
    if (!open) return;
    const fetchStatus = () => {
      fetch(`${API}/api/status`)
        .then(r => r.json())
        .then(data => {
          const s: Record<string, string> = {};
          for (const [name, info] of Object.entries(data) as [string, any][]) {
            s[name] = info.status || 'idle';
          }
          setAgentStatuses(s);
        })
        .catch(() => {});
    };
    fetchStatus();
    const iv = setInterval(fetchStatus, 3000);
    return () => clearInterval(iv);
  }, [open]);

  // SSE for live updates
  useEffect(() => {
    if (!open) return;
    const es = new EventSource(`${API}/api/group/stream`);

    es.onmessage = (e) => {
      try {
        const msg: GroupMessage = JSON.parse(e.data);
        setMessages(prev => {
          if (msg.partial && msg.type === 'stream') {
            const idx = prev.findIndex(m => m.id === msg.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], content: msg.content };
              return updated;
            }
          }
          if (msg.type === 'reply') {
            const idx = prev.findIndex(m => m.id === msg.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg;
              return updated;
            }
          }
          if (msg.type === 'status' && prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } catch {}
    };

    return () => es.close();
  }, [open]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, channel]);

  // Hide status messages once the agent has a reply/stream for that task
  const visibleMessages = messages.filter((msg, idx) => {
    if (msg.type !== 'status') return true;
    // Check if there's a reply or stream from same agent after this status
    const hasFollowUp = messages.some((m, i) =>
      i > idx &&
      m.from === msg.from &&
      (m.type === 'reply' || m.type === 'stream') &&
      (!msg.taskId || m.taskId === msg.taskId)
    );
    return !hasFollowUp;
  });

  // Filter messages by channel
  const filteredMessages = channel === 'group'
    ? visibleMessages
    : visibleMessages.filter(m =>
        m.from === channel || m.target === channel ||
        (m.type === 'user' && m.target === channel) ||
        (m.type === 'delegate' && (m.from === channel || m.toAgent === channel))
      );

  const handleUpload = useCallback(async (fileList: FileList) => {
    const fd = new FormData();
    const rawFiles = Array.from(fileList);
    for (const f of rawFiles) fd.append('files', f);
    try {
      const res = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        const uploaded = data.files.map((f: UploadedFile, i: number) => ({
          ...f,
          localPreview: rawFiles[i]?.type.startsWith('image/') ? URL.createObjectURL(rawFiles[i]) : undefined,
        }));
        setFiles(prev => [...prev, ...uploaded]);
      }
    } catch {}
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    // If in agent channel, auto-target that agent
    const mentionMatch = text.match(/@(Claw|Deep)/i);
    const target = channel !== 'group' ? channel : (mentionMatch ? mentionMatch[1] : undefined);

    setInput('');
    setMentionOpen(false);
    const sendFiles = files.length > 0 ? [...files] : undefined;
    setFiles([]);

    try {
      await fetch(`${API}/api/group/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target, attachments: sendFiles }),
      });
    } catch {}
  }, [input, files, channel]);

  // @ mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Check for @ trigger
    const cursorPos = e.target.selectionStart || 0;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionFilter(atMatch[1].toLowerCase());
      setMentionIdx(0);
    } else {
      setMentionOpen(false);
    }
  };

  const filteredMentions = MENTIONABLE.filter(name =>
    name.toLowerCase().startsWith(mentionFilter)
  );

  const insertMention = (name: string) => {
    const cursorPos = inputRef.current?.selectionStart || input.length;
    const textBefore = input.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0) {
      const newInput = input.slice(0, atIdx) + `@${name} ` + input.slice(cursorPos);
      setInput(newInput);
    }
    setMentionOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx(i => (i + 1) % filteredMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentions[mentionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Status color
  const statusColor = (s: string) => {
    const map: Record<string, string> = { idle: '#6b7280', working: '#22c55e', done: '#eab308', blocked: '#ef4444' };
    return map[s] || '#6b7280';
  };

  // Render a single message
  const renderMessage = (msg: GroupMessage) => {
    const color = AGENT_COLORS[msg.from] || '#6b7280';
    const isUser = msg.from === 'User';

    if (msg.type === 'status') {
      return (
        <div key={msg.id} style={{
          display: 'flex', justifyContent: 'center', padding: '4px 0',
        }}>
          <span style={{
            fontSize: 11, color: '#6b7280',
            background: 'rgba(255,255,255,0.05)',
            padding: '2px 12px', borderRadius: 10,
          }}>
            <span style={{ color, fontWeight: 600 }}>{msg.from}</span>
            {' '}{msg.content}
          </span>
        </div>
      );
    }

    if (msg.type === 'delegate') {
      return (
        <div key={msg.id} style={{
          display: 'flex', justifyContent: 'center', padding: '4px 0',
        }}>
          <span style={{
            fontSize: 11,
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            padding: '4px 14px', borderRadius: 10,
            color: '#f59e0b',
          }}>
            <span style={{ fontWeight: 700 }}>{msg.from}</span>
            {' → '}
            <span style={{ fontWeight: 700 }}>{msg.toAgent}</span>
            {': '}{msg.content.slice(0, 120)}{msg.content.length > 120 ? '...' : ''}
          </span>
        </div>
      );
    }

    const isStreaming = msg.type === 'stream' && msg.status === 'streaming';

    return (
      <div key={msg.id} style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 8,
        padding: '4px 0',
        alignItems: 'flex-start',
      }}>
        {!isUser && (
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#fff',
            flexShrink: 0,
          }}>
            {msg.from[0]}
          </div>
        )}

        <div style={{
          maxWidth: '60%',
          background: isUser ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${isUser ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          padding: '8px 12px',
        }}>
          {!isUser && (
            <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 2 }}>
              {AGENT_LABELS[msg.from] || msg.from}
              {isStreaming && (
                <span style={{
                  marginLeft: 6, fontSize: 10, color: '#22c55e',
                  animation: 'pulse 1.5s infinite',
                }}>typing...</span>
              )}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#e5e7eb' }}>
            <MessageText text={msg.content || (isStreaming ? '...' : '')} />
          </div>
          {/* Attachments */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {msg.attachments.map((att: UploadedFile) => (
                att.type === 'image' ? (
                  <img key={att.id} src={att.localPreview || att.url}
                    style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, cursor: 'pointer' }}
                    onClick={() => window.open(att.url, '_blank')}
                  />
                ) : (
                  <a key={att.id} href={att.url} download={att.name}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#60a5fa', fontSize: 12, textDecoration: 'none' }}>
                    📄 {att.name}
                  </a>
                )
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4, textAlign: isUser ? 'right' : 'left' }}>
            {formatTime(msg.timestamp)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          bottom: 60,
          left: 24,
          width: 48, height: 48,
          borderRadius: 12,
          background: open ? 'rgba(77, 159, 255, 0.2)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${open ? 'rgba(77, 159, 255, 0.4)' : 'rgba(255,255,255,0.1)'}`,
          color: open ? '#4d9fff' : '#e5e7eb',
          cursor: 'pointer',
          zIndex: 200,
          fontSize: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s',
        }}
        title="Group Chat"
      >
        G
      </button>

      {/* Fullscreen panel */}
      {open && (
        <div style={{
          position: 'fixed',
          top: 52, left: 0, right: 0, bottom: 0,
          background: 'rgba(10, 14, 26, 0.98)',
          display: 'flex',
          zIndex: 150,
          overflow: 'hidden',
        }}>
          {/* ── Left sidebar ── */}
          <div style={{
            width: 220,
            borderRight: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 0',
            flexShrink: 0,
          }}>
            <div style={{ padding: '0 16px 12px', fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: 1 }}>
              CHANNELS
            </div>

            {CHANNELS.map(ch => {
              const isActive = channel === ch.id;
              const status = ch.id !== 'group' ? agentStatuses[ch.id] : undefined;
              return (
                <button
                  key={ch.id}
                  onClick={() => setChannel(ch.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px',
                    background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? `3px solid ${ch.color}` : '3px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  {/* Icon */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `${ch.color}22`,
                    border: `1px solid ${ch.color}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: ch.color,
                    flexShrink: 0,
                  }}>
                    {ch.icon}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      color: isActive ? '#e5e7eb' : '#9ca3af',
                    }}>
                      {ch.label}
                    </div>
                    <div style={{ fontSize: 10, color: '#4b5563', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {status && (
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: statusColor(status),
                          display: 'inline-block',
                        }} />
                      )}
                      {status || ch.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Right: chat area ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              padding: '12px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: CHANNELS.find(c => c.id === channel)?.color || '#f59e0b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#fff',
                }}>
                  {CHANNELS.find(c => c.id === channel)?.icon}
                </div>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>
                    {channel === 'group' ? 'Group Chat' : `Chat with ${channel}`}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                    {channel === 'group' ? '@mention to target agent' : `Direct · file upload · task tracking`}
                  </span>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: '#9ca3af', fontSize: 12,
              }}>Close</button>
            </div>

            {/* Agent channel: inline ChatModal with full direct chat features */}
            {channel !== 'group' ? (
              (() => {
                const agentConfig = AGENT_CONFIGS.find(a => a.name === channel);
                return agentConfig ? (
                  <ChatModal
                    key={channel}
                    agent={agentConfig}
                    onClose={() => setChannel('group')}
                    inline
                  />
                ) : null;
              })()
            ) : (
              <>
                {/* Group Messages — with drag & drop */}
                <div ref={scrollRef} style={{
                  flex: 1, overflowY: 'auto', padding: '12px 20px',
                }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(77, 159, 255, 0.05)'; }}
                  onDragLeave={e => { e.currentTarget.style.background = ''; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.background = ''; if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files); }}
                >
                  {filteredMessages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#4b5563', fontSize: 13, marginTop: 60 }}>
                      Send a message to start the conversation · drag files here to upload
                    </div>
                  )}
                  {filteredMessages.map(renderMessage)}
                </div>

                {/* File preview with thumbnails */}
                {files.length > 0 && (
                  <div style={{
                    padding: '8px 20px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: 8, flexWrap: 'wrap',
                  }}>
                    {files.map(f => (
                      <div key={f.id} style={{
                        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 8, padding: f.type === 'image' ? '2px' : '4px 8px',
                      }}>
                        {f.type === 'image' && (f as any).localPreview ? (
                          <img src={(f as any).localPreview} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                        ) : (
                          <span style={{ fontSize: 11, color: '#9ca3af', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name}</span>
                        )}
                        <button onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} style={{
                          position: f.type === 'image' ? 'absolute' : 'static', top: -4, right: -4,
                          width: 16, height: 16, borderRadius: '50%', background: '#374151',
                          border: 'none', color: '#fff', cursor: 'pointer', fontSize: 10,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                        }}>x</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Group input area with @ mention popup */}
                <div style={{
                  padding: '12px 20px',
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                }}>
                  {mentionOpen && filteredMentions.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 20,
                      background: 'rgba(20, 24, 40, 0.98)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8,
                      padding: '4px 0',
                      boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
                      minWidth: 180,
                      zIndex: 10,
                    }}>
                      {filteredMentions.map((name, i) => (
                        <button
                          key={name}
                          onClick={() => insertMention(name)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px',
                            background: i === mentionIdx ? 'rgba(77, 159, 255, 0.15)' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            width: '100%',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{
                            width: 24, height: 24, borderRadius: 4,
                            background: AGENT_COLORS[name] || '#6b7280',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: '#fff',
                          }}>{name[0]}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>{name}</div>
                            <div style={{ fontSize: 10, color: '#6b7280' }}>
                              {AGENT_LABELS[name] || name}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => e.target.files && handleUpload(e.target.files)}
                    />
                    <button onClick={() => fileRef.current?.click()} style={{
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: '#9ca3af', fontSize: 14,
                    }} title="Upload files">+</button>

                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message... @ to mention"
                      rows={1}
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        color: '#e5e7eb',
                        fontSize: 13,
                        resize: 'none',
                        outline: 'none',
                        fontFamily: 'inherit',
                        lineHeight: 1.4,
                      }}
                    />

                    <button onClick={handleSend} style={{
                      background: 'linear-gradient(135deg, #1a6cf5, #7c3aed)',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 16px',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}>Send</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
