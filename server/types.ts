export type AgentStatus = 'idle' | 'working' | 'done' | 'blocked';
export type TaskStatus = 'queued' | 'working' | 'done' | 'blocked' | 'cancelled' | 'cancellation-requested';
export type ThreadStatus = 'active' | 'paused' | 'done';
export type OrchestrationStatus = 'routing' | 'working' | 'merging' | 'done' | 'blocked';

export interface AgentState {
  status: AgentStatus;
  taskId: string | null;
  description: string | null;
  latestLog: string | null;
  title: string | null;
  _startedAt: number | null;
}

export interface Task {
  id: string;
  agent: string;
  description: string;
  by: string;
  status: TaskStatus;
  latestLog: string | null;
  result: string | null;
  delegatedBy: string | null;
  parentTaskId: string | null;
  source: string;
  groupId?: string;
  createdAt: string;
  attachments?: Attachment[];
  completedAt?: string;
}

export interface Attachment {
  name: string;
  type: string;
  url: string;
}

export interface ThreadMessage {
  from: string;
  content: string;
  timestamp: string;
}

export interface Thread {
  id: string;
  groupId: string;
  topic: string;
  participants: string[];
  messages: ThreadMessage[];
  status: ThreadStatus;
  maxTurns: number;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  // Project persistence
  projectId?: string;
  // History summarization: compressed older messages
  summary?: string;
  summaryTurnCount?: number;
  // File change tracking: snapshot after last agent turn
  fileSnapshot?: Record<string, number>;
  lastChanges?: string[];
}

export interface Project {
  id: string;
  name: string;
  directory: string;
  groupId?: string;
  description?: string;
  createdAt: string;
}

export interface AgentConfig {
  name: string;
  provider: string;
  model: string;
  apiKey: string | null;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  agents: string[];
  createdAt: string;
}

export interface GroupMessage {
  id: string;
  type: string;
  from: string;
  content: string;
  timestamp: string;
  // Optional metadata fields emitted via pushGroupMsg
  groupId?: string;
  threadId?: string;
  taskId?: string;
  status?: string;
  partial?: boolean;
  target?: string | null;
  attachments?: Attachment[];
  toAgent?: string;
  participants?: string[];
  endReason?: string;
}

export interface Orchestration {
  id: string;
  description: string;
  by: string;
  status: OrchestrationStatus;
  route: string | null;
  reason: string | null;
  clawTaskId: string | null;
  deepTaskId: string | null;
  clawResult: string | null;
  deepResult: string | null;
  merged: string | null;
  createdAt: string;
}

export interface PendingClarification {
  prompt: string;        // original vague message
  orchestrationId: string;
  askedAt: number;       // Date.now() — expire after 5 min
}

export interface AppState {
  agents: Record<string, AgentState>;
  tasks: Record<string, Task>;
  messages: DirectMessage[];
  groupMessages: Record<string, GroupMessage[]>;
  taskCounter: number;
  orchestrations: Record<string, Orchestration>;
  threads: Record<string, Thread>;
  threadCounter: number;
  projects: Record<string, Project>;
  pendingClarifications: Record<string, PendingClarification>; // groupId → pending
}

export interface DirectMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  read: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface ProviderResult {
  result: string;
  usage: TokenUsage | null;
}

export interface ToolCall {
  name: string;
  args: string;
}

export interface QueueTaskMeta {
  taskId: string;
  agent: string;
  description: string;
  createdAt: string;
}

export interface ScratchpadEntry {
  key: string;
  value: string;
  agent: string;
  ts: string;
}

export interface Scratchpad {
  entries: ScratchpadEntry[];
}

export interface MemoryEntry {
  role: string;
  content: string;
  ts: string;
}

export interface TokenRecord {
  timestamp: string;
  agentName: string;
  taskId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface AgentTokenStats {
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalCost: number;
  provider: string;
}
