export type AgentStatus = 'idle' | 'working' | 'done' | 'blocked';

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
  status: string;
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
  status: string;
  maxTurns: number;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
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
  [key: string]: unknown;
}

export interface Orchestration {
  id: string;
  description: string;
  by: string;
  status: string;
  route: string | null;
  reason: string | null;
  clawTaskId: string | null;
  deepTaskId: string | null;
  clawResult: string | null;
  deepResult: string | null;
  merged: string | null;
  createdAt: string;
  [key: string]: unknown;
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
