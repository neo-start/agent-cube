export type SceneType = 'office' | 'grassland';

export type AgentStatus = 'idle' | 'pending' | 'working' | 'done' | 'blocked';

export interface AgentData {
  status: AgentStatus;
  taskId: string | null;
  description: string | null;
  latestLog: string | null;
  title: string | null;
  by: string | null;
  raw: string | null;
  delegatedBy: string | null;
  parentTaskId: string | null;
  source: string | null;
}

export interface AgentsResponse {
  agents: Record<string, AgentData>;
}

// 3D scene config (existing)
export interface AgentConfig {
  name: string;
  color: string;
  accentColor: string;
  role: string;
  emoji: string;
  position: [number, number, number];
}

// Registry entry from /api/agents
export interface AgentRegistryEntry {
  name: string;
  provider: string;
  model: string;
  apiKey?: string | null;
}

export interface Group {
  id: string;
  name: string;
  agents: string[];
  description?: string;
  createdAt: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  url: string;
  type: "image" | "file";
  size: number;
  localPreview?: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  read: boolean;
}

