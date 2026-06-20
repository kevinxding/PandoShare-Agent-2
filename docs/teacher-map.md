# Teacher Architecture Map

This map is the audit trail for how Pando learns from the local teacher
projects without turning into an untraceable rewrite. It should stay small,
direct, and tied to real Pando files.

## Source Boundary

| Teacher | Local source | License status | Pando usage rule |
| --- | --- | --- | --- |
| OpenCode | `D:/Users/Lenovo/Desktop/学习代码/opencode` | MIT license in local source | Learn provider/model configuration, model selection UX, plugin boundaries, and UI information layout. Copy only when license obligations are preserved; prefer Pando-native TypeScript structure. |
| Codex | `D:/Users/Lenovo/Desktop/学习代码/codex` | Apache-2.0 license and NOTICE in local source | Learn command protocol, approvals, event discipline, thread/goal semantics, sandbox mindset, and smoke-test rigor. Preserve attribution when copying or adapting licensed material. |
| Claude Code-like source | `D:/Users/Lenovo/Desktop/学习代码/claude-code-source-code` | No LICENSE file found in local snapshot | Use only behavior-level and architecture-level replication: agent loop shape, tool-result pairing, compaction behavior, recovery, subagent/task patterns, and verification discipline. Do not copy private or unclear-license implementation line by line. |
| Hermes Agent | `D:/Users/Lenovo/Desktop/学习代码/hermes-agent` | MIT license in local source | Learn gateway sessions, mobile-style command channels, heartbeat, cron/background work, and long-running session resilience. Keep Pando gateway names, storage, and runtime contracts independent. |
| Dingxu GUI | `D:/Users/Lenovo/Desktop/dingxu_agent` | Local project dependency | Use as the GUI automation core behind Pando's stable `gui_action` abstraction. Do not expose raw low-level GUI tools directly to the model. |

## Borrowing Matrix

| Pando area | Teacher references | Local implementation |
| --- | --- | --- |
| CLI entry and command protocol | Codex typed commands and Claude Code thin launch experience | `bin/pando.js`, `src/entrypoints/cli.ts`, `src/main.tsx` |
| Multi-LLM provider layer | OpenCode provider/model separation and selectable model UX | `src/services/llm/*`, `docs/llm-model-layer.md`, `pandoshare.config.json` |
| Agent harness loop | Claude Code tool loop behavior plus Codex event/test discipline | `src/QueryEngine.ts`, `src/query.ts`, `src/services/contextBuilder/*`, `src/services/events/*` |
| Tool protocol and safety | Codex approval/sandbox mindset, Claude Code structured tool-result pairing | `src/Tool.ts`, `src/tools.ts`, `src/services/tools/*`, `src/tools/*` |
| Thread and context persistence | Codex thread semantics plus Claude Code recovery/compaction behavior | `src/services/threadStore/*`, `src/services/compact/*`, `docs/agent-loop.md` |
| Goal management | Codex goal lifecycle and conservative completion semantics | `src/services/goalStore/*`, CLI goal commands in `src/main.tsx` |
| Loop Engineering | Claude Code task/subagent loop patterns plus Pando-native verifier storage | `src/services/loopRuntime/*`, loop CLI/Web/Gateway commands |
| Gateway and heartbeat | Hermes gateway/background/heartbeat ideas | `src/services/gatewayRuntime/*`, `scripts/gateway-smoke.mjs`, `scripts/stability-runner.mjs` |
| GUI automation | Dingxu GUI core plus Pando UIA-first wrapper | `src/services/gui/*`, `src/tools/GuiTool/index.ts`, `scripts/dingxu-mcp-smoke.mjs` |
| Minimal Web UI | OpenCode information density as inspiration, no product polish in current phase | `src/server/index.ts`, `web/src/*`, `scripts/serve-smoke.mjs` |
| Acceptance and stability | Codex smoke-test rigor plus Hermes long-running runtime concerns | `scripts/acceptance-smoke.mjs`, `scripts/stability-runner.mjs` |

## Mirrored Root Shape

The original Claude Code-like skeleton informed the first project shape. These
directories remain the broad module boundary, but Pando is no longer a simple
directory mirror.

- `docs`
- `scripts`
- `src`
- `stubs`
- `tools`
- `types`
- `utils`
- `vendor`

## Mirrored `src` Shape

These names came from the teacher skeleton and are retained only where they
help organize Pando's runtime. Empty or unused skeletons do not count as
feature completion.

- `assistant`
- `bootstrap`
- `bridge`
- `buddy`
- `cli`
- `commands`
- `components`
- `constants`
- `context`
- `coordinator`
- `entrypoints`
- `hooks`
- `ink`
- `keybindings`
- `memdir`
- `migrations`
- `moreright`
- `native-ts`
- `outputStyles`
- `plugins`
- `query`
- `remote`
- `schemas`
- `screens`
- `server`
- `services`
- `skills`
- `state`
- `tasks`
- `tools`
- `types`
- `upstreamproxy`
- `utils`
- `vim`
- `voice`

## Pando-Native Extensions

These are not direct teacher copies. They are Pando's product-specific backend
surface.

- `src/services/gui`
- `src/tools/GuiTool`
- `src/services/gatewayRuntime`
- `src/services/loopRuntime`
- `src/services/goalStore`
- `src/services/threadStore`
- `src/services/compact`

## Completion Rule

When a future module overlaps with OpenCode, Codex, Claude Code-like source, or
Hermes, inspect the matching teacher module first. Then either adapt licensed
code with attribution or rewrite the behavior in Pando's own structure. Do not
claim completion from a skeleton file, a placeholder, or a doc-only mapping.
