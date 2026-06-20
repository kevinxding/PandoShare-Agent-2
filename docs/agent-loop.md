# Agent Loop

This started as the first minimal agent loop:

1. receive user prompt
2. call the configured model once
3. print the assistant text

It now includes the first native tool-call loop. It still intentionally does not
include streaming, memory compaction, or UI automation. Those belong in later
loop layers.

## Code Shape

- `src/services/agent/index.ts`: session state and one-turn execution.
- `src/query.ts`: query turn wrapper. It can run through `AgentSession` now and
  returns normalized tool results.
- `src/QueryEngine.ts`: owns the session and keeps conversation messages across
  turns.
- `scripts/agent-turn.mjs`: CLI smoke path for one prompt.
- `scripts/agent-tool-smoke.mjs`: offline tool-call loop smoke.

The shape follows the same split used by Claude Code and Codex-style runtimes:
session state is outside the model client, while the turn executor performs
model calls, appends assistant messages, executes requested tools, appends
paired tool results, and then continues the model call.

## Tool Call Shape

Borrowed points:

- Claude Code: keep `assistant tool_use -> user/tool_result` pairing explicit in
  conversation state before the next model call.
- Claude Code: treat missing tool results as model-visible errors, not silent
  runtime failures.
- Codex: separate model-visible tool specs from runtime dispatch.
- Codex: normalize tool output into one response item with a success flag.
- Codex: allow safe tools to run concurrently, but keep unsafe tools serial.

Current implementation:

- `LLMRequest.tools` exposes registry tools to OpenAI-compatible providers.
- Chat Completions parses `message.tool_calls`.
- Responses parses `output` function-call items and can emit
  `function_call_output` continuation items.
- `AgentSession.runTurn()` loops through tool calls until the model returns text
  or `maxToolRounds` is reached.
- `ToolDefinition.inputSchema` is optional; missing schemas default to an open
  object schema.

## Default Tools

The first default tool set covers deterministic local work:

- `file_read`: read UTF-8 workspace files.
- `glob`: find workspace files with `*`, `?`, and `**`.
- `grep`: search UTF-8 workspace files by fixed text or regular expression.
- `file_write`: write UTF-8 workspace files.
- `apply_patch`: apply one exact text replacement to one workspace file.
- `shell_command`: run a command through the platform default shell.
- `powershell_command`: run a PowerShell command.

All file paths and command working directories are resolved under the active
workspace. Read-only tools are marked concurrency-safe. Write and command tools
run serially by default. Tool failures are returned as model-visible tool
results instead of crashing the turn.

## Run

Use the default project config:

```powershell
npm run agent:turn -- --prompt "Say OK." --max-tokens 8
```

Override provider and model for one run:

```powershell
npm run agent:turn -- --provider deepseek --model deepseek-v4-flash --prompt "Say OK."
```

Run the offline tool loop smoke:

```powershell
npm run agent:tool-smoke
```

Run the default tool runtime smoke:

```powershell
npm run tools:smoke
```

The CLI reads API keys from environment variables through the model layer. It
does not read, print, or store secret values.
