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

export interface AgentConfig {
  name: string;
  color: string;
  accentColor: string;
  role: string;
  emoji: string;
  position: [number, number, number];
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

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: 'Claw',
    color: '#1a6cf5',
    accentColor: '#4d9fff',
    role: 'Claude · Coder',
    emoji: '🤖',
    position: [2, 0, 0],
  },
  {
    name: 'Deep',
    color: '#7c3aed',
    accentColor: '#a78bfa',
    role: 'DeepSeek · Thinker',
    emoji: '🧠',
    position: [-2, 0, 0],
  },
];
