export const state = {
  agents: {
    Claw: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
    Deep: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
    Orchestrator: { status: 'idle', taskId: null, description: null, latestLog: null, title: null, _startedAt: null },
  },
  tasks: {},
  messages: [],
  groupMessages: [],
  taskCounter: 0,
  orchestrations: {},
};

let groupMsgCounter = 0;

export const groupSseClients = new Set();
export const sseClients = new Set();

export function broadcast() {
  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(state.agents).map(([name, a]) => [
        name,
        { status: a.status, task: a.title, log: a.latestLog, updated: new Date().toISOString() },
      ])
    )
  );
  for (const res of sseClients) {
    res.write(`data: ${payload}\n\n`);
  }
}

export function broadcastGroup(msg) {
  const payload = JSON.stringify(msg);
  for (const res of groupSseClients) {
    res.write(`data: ${payload}\n\n`);
  }
}

export function pushGroupMsg(type, from, content, meta = {}) {
  const msg = {
    id: `gm-${++groupMsgCounter}-${Date.now()}`,
    type,
    from,
    content,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  state.groupMessages.push(msg);
  if (state.groupMessages.length > 500) state.groupMessages.shift();
  broadcastGroup(msg);
  return msg;
}

// Watchdog: reset stuck agents after 8 minutes
setInterval(() => {
  const now = Date.now();
  for (const [, a] of Object.entries(state.agents)) {
    if (a.status === 'working' && a._startedAt && (now - a._startedAt) > 8 * 60 * 1000) {
      a.status = 'blocked';
      a.latestLog = '⏱ Timed out (8 min)';
      broadcast();
    }
  }
}, 30_000);
