#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'

const root = process.cwd()
const options = parseArgs(process.argv.slice(2))
const evidence = await loadAcceptanceEvidence(options.acceptanceRunId)
const report = renderReport({ evidence })

if (options.stdout) {
  process.stdout.write(report)
} else {
  const outPath = options.out
    ? resolve(root, options.out)
    : resolve(root, '.pandoshare/reports', `delivery-report-${safeFilePart(evidence.primary?.runId ?? Date.now())}.md`)
  assertInside(root, outPath)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, report, 'utf8')
  console.log(`delivery report: ${outPath}`)
}

async function loadAcceptanceEvidence(runId) {
  const summaries = await loadAllAcceptanceSummaries()
  const primary = runId
    ? summaries.find(summary => summary.runId === runId)
    : summaries.find(summary => summary.profile === 'required' && summary.status === 'passed')
      ?? summaries.find(summary => summary.status === 'passed')
      ?? summaries[0]
  const supporting = selectSupportingEvidence(summaries, primary)
  return { primary, supporting, all: summaries }
}

async function loadAllAcceptanceSummaries() {
  const acceptanceRoot = resolve(root, '.pandoshare/acceptance')
  if (!existsSync(acceptanceRoot)) return []

  const entries = await readdir(acceptanceRoot, { withFileTypes: true })
  const summaries = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const summaryPath = resolve(acceptanceRoot, entry.name, 'summary.json')
    if (!existsSync(summaryPath)) continue
    try {
      summaries.push(await readSummary(summaryPath))
    } catch {
      // Ignore broken historical evidence; the report states when evidence is missing.
    }
  }

  summaries.sort((left, right) => (right.finishedAtMs ?? 0) - (left.finishedAtMs ?? 0))
  return summaries
}

function selectSupportingEvidence(summaries, primary) {
  const used = new Set(primary ? [primary.runId] : [])
  const selected = []
  for (const predicate of [
    summary => summary.status === 'passed' && hasStepPrefix(summary, 'linked-pando-'),
    summary => summary.status === 'passed' && hasStep(summary, 'gui-live-smoke'),
    summary => summary.status === 'passed' && hasAnyStep(summary, [
      'task-tools-smoke',
      'web-tools-smoke',
      'lsp-tool-smoke',
      'skill-tool-smoke',
      'mcp-resource-tools-smoke',
      'ask-user-tool-smoke',
      'schedule-tools-smoke',
      'notebook-tool-smoke',
      'tool-permissions-smoke',
      'tool-events-smoke',
    ]),
    summary => summary.status === 'passed' && hasStep(summary, 'dingxu-mcp-smoke'),
    summary => summary.status === 'passed' && hasStep(summary, 'serve-smoke'),
  ]) {
    const match = summaries.find(summary => !used.has(summary.runId) && predicate(summary))
    if (match) {
      selected.push(match)
      used.add(match.runId)
    }
  }
  return selected
}

async function readSummary(summaryPath) {
  const parsed = JSON.parse(await readFile(summaryPath, 'utf8'))
  return {
    ...parsed,
    summaryPath,
    reportPath: resolve(dirname(summaryPath), 'report.md'),
  }
}

function renderReport({ evidence }) {
  const primary = evidence.primary
  const status = primary
    ? `Acceptance ${primary.profile} profile is ${primary.status} (${acceptedStepText(primary)}).`
    : 'No acceptance evidence was found under `.pandoshare/acceptance`.'
  const supportingText = evidence.supporting.length
    ? `${evidence.supporting.length} supporting acceptance run(s) included.`
    : 'No supporting acceptance runs selected.'

  const lines = [
    '# Pando Backend Agent Delivery Report',
    '',
    'This report is generated from the current workspace. It is an acceptance-oriented delivery report, not a claim that the full long-term product goal is complete.',
    '',
    '## Current Status',
    '',
    `- Workspace: ${root}`,
    `- Status: ${status}`,
    `- Supporting evidence: ${supportingText}`,
    primary ? `- Primary evidence root: ${primary.evidenceRoot}` : '- Primary evidence root: missing',
    primary ? `- Primary acceptance report: ${primary.reportPath}` : '- Primary acceptance report: missing',
    '',
    '## Evidence Coverage',
    '',
    ...renderEvidenceCoverage(evidence),
    '',
    '## 1. Completed Backend Modules',
    '',
    '- CLI entrypoint and command routing for chat, exec, doctor, thread, goal, loop, gateway, MCP, GUI, and serve.',
    '- Multi-provider LLM layer with DeepSeek, MiniMax CN Token Plan, OpenAI, OpenAI Codex token auth path, and custom OpenAI-compatible providers.',
    '- Agent harness loop with context building, model calls, tool calls, approvals, events, checkpoints, and structured tool failures.',
    '- ThreadStore with metadata, messages, events, checkpoints, exports, branching, and compactions.',
    '- AutoCompact and rectangular compaction that preserves assistant tool-call/tool-result rectangles.',
    '- Permission system with request approval, session approval, and full-access semantics.',
    '- Pando GUI abstraction over UIA-first behavior and Dingxu human/visual GUI fallback.',
    '- Gateway runtime with local/mock channels, external channel diagnostics, pairing, approvals bridge, heartbeats, wake checks, recovery, and mobile-style commands.',
    '- Native Loop Engineering with local loop specs, runs, iterations, verifiers, pause/resume/stop, checkpointing, and Gateway wake integration.',
    '- Native Goal Store/Service/Runtime with requirements, progress, evidence, runs, checkpoints, conservative completion, and CLI/Web/Gateway surfaces.',
    '- Advanced tool layer including task, web, LSP, skill, REPL, MCP resource, ask-user, notebook, schedule, remote trigger, send message, todo, and tool search surfaces.',
    '- Minimal Web UI endpoints and controls for backend verification, without product visual polish as requested.',
    '- Stability runner and acceptance runner with persisted evidence.',
    '',
    '## 2. Key Files By Module',
    '',
    '- Entry and CLI: `bin/pando.js`, `src/entrypoints/cli.ts`, `src/main.tsx`.',
    '- Web/API: `src/server/index.ts`, `web/src/App.tsx`, `web/src/styles.css`.',
    '- LLM: `src/services/llm/*`, `docs/llm-model-layer.md`.',
    '- Harness: `src/QueryEngine.ts`, `src/query.ts`, `src/services/agent/index.ts`, `src/services/contextBuilder/index.ts`.',
    '- Events: `src/services/events/index.ts`.',
    '- Tools: `src/Tool.ts`, `src/tools.ts`, `src/tools/*`, `src/services/tools/*`.',
    '- Permissions and approvals: `src/services/permissions/*`, `src/services/approvalStore/index.ts`.',
    '- Threads and compact: `src/services/threadStore/index.ts`, `src/services/compact/index.ts`.',
    '- GUI: `src/services/gui/index.ts`, `src/tools/GuiTool/index.ts`.',
    '- Gateway: `src/services/gatewayRuntime/index.ts`.',
    '- Loop: `src/services/loopRuntime/index.ts`.',
    '- Goal: `src/services/goalStore/index.ts`, `src/services/goalService/index.ts`, `src/services/goalRuntime/index.ts`, `src/tools/GoalTool/index.ts`.',
    '- Acceptance/stability: `scripts/acceptance-smoke.mjs`, `scripts/stability-runner.mjs`.',
    '- Architecture traceability: `docs/architecture.md`, `docs/teacher-map.md`, `scripts/architecture-check.mjs`.',
    '',
    '## 3. Teacher Ideas Used',
    '',
    '- OpenCode: multi-provider/provider-model separation, selectable model UX, plugin/tool surface thinking, and dense operational UI information layout.',
    '- Codex: command protocol discipline, approvals, event stream semantics, thread/goal lifecycle, sandbox mindset, app-server-style health checks, and smoke-test rigor.',
    '- Claude Code-like source: behavior-level agent loop, tool-result pairing discipline, recovery/compaction behavior, subagent/task patterns, and verifier-first workflow.',
    '- Hermes Agent: Gateway sessions, mobile-style command channels, heartbeat, background/cron work, pairing/authorization concepts, and long-running runtime concerns.',
    '- Dingxu GUI: human/visual GUI automation core behind Pando stable GUI actions.',
    '',
    '## 4. Pando-Native Design',
    '',
    '- Stable `gui_action` abstraction instead of exposing raw Dingxu `human_gui_*` tools directly to the model.',
    '- Local JSON/JSONL stores under `.pandoshare` for threads, goals, loops, gateway, acceptance, and stability evidence.',
    '- Goal as the top-level audit object linking requirements, evidence, runs, loops, gateway actions, and acceptance results.',
    '- Gateway heartbeat and LoopRuntime integration tuned for Pando long-running GUI/code work.',
    '- Rectangular compaction implemented as a provider-agnostic summary ledger, not a provider-specific compact endpoint.',
    '',
    '## 5. Test Commands And Results',
    '',
    ...renderAcceptanceEvidence(evidence),
    '',
    '## 6. Minimal Web UI',
    '',
    '- Build: `npm run web-build`.',
    '- Serve: `pando serve` or `node bin/pando.js serve`.',
    '- The server prints the local URL at startup. The UI is intentionally minimal for backend triggering, status, logs, approvals, goals, loops, gateway, GUI, MCP, settings, and acceptance controls.',
    '',
    '## 7. Gateway Usage',
    '',
    '- Doctor: `pando gateway doctor --json`.',
    '- Start short run: `pando gateway start --duration-ms 10000`.',
    '- Status: `pando gateway status --json`.',
    '- Stop: `pando gateway stop`.',
    '- Local/mobile command semantics include `/status`, `/approve`, `/deny`, `/stop`, `/background`, `/resume`, `/model`, `/loops`, `/compress`, `/goal`, and `/usage`.',
    '',
    '## 8. Loop Engineering Usage',
    '',
    '- List: `pando loop list`.',
    '- Create/run/inspect/pause/resume/stop/export are routed through `pando loop ...`.',
    '- Loops persist under `.pandoshare/loops/<loopId>/` and can use command, model, file, and custom verifiers.',
    '- Heartbeat-triggered loops can be enrolled through Gateway background commands.',
    '',
    '## 9. Goal Usage',
    '',
    '- List: `pando goal list`.',
    '- Create/inspect/status/resume/pause/block/complete/export are routed through `pando goal ...`.',
    '- Goal state persists under `.pandoshare/goals/<goalId>/` with objective, requirements, progress, evidence, runs, and checkpoints.',
    '- Completion is conservative: requirements need direct evidence before completion.',
    '',
    '## 10. Model Configuration',
    '',
    '- Config file: `pandoshare.config.json`.',
    '- Main sections: `model`, `providers`, `permissions`, `tokenBudget`, `mcpServers`, and `gateway`.',
    '- API keys should use environment variables: `DEEPSEEK_API_KEY`, `MINIMAX_CN_API_KEY`, `MINIMAX_API_KEY`, `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, or a custom provider env key.',
    '- Custom providers can set `baseURL`, `apiKeyEnv`, `model`, `protocol`, and capability metadata.',
    '',
    '## 11. GUI Automation Configuration',
    '',
    '- GUI core path: `D:/Users/Lenovo/Desktop/dingxu_agent`.',
    '- Doctor: `pando gui doctor --json`.',
    '- Real Dingxu MCP smoke: `npm run dingxu-mcp:smoke`.',
    '- Live GUI smoke is opt-in: `PANDO_GUI_LIVE_SMOKE=1 npm run gui-live:smoke`.',
    '- The model-facing action surface stays `gui_action`; backend routing can use UIA, Windows MCP, and Dingxu fallback.',
    '',
    '## 12. Remaining Limits And Next Steps',
    '',
    '- Real Telegram, Feishu/Lark, and WeCom tokens/webhooks are still external setup items; local/mock channels keep the core loop testable without them.',
    '- Long 1h/10h stability scripts exist, but the current phase avoids spending time actually running long pressure tests unless explicitly requested.',
    '- More real-world code-agent benchmark tasks are still needed before claiming world-class maturity.',
    '- GUI automation needs more real application replay suites beyond smoke tests.',
    '- Final completion still requires re-running the required acceptance profile after any further changes and reviewing every objective requirement against direct evidence.',
    '',
    '## 13. Frontend Scope Statement',
    '',
    'Current-stage Web UI work intentionally does not do frontend beautification, product-level UI redesign, marketing pages, animation, or visual polish. It only keeps the minimal functional buttons, forms, status text, logs, and controls needed to trigger and verify backend capabilities.',
    '',
  ]

  return `${lines.join('\n')}\n`
}

function renderAcceptanceSteps(summary) {
  if (!summary?.steps?.length) return ['- No acceptance summary was found.']
  return summary.steps.map(step => `- ${step.id}: ${step.status} (${step.command})`)
}

function renderAcceptanceEvidence(evidence) {
  const lines = []
  if (evidence.primary) {
    lines.push(`Primary run: ${evidence.primary.runId} (${evidence.primary.status}, ${acceptedStepText(evidence.primary)})`)
    lines.push(...renderAcceptanceSteps(evidence.primary))
  } else {
    lines.push('- No primary acceptance summary was found.')
  }

  if (evidence.supporting.length > 0) {
    lines.push('', 'Supporting runs:')
    for (const summary of evidence.supporting) {
      lines.push(`- ${summary.runId}: ${summary.status}, ${acceptedStepText(summary)}, report=${summary.reportPath}`)
      for (const step of summary.steps ?? []) lines.push(`  - ${step.id}: ${step.status} (${step.command})`)
    }
  }
  return lines
}

function renderEvidenceCoverage(evidence) {
  const summaries = [evidence.primary, ...evidence.supporting].filter(Boolean)
  const rows = [
    ['Required acceptance gates', findRunForSteps(summaries, ['typecheck', 'build', 'stability-smoke'])],
    ['Linked `pando.cmd` lifecycle', findRunWithPrefix(summaries, 'linked-pando-')],
    ['Advanced tool layer', findRunForSteps(summaries, ['task-tools-smoke', 'web-tools-smoke', 'tool-events-smoke'])],
    ['Real GUI live smoke', findRunForSteps(summaries, ['gui-live-smoke'])],
    ['Dingxu MCP integration', findRunForSteps(summaries, ['dingxu-mcp-smoke'])],
    ['Serve/Web API smoke', findRunForSteps(summaries, ['serve-smoke'])],
  ]
  return rows.map(([label, summary]) => summary
    ? `- ${label}: ${summary.runId} (${summary.status}, ${acceptedStepText(summary)})`
    : `- ${label}: not present in selected evidence`)
}

function acceptedStepText(summary) {
  const passed = summary.steps?.filter(step => step.status === 'passed').length ?? 0
  return `${passed}/${summary.selectedStepCount ?? summary.steps?.length ?? 0} steps passed`
}

function hasStep(summary, stepId) {
  return (summary.steps ?? []).some(step => step.id === stepId)
}

function hasStepPrefix(summary, prefix) {
  return (summary.steps ?? []).some(step => step.id.startsWith(prefix))
}

function hasAnyStep(summary, stepIds) {
  return stepIds.some(stepId => hasStep(summary, stepId))
}

function findRunForSteps(summaries, stepIds) {
  return summaries.find(summary => stepIds.every(stepId => hasStep(summary, stepId)))
}

function findRunWithPrefix(summaries, prefix) {
  return summaries.find(summary => hasStepPrefix(summary, prefix))
}

function parseArgs(args) {
  const parsed = {
    acceptanceRunId: undefined,
    out: undefined,
    stdout: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--acceptance-run-id') {
      parsed.acceptanceRunId = requireValue(args, index, arg)
      index += 1
    } else if (arg === '--out') {
      parsed.out = requireValue(args, index, arg)
      index += 1
    } else if (arg === '--stdout') {
      parsed.stdout = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (parsed.acceptanceRunId && !/^[A-Za-z0-9_-]+$/.test(parsed.acceptanceRunId)) {
    throw new Error('--acceptance-run-id must use ASCII letters, numbers, underscore, and hyphen')
  }
  return parsed
}

function requireValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function safeFilePart(value) {
  return basename(String(value)).replace(/[^A-Za-z0-9_-]/g, '-')
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
  }
}
