import { state, broadcast } from './state.js';
import { runClaw, runDeep, PERSONAS } from './agents.js';

export function watchSingleTask(orchestrationId, taskId, resultKey) {
  const iv = setInterval(() => {
    const task = state.tasks[taskId];
    if (!task) return;
    if (task.status === 'done' || task.status === 'blocked') {
      clearInterval(iv);
      state.orchestrations[orchestrationId][resultKey] = task.result;
      state.orchestrations[orchestrationId].merged = task.result;
      state.orchestrations[orchestrationId].status = task.status === 'done' ? 'done' : 'blocked';
      state.agents.Orchestrator.status = state.orchestrations[orchestrationId].status;
      state.agents.Orchestrator.latestLog = (task.result || 'Done').slice(-500);
      broadcast();
    }
  }, 1500);
}

async function watchBothTasks(orchestrationId, clawTaskId, deepTaskId, description) {
  const iv = setInterval(async () => {
    const clawTask = state.tasks[clawTaskId];
    const deepTask = state.tasks[deepTaskId];
    if (!clawTask || !deepTask) return;

    const clawDone = clawTask.status === 'done' || clawTask.status === 'blocked';
    const deepDone = deepTask.status === 'done' || deepTask.status === 'blocked';

    if (clawDone) state.orchestrations[orchestrationId].clawResult = clawTask.result;
    if (deepDone) state.orchestrations[orchestrationId].deepResult = deepTask.result;

    if (clawDone && deepDone) {
      clearInterval(iv);
      state.orchestrations[orchestrationId].status = 'merging';
      state.agents.Orchestrator.latestLog = 'Merging results...';
      broadcast();

      try {
        const mergeRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-b24861db17d640bba4ffb816c8863f34',
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: PERSONAS.Deep },
              { role: 'user', content: `Merge these two responses into one cohesive answer:\nANALYSIS (from Deep): ${state.orchestrations[orchestrationId].deepResult || '(none)'}\nIMPLEMENTATION (from Claw): ${state.orchestrations[orchestrationId].clawResult || '(none)'}\nOriginal request: ${description}\nProvide a clean integrated response.` },
            ],
            stream: false,
          }),
        });
        const mergeData = await mergeRes.json();
        const merged = mergeData.choices?.[0]?.message?.content || 'Merge failed';
        state.orchestrations[orchestrationId].merged = merged;
        state.orchestrations[orchestrationId].status = 'done';
        state.agents.Orchestrator.status = 'done';
        state.agents.Orchestrator.latestLog = merged.slice(-500);
      } catch (err) {
        state.orchestrations[orchestrationId].merged = `Merge error: ${err.message}`;
        state.orchestrations[orchestrationId].status = 'blocked';
        state.agents.Orchestrator.status = 'blocked';
        state.agents.Orchestrator.latestLog = `Merge error: ${err.message}`;
      }
      broadcast();
    }
  }, 1500);
}

export async function orchestrate(orchestrationId, description) {
  const orchAgent = state.agents.Orchestrator;
  orchAgent.status = 'working';
  orchAgent.description = description;
  orchAgent.title = description.slice(0, 60);
  orchAgent.latestLog = 'Analyzing task...';
  orchAgent._startedAt = Date.now();
  broadcast();

  const lowerDesc = description.toLowerCase();
  const codeKeywords = /\b(code|implement|build|fix|bug|write|create|refactor|deploy|script|function|api|endpoint|component|css|html|server|database|sql)\b/;
  const thinkKeywords = /\b(analyze|explain|plan|review|compare|evaluate|research|strategy|design|think|why|how|what|summarize|assess)\b/;
  const hasCode = codeKeywords.test(lowerDesc);
  const hasThink = thinkKeywords.test(lowerDesc);

  let routing;
  if (hasCode && !hasThink) {
    routing = { route: 'Claw', reason: 'Code-related task detected' };
  } else if (hasThink && !hasCode) {
    routing = { route: 'Deep', reason: 'Analysis/thinking task detected' };
  } else {
    routing = { route: 'both', reason: 'Default: engage both agents' };
    try {
      const routeRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-b24861db17d640bba4ffb816c8863f34',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are a task router. Analyze the task and respond with ONLY valid JSON, nothing else. No markdown, no explanation.' },
            { role: 'user', content: `Route this task: "${description}"\nJSON format: {"route": "Claw"|"Deep"|"both", "reason": "one line", "clawTask": "subtask for coder", "deepTask": "subtask for analyst"}\nClaw = coding/implementation. Deep = analysis/thinking. both = needs both.` },
          ],
          stream: false,
        }),
      });
      const routeData = await routeRes.json();
      const content = routeData.choices?.[0]?.message?.content || '{}';
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.route) routing = parsed;
    } catch {}
  }

  state.orchestrations[orchestrationId].route = routing.route;
  state.orchestrations[orchestrationId].reason = routing.reason;
  orchAgent.latestLog = `Route: ${routing.route} — ${routing.reason || ''}`;
  broadcast();

  if (routing.route === 'Claw') {
    state.taskCounter++;
    const taskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = { id: taskId, agent: 'Claw', description, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };
    state.orchestrations[orchestrationId].clawTaskId = taskId;
    runClaw(taskId, description);
    watchSingleTask(orchestrationId, taskId, 'clawResult');
  } else if (routing.route === 'Deep') {
    state.taskCounter++;
    const taskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[taskId] = { id: taskId, agent: 'Deep', description, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };
    state.orchestrations[orchestrationId].deepTaskId = taskId;
    runDeep(taskId, description);
    watchSingleTask(orchestrationId, taskId, 'deepResult');
  } else {
    const clawDesc = routing.clawTask || description;
    const deepDesc = routing.deepTask || description;

    state.taskCounter++;
    const clawTaskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[clawTaskId] = { id: clawTaskId, agent: 'Claw', description: clawDesc, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };

    state.taskCounter++;
    const deepTaskId = `task-${state.taskCounter}-${Date.now()}`;
    state.tasks[deepTaskId] = { id: deepTaskId, agent: 'Deep', description: deepDesc, by: 'Orchestrator', status: 'working', latestLog: null, result: null, delegatedBy: null, parentTaskId: null, source: 'orchestrate', createdAt: new Date().toISOString() };

    state.orchestrations[orchestrationId].clawTaskId = clawTaskId;
    state.orchestrations[orchestrationId].deepTaskId = deepTaskId;

    runClaw(clawTaskId, clawDesc);
    runDeep(deepTaskId, deepDesc);
    watchBothTasks(orchestrationId, clawTaskId, deepTaskId, description);
  }
}
