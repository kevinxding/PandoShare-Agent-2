# Architecture

Pando is organized as a local agent platform rather than a single chat script. The design borrows proven ideas from Codex, Claude Code, OpenCode, and Hermes-like background runtimes, but the runtime names, storage layout, GUI abstraction, and Gateway/Loop behavior are Pando-specific.

## Runtime Layers

1. Entry points
   - `bin/pando.js` is the thin executable wrapper.
   - `src/entrypoints/cli.ts` handles fast `--help` and `--version`, then loads `src/main.tsx`.
   - `src/main.tsx` owns CLI commands for chat, exec, doctor, MCP, GUI, Gateway, threads, loops, and serve.
   - `src/server/index.ts` exposes the Web UI API and serves the browser app.

2. Agent harness
   - `src/QueryEngine.ts` owns the user turn lifecycle.
   - The turn shape is: user prompt -> context build -> model request -> tool calls -> tool results -> final response.
   - Events are emitted for model, context, tool, approval, compaction, GUI, MCP, and turn state changes.
   - Tool failures are structured so CLI, Web UI, Gateway, and tests can reason about them.

3. Model layer
   - `src/services/llm/*` provides provider definitions, capability metadata, generate calls, and error classification.
   - Supported provider families include DeepSeek, MiniMax China Token Plan, OpenAI, and custom OpenAI-compatible endpoints.
   - API keys are referenced through environment variables and are redacted before events, exports, or stored summaries.

4. Context and thread storage
   - `src/services/threadStore/*` persists metadata, messages, events, checkpoints, and compactions under `.pandoshare/threads`.
   - `src/services/contextBuilder/*` builds model input using live messages plus the latest successful compaction summary.
   - `src/services/compact/*` implements rectangular compaction so assistant tool calls and tool results are never split across the live/summary boundary.

5. Tools and permissions
   - `src/Tool.ts` defines tool contracts and approval policy types.
   - `src/tools.ts` assembles the default tool registry.
   - `src/services/tools/*` contains file, shell, GUI, result storage, and related tool services.
   - Approval behavior supports request approval, approve for session, and full access semantics.

6. GUI automation
   - `src/services/gui/*` exposes one Pando GUI tool layer to the model.
   - Execution prefers deterministic UIA behavior where available, then Dingxu visual/human GUI fallback, then screenshot verification and failure classification.
   - The current GUI automation core is expected at `D:/Users/Lenovo/Desktop/dingxu_agent`.

7. MCP integration
   - `src/services/mcp/*` connects configured stdio MCP servers.
   - MCP tools are normalized into Pando `ToolDefinition` objects using names like `mcp__server__tool`.
   - MCP server failures are surfaced through doctor output and runtime events without crashing the whole agent.

8. Loop Engineering
   - `src/services/loopRuntime/*` stores loops under `.pandoshare/loops`.
   - A loop has metadata, state, runs, iterations, events, verification, failure policy, and resume behavior.
   - Loops can be controlled through CLI, Web UI, and Gateway commands.

9. Gateway runtime
   - `src/services/gatewayRuntime/*` stores state under `.pandoshare/gateway`.
   - It supports local/mock channels now, plus Telegram, Feishu/Lark, and WeCom configuration diagnostics.
   - Gateway can process mobile-style commands, share approvals with Web UI, resume loops, compact threads, and write events.
   - It has three heartbeat classes:
     - Liveness heartbeat updates `state.json`.
     - Progress heartbeat emits runId-bound still-working messages for running loops.
     - Wake heartbeat performs a fresh state check, writes `wake.jsonl`, and notifies local/mock channels when attention is needed.

10. Stability and diagnostics
   - `scripts/stability-runner.mjs` runs the platform under a temporary workspace and fake model server.
   - It verifies Web health, thread chat, Gateway approvals, Gateway progress/wake signals, Loop runtime, stored state, heartbeat watchdog, and resource usage.
   - Reports are written to `.pandoshare/stability/<runId>/`.

## Main Data Paths

```text
.pandoshare/threads/<threadId>/
.pandoshare/loops/<loopId>/
.pandoshare/gateway/
.pandoshare/stability/<runId>/
```

## Agent Turn Shape

```text
user prompt
  -> preflight/context selection
  -> model request
  -> assistant tool calls
  -> permission checks
  -> tool execution
  -> tool result storage/redaction
  -> next model round or final answer
  -> thread events/messages/checkpoint
```

## Long-Running Work Shape

```text
Gateway start
  -> liveness heartbeat
  -> mobile/local commands
  -> shared approvals
  -> LoopRuntime run/resume
  -> runId-bound progress heartbeat
  -> wake heartbeat state check
  -> ledger/report evidence
```

## Verification Contract

The project is not considered healthy unless these classes of checks pass:

- TypeScript typecheck and build.
- Web build and serve smoke.
- Provider/model smoke.
- Thread, context, compaction, event, permission, tool, MCP, GUI, Gateway, Loop, and harness smoke tests.
- Stability smoke, then long-run stability checks before final release.
