import { state, broadcast, pushGroupMsg, taskEvents } from './state.js';
import { scheduleAgent, PERSONAS } from './agents.js';
import { streamChat } from './claude-proxy.js';
import { loadAgentRegistry } from './registry.js';

const CLARIFICATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Returns true when the message is too vague to route meaningfully. */
function isAmbiguousInput(text: string): boolean {
  const trimmed = text.trim();
  // For CJK text, count characters directly (no space-delimited words)
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f]/.test(trimmed);
  const charCount = hasCJK ? trimmed.replace(/\s+/g, '').length : 0;
  const words = trimmed.split(/\s+/).filter(w => w.length > 1);
  // Enough context if 4+ words (Latin) or 6+ CJK characters
  if (words.length >= 4 || charCount >= 6) return false;
  const lower = trimmed.toLowerCase();
  const actionable = /\b(code|implement|build|fix|bug|write|create|refactor|deploy|script|function|api|endpoint|component|server|database|sql|error|crash|test|analyze|explain|plan|review|compare|evaluate|research|strategy|design|summarize|document|describe|translate|generate|optimize)\b/;
  const actionableCJK = /(写|实现|创建|修复|部署|分析|解释|计划|审查|比较|评估|研究|设计|总结|文档|翻译|生成|优化|重构|测试|代码|函数|接口|组件|服务|数据库|错误)/;
  return !actionable.test(lower) && !actionableCJK.test(trimmed);
}

/**
 * If input is ambiguous, post a clarification question from Orchestrator,
 * store pending state, and return true. Caller should skip normal routing.
 */
export function askClarificationIfNeeded(
  orchestrationId: string,
  prompt: string,
  groupId: string,
): boolean {
  if (!isAmbiguousInput(prompt)) return false;

  state.pendingClarifications[groupId] = { prompt, orchestrationId, askedAt: Date.now() };

  const orchAgent = state.agents['Orchestrator'];
  orchAgent.status = 'idle';
  orchAgent.latestLog = 'Waiting for clarification';
  broadcast();

  pushGroupMsg('reply', 'Orchestrator',
    `需要多一点信息才能帮到你。能说说你想做什么吗？比如实现某个功能、分析一个问题，还是修复某个 bug？`,
    { groupId, taskId: orchestrationId }
  );

  return true;
}

/**
 * Consume a pending clarification for the group. Returns the enriched prompt
 * (original + clarification answer) if one exists and hasn't expired, else null.
 */
export function consumePendingClarification(groupId: string, reply: string): string | null {
  const pending = state.pendingClarifications[groupId];
  if (!pending) return null;
  delete state.pendingClarifications[groupId];
  // Expired clarification — treat as fresh message
  if (Date.now() - pending.askedAt > CLARIFICATION_TTL_MS) return null;
  return `${pending.prompt}\n\nUser clarification: ${reply}`;
}

export function watchSingleTask(orchestrationId: string, taskId: string, resultKey: 'clawResult' | 'deepResult'): void {
  const TIMEOUT_MS = 15 * 60 * 1000;
  const timer = setTimeout(() => {
    taskEvents.removeListener('task-done', handler);
    const orch = state.orchestrations[orchestrationId];
    if (orch && orch.status !== 'done') {
      orch.status = 'blocked';
      orch.merged = 'Orchestration timed out';
      state.agents['Orchestrator'].status = 'blocked';
      state.agents['Orchestrator'].latestLog = 'Timed out waiting for agent';
      broadcast();
    }
  }, TIMEOUT_MS);

  const handler = (completedTaskId: string) => {
    if (completedTaskId !== taskId) return;
    taskEvents.removeListener('task-done', handler);
    clearTimeout(timer);
    const task = state.tasks[taskId];
    const orch = state.orchestrations[orchestrationId];
    if (!task || !orch) return;
    orch[resultKey] = task.result;
    orch.merged = task.result;
    orch.status = task.status === 'done' ? 'done' : 'blocked';
    state.agents['Orchestrator'].status = orch.status;
    state.agents['Orchestrator'].latestLog = (task.result || 'Done').slice(-500);
    broadcast();
  };
  taskEvents.on('task-done', handler);
}

async function watchBothTasks(orchestrationId: string, clawTaskId: string, deepTaskId: string, description: string, coderName: string, analystName: string): Promise<void> {
  const TIMEOUT_MS = 15 * 60 * 1000;
  let settled = false;

  const cleanup = () => {
    settled = true;
    clearTimeout(timer);
    taskEvents.removeListener('task-done', handler);
  };

  const timer = setTimeout(() => {
    if (settled) return;
    cleanup();
    const orch = state.orchestrations[orchestrationId];
    if (orch && orch.status !== 'done') {
      orch.status = 'blocked';
      orch.merged = 'Orchestration timed out';
      state.agents['Orchestrator'].status = 'blocked';
      state.agents['Orchestrator'].latestLog = 'Timed out waiting for both agents';
      broadcast();
    }
  }, TIMEOUT_MS);

  const handler = async (completedTaskId: string) => {
    if (settled) return;
    if (completedTaskId !== clawTaskId && completedTaskId !== deepTaskId) return;

    const orch = state.orchestrations[orchestrationId];
    if (!orch) { cleanup(); return; }

    const clawTask = state.tasks[clawTaskId];
    const deepTask = state.tasks[deepTaskId];
    if (!clawTask || !deepTask) return;

    const clawDone = clawTask.status === 'done' || clawTask.status === 'blocked';
    const deepDone = deepTask.status === 'done' || deepTask.status === 'blocked';

    if (clawDone) orch.clawResult = clawTask.result;
    if (deepDone) orch.deepResult = deepTask.result;

    if (clawDone && deepDone) {
      cleanup();
      orch.status = 'merging';
      state.agents['Orchestrator'].latestLog = 'Merging results...';
      broadcast();

      try {
        const mergePersona = PERSONAS[analystName] || 'You are a helpful assistant.';
        const mergePrompt = `Merge these two responses into one cohesive answer:\nANALYSIS (from ${analystName}): ${orch.deepResult || '(none)'}\nIMPLEMENTATION (from ${coderName}): ${orch.clawResult || '(none)'}\nOriginal request: ${description}\nProvide a clean integrated response.`;
        let merged = '';
        await streamChat({
          agentName: analystName,
          sessionKey: `merge-${orchestrationId}`,
          system: mergePersona,
          userMessage: mergePrompt,
          onDelta: (chunk: string) => { merged += chunk; },
        });
        orch.merged = merged || 'Merge failed';
        orch.status = 'done';
        state.agents['Orchestrator'].status = 'done';
        state.agents['Orchestrator'].latestLog = merged.slice(-500);
      } catch (err) {
        orch.merged = `Merge error: ${(err as Error).message}`;
        orch.status = 'blocked';
        state.agents['Orchestrator'].status = 'blocked';
        state.agents['Orchestrator'].latestLog = `Merge error: ${(err as Error).message}`;
      }
      broadcast();
    }
  };
  taskEvents.on('task-done', handler);
}

interface Routing {
  route: string;
  reason: string;
  clawTask?: string;
  deepTask?: string;
}

export async function orchestrate(orchestrationId: string, description: string, groupId = 'default'): Promise<void> {
  const orchAgent = state.agents['Orchestrator'];
  orchAgent.status = 'working';
  orchAgent.description = description;
  orchAgent.title = description.slice(0, 60);
  orchAgent.latestLog = 'Analyzing task...';
  orchAgent._startedAt = Date.now();
  broadcast();

  // Resolve agent roles dynamically from registry.
  // Convention: first claude agent = coder, non-claude = analyst, second claude = architect.
  const allAgents = loadAgentRegistry();
  const claudeAgents = allAgents.filter(a => a.provider === 'claude');
  const coderAgent = claudeAgents[0] || allAgents[0];
  const analystAgent = allAgents.find(a => a.provider !== 'claude') || allAgents[allAgents.length - 1];
  const architectAgent = claudeAgents[1] || null; // third agent (Arc), if registered
  const coderName = coderAgent.name;
  const analystName = analystAgent.name;
  const architectName = architectAgent?.name || null;
  const singleAgent = coderName === analystName; // only one agent registered

  const lowerDesc = description.toLowerCase();
  const codeKeywords = /\b(code|implement|build|fix|bug|write|create|refactor|deploy|script|function|api|endpoint|component|css|html|server|database|sql)\b/;
  const codeKeywordsCJK = /(代码|编码|实现|构建|修复|修bug|写代码|创建|重构|部署|脚本|函数|接口|组件|服务器|数据库|前端|后端|页面|样式|功能)/;
  const thinkKeywords = /\b(analyze|explain|plan|review|compare|evaluate|research|strategy|think|why|summarize|assess)\b/;
  const thinkKeywordsCJK = /(分析|解释|计划|审查|对比|比较|评估|研究|策略|思考|为什么|总结|评价|调研)/;
  const archKeywords = /\b(architect|architecture|design|system design|structure|pattern|trade.?off|scalab|review code|code review)\b/;
  const archKeywordsCJK = /(架构|设计|系统设计|结构|模式|权衡|可扩展|代码审查|技术方案|选型)/;
  const hasCode = codeKeywords.test(lowerDesc) || codeKeywordsCJK.test(description);
  const hasThink = thinkKeywords.test(lowerDesc) || thinkKeywordsCJK.test(description);
  const hasArch = !!architectName && (archKeywords.test(lowerDesc) || archKeywordsCJK.test(description));

  let routing: Routing;
  if (singleAgent) {
    routing = { route: coderName, reason: 'Only one agent registered' };
  } else if (hasArch && !hasCode) {
    routing = { route: architectName!, reason: 'Architecture/design task detected' };
  } else if (hasCode && !hasThink) {
    routing = { route: coderName, reason: 'Code-related task detected' };
  } else if (hasThink && !hasCode) {
    routing = { route: analystName, reason: 'Analysis/thinking task detected' };
  } else {
    routing = { route: 'both', reason: 'Default: engage both agents' };
  }

  if (!state.orchestrations[orchestrationId]) {
    state.orchestrations[orchestrationId] = {
      id: orchestrationId, description, by: 'Orchestrator', status: 'working',
      route: null, reason: null, clawTaskId: null, deepTaskId: null,
      clawResult: null, deepResult: null, merged: null,
      createdAt: new Date().toISOString(),
    };
  }
  state.orchestrations[orchestrationId].route = routing.route;
  state.orchestrations[orchestrationId].reason = routing.reason;
  orchAgent.latestLog = `Route: ${routing.route} — ${routing.reason || ''}`;
  broadcast();

  const makeTask = (agent: string, desc: string): string => {
    state.taskCounter++;
    const taskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = { id: taskId, agent, description: desc, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', groupId, createdAt: new Date().toISOString() };
    return taskId;
  };

  if (routing.route === coderName || routing.route === architectName) {
    const agentName = routing.route as string;
    const taskId = makeTask(agentName, description);
    state.orchestrations[orchestrationId].clawTaskId = taskId;
    scheduleAgent(agentName, taskId, description);
    watchSingleTask(orchestrationId, taskId, 'clawResult');
  } else if (routing.route === analystName) {
    const taskId = makeTask(analystName, description);
    state.orchestrations[orchestrationId].deepTaskId = taskId;
    scheduleAgent(analystName, taskId, description);
    watchSingleTask(orchestrationId, taskId, 'deepResult');
  } else {
    const clawDesc = routing.clawTask || description;
    const deepDesc = routing.deepTask || description;

    const clawTaskId = makeTask(coderName, clawDesc);
    const deepTaskId = makeTask(analystName, deepDesc);

    state.orchestrations[orchestrationId].clawTaskId = clawTaskId;
    state.orchestrations[orchestrationId].deepTaskId = deepTaskId;

    scheduleAgent(coderName, clawTaskId, clawDesc);
    scheduleAgent(analystName, deepTaskId, deepDesc);
    watchBothTasks(orchestrationId, clawTaskId, deepTaskId, description, coderName, analystName);
  }
}
