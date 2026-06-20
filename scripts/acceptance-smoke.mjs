#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const startedAtMs = Date.now()
const options = parseArgs(process.argv.slice(2))
const runId = options.runId ?? `acceptance_${startedAtMs}_${shortId()}`
const evidenceRoot = resolve(root, '.pandoshare/acceptance', runId)
const logsRoot = resolve(evidenceRoot, 'logs')
const summaryPath = resolve(evidenceRoot, 'summary.json')
const reportPath = resolve(evidenceRoot, 'report.md')
const ledgerPath = resolve(evidenceRoot, 'ledger.jsonl')

assertInside(root, evidenceRoot)
await mkdir(logsRoot, { recursive: true })

const allSteps = stepsForProfile(options.profile)
const selectedSteps = options.only.size > 0
  ? allSteps.filter(step => options.only.has(step.id))
  : allSteps

if (options.list) {
  for (const step of allSteps) {
    console.log(`${step.id}\t${commandLine(step)}`)
  }
  process.exit(0)
}

if (selectedSteps.length === 0) {
  throw new Error(`No acceptance steps matched: ${Array.from(options.only).join(', ')}`)
}

const summary = {
  runId,
  profile: options.profile,
  status: options.dryRun ? 'dry_run' : 'running',
  startedAtMs,
  finishedAtMs: undefined,
  cwd: root,
  evidenceRoot,
  dryRun: options.dryRun,
  timeoutMs: options.timeoutMs,
  selectedStepCount: selectedSteps.length,
  totalStepCount: allSteps.length,
  steps: [],
}

await appendLedger('run_started', {
  runId,
  profile: options.profile,
  dryRun: options.dryRun,
  selectedStepCount: selectedSteps.length,
})

try {
  if (options.dryRun) {
    for (const [index, step] of selectedSteps.entries()) {
      summary.steps.push({
        id: step.id,
        command: commandLine(step),
        status: 'skipped',
        durationMs: 0,
        stdoutPath: undefined,
        stderrPath: undefined,
      })
      await appendLedger('step_planned', { index: index + 1, id: step.id, command: commandLine(step) })
    }
  } else {
    for (const [index, step] of selectedSteps.entries()) {
      console.log(`[${index + 1}/${selectedSteps.length}] ${step.id}: ${commandLine(step)}`)
      const result = await runStep(step, index + 1)
      summary.steps.push(result)
      const marker = result.status === 'passed' ? 'ok' : 'failed'
      console.log(`  ${marker} ${result.durationMs}ms`)
    }
    summary.status = summary.steps.every(step => step.status === 'passed') ? 'passed' : 'failed'
  }
} catch (error) {
  summary.status = 'failed'
  summary.steps.push({
    id: 'acceptance_runner',
    command: 'node scripts/acceptance-smoke.mjs',
    status: 'failed',
    durationMs: 0,
    error: errorMessage(error),
  })
  await appendLedger('run_failed', { error: errorMessage(error) })
} finally {
  summary.finishedAtMs = Date.now()
  await writeSummaryAndReport(summary)
}

console.log(`acceptance ${summary.status}: ${summaryPath}`)
console.log(`report: ${reportPath}`)

if (summary.status === 'failed') {
  process.exitCode = 1
}

function stepsForProfile(profile) {
  const required = [
    npmStep('typecheck', ['run', 'typecheck']),
    npmStep('build', ['run', 'build']),
    npmStep('check', ['run', 'check']),
    npmStep('web-build', ['run', 'web-build']),
    npmStep('cli-entry-smoke', ['run', 'cli-entry:smoke']),
    npmStep('doctor-smoke', ['run', 'doctor:smoke']),
    npmStep('model-smoke', ['run', 'model-smoke']),
    npmStep('mcp-client-smoke', ['run', 'mcp-client:smoke']),
    npmStep('gui-tool-smoke', ['run', 'gui-tool:smoke']),
    npmStep('gateway-smoke', ['run', 'gateway:smoke']),
    npmStep('loop-runtime-smoke', ['run', 'loop-runtime:smoke']),
    npmStep('harness-smoke', ['run', 'harness:smoke']),
    npmStep('thread-store-smoke', ['run', 'thread-store:smoke']),
    npmStep('thread-commands-smoke', ['run', 'thread-commands:smoke']),
    npmStep('compact-smoke', ['run', 'compact:smoke']),
    npmStep('events-smoke', ['run', 'events:smoke']),
    npmStep('permissions-smoke', ['run', 'permissions:smoke']),
    npmStep('approval-web-smoke', ['run', 'approval-web:smoke']),
    npmStep('goal-store-smoke', ['run', 'goal-store:smoke']),
    npmStep('stability-smoke', ['run', 'stability:smoke']),
  ]

  if (profile === 'required') return required

  return [
    ...required,
    npmStep('web-build-smoke', ['run', 'web-build:smoke']),
    npmStep('serve-smoke', ['run', 'serve:smoke']),
    npmStep('dingxu-mcp-smoke', ['run', 'dingxu-mcp:smoke']),
    npmStep('gui-live-smoke', ['run', 'gui-live:smoke']),
    npmStep('tools-smoke', ['run', 'tools:smoke']),
    npmStep('context-builder-smoke', ['run', 'context-builder:smoke']),
    npmStep('tool-result-storage-smoke', ['run', 'tool-result-storage:smoke']),
    npmStep('token-budget-smoke', ['run', 'token-budget:smoke']),
    npmStep('terminal-approval-smoke', ['run', 'terminal-approval:smoke']),
    npmStep('task-tools-smoke', ['run', 'task-tools:smoke']),
    npmStep('web-tools-smoke', ['run', 'web-tools:smoke']),
    npmStep('lsp-tool-smoke', ['run', 'lsp-tool:smoke']),
    npmStep('skill-tool-smoke', ['run', 'skill-tool:smoke']),
    npmStep('mcp-resource-tools-smoke', ['run', 'mcp-resource-tools:smoke']),
    npmStep('ask-user-tool-smoke', ['run', 'ask-user-tool:smoke']),
    npmStep('schedule-tools-smoke', ['run', 'schedule-tools:smoke']),
    npmStep('notebook-tool-smoke', ['run', 'notebook-tool:smoke']),
    npmStep('tool-permissions-smoke', ['run', 'tool-permissions:smoke']),
    npmStep('tool-events-smoke', ['run', 'tool-events:smoke']),
    nodeStep('bin-version', ['bin/pando.js', '--version']),
    nodeStep('bin-help', ['bin/pando.js', '--help']),
    pandoStep('linked-pando-version', ['--version']),
    pandoStep('linked-pando-help', ['--help']),
    pandoStep('linked-pando-doctor', ['doctor', '--json']),
    pandoStep('linked-pando-gui-doctor', ['gui', 'doctor', '--json']),
    pandoStep('linked-pando-mcp-doctor', ['mcp', 'doctor', '--json']),
    pandoStep('linked-pando-gateway-doctor', ['gateway', 'doctor', '--json']),
    pandoStep('linked-pando-gateway-status', ['gateway', 'status', '--json']),
    pandoStep('linked-pando-gateway-start-short', ['gateway', 'start', '--json', '--duration-ms', '200', '--heartbeat-interval-ms', '50']),
    pandoStep('linked-pando-thread-list', ['thread', 'list', '--limit', '3']),
    pandoStep('linked-pando-loop-list', ['loop', 'list']),
    pandoStep('linked-pando-goal-list', ['goal', 'list']),
  ]
}

function npmStep(id, args) {
  return { id, command: npmCommand(), args }
}

function nodeStep(id, args) {
  return { id, command: process.execPath, args }
}

function pandoStep(id, args) {
  return { id, command: process.platform === 'win32' ? 'pando.cmd' : 'pando', args }
}

async function runStep(step, index) {
  const started = Date.now()
  const logBase = `${String(index).padStart(2, '0')}-${safeFilePart(step.id)}`
  const stdoutPath = resolve(logsRoot, `${logBase}.stdout.txt`)
  const stderrPath = resolve(logsRoot, `${logBase}.stderr.txt`)
  assertInside(root, stdoutPath)
  assertInside(root, stderrPath)

  await appendLedger('step_started', { id: step.id, command: commandLine(step) })
  const output = await spawnWithTimeout(step.command, step.args, options.timeoutMs)
  await writeFile(stdoutPath, output.stdout, 'utf8')
  await writeFile(stderrPath, output.stderr, 'utf8')

  const durationMs = Date.now() - started
  const result = {
    id: step.id,
    command: commandLine(step),
    status: output.timedOut ? 'timed_out' : output.exitCode === 0 ? 'passed' : 'failed',
    exitCode: output.exitCode,
    signal: output.signal,
    durationMs,
    stdoutPath,
    stderrPath,
    stdoutPreview: preview(output.stdout),
    stderrPreview: preview(output.stderr),
  }
  await appendLedger('step_finished', {
    id: step.id,
    status: result.status,
    exitCode: result.exitCode,
    durationMs,
  })
  return result
}

function spawnWithTimeout(command, args, timeoutMs) {
  return new Promise(resolveRun => {
    const spec = spawnSpec(command, args)
    const child = spawn(spec.command, spec.args, {
      cwd: root,
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      void terminateChildTree(child)
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({
        exitCode: 1,
        signal: undefined,
        timedOut,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${errorMessage(error)}`,
      })
    })
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({ exitCode, signal, timedOut, stdout, stderr })
    })
  })
}

function spawnSpec(command, args) {
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    }
  }
  return { command, args }
}

function terminateChildTree(child) {
  if (!child.pid || child.exitCode !== null) return Promise.resolve()
  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    return Promise.resolve()
  }
  return new Promise(resolveKill => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('close', () => resolveKill())
    killer.on('error', () => {
      child.kill()
      resolveKill()
    })
  })
}

async function writeSummaryAndReport(currentSummary) {
  await writeFile(summaryPath, JSON.stringify(currentSummary, null, 2), 'utf8')
  await writeFile(reportPath, renderReport(currentSummary), 'utf8')
}

function renderReport(currentSummary) {
  const lines = [
    '# Pando Acceptance Smoke Report',
    '',
    `- Run ID: ${currentSummary.runId}`,
    `- Profile: ${currentSummary.profile}`,
    `- Status: ${currentSummary.status}`,
    `- Started: ${new Date(currentSummary.startedAtMs).toISOString()}`,
    `- Finished: ${new Date(currentSummary.finishedAtMs).toISOString()}`,
    `- Evidence root: ${currentSummary.evidenceRoot}`,
    '',
    '## Steps',
    '',
    '| Step | Status | Duration | Command |',
    '| --- | --- | ---: | --- |',
  ]

  for (const step of currentSummary.steps) {
    lines.push(`| ${step.id} | ${step.status} | ${step.durationMs ?? 0}ms | \`${escapeMarkdown(step.command)}\` |`)
  }

  const failed = currentSummary.steps.filter(step => step.status !== 'passed' && step.status !== 'skipped')
  if (failed.length > 0) {
    lines.push('', '## Failures', '')
    for (const step of failed) {
      lines.push(`### ${step.id}`)
      if (step.error) lines.push('', step.error, '')
      if (step.stderrPreview) lines.push('', '```text', step.stderrPreview, '```', '')
      if (step.stdoutPreview) lines.push('', '```text', step.stdoutPreview, '```', '')
    }
  }

  lines.push('', '## Logs', '')
  for (const step of currentSummary.steps) {
    if (!step.stdoutPath && !step.stderrPath) continue
    lines.push(`- ${step.id}: stdout=${step.stdoutPath ?? 'none'} stderr=${step.stderrPath ?? 'none'}`)
  }

  return `${lines.join('\n')}\n`
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    list: false,
    only: new Set(),
    profile: 'required',
    runId: undefined,
    timeoutMs: 180_000,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--list') {
      parsed.list = true
    } else if (arg === '--profile') {
      parsed.profile = requireValue(args, index, arg)
      index += 1
    } else if (arg === '--only') {
      for (const item of requireValue(args, index, arg).split(',')) {
        if (item.trim()) parsed.only.add(item.trim())
      }
      index += 1
    } else if (arg === '--run-id') {
      parsed.runId = requireValue(args, index, arg)
      index += 1
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number(requireValue(args, index, arg))
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!['required', 'full'].includes(parsed.profile)) {
    throw new Error(`Unsupported profile: ${parsed.profile}`)
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 1_000) {
    throw new Error(`Invalid --timeout-ms value: ${parsed.timeoutMs}`)
  }
  if (parsed.runId && !/^[A-Za-z0-9_-]+$/.test(parsed.runId)) {
    throw new Error('--run-id must use only ASCII letters, numbers, underscore, and hyphen')
  }
  return parsed
}

function requireValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function commandLine(step) {
  return [step.command, ...step.args].map(quoteArg).join(' ')
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function safeFilePart(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-')
}

function preview(value) {
  const trimmed = value.trim()
  if (trimmed.length <= 4000) return trimmed
  return trimmed.slice(-4000)
}

function shortId() {
  return Math.random().toString(36).slice(2, 8)
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, '\\|').replace(/`/g, '\\`')
}

async function appendLedger(type, payload) {
  await writeFile(
    ledgerPath,
    `${JSON.stringify({ type, atMs: Date.now(), ...payload })}\n`,
    { encoding: 'utf8', flag: 'a' },
  )
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
