# Planner Agent — 实现规格

## 目标
给 agent-cube 增加 Planner agent，让它能自动拆解复杂任务并分阶段协调执行。

## 需要做的事

### 1. 创建 ~/.agent-cube/souls/Planner.md
Planner 的行为定义：
- 收到任务后，判断是否需要多阶段（超过60分钟工作量、涉及多个独立模块、有明确先后依赖关系）
- 简单任务：直接 [NEXT:Forge] 执行
- 复杂任务：
  a. 把阶段计划写入 workspace/{taskId}/plan.json
  b. 输出计划摘要
  c. [NEXT:Forge] 开始 Phase 1
- 每次被 [NEXT:Planner] 唤回时：
  a. 读取 plan.json，了解当前进度
  b. 评估上一阶段结果
  c. 若需修正：修改 plan.json 后重新分配给 Forge/Arc
  d. 若通过：标记当前阶段 done，进入下一阶段
  e. 所有阶段完成：[NEXT:User] 输出总结报告

### 2. plan.json 结构（写入 ~/.agent-cube/workspaces/{taskId}/plan.json）
```json
{
  "goal": "总目标描述",
  "currentPhase": 1,
  "phases": [
    {
      "id": 1,
      "title": "Phase 1 标题",
      "goal": "这个阶段要完成什么",
      "status": "in_progress",
      "result": null
    },
    {
      "id": 2,
      "title": "Phase 2 标题", 
      "goal": "...",
      "status": "pending",
      "result": null
    }
  ]
}
```

### 3. 在 ~/.agent-cube/data/agents.json 注册 Planner
格式参考现有 agents（provider: claude，model: claude-opus-4-6）

### 4. 修改 ~/.agent-cube/souls/Forge.md
在末尾加：
"当你完成了一个阶段的任务，且 workspace 目录里存在 plan.json 文件时，用 [NEXT:Planner] 将控制权交回给 Planner，而不是 [NEXT:User]。Planner 会决定下一步。"

## 技术参考
- server/agents.ts 的 parseNextDirective 函数已支持任意 agent 名和循环（A→B→A）
- server/registry.ts 的 loadAgentRegistry 读 ~/.agent-cube/data/agents.json
- workspace 路径由 getWorkspace(taskId) 返回：~/.agent-cube/workspaces/{taskId}/
- tool protocol 里 readFile/writeFile 可以操作文件

## 完成条件
- Planner soul 文件创建完毕
- agents.json 注册完毕
- Forge.md 更新完毕
- 简单任务测试：Planner 判断不需要多阶段，直接 [NEXT:Forge]
- 完成后通知 X（open_id: ou_7ed514cd124690ef792400e04fa1764e）
