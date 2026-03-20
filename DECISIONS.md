# DECISIONS.md

记录 agent-cube 中"选择不做什么"以及背后的原因。
供 code review 时参考，避免重复讨论已决策的设计取舍。

---

## 安全

### 不限制 exec 工具的命令白名单
- **决定**：`tools.js` 的 exec 工具允许执行任意 shell 命令，没有白名单过滤。
- **原因**：agent-cube 运行在本地信任环境（Neo 的 MacBook），agent 需要完整的 shell 能力才能做有意义的编程任务。白名单会大幅限制实用性，且本地环境下额外的安全边界收益有限。
- **已知风险**：agent 能执行破坏性命令。接受。

### 不限制 exec 工具的路径访问（允许绝对路径）
- **决定**：`resolvePath` 允许绝对路径，agent 可以读写任意文件。
- **原因**：同上，本地信任环境。agent 需要能访问项目目录之外的文件（如 `~/.openclaw`、`~/Stars` 下的其他项目）。
- **已知风险**：agent 能读取敏感文件。接受。

### 保留 `--dangerously-skip-permissions`
- **决定**：claude-proxy.js 调用 claude CLI 时带 `--dangerously-skip-permissions`。
- **原因**：去掉这个 flag 会导致 claude CLI 在工具调用时弹出交互式确认，破坏无人值守的自动化执行流程。
- **已知风险**：Claude 可以无需确认地执行文件操作。接受。

---

## 架构

### scheduleAgent 是唯一公开入口，runAgent 是私有实现
- **决定**：所有外部调用（routes、checkDelegation、checkGroupMessages、restoreQueues）统一走 `scheduleAgent`。`runAgent` 不导出。
- **原因**：`scheduleAgent` 负责"要不要排队"的决策，`runAgent` 负责实际执行。分层清晰，外部调用者不需要关心 agent 是否 busy。
- **影响**：写新的触发 agent 的代码时，调 `scheduleAgent`，不要直接调 `runAgent`。

### compaction 用字符串前缀 `__COMPACT__` 做流程控制
- **决定**：`claude-proxy.js` 通过检测流输出中的 `__COMPACT__<sessionId>` 前缀来触发 context compaction，而不是用结构化返回值或特定 Error。
- **原因**：`streamChat` 的回调式 API 使得从内部抛出结构化信号比较繁琐，字符串前缀是当前最简单的实现。理论上存在误判（极低概率），但实际中不会发生。
- **待改**：下次重构 claude-proxy 的 Promise 链时，改成 `{ type: 'compact', sessionId }` 结构化返回。

### 队列 cap 设为 20，超出直接 blocked（不 backpressure）
- **决定**：每个 agent 的队列上限 20 条，超出后新任务立刻标为 `blocked`，不等待、不丢弃旧任务。
- **原因**：简单明确。20 条对正常使用场景绰绰有余；超出说明系统过载，及时反馈比静默堆积更好。

### threadCounter 重启后归零
- **决定**：`threadCounter` 不从磁盘恢复，每次重启从 0 开始。
- **原因**：thread ID 带时间戳，不会冲突。Thread 目前不持久化到磁盘（`state.threads` 重启后清空），所以 counter 从 0 开始不影响正确性。
- **待改**：如果未来持久化 threads，需要同步恢复 threadCounter。

---

_最后更新：2026-03-20_
