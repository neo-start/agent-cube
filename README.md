# agent-cube

A 3D multi-agent collaboration workspace. Multiple AI agents live as desks in a Three.js scene — they can chat together in a group, work on tasks independently, and even spawn sub-threads to collaborate on code.

![agent-cube screenshot](docs/screenshot.png)

## Features

- **3D workspace** — agents as interactive desks in a Three.js scene
- **Group chat** — send a message to all agents, watch them discuss and collaborate in real time
- **Direct chat** — open a 1-on-1 chat window with any agent
- **Threaded tasks** — agents spin up sub-threads to tackle complex coding tasks
- **Tool use** — agents can read/write files, run shell commands, search the web
- **Project context** — attach a project directory so agents can work within a codebase
- **Multi-provider** — mix Claude (Anthropic) and DeepSeek agents in the same workspace
- **Persistent history** — all messages, threads, and direct chats saved to disk

---

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **npm** 9+
- At least one API key:
  - [Anthropic](https://console.anthropic.com/) for Claude agents
  - [DeepSeek](https://platform.deepseek.com/) for DeepSeek agents

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourname/agent-cube.git
cd agent-cube
npm install
```

### 2. Create your data directory

agent-cube stores all configuration and runtime data in `~/.agent-cube/`. Create it and add your agents:

```bash
mkdir -p ~/.agent-cube/souls
```

### 3. Configure agents

Create `~/.agent-cube/agents.json`:

```json
{
  "agents": [
    {
      "name": "Forge",
      "provider": "claude",
      "model": "claude-opus-4-5",
      "apiKey": "sk-ant-..."
    },
    {
      "name": "Sage",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "apiKey": "sk-..."
    }
  ]
}
```

> **Tip:** You can also set API keys as environment variables — `ANTHROPIC_API_KEY` for Claude agents, `DEEPSEEK_API_KEY` for DeepSeek. If `apiKey` in agents.json is `null`, the env var is used automatically.

Supported providers: `claude`, `deepseek`

### 4. Write agent souls (personas)

Each agent gets a soul file that defines its personality and capabilities. Create `~/.agent-cube/souls/<AgentName>.md`:

**Example — `~/.agent-cube/souls/Forge.md`:**

```markdown
# Forge — Senior Software Engineer

You are Forge, a senior software engineer.

## Core Traits
- Write clean, working TypeScript/React code
- Think step by step before coding
- Prefer simple, direct solutions

## Your Tools
- readFile / writeFile — read and edit files
- exec — run shell commands
- You can read/write any file the user has access to
```

**Example — `~/.agent-cube/souls/Sage.md`:**

```markdown
# Sage — Research & Analysis

You are Sage, a generalist agent focused on research, analysis, and writing.

## Core Traits
- Thorough and precise
- Great at summarizing complex topics
- Write clear explanations
```

A soul is just a markdown prompt — write whatever makes the agent useful to you.

### 5. Set up your group

Create `~/.agent-cube/groups.json` to define which agents are in your main group:

```json
{
  "groups": [
    {
      "id": "default",
      "name": "Team",
      "agents": ["Forge", "Sage"]
    }
  ]
}
```

### 6. Start

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The API server runs on port `3021` in dev mode; Vite proxies it automatically. In production (`npm start`), everything is served from port `3020`.

---

## Production Build

```bash
npm run build
npm start
```

This compiles the frontend and serves everything from the Express server on port `3020`.

---

## Data Directory Layout

```
~/.agent-cube/
├── agents.json              # Agent registry (name, provider, model, apiKey)
├── groups.json              # Group definitions
├── souls/                   # Agent persona files (.md)
│   ├── Forge.md
│   └── Sage.md
├── memory/                  # Agent short-term memory (per-agent JSON)
│   └── long-term/           # Agent long-term notes
├── direct-chats/            # 1-on-1 chat history (per-agent JSON)
├── groups/                  # Group message history (per-group JSONL)
│   └── default/
│       └── messages.jsonl
├── threads/                 # Sub-thread records (JSON, one file per thread)
├── inboxes/                 # Inter-agent message passing
├── workspaces/              # Per-agent file workspaces
└── uploads/                 # Uploaded files (images, docs)
```

All directories are created automatically on first run. You only need to create `agents.json`, `groups.json`, and the soul files manually.

---

## Adding a New Agent

1. Add an entry to `~/.agent-cube/agents.json`
2. Create a soul file at `~/.agent-cube/souls/<Name>.md`
3. Add the agent name to a group in `~/.agent-cube/groups.json`
4. Restart the server — the new agent desk appears automatically

---

## Agent Tools

Agents have access to the following tools during task execution:

| Tool | Description |
|------|-------------|
| `readFile` | Read file contents (supports `path:startLine-endLine`) |
| `writeFile` | Write or overwrite a file |
| `exec` | Run a shell command |
| `listFiles` | List directory contents |
| `webSearch` | Search the web |
| `webFetch` | Fetch a URL |
| `sendMessage` | Send a message to another agent |
| `delegateTask` | Delegate a sub-task to another agent |

> **Note:** `exec` runs without sandboxing — agents can execute arbitrary shell commands. This is intentional for a local development environment. Do not expose the server to the public internet without adding authentication.

---

## Resetting Data

To clear all runtime data (messages, threads, memory) while keeping your agent configuration:

```bash
bash scripts/reset-data.sh
```

This preserves `souls/`, `agents.json`, and `groups.json`.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3020`) |
| `ANTHROPIC_API_KEY` | API key for Claude agents |
| `DEEPSEEK_API_KEY` | API key for DeepSeek agents |

---

## Architecture

```
agent-cube/
├── server/
│   ├── index.ts          # Express server entry point
│   ├── agents.ts         # Task scheduling, tool loop, thread execution
│   ├── tools.ts          # Tool implementations (readFile, exec, etc.)
│   ├── state.ts          # In-memory state, startup restoration
│   ├── memory.ts         # Disk persistence (messages, threads, memory)
│   ├── config.ts         # Paths and constants
│   └── routes/           # REST API endpoints
└── src/
    ├── App.tsx            # Root component, agent desks layout
    ├── components/
    │   ├── GroupChat.tsx  # Group chat panel with SSE streaming
    │   ├── ChatModal.tsx  # Direct 1-on-1 agent chat
    │   └── ...
    └── hooks/
        └── useAgentConfigs.tsx  # Fetches agent list from API
```

**Key API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/tasks/assign` | Assign a task to an agent |
| `GET` | `/api/groups/:id/stream` | SSE stream for group chat |
| `POST` | `/api/groups/:id/send` | Send message to group |
| `GET` | `/api/direct-chat/:agent` | Load 1-on-1 chat history |
| `POST` | `/api/direct-chat/:agent` | Save 1-on-1 chat history |
| `GET` | `/api/status` | All agent statuses |

---

## License

MIT
