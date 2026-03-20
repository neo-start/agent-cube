import { useState, useEffect, useRef, useCallback } from 'react';
import { AGENT_CONFIGS, UploadedFile } from '../types';
import { ChatModal } from './ChatModal';

interface GroupMessage {
  id: string;
  type: 'user' | 'reply' | 'delegate' | 'status' | 'stream' | 'agent-msg'
      | 'thread-start' | 'thread-end' | 'thread-pause' | 'thread-join'
      | 'tool-call' | 'tool-result';
  from: string;
  content: string;
  timestamp: string;
  target?: string;
  toAgent?: string;
  taskId?: string;
  threadId?: string;
  status?: string;
  partial?: boolean;
  participants?: string[];
  endReason?: string;
  attachments?: UploadedFile[];
}

type Channel = string; // 'group' or agent name

const API = '';

const AGENT_COLORS: Record<string, string> = {
  Forge: '#4d9fff',
  Sage: '#a78bfa',
  Orchestrator: '#f59e0b',
  User: '#22c55e',
};

const AGENT_LABELS: Record<string, string> = {
  Forge: 'Forge (Claude)',
  Sage: 'Sage (DeepSeek)',
  Orchestrator: 'Orchestrator',
  User: 'You',
};

const AGENT_CHANNEL_COLORS = ['#4d9fff', '#a78bfa', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

function agentColor(name: string, idx: number): string {
  return AGENT_COLORS[name] || AGENT_CHANNEL_COLORS[idx % AGENT_CHANNEL_COLORS.length];
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📋', pptx: '📋', zip: '🗜️', tar: '🗜️', gz: '🗜️', rar: '🗜️',
    mp4: '🎬', mov: '🎬', avi: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵', ogg: '🎵',
    js: '💻', ts: '💻', py: '💻', json: '📋',
    txt: '📄', csv: '📊', md: '📝',
  };
  return icons[ext] || '📎';
}

// Paperclip SVG icon
function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// Spinner SVG
function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
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
  initialChannel?: string | null;
  onToggle?: (open: boolean) => void;
  groupId?: string;
  groupAgents?: string[];
  groupName?: string;
  onCreateGroup?: () => void;
}

export function GroupChat({ isOpen, initialChannel, onToggle, groupId = 'default', groupAgents, groupName, onCreateGroup }: GroupChatProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (onToggle) onToggle(next);
    else setInternalOpen(next);
  };
  const [channel, setChannel] = useState<Channel>('group');

  // Agents for this group (fall back to AGENT_CONFIGS if not provided)
  const agentNames = groupAgents && groupAgents.length > 0
    ? groupAgents
    : AGENT_CONFIGS.map(a => a.name);

  // Dynamic channel list
  const channels = [
    { id: 'group', label: groupName || 'Group', icon: 'G', color: '#f59e0b', desc: 'All agents' },
    ...agentNames.map((name, i) => ({
      id: name,
      label: name,
      icon: name[0].toUpperCase(),
      color: agentColor(name, i),
      desc: AGENT_LABELS[name] || name,
    })),
  ];

  const mentionable = agentNames;

  useEffect(() => {
    if (isOpen && initialChannel) {
      setChannel(initialChannel);
    }
  }, [isOpen, initialChannel]);

  // Reset to 'group' channel when groupId changes
  useEffect(() => {
    setChannel('group');
  }, [groupId]);

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);
  const [hoveredAttId, setHoveredAttId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/groups/${groupId}/messages`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))
      .catch(() => {
        // fallback to old endpoint
        fetch(`${API}/api/group`)
          .then(r => r.json())
          .then(data => setMessages(data.messages || []))
          .catch(() => {});
      });
    setMessages([]);
  }, [open, groupId]);

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

  useEffect(() => {
    if (!open) return;
    const es = new EventSource(`${API}/api/groups/${groupId}/stream`);

    es.onmessage = (e) => {
      try {
        const msg: GroupMessage = JSON.parse(e.data);

        // Track thread pause/resume state
        if (msg.type === 'thread-pause' && msg.threadId) {
          setActiveThreadId(msg.threadId);
        } else if (msg.type === 'thread-end') {
          setActiveThreadId(null);
        } else if (msg.type === 'thread-start') {
          setActiveThreadId(null);
        }

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
  }, [open, groupId]);

  useEffect(() => {
    if (scrollRef.current && !userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, channel]);

  // Reset userScrolledUp when channel changes so new channel auto-scrolls to bottom
  useEffect(() => { userScrolledUp.current = false; }, [channel, groupId]);

  const visibleMessages = messages.filter((msg, idx) => {
    if (msg.type !== 'status') return true;
    const hasFollowUp = messages.some((m, i) =>
      i > idx &&
      m.from === msg.from &&
      (m.type === 'reply' || m.type === 'stream') &&
      (!msg.taskId || m.taskId === msg.taskId)
    );
    return !hasFollowUp;
  });

  const filteredMessages = channel === 'group'
    ? visibleMessages
    : visibleMessages.filter(m =>
        m.from === channel || m.target === channel ||
        (m.type === 'user' && m.target === channel) ||
        (m.type === 'delegate' && (m.from === channel || m.toAgent === channel))
      );

  const handleUpload = useCallback(async (fileList: FileList) => {
    setUploading(true);
    setUploadError(null);
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
      } else {
        setUploadError('Upload failed');
      }
    } catch {
      setUploadError('Upload failed — check connection');
    } finally {
      setUploading(false);
    }
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const pastedFiles = items
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter(Boolean) as File[];
    if (pastedFiles.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      pastedFiles.forEach(f => dt.items.add(f));
      handleUpload(dt.files);
    }
  }, [handleUpload]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    // In group channel, let the server handle @mention routing (Thread vs single agent).
    // Only set target when in a direct channel (Forge/Sage sidebar).
    const target = channel !== 'group' ? channel : undefined;

    setInput('');
    setMentionOpen(false);
    const sendFiles = files.length > 0 ? [...files] : undefined;
    setFiles([]);

    try {
      await fetch(`${API}/api/groups/${groupId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          target,
          attachments: sendFiles,
          ...(activeThreadId && channel === 'group' ? { threadId: activeThreadId } : {}),
        }),
      });
    } catch {}
  }, [input, files, channel, activeThreadId, groupId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

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

  const filteredMentions = mentionable.filter(name =>
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

  const statusColor = (s: string) => {
    const map: Record<string, string> = { idle: '#6b7280', working: '#22c55e', done: '#eab308', blocked: '#ef4444' };
    return map[s] || '#6b7280';
  };

  const renderMessage = (msg: GroupMessage) => {
    const color = AGENT_COLORS[msg.from] || '#6b7280';
    const isUser = msg.from === 'User';

    if (msg.type === 'status') {
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
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
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
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

    // Thread system events
    if (msg.type === 'thread-start') {
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <span style={{
            fontSize: 11,
            background: 'rgba(77, 159, 255, 0.1)',
            border: '1px solid rgba(77, 159, 255, 0.25)',
            padding: '4px 14px', borderRadius: 10,
            color: '#4d9fff',
          }}>
            Thread started · {(msg.participants || []).join(' + ')} · {msg.content}
          </span>
        </div>
      );
    }

    if (msg.type === 'thread-join') {
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            <span style={{ color: AGENT_COLORS[msg.from] || '#6b7280', fontWeight: 600 }}>{msg.from}</span>
            {' joined the discussion'}
          </span>
        </div>
      );
    }

    if (msg.type === 'thread-pause') {
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <span style={{
            fontSize: 11,
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            padding: '4px 14px', borderRadius: 10,
            color: '#eab308',
          }}>
            Waiting for your input · reply to continue the discussion
          </span>
        </div>
      );
    }

    if (msg.type === 'thread-end') {
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <span style={{
            fontSize: 11,
            background: 'rgba(107, 114, 128, 0.1)',
            border: '1px solid rgba(107, 114, 128, 0.2)',
            padding: '4px 14px', borderRadius: 10,
            color: '#6b7280',
          }}>
            Discussion ended {msg.endReason === 'max-turns' ? '(max turns reached)' : ''}
          </span>
        </div>
      );
    }

    if (msg.type === 'tool-call') {
      const agentCol = AGENT_COLORS[msg.from] || '#6b7280';
      const isExpanded = expandedTools.has(msg.id);
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '3px 0' }}>
          <button
            onClick={() => setExpandedTools(prev => {
              const next = new Set(prev);
              if (next.has(msg.id)) next.delete(msg.id); else next.add(msg.id);
              return next;
            })}
            style={{
              background: 'rgba(234, 179, 8, 0.06)',
              border: '1px solid rgba(234, 179, 8, 0.2)',
              borderRadius: 8, padding: '4px 12px',
              cursor: 'pointer', textAlign: 'left',
              maxWidth: '70%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12 }}>⚙️</span>
              <span style={{ fontSize: 11, color: agentCol, fontWeight: 600 }}>{msg.from}</span>
              <span style={{ fontSize: 11, color: '#d97706' }}>{msg.content.replace(/^Executing \d+ tool\(s\): /, '')}</span>
              <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>{isExpanded ? '▲' : '▼'}</span>
            </div>
            {isExpanded && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.content}
              </div>
            )}
          </button>
        </div>
      );
    }

    if (msg.type === 'tool-result') {
      const agentCol = AGENT_COLORS[msg.from] || '#6b7280';
      const isExpanded = expandedTools.has(msg.id + '-result');
      return (
        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', padding: '3px 0' }}>
          <button
            onClick={() => setExpandedTools(prev => {
              const next = new Set(prev);
              const k = msg.id + '-result';
              if (next.has(k)) next.delete(k); else next.add(k);
              return next;
            })}
            style={{
              background: 'rgba(107, 114, 128, 0.06)',
              border: '1px solid rgba(107, 114, 128, 0.15)',
              borderRadius: 8, padding: '4px 12px',
              cursor: 'pointer', textAlign: 'left',
              maxWidth: '70%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12 }}>✓</span>
              <span style={{ fontSize: 11, color: agentCol, fontWeight: 600 }}>{msg.from}</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>tool result</span>
              <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 4 }}>{isExpanded ? '▲' : '▼'}</span>
            </div>
            {isExpanded && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.content}
              </div>
            )}
          </button>
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
                <span style={{ marginLeft: 6, fontSize: 10, color: '#22c55e', animation: 'pulse 1.5s infinite' }}>
                  typing...
                </span>
              )}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#e5e7eb' }}>
            <MessageText text={msg.content || (isStreaming ? '...' : '')} />
          </div>

          {/* Received attachments */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {msg.attachments.map((att: UploadedFile) =>
                att.type === 'image' ? (
                  <div
                    key={att.id}
                    style={{ position: 'relative', display: 'inline-block', cursor: 'zoom-in' }}
                    onMouseEnter={() => setHoveredAttId(att.id)}
                    onMouseLeave={() => setHoveredAttId(null)}
                    onClick={() => setLightbox({ url: att.url, name: att.name })}
                  >
                    <img
                      src={att.localPreview || att.url}
                      style={{
                        maxWidth: '100%', maxHeight: 200, borderRadius: 8,
                        display: 'block',
                        transform: hoveredAttId === att.id ? 'scale(1.02)' : 'scale(1)',
                        transition: 'transform 0.15s ease',
                        boxShadow: hoveredAttId === att.id ? '0 4px 16px rgba(0,0,0,0.4)' : 'none',
                      }}
                    />
                    {hoveredAttId === att.id && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.25)',
                        borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 22 }}>🔍</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={att.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                  }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{fileTypeIcon(att.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, color: '#e5e7eb', fontWeight: 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{att.name}</div>
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
                        {att.name.split('.').pop()?.toUpperCase()}{att.size ? ` · ${formatSize(att.size)}` : ''}
                      </div>
                    </div>
                    <a href={att.url} download={att.name} style={{
                      background: 'rgba(77, 159, 255, 0.15)',
                      border: '1px solid rgba(77, 159, 255, 0.3)',
                      borderRadius: 6, padding: '4px 10px',
                      color: '#4d9fff', fontSize: 12, textDecoration: 'none',
                      flexShrink: 0, fontWeight: 600,
                    }}>↓</a>
                  </div>
                )
              )}
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
      {/* keyframe styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 999, cursor: 'zoom-out',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={lightbox.url}
              alt={lightbox.name}
              style={{ maxWidth: '90vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10, display: 'block' }}
            />
            <div style={{
              position: 'absolute', bottom: -32, left: 0, right: 0,
              textAlign: 'center', fontSize: 12, color: '#9ca3af',
            }}>{lightbox.name}</div>
            <button
              onClick={() => setLightbox(null)}
              style={{
                position: 'absolute', top: -14, right: -14,
                width: 28, height: 28, borderRadius: '50%',
                background: '#374151', border: '1px solid rgba(255,255,255,0.15)',
                color: '#e5e7eb', cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        </div>
      )}

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
          {/* Left sidebar */}
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

            {channels.map(ch => {
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#e5e7eb' : '#9ca3af' }}>
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

            {/* New Group button */}
            {onCreateGroup && (
              <div style={{ padding: '12px 12px 0', marginTop: 'auto' }}>
                <button
                  onClick={onCreateGroup}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'rgba(77, 159, 255, 0.08)',
                    border: '1px solid rgba(77, 159, 255, 0.2)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: '#4d9fff',
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'background 0.15s',
                  }}
                >
                  + New Group
                </button>
              </div>
            )}
          </div>

          {/* Right: chat area */}
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
                  background: channels.find(c => c.id === channel)?.color || '#f59e0b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#fff',
                }}>
                  {channels.find(c => c.id === channel)?.icon}
                </div>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>
                    {channel === 'group' ? `${groupName || 'Group'} Chat` : `Chat with ${channel}`}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                    {channel === 'group' ? '@mention to target agent' : 'Direct · file upload · task tracking'}
                  </span>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: '#9ca3af', fontSize: 12,
              }}>Close</button>
            </div>

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
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>
                    No direct chat available for {channel}
                  </div>
                );
              })()
            ) : (
              <>
                {/* Group Messages — with drag & drop */}
                <div
                  ref={scrollRef}
                  onScroll={() => {
                    const el = scrollRef.current;
                    if (!el) return;
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                    userScrolledUp.current = !atBottom;
                  }}
                  style={{
                    flex: 1, overflowY: 'auto', padding: '12px 20px',
                    position: 'relative',
                    background: isDragging ? 'rgba(77, 159, 255, 0.03)' : undefined,
                    transition: 'background 0.15s',
                  }}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={e => {
                    // Only clear if leaving the scroll container itself
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
                  }}
                >
                  {isDragging && (
                    <div style={{
                      position: 'absolute', inset: 12,
                      border: '2px dashed rgba(77, 159, 255, 0.5)',
                      borderRadius: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none', zIndex: 5,
                      background: 'rgba(77, 159, 255, 0.06)',
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>📎</div>
                        <div style={{ color: '#4d9fff', fontSize: 14, fontWeight: 600 }}>Drop files to upload</div>
                      </div>
                    </div>
                  )}

                  {filteredMessages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#4b5563', fontSize: 13, marginTop: 60 }}>
                      Send a message to start the conversation · drag & drop or paste files to upload
                    </div>
                  )}
                  {filteredMessages.map(renderMessage)}
                </div>

                {/* Thread pause indicator */}
                {activeThreadId && (
                  <div style={{
                    padding: '6px 20px',
                    background: 'rgba(234, 179, 8, 0.08)',
                    borderTop: '1px solid rgba(234, 179, 8, 0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: 11, color: '#eab308' }}>
                      Thread paused — your reply will continue the discussion
                    </span>
                    <button
                      onClick={() => setActiveThreadId(null)}
                      style={{ fontSize: 10, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      dismiss
                    </button>
                  </div>
                )}

                {/* File preview — selected & pending */}
                {files.length > 0 && (
                  <div style={{
                    padding: '10px 20px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: 8, flexWrap: 'wrap',
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    {files.map(f => (
                      <div
                        key={f.id}
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setHoveredFileId(f.id)}
                        onMouseLeave={() => setHoveredFileId(null)}
                      >
                        {f.type === 'image' && (f as any).localPreview ? (
                          <div style={{ position: 'relative' }}>
                            <img
                              src={(f as any).localPreview}
                              style={{
                                width: 56, height: 56, objectFit: 'cover', borderRadius: 8,
                                display: 'block', border: '1px solid rgba(255,255,255,0.12)',
                                transform: hoveredFileId === f.id ? 'scale(1.05)' : 'scale(1)',
                                transition: 'transform 0.15s ease',
                              }}
                            />
                            <button
                              onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}
                              style={{
                                position: 'absolute', top: -6, right: -6,
                                width: 18, height: 18, borderRadius: '50%',
                                background: '#1f2937', border: '1px solid rgba(255,255,255,0.2)',
                                color: '#e5e7eb', cursor: 'pointer', fontSize: 11,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1, fontWeight: 700,
                              }}
                            >×</button>
                          </div>
                        ) : (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 10px 6px 8px',
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8, maxWidth: 200,
                          }}>
                            <span style={{ fontSize: 18, flexShrink: 0 }}>{fileTypeIcon(f.name)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: 11, color: '#e5e7eb',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{f.name}</div>
                              {f.size ? (
                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
                                  {f.name.split('.').pop()?.toUpperCase()} · {formatSize(f.size)}
                                </div>
                              ) : null}
                            </div>
                            <button
                              onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}
                              style={{
                                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                background: '#374151', border: '1px solid rgba(255,255,255,0.15)',
                                color: '#e5e7eb', cursor: 'pointer', fontSize: 10,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700,
                              }}
                            >×</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload error banner */}
                {uploadError && (
                  <div style={{
                    padding: '6px 20px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    borderTop: '1px solid rgba(239, 68, 68, 0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {uploadError}</span>
                    <button
                      onClick={() => setUploadError(null)}
                      style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}
                    >Dismiss</button>
                  </div>
                )}

                {/* Input area */}
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
                            <div style={{ fontSize: 10, color: '#6b7280' }}>{AGENT_LABELS[name] || name}</div>
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

                    {/* Paperclip upload button */}
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        cursor: uploading ? 'default' : 'pointer',
                        color: uploading ? '#4d9fff' : '#9ca3af',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'color 0.15s, background 0.15s',
                        flexShrink: 0,
                      }}
                      title="Upload files (or paste images)"
                    >
                      {uploading ? <Spinner /> : <PaperclipIcon />}
                    </button>

                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder="Type a message… @ to mention · paste image to upload"
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
                      flexShrink: 0,
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
