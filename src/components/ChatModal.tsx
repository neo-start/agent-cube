import { useState, useEffect, useRef, useCallback } from 'react';
import { AgentConfig, UploadedFile } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  taskId?: string;
  status?: 'sending' | 'thinking' | 'done' | 'error';
  thinkingStartedAt?: number;
  attachments?: UploadedFile[];
}

interface Props {
  agent: AgentConfig;
  onClose: () => void;
  inline?: boolean;
}

const API = '';
const STORAGE_KEY = (agentName: string) => `agent-cube-chat-${agentName}`;

function loadMessages(agentName: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(agentName));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(agentName: string, messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-200);
    localStorage.setItem(STORAGE_KEY(agentName), JSON.stringify(trimmed));
  } catch {}
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function TypingDots({ color }: { color: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', height: 16 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: color,
          display: 'inline-block',
          animation: `chatDot 1.2s ${i * 0.2}s ease-in-out infinite`,
        }} />
      ))}
    </span>
  );
}

/** Renders text with ``` code blocks as styled <pre> elements */
function MessageText({ text, color, isError }: { text: string; color: string; isError: boolean }) {
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', lang: match[1] || '', content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return (
    <>
      {parts.map((p, i) =>
        p.type === 'code' ? (
          <pre key={i} style={{
            background: '#0d1117',
            color: '#e6edf3',
            padding: 12,
            borderRadius: 6,
            overflowX: 'auto',
            fontSize: 12,
            margin: '6px 0',
            fontFamily: 'monospace',
            whiteSpace: 'pre',
          }}>{p.content}</pre>
        ) : (
          <span key={i} style={{
            color: isError ? '#f87171' : color,
            fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            display: 'block',
          }}>{p.content}</span>
        )
      )}
    </>
  );
}

/** Elapsed seconds timer for thinking messages */
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));

  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  return <span style={{ opacity: 0.6 }}>{elapsed}s</span>;
}

/** Strip [DELEGATE:X]\n prefix and return {toAgent, body} */
function parseDelegation(text: string): { toAgent: string; body: string } | null {
  const m = text.match(/^\[DELEGATE:(Forge|Sage)\]\n?([\s\S]*)/);
  if (!m) return null;
  return { toAgent: m[1], body: m[2].trim() };
}

export function ChatModal({ agent, onClose, inline = false }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Recover stale 'thinking' messages from previous sessions
    return loadMessages(agent.name).map(m =>
      (m.status === 'thinking' || m.status === 'sending')
        ? { ...m, status: 'error' as const, text: m.text || '(interrupted — server restarted)' }
        : m
    );
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const pendingTaskRef = useRef<{ taskId: string; msgId: string } | null>(null);
  const pollRef = useRef<number | null>(null);
  const orchPollRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist messages whenever they change
  useEffect(() => {
    saveMessages(agent.name, messages);
  }, [messages, agent.name]);

  // Smart scroll: only auto-scroll if user is near the bottom
  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input on open
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }, []);

  // Reset agent to idle after done
  const scheduleIdleReset = useCallback(() => {
    setTimeout(async () => {
      try {
        await fetch(`${API}/api/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: agent.name, status: 'idle' }),
        });
      } catch {}
    }, 3000);
  }, [agent.name]);

  // Poll specific task by ID until it completes
  const startPolling = useCallback((taskId: string, msgId: string) => {
    pendingTaskRef.current = { taskId, msgId };
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = window.setInterval(async () => {
      try {
        // Poll ONLY the specific task by ID — never fall back to global agent state
        // to prevent cross-contamination between different callers (UI vs API)
        const res = await fetch(`${API}/api/tasks/${taskId}`);
        if (!res.ok) return; // task endpoint unavailable, just wait
        const task = await res.json();
        if (task.status === 'done') {
          updateMessage(msgId, { text: task.result || task.latestLog || '(Done)', status: 'done' });
          setSending(false);
          pendingTaskRef.current = null;
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          scheduleIdleReset();
        } else if (task.status === 'blocked') {
          updateMessage(msgId, { text: task.latestLog || 'Task failed', status: 'error' });
          setSending(false);
          pendingTaskRef.current = null;
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } else if (task.latestLog) {
          updateMessage(msgId, { text: task.latestLog, status: 'thinking' });
        }
      } catch {}
    }, 1500);
  }, [agent.name, updateMessage, scheduleIdleReset]);

  // Poll orchestration status
  const startOrchestratePolling = useCallback((orchestrationId: string, msgId: string) => {
    let routeShown = false;
    if (orchPollRef.current) clearInterval(orchPollRef.current);

    orchPollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/orchestrate/${orchestrationId}`);
        const data = await res.json();
        if (!data.ok) return;

        if (!routeShown && data.route) {
          routeShown = true;
          const label = data.route === 'both' ? 'Forge + Sage' : data.route;
          const routeMsg: ChatMessage = {
            id: `sys-${Date.now()}`,
            role: 'system',
            text: `🎯 Routing to ${label} because: ${data.reason || ''}`,
            timestamp: new Date().toISOString(),
            status: 'done',
          };
          setMessages(prev => [...prev, routeMsg]);
        }

        if (data.status === 'merging') {
          updateMessage(msgId, { text: 'Merging results from Forge and Sage...', status: 'thinking' });
        } else if (data.status === 'done') {
          updateMessage(msgId, { text: data.merged || '(Completed)', status: 'done' });
          setSending(false);
          if (orchPollRef.current) { clearInterval(orchPollRef.current); orchPollRef.current = null; }
          scheduleIdleReset();
        } else if (data.status === 'blocked') {
          updateMessage(msgId, { text: data.merged || 'Orchestration failed', status: 'error' });
          setSending(false);
          if (orchPollRef.current) { clearInterval(orchPollRef.current); orchPollRef.current = null; }
        } else if (data.status === 'working' || data.status === 'routing') {
          const log = data.merged || data.clawResult || data.deepResult || '';
          if (log) updateMessage(msgId, { text: log.slice(-500), status: 'thinking' });
        }
      } catch {}
    }, 1500);
  }, [updateMessage, scheduleIdleReset]);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (orchPollRef.current) clearInterval(orchPollRef.current);
    };
  }, []);

  const handleFiles = async (fileList: FileList) => {
    // Snapshot files before resetting input (reset invalidates FileList reference)
    const rawFiles = Array.from(fileList);
    const formData = new FormData();
    rawFiles.forEach(f => formData.append('files', f));
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok || !data.files) throw new Error('Upload response invalid');
      const uploaded: UploadedFile[] = data.files.map((f: UploadedFile, i: number) => ({
        ...f,
        url: f.url.startsWith('http') ? f.url : `${API}${f.url}`,
        localPreview: rawFiles[i]?.type?.startsWith('image/') ? URL.createObjectURL(rawFiles[i]) : undefined,
      }));
      setAttachments(prev => [...prev, ...uploaded]);
    } catch (e) {
      console.error('Upload failed:', e);
      alert(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsgId = `u-${Date.now()}`;
    const agentMsgId = `a-${Date.now()}`;
    const now = new Date().toISOString();

    const userMsg: ChatMessage = { id: userMsgId, role: 'user', text, timestamp: now, status: 'done', attachments: attachments.length > 0 ? [...attachments] : undefined };
    const thinkingMsg: ChatMessage = {
      id: agentMsgId, role: 'agent', text: '', timestamp: now, status: 'thinking',
      thinkingStartedAt: Date.now(),
    };

    setMessages(prev => [...prev, userMsg, thinkingMsg]);
    setInput('');
    setAttachments([]);
    setSending(true);

    if (autoMode) {
      try {
        const res = await fetch(`${API}/api/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: text, by: 'Neo' }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed to orchestrate');
        startOrchestratePolling(data.orchestrationId, agentMsgId);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Failed';
        updateMessage(agentMsgId, { text: errMsg, status: 'error' });
        setSending(false);
      }
      return;
    }

    try {
      const res = await fetch(`${API}/api/tasks/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, description: text, by: 'Neo', attachments }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to assign task');

      updateMessage(agentMsgId, { taskId: data.taskId, status: 'thinking', text: '' });
      startPolling(data.taskId, agentMsgId);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed';
      updateMessage(agentMsgId, { text: errMsg, status: 'error' });
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  };

  const clearHistory = async () => {
    if (confirm(`Clear all conversation history with ${agent.name}?`)) {
      setMessages([]);
      localStorage.removeItem(STORAGE_KEY(agent.name));
      try {
        await fetch(`${API}/api/memory/${agent.name}`, { method: 'DELETE' });
      } catch {}
    }
  };

  const innerContent = (
      <>
        {/* Header — only show in inline mode as a toolbar, in modal as full header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: inline ? '8px 18px' : '14px 18px',
          borderBottom: `1px solid ${agent.accentColor}20`,
          background: inline ? 'transparent' : `linear-gradient(90deg, ${agent.color}18, transparent)`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!inline && <span style={{ fontSize: 22 }}>{agent.emoji}</span>}
            {!inline && (
              <div>
                <div style={{ color: agent.accentColor, fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{agent.name}</div>
                <div style={{ color: '#4b5563', fontSize: 11 }}>{agent.role}</div>
              </div>
            )}
            <button
              onClick={() => setAutoMode(m => !m)}
              title={autoMode ? 'Auto-orchestrate mode (click to switch to direct)' : 'Direct mode (click to switch to auto-orchestrate)'}
              style={{
                background: autoMode ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${autoMode ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 6, color: autoMode ? '#c4b5fd' : '#4b5563',
                cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >{autoMode ? 'Auto ✨' : 'Direct'}</button>
            {messages.length > 0 && (
              <button onClick={clearHistory} title="Clear history" style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: '#4b5563', cursor: 'pointer',
                fontSize: 11, padding: '3px 8px',
              }}>Clear</button>
            )}
          </div>
          {!inline && (
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: '#4b5563',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4,
            }}>✕</button>
          )}
        </div>

        {/* Message list */}
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          style={{
            flex: 1, overflowY: 'auto', padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}
          onDragOver={e => { e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
        >
          {messages.length === 0 && (
            <div style={{ color: '#374151', fontSize: 13, textAlign: 'center', marginTop: 60 }}>
              {agent.emoji} Start a conversation with {agent.name}
              <div style={{ color: '#1f2937', fontSize: 12, marginTop: 8 }}>
                Type a task or question below
              </div>
            </div>
          )}

          {messages.map(msg => {
            if (msg.role === 'system') {
              return (
                <div key={msg.id} style={{ textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block',
                    background: 'rgba(139,92,246,0.15)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    borderRadius: 20, padding: '3px 12px',
                    fontSize: 11, color: '#c4b5fd',
                  }}>{msg.text}</span>
                </div>
              );
            }

            const delegation = msg.role === 'agent' && msg.status === 'done'
              ? parseDelegation(msg.text)
              : null;
            const displayText = delegation ? delegation.body : msg.text;

            return (
              <div key={msg.id} style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: 8, alignItems: 'flex-end',
              }}>
                {/* Avatar */}
                {msg.role !== 'user' && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: `linear-gradient(135deg, ${agent.color}, ${agent.accentColor})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13,
                  }}>{agent.emoji}</div>
                )}

                {/* Bubble */}
                <div style={{
                  maxWidth: '78%',
                  background: msg.role === 'user'
                    ? `linear-gradient(135deg, ${agent.color}cc, ${agent.color}88)`
                    : msg.status === 'error'
                      ? 'rgba(239,68,68,0.12)'
                      : 'rgba(255,255,255,0.05)',
                  border: msg.role === 'user'
                    ? 'none'
                    : msg.status === 'error'
                      ? '1px solid rgba(239,68,68,0.3)'
                      : `1px solid ${agent.accentColor}20`,
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  padding: '9px 13px',
                }}>
                  {msg.status === 'thinking' && msg.text === '' ? (
                    <TypingDots color={agent.accentColor} />
                  ) : (
                    <div>
                      {msg.status === 'thinking' && (
                        <span style={{ color: agent.accentColor, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          Working... <TypingDots color={agent.accentColor} />
                          {msg.thinkingStartedAt && (
                            <ElapsedTimer startedAt={msg.thinkingStartedAt} />
                          )}
                        </span>
                      )}
                      {delegation && (
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: 'rgba(99,102,241,0.15)',
                          border: '1px solid rgba(99,102,241,0.3)',
                          borderRadius: 4, padding: '2px 7px',
                          fontSize: 11, color: '#a5b4fc', marginBottom: 6,
                        }}>
                          → delegated to {delegation.toAgent}
                        </div>
                      )}
                      {msg.role === 'user' ? (
                        <div>
                          <div style={{
                            color: '#fff', fontSize: 13, lineHeight: 1.6,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>{msg.text}</div>
                          {msg.attachments?.map(f => f.type === 'image' && (
                            <img key={f.id} src={f.localPreview || f.url}
                              style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, display: 'block', marginTop: 6, cursor: 'pointer' }}
                              onClick={() => window.open(f.url, '_blank')}
                            />
                          ))}
                          {msg.attachments?.filter(f => f.type === 'file').map(f => (
                            <a key={f.id} href={f.url} download={f.name} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#60a5fa', fontSize: 12, marginTop: 4 }}>
                              📄 {f.name}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <MessageText
                          text={displayText}
                          color={msg.status === 'thinking' ? '#9ca3af' : '#d1d5db'}
                          isError={msg.status === 'error'}
                        />
                      )}
                    </div>
                  )}
                  <div style={{
                    fontSize: 10, color: msg.role === 'user' ? 'rgba(255,255,255,0.5)' : '#374151',
                    marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left',
                  }}>
                    {formatTime(msg.timestamp)}
                    {msg.status === 'error' && ' · error'}
                    {msg.taskId && msg.status === 'done' && ` · ${msg.taskId}`}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Attachment preview bar */}
        {attachments.length > 0 && (
          <div style={{ padding: '8px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${agent.accentColor}20`, background: 'rgba(0,0,0,0.3)' }}>
            {attachments.map(f => (
              <div key={f.id} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: f.type === 'image' ? '2px' : '4px 8px' }}>
                {f.type === 'image' && f.localPreview ? (
                  <img src={f.localPreview} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                ) : (
                  <span style={{ fontSize: 11, color: '#9ca3af', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name}</span>
                )}
                <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== f.id))}
                  style={{ position: f.type === 'image' ? 'absolute' : 'static', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#374151', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: '12px 14px',
          borderTop: `1px solid ${agent.accentColor}20`,
          display: 'flex', gap: 8, alignItems: 'flex-end',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.3)',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agent.name}...`}
            rows={2}
            disabled={sending}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${agent.accentColor}30`,
              borderRadius: 10, color: '#e5e7eb', fontSize: 13,
              padding: '9px 12px', outline: 'none',
              resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
              opacity: sending ? 0.6 : 1,
            }}
          />
          <button onClick={() => fileInputRef.current?.click()}
            style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#6b7280', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>
            📎
          </button>
          <input ref={fileInputRef} type="file" multiple
            style={{ display: 'none' }} onChange={e => e.target.files && handleFiles(e.target.files)} />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            style={{
              background: `linear-gradient(135deg, ${agent.color}, ${agent.accentColor}99)`,
              border: 'none', borderRadius: 10, color: '#fff',
              width: 40, height: 40, cursor: 'pointer', fontSize: 16,
              opacity: !input.trim() || sending ? 0.4 : 1,
              transition: 'opacity 0.15s', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >↑</button>
        </div>

        <div style={{ padding: '4px 14px 8px', color: '#1f2937', fontSize: 10, textAlign: 'right', flexShrink: 0 }}>
          ⌘↵ to send · history saved locally
        </div>

      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
      </>
  );

  if (inline) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {innerContent}
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, height: 640, maxHeight: '88vh',
          background: 'rgba(5, 8, 20, 0.99)',
          border: `1px solid ${agent.accentColor}40`,
          borderRadius: 18,
          display: 'flex', flexDirection: 'column',
          boxShadow: `0 0 60px ${agent.color}25`,
          overflow: 'hidden',
        }}
      >
        {innerContent}
      </div>

      <style>{`
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
      `}</style>
    </div>
  );
}
