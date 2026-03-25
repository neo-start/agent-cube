/**
 * tools.ts — Agent 工具注册和执行
 *
 * 协议: agent 在输出中用如下格式调用工具:
 *   [TOOL:readFile]path/to/file[/TOOL]
 *   [TOOL:writeFile]path/to/file\ncontent here[/TOOL]
 *   [TOOL:exec]npm install express[/TOOL]
 *   [TOOL:listFiles]./src[/TOOL]
 *
 * 服务端执行后注入结果:
 *   [TOOL_RESULT:readFile]file content here[/TOOL_RESULT]
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { ToolCall } from './types.js';

// 允许执行的命令（前缀匹配）
const EXEC_WHITELIST = [
  'npm', 'npx', 'node', 'python', 'python3', 'pip', 'pip3',
  'git', 'ls', 'cat', 'mkdir', 'rm', 'cp', 'mv', 'touch',
  'echo', 'pwd', 'find', 'grep', 'which', 'env', 'curl',
  'tsc', 'ts-node', 'jest', 'vitest', 'mocha', 'pytest',
  'cd', 'sed', 'awk', 'wc', 'head', 'tail', 'sort', 'uniq',
];

function resolvePath(filePath: string, workspace: string): string {
  if (!filePath) return workspace;
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(workspace, filePath);
  // Resolve symlinks to prevent traversal via symlinked directories
  try {
    return fs.realpathSync(resolved);
  } catch {
    // File may not exist yet (writeFile) — resolve without symlink check
    return path.resolve(resolved);
  }
}

interface Tool {
  description: string;
  execute: (args: string, workspace: string) => Promise<string>;
}

export const tools: Record<string, Tool> = {
  readFile: {
    description: 'Read file contents. Format: "path" or "path:startLine-endLine" (1-based, inclusive). Max 300 lines or 20KB per call.',
    execute: async (args, workspace) => {
      const raw = args.trim();
      // Support "path:start-end" for line ranges
      const rangeMatch = raw.match(/^(.+):(\d+)-(\d+)$/);
      const filePath = resolvePath(rangeMatch ? rangeMatch[1] : raw, workspace);
      if (!filePath.startsWith(workspace)) return `Error: Cannot read files outside workspace`;
      if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        if (rangeMatch) {
          const start = Math.max(1, parseInt(rangeMatch[2])) - 1;
          const end = Math.min(lines.length, parseInt(rangeMatch[3]));
          const slice = lines.slice(start, end).join('\n');
          return `[Lines ${start + 1}-${end} of ${lines.length}]\n${slice.slice(0, 20000)}`;
        }
        // Default: first 300 lines or 20KB
        const preview = lines.slice(0, 300).join('\n');
        const out = preview.slice(0, 20000);
        return lines.length > 300
          ? `[Lines 1-300 of ${lines.length} — use "path:startLine-endLine" to read more]\n${out}`
          : out;
      } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
      }
    },
  },

  writeFile: {
    description: 'Write content to a file. First line is the path, rest is content.',
    execute: async (args, workspace) => {
      const firstNewline = args.indexOf('\n');
      if (firstNewline === -1) return 'Error: writeFile requires path on first line, content on subsequent lines';
      const filePath = resolvePath(args.slice(0, firstNewline).trim(), workspace);
      if (!filePath.startsWith(workspace)) return `Error: Cannot write files outside workspace`;
      const content = args.slice(firstNewline + 1);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return `Written: ${filePath} (${content.length} bytes)`;
      } catch (err) {
        return `Error writing file: ${(err as Error).message}`;
      }
    },
  },

  appendFile: {
    description: 'Append content to an existing file. First line is path, rest is content to append.',
    execute: async (args, workspace) => {
      const firstNewline = args.indexOf('\n');
      if (firstNewline === -1) return 'Error: appendFile requires path on first line, content after';
      const filePath = resolvePath(args.slice(0, firstNewline).trim(), workspace);
      if (!filePath.startsWith(workspace)) return `Error: Cannot append to files outside workspace`;
      const content = args.slice(firstNewline + 1);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, content, 'utf8');
        return `Appended to: ${filePath} (${content.length} bytes added)`;
      } catch (err) {
        return `Error appending file: ${(err as Error).message}`;
      }
    },
  },

  listFiles: {
    description: 'List files in a directory. Default is workspace root.',
    execute: async (args, workspace) => {
      const dirPath = resolvePath(args.trim() || '.', workspace);
      if (!dirPath.startsWith(workspace)) return `Error: Cannot list files outside workspace`;
      if (!fs.existsSync(dirPath)) return `Error: Directory not found: ${dirPath}`;
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        if (items.length === 0) return '(empty directory)';
        return items
          .map(f => `${f.isDirectory() ? '[dir]' : '[file]'} ${f.name}`)
          .join('\n');
      } catch (err) {
        return `Error listing directory: ${(err as Error).message}`;
      }
    },
  },

  exec: {
    description: 'Execute a shell command in the workspace directory.',
    execute: async (args, workspace) => {
      const cmd = args.trim();
      if (!cmd) return 'Error: No command provided';

      // Block shell chaining operators and newlines that bypass whitelist
      if (/[;&|`\n\r]|\$\(/.test(cmd)) {
        return `Error: Shell operators (;, &, |, \`, $(), newlines) are not allowed. Run one command at a time.`;
      }

      // 白名单检查（取第一个单词）
      const cmdBase = path.basename(cmd.split(/\s+/)[0]);
      const allowed = EXEC_WHITELIST.some(w => cmdBase === w);
      if (!allowed) {
        return `Error: Command not in whitelist: "${cmdBase}"\nAllowed: ${EXEC_WHITELIST.join(', ')}`;
      }

      // Block dangerous flags that allow arbitrary code execution
      const dangerousFlags = /\s-e\s|\s--eval[\s=]|\s-c\s/;
      if (['node', 'python', 'python3'].includes(cmdBase) && dangerousFlags.test(` ${cmd} `)) {
        return `Error: Inline code execution flags (-e, -c, --eval) are not allowed. Write code to a file first.`;
      }

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        const proc = spawn('sh', ['-c', cmd], {
          cwd: workspace,
          env: process.env,
        });
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        const timer = setTimeout(() => { proc.kill(); resolve('Error: command timed out (60s)'); }, 60_000);
        proc.on('close', (code: number | null) => {
          clearTimeout(timer);
          const out = (stdout + stderr).slice(0, 8000);
          resolve(code === 0 ? out || '(no output)' : `Error (exit ${code}):\n${out.slice(0, 5000)}`);
        });
        proc.on('error', (err: Error) => { clearTimeout(timer); resolve(`Error: ${err.message}`); });
      });
    },
  },

  deleteFile: {
    description: 'Delete a file. Path relative to workspace.',
    execute: async (args, workspace) => {
      const filePath = resolvePath(args.trim(), workspace);
      // 禁止删除 workspace 之外的文件
      if (!filePath.startsWith(workspace)) return 'Error: Cannot delete files outside workspace';
      if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;
      try {
        fs.unlinkSync(filePath);
        return `Deleted: ${filePath}`;
      } catch (err) {
        return `Error deleting file: ${(err as Error).message}`;
      }
    },
  },
};

/**
 * Parse [TOOL:name]args[/TOOL] blocks from agent response.
 * Returns array of { name, args } objects.
 */
export function parseToolCalls(text: string): ToolCall[] {
  const pattern = /\[TOOL:(\w+)\]([\s\S]*?)\[\/TOOL\]/g;
  const calls: ToolCall[] = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    calls.push({ name: match[1], args: match[2] });
  }
  return calls;
}

/**
 * Execute a list of tool calls in the given workspace.
 * Returns formatted result string to inject back to agent.
 */
export async function executeToolCalls(toolCalls: ToolCall[], workspace: string): Promise<string> {
  const results: string[] = [];
  for (const tc of toolCalls) {
    const tool = tools[tc.name];
    if (!tool) {
      results.push(`[TOOL_RESULT:${tc.name}]\nError: Unknown tool "${tc.name}". Available: ${Object.keys(tools).join(', ')}\n[/TOOL_RESULT]`);
      continue;
    }
    const output = await tool.execute(tc.args, workspace);
    results.push(`[TOOL_RESULT:${tc.name}]\n${output}\n[/TOOL_RESULT]`);
  }
  return results.join('\n\n');
}

/**
 * System prompt injection — tells agents how to use tools.
 */
export const TOOL_PROTOCOL = `
## Tool Use
You can interact with the filesystem and run commands using these tools.
Place tool calls anywhere in your response — they will be executed and results injected back.

Available tools:
- [TOOL:readFile]path/to/file[/TOOL]            — read a file (first 300 lines)
- [TOOL:readFile]path/to/file:50-120[/TOOL]     — read lines 50–120 of a file
- [TOOL:writeFile]path/to/file                  — write a file (path on first line, content after)
content goes here
[/TOOL]
- [TOOL:appendFile]path/to/file                 — append to file
appended content
[/TOOL]
- [TOOL:listFiles]./optional/path[/TOOL]        — list directory contents
- [TOOL:exec]command here[/TOOL]                — run a command (npm, git, node, python3, etc.)
- [TOOL:deleteFile]path/to/file[/TOOL]          — delete a file (workspace only)

Rules:
- All relative paths are relative to your project workspace
- exec runs in your workspace directory
- exec is sandboxed: npm, npx, node, python3, git, and common Unix tools are allowed
- After tool results are injected, continue your response naturally
- Use tools when you need to read, write, or test code — don't just describe what you'd do
`;
