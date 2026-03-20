import { state, broadcast } from './state.js';
import { scheduleAgent, PERSONAS } from './agents.js';
import { DEEPSEEK_API_KEY } from './config.js';
import { loadAgentRegistry } from './registry.js';

export function watchSingleTask(orchestrationId: string, taskId: string, resultKey: string): void {
  const iv = setInterval(() => {
    const task = state.tasks[taskId];
    if (!task) return;
    if (task.status === 'done' || task.status === 'blocked') {
      clearInterval(iv);
      state.orchestrations[orchestrationId][resultKey] = task.result;
      state.orchestrations[orchestrationId]['merged'] = task.result;
      state.orchestrations[orchestrationId]['status'] = task.status === 'done' ? 'done' : 'blocked';
      state.agents['Orchestrator'].status = state.orchestrations[orchestrationId]['status'] as 'done' | 'blocked';
      state.agents['Orchestrator'].latestLog = (task.result || 'Done').slice(-500);
      broadcast();
    }
  }, 1500);
}

async function watchBothTasks(orchestrationId: string, clawTaskId: string, deepTaskId: string, description: string, coderName: string, analystName: string): Promise<void> {
  const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const startedAt = Date.now();
  const iv = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      clearInterval(iv);
      state.orchestrations[orchestrationId]['status'] = 'blocked';
      state.orchestrations[orchestrationId]['merged'] = 'Orchestration timed out';
      state.agents['Orchestrator'].status = 'blocked';
      state.agents['Orchestrator'].latestLog = 'Timed out waiting for both agents';
      broadcast();
      return;
    }

    const clawTask = state.tasks[clawTaskId];
    const deepTask = state.tasks[deepTaskId];
    if (!clawTask || !deepTask) return;

    const clawDone = clawTask.status === 'done' || clawTask.status === 'blocked';
    const deepDone = deepTask.status === 'done' || deepTask.status === 'blocked';

    if (clawDone) state.orchestrations[orchestrationId]['clawResult'] = clawTask.result;
    if (deepDone) state.orchestrations[orchestrationId]['deepResult'] = deepTask.result;

    if (clawDone && deepDone) {
      clearInterval(iv);
      state.orchestrations[orchestrationId]['status'] = 'merging';
      state.agents['Orchestrator'].latestLog = 'Merging results...';
      broadcast();

      try {
        const allAgents = loadAgentRegistry();
        const analystConfig = allAgents.find(a => a.name === analystName) || allAgents[allAgents.length - 1];
        const mergeApiKey = analystConfig?.apiKey || DEEPSEEK_API_KEY;
        const mergeModel = analystConfig?.model || 'deepseek-chat';
        const mergePersona = PERSONAS[analystName] || PERSONAS['Deep'] || 'You are a helpful assistant.';
        const mergeRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + mergeApiKey,
          },
          body: JSON.stringify({
            model: mergeModel,
            messages: [
              { role: 'system', content: mergePersona },
              { role: 'user', content: `Merge these two responses into one cohesive answer:\nANALYSIS (from ${analystName}): ${state.orchestrations[orchestrationId]['deepResult'] || '(none)'}\nIMPLEMENTATION (from ${coderName}): ${state.orchestrations[orchestrationId]['clawResult'] || '(none)'}\nOriginal request: ${description}\nProvide a clean integrated response.` },
            ],
            stream: false,
          }),
        });
        const mergeData = await mergeRes.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = mergeData.choices?.[0]?.message?.content || 'Merge failed';
        state.orchestrations[orchestrationId]['merged'] = merged;
        state.orchestrations[orchestrationId]['status'] = 'done';
        state.agents['Orchestrator'].status = 'done';
        state.agents['Orchestrator'].latestLog = merged.slice(-500);
      } catch (err) {
        state.orchestrations[orchestrationId]['merged'] = `Merge error: ${(err as Error).message}`;
        state.orchestrations[orchestrationId]['status'] = 'blocked';
        state.agents['Orchestrator'].status = 'blocked';
        state.agents['Orchestrator'].latestLog = `Merge error: ${(err as Error).message}`;
      }
      broadcast();
    }
  }, 1500);
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
  // Convention: claude-based agents are "coders", deepseek/other are "analysts".
  // Falls back to first/last agent if no clear split.
  const allAgents = loadAgentRegistry();
  const coderAgent = allAgents.find(a => a.provider === 'claude') || allAgents[0];
  const analystAgent = allAgents.find(a => a.provider !== 'claude') || allAgents[allAgents.length - 1];
  const coderName = coderAgent.name;
  const analystName = analystAgent.name;
  const singleAgent = coderName === analystName; // only one agent registered

  const lowerDesc = description.toLowerCase();
  const codeKeywords = /\b(code|implement|build|fix|bug|write|create|refactor|deploy|script|function|api|endpoint|component|css|html|server|database|sql)\b/;
  const thinkKeywords = /\b(analyze|explain|plan|review|compare|evaluate|research|strategy|design|think|why|how|what|summarize|assess)\b/;
  const hasCode = codeKeywords.test(lowerDesc);
  const hasThink = thinkKeywords.test(lowerDesc);

  let routing: Routing;
  if (singleAgent) {
    routing = { route: coderName, reason: 'Only one agent registered' };
  } else if (hasCode && !hasThink) {
    routing = { route: coderName, reason: 'Code-related task detected' };
  } else if (hasThink && !hasCode) {
    routing = { route: analystName, reason: 'Analysis/thinking task detected' };
  } else {
    routing = { route: 'both', reason: 'Default: engage both agents' };
    try {
      const analystConfig = allAgents.find(a => a.name === analystName);
      const routeApiKey = analystConfig?.apiKey || DEEPSEEK_API_KEY;
      const routeModel = analystConfig?.model || 'deepseek-chat';
      const routeRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + routeApiKey,
        },
        body: JSON.stringify({
          model: routeModel,
          messages: [
            { role: 'system', content: 'You are a task router. Analyze the task and respond with ONLY valid JSON, nothing else. No markdown, no explanation.' },
            { role: 'user', content: `Route this task: "${description}"\nJSON format: {"route": "${coderName}"|"${analystName}"|"both", "reason": "one line", "coderTask": "subtask for ${coderName}", "analystTask": "subtask for ${analystName}"}\n${coderName} = coding/implementation. ${analystName} = analysis/thinking. both = needs both.` },
          ],
          stream: false,
        }),
      });
      const routeData = await routeRes.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = routeData.choices?.[0]?.message?.content || '{}';
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr) as { route?: string; reason?: string; coderTask?: string; analystTask?: string };
      if (parsed.route) routing = { ...parsed, route: parsed.route, reason: parsed.reason || '', clawTask: parsed.coderTask, deepTask: parsed.analystTask };
    } catch {}
  }

  state.orchestrations[orchestrationId]['route'] = routing.route;
  state.orchestrations[orchestrationId]['reason'] = routing.reason;
  orchAgent.latestLog = `Route: ${routing.route} — ${routing.reason || ''}`;
  broadcast();

  const makeTask = (agent: string, desc: string): string => {
    state.taskCounter++;
    const taskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = { id: taskId, agent, description: desc, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', groupId, createdAt: new Date().toISOString() };
    return taskId;
  };

  if (routing.route === coderName) {
    const taskId = makeTask(coderName, description);
    state.orchestrations[orchestrationId]['clawTaskId'] = taskId;
    scheduleAgent(coderName, taskId, description);
    watchSingleTask(orchestrationId, taskId, 'clawResult');
  } else if (routing.route === analystName) {
    const taskId = makeTask(analystName, description);
    state.orchestrations[orchestrationId]['deepTaskId'] = taskId;
    scheduleAgent(analystName, taskId, description);
    watchSingleTask(orchestrationId, taskId, 'deepResult');
  } else {
    const clawDesc = routing.clawTask || description;
    const deepDesc = routing.deepTask || description;

    const clawTaskId = makeTask(coderName, clawDesc);
    const deepTaskId = makeTask(analystName, deepDesc);

    state.orchestrations[orchestrationId]['clawTaskId'] = clawTaskId;
    state.orchestrations[orchestrationId]['deepTaskId'] = deepTaskId;

    scheduleAgent(coderName, clawTaskId, clawDesc);
    scheduleAgent(analystName, deepTaskId, deepDesc);
    watchBothTasks(orchestrationId, clawTaskId, deepTaskId, description, coderName, analystName);
  }
}
