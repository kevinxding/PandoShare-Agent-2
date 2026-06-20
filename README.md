# Pando Agent

Pando is a local agent platform for long-running code and GUI work. It combines a Codex-like command and event protocol, a Claude Code-like agent loop and recovery experience, an OpenCode-style multi-provider model layer, and Pando-native GUI automation.

The project uses English and ASCII file names, program identifiers, config keys, and script paths. Chinese should only appear where it is user-visible content, prompt text, recognition text, or explicitly required copy.

## Main Entry Points

```bash
node bin/pando.js --help
node bin/pando.js doctor
node bin/pando.js serve
node bin/pando.js "Reply with exactly: PANDO_OK"
node bin/pando.js exec "Inspect this workspace"
node bin/pando.js exec --provider minimax-cn --model MiniMax-M3 "Reply with exactly: PANDO_OK"
node bin/pando.js gateway start --duration-ms 10000
node bin/pando.js gateway status
node bin/pando.js gateway stop
node bin/pando.js loop list
node bin/pando.js gui doctor
node bin/pando.js mcp doctor
```

After package linking or installation, the same commands are available as `pando`.

## Core Capabilities

- Web UI: chat, threads, model settings, tools/events, approvals, GUI status, Loop Engineering, Gateway status, files, and runtime settings.
- Model layer: DeepSeek, MiniMax China Token Plan, OpenAI, and custom OpenAI-compatible providers with capability metadata and error classification.
- Harness loop: context build, model request, tool calls, approvals, tool results, event stream, checkpoints, and recovery-oriented thread storage.
- Context management: rectangular tool-call-safe compaction using persisted `compactions.jsonl`.
- Tools: file, shell, MCP, GUI orchestration, result storage for large outputs, and token budget telemetry.
- GUI automation: Pando GUI abstraction over UIA-first execution with Dingxu visual/human fallback and action verification.
- Loop Engineering: local loop specs, runs, iterations, verifiers, pause/resume/stop, CLI and Web controls.
- Gateway runtime: local/mock command channel, Telegram/Feishu/Lark/WeCom delivery adapters, approvals bridge, thread compression, loop resume, heartbeat-triggered loops, liveness heartbeat, runId-bound progress heartbeat, and wake heartbeat.
- Stability runner: repeatable smoke/long-run scripts with ledger, watchdog, resource usage, Gateway signal evidence, and summary report.

The Pando-facing GUI tool is `gui_action`. Models do not call Dingxu's raw MCP tools directly. Pando maps stable actions such as `observe`, `click`, `fast_click`, `type`, `press_key`, `set_key_state`, `mouse_button_state`, `scroll`, `draw_path`, `draw_paths`, `analyze_grid`, `reflex_click`, `wait`, `wait_for_change`, `wait_until_stable`, `compare_observations`, and `release_all` onto the configured UIA/Windows MCP/Dingxu backend.

## Configuration

Default config file:

```text
pandoshare.config.json
```

Common sections:

- `model`: active provider and model.
- `providers`: provider definitions for DeepSeek, MiniMax CN, OpenAI, or custom OpenAI-compatible endpoints.
- `permissions`: approval and sandbox policy.
- `tokenBudget`: context budget behavior.
- `mcpServers`: stdio MCP server definitions.
- `gateway`: channels, allowlist, liveness heartbeat, progress heartbeat, and wake heartbeat intervals.

Do not store API keys directly in config. Use environment variables such as `DEEPSEEK_API_KEY`, `MINIMAX_CN_API_KEY`, `OPENAI_API_KEY`, or a custom provider env key.

Gateway channel secrets should also stay in environment variables. Example:

```json
{
  "gateway": {
    "allowUsers": ["local-user"],
    "pairingSecretEnv": "PANDO_GATEWAY_PAIRING_SECRET",
    "channels": {
      "telegram": {
        "kind": "telegram",
        "tokenEnv": "PANDO_TELEGRAM_BOT_TOKEN",
        "chatIdEnv": "PANDO_TELEGRAM_CHAT_ID",
        "ingressSecretEnv": "PANDO_GATEWAY_INGRESS_SECRET",
        "allowedUsers": ["telegram-user"]
      },
      "feishu": {
        "kind": "feishu",
        "webhookEnv": "PANDO_FEISHU_WEBHOOK",
        "ingressSecretEnv": "PANDO_GATEWAY_INGRESS_SECRET",
        "allowedUsers": ["feishu-user"]
      },
      "lark": {
        "kind": "lark",
        "webhookEnv": "PANDO_LARK_WEBHOOK",
        "ingressSecretEnv": "PANDO_GATEWAY_INGRESS_SECRET",
        "allowedUsers": ["lark-user"]
      },
      "wecom": {
        "kind": "wecom",
        "webhookEnv": "PANDO_WECOM_WEBHOOK",
        "ingressSecretEnv": "PANDO_GATEWAY_INGRESS_SECRET",
        "allowedUsers": ["wecom-user"]
      }
    }
  }
}
```

External users can send `/pair <secret>` once through a configured inbound channel. When `<secret>` matches `pairingSecretEnv`, Pando persists the channel/user pair under `.pandoshare/gateway/paired-users.jsonl` and allows that user after restart. Do not put the secret itself in config.

When Gateway starts after a previous `starting`, `running`, or `failed` state, it records a `gateway_recovered` event and stores a recovery snapshot in `state.json`. Recovery reloads loops, approvals, paired users, and channel diagnostics from local stores; it does not replay unsafe old actions.

Use `pando gateway status --json` to inspect the last state, channels, inbox, outbox, paired users, events, and wake runs. Use `pando gateway stop` to enqueue a local `/stop` command for a running Gateway; the Gateway exits after it processes the inbox command.

Loops can be created with `--trigger manual`, `--trigger schedule`, or `--trigger heartbeat`. Gateway wake heartbeats will run at most one `heartbeat` loop per wake cycle when that loop is explicitly marked with `trigger: heartbeat` and is in a resumable state.

Gateway users can send `/model` to inspect the current runtime model or `/model <provider> [model]` to switch the current Gateway session to an already configured provider/model. This session switch does not write `pandoshare.config.json`; use Web Settings for permanent model changes.

Gateway users can send `/usage` to receive a compact runtime summary: heartbeats, wake runs, thread/message/event/checkpoint/compaction counts, Loop status counts, pending approvals, paired users, Gateway inbox/outbox/events, and recent structured tool failures.

Gateway users can send `/background <loopId>` to enroll a resumable Loop for heartbeat-triggered background execution. The command sets the Loop trigger to `heartbeat`, pauses non-running loops so they are resumable, and the next Gateway wake heartbeat can resume it. Sending `/background` without a loop id lists enrolled background loops.

## Verification

Fast local checks:

```bash
npm run typecheck
npm run web-build
npm run check
npm run doctor:smoke
npm run model-smoke
npm run gateway:smoke
npm run loop-runtime:smoke
npm run gui-tool:smoke
npm run serve:smoke
npm run stability:smoke
```

Long-run checks:

```bash
npm run stability:1h
npm run stability:10h
```

The stability runner writes evidence to:

```text
.pandoshare/stability/<runId>/summary.json
.pandoshare/stability/<runId>/report.md
.pandoshare/stability/<runId>/ledger.jsonl
```

## Current External Boundaries

- Real Telegram, Feishu/Lark, and WeCom delivery depend on user-provided tokens/webhooks. Configured channels send outbound HTTP messages; inbound webhook control uses `POST /api/gateway/inbound` and requires `ingressSecretEnv` for external channels. Missing outbound secrets are reported as `missing_config` while local/mock channels remain usable.
- Real Dingxu GUI integration uses the configured MCP server from `D:/Users/Lenovo/Desktop/dingxu_agent`; fake GUI backend smoke tests cover the same Pando-facing abstraction.
- Online model smoke tests require provider API keys. Offline smoke tests use fake OpenAI-compatible providers to verify runtime behavior without leaking secrets.
