#!/usr/bin/env bash
# reset-data.sh — 清空 agent-cube 所有运行数据，保留 soul 文件和配置
# 用法: bash scripts/reset-data.sh

set -e

DATA_DIR="$HOME/.agent-cube"

echo "停止服务..."
pkill -f "tsx watch server/index.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

echo "清空数据..."

# Group 聊天记录
find "$DATA_DIR/groups" -name "messages.jsonl" -delete 2>/dev/null || true

# Direct chat 历史（ChatModal 1v1 聊天）
rm -f "$DATA_DIR"/direct-chats/*.json 2>/dev/null || true

# Thread 记录
rm -f "$DATA_DIR"/threads/*.json 2>/dev/null || true

# 任务状态
rm -f "$DATA_DIR/tasks-state.json" "$DATA_DIR/queued-tasks.json" "$DATA_DIR/token-usage.jsonl" 2>/dev/null || true

# Agent 记忆（保留 souls/）
rm -f "$DATA_DIR"/memory/*.json 2>/dev/null || true
rm -f "$DATA_DIR"/memory/long-term/* 2>/dev/null || true

# 收件箱 & 工作区
rm -f "$DATA_DIR"/inboxes/* 2>/dev/null || true
rm -rf "$DATA_DIR"/workspaces/*/ 2>/dev/null || true

echo ""
echo "保留的文件:"
echo "  souls/   $(ls "$DATA_DIR/souls/" 2>/dev/null | tr '\n' ' ')"
echo "  groups.json (group/agent 列表不变)"
echo "  agents.json (registry 不变)"
echo ""

echo "重启服务..."
cd "$(dirname "$0")/.."
npm run dev > /tmp/agent-cube.log 2>&1 &

sleep 4
if curl -s http://localhost:3021/api/status > /dev/null 2>&1; then
  echo "✓ 服务已启动，访问 http://localhost:3020"
else
  echo "服务启动中，查看日志: tail -f /tmp/agent-cube.log"
fi
