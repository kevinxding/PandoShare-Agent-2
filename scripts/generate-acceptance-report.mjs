#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const docsRoot = resolve(root, 'docs/kernel')
const reportPath = resolve(docsRoot, 'generated-acceptance-report.md')
const summaryPath = resolve(docsRoot, 'generated-acceptance-report.json')
const startedAtMs = Date.now()
const options = parseArgs(process.argv.slice(2))
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const scripts = packageJson.scripts ?? {}

const steps = acceptanceSteps()
const selectedSteps = options.only.length
  ? steps.filter(step => options.only.includes(step.id))
  : steps

if (!selectedSteps.length) throw new Error(`No acceptance steps matched: ${options.only.join(', ')}`)

await mkdir(docsRoot, { recursive: true })

const results = []
let failed = false

for (const [index, step] of selectedSteps.entries()) {
  const command = commandLine(step)
  console.log(`[${index + 1}/${selectedSteps.length}] ${step.id}: ${command}`)
  const result = await runStep(step)
  results.push(result)
  if (result.status !== 'passed') failed = true
  console.log(`  ${result.status} ${result.durationMs}ms`)
  if (failed && options.stopOnFailure) break
}

const finishedAtMs = Date.now()
const summary = {
  status: failed ? 'failed' : 'passed',
  startedAtMs,
  finishedAtMs,
  durationMs: finishedAtMs - startedAtMs,
  cwd: root,
  stepCount: results.length,
  passedStepCount: results.filter(result => result.status === 'passed').length,
  failedStepCount: results.filter(result => result.status !== 'passed').length,
  steps: results,
}

await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
await writeFile(reportPath, renderMarkdown(summary), 'utf8')

console.log(`acceptance report ${summary.status}: ${reportPath}`)
if (summary.status !== 'passed') process.exit(1)

function acceptanceSteps() {
  return [
    npmStep('typecheck', 'typecheck'),
    npmStep('check', 'check'),
    npmStep('reality-api-contract', 'reality:api-contract'),
    npmStep('reality-package', 'reality:package'),
    npmStep('reality-docs', 'reality:docs'),
    npmStep('reality-dist', 'reality:dist'),
    npmStep('backend-service-smoke', 'backend:service-smoke'),
    npmStep('backend-contract-smoke', 'backend:contract-smoke'),
    npmStep('tool-runtime-smoke', 'tool-runtime:smoke'),
    npmStep('code-agent-harness-smoke', 'code-agent:harness-smoke'),
    npmStep('code-agent-fixture-smoke', 'code-agent:fixture-smoke'),
    npmStep('patch-verifier-smoke', 'patch-verifier:smoke'),
    npmStep('benchmark-smoke', 'benchmark:smoke'),
    npmStep('benchmark-code-smoke', 'benchmark:code-smoke'),
    npmStep('benchmark-loop-smoke', 'benchmark:loop-smoke'),
    npmStep('benchmark-gateway-smoke', 'benchmark:gateway-smoke'),
    npmStep('benchmark-gui-smoke', 'benchmark:gui-smoke'),
    npmStep('benchmark-report-smoke', 'benchmark:report-smoke'),
    npmStep('context-runtime-smoke', 'context:runtime-smoke'),
    npmStep('context-evidence-smoke', 'context:evidence-smoke'),
    npmStep('memory-smoke', 'memory:smoke'),
    npmStep('compaction-runtime-smoke', 'compaction:runtime-smoke'),
    npmStep('context-budget-smoke', 'context:budget-smoke'),
    npmStep('worktree-smoke', 'worktree:smoke'),
    npmStep('sandbox-policy-smoke', 'sandbox:policy-smoke'),
    npmStep('permission-profile-smoke', 'permission:profile-smoke'),
    npmStep('path-policy-smoke', 'path-policy:smoke'),
    npmStep('command-policy-smoke', 'command-policy:smoke'),
    npmStep('productization-phase-smoke', 'productization:phase-smoke'),
    npmStep('loop-v3-smoke', 'loop:v3-smoke'),
    npmStep('loop-verifier-graph-smoke', 'loop:verifier-graph-smoke'),
    npmStep('loop-skill-candidate-smoke', 'loop:skill-candidate-smoke'),
    npmStep('gui-benchmark-smoke', 'gui:benchmark-smoke'),
    npmStep('gui-real-probe-smoke', 'gui:real-probe-smoke'),
    npmStep('gui-recovery-benchmark-smoke', 'gui:recovery-benchmark-smoke'),
    npmStep('daemon-foreground-smoke', 'daemon:foreground-smoke'),
    npmStep('gateway-service-smoke', 'gateway:service-smoke'),
    npmStep('gateway-webhook-smoke', 'gateway:webhook-smoke'),
    npmStep('gateway-watchdog-smoke', 'gateway:watchdog-smoke'),
    npmStep('model-probe-smoke', 'model:probe-smoke'),
    npmStep('model-probe-offline-smoke', 'model:probe-offline-smoke'),
    npmStep('model-probe-report-smoke', 'model:probe-report-smoke'),
    npmStep('model-probe-fallback-smoke', 'model:probe-fallback-smoke'),
    npmStep('replay-golden-smoke', 'replay:golden-smoke'),
    npmStep('replay-golden-diff-smoke', 'replay:golden-diff-smoke'),
    npmStep('replay-golden-report-smoke', 'replay:golden-report-smoke'),
    npmStep('replay-golden-update-dry-run', 'replay:golden-update-dry-run'),
    npmStep('productization-wave-2-smoke', 'productization:wave-2-smoke'),
    npmStep('kernel-smoke', 'kernel:smoke'),
    npmStep('durable-smoke', 'durable:smoke'),
    npmStep('durable-hardening-smoke', 'durable:hardening-smoke'),
    npmStep('loop-core-smoke', 'loop:core-smoke'),
    npmStep('loop-projection-smoke', 'loop:projection-smoke'),
    npmStep('loop-recovery-smoke', 'loop:recovery-smoke'),
    npmStep('gui-runtime-smoke', 'gui:runtime-smoke'),
    npmStep('gui-approval-smoke', 'gui:approval-smoke'),
    npmStep('gui-recovery-smoke', 'gui:recovery-smoke'),
    npmStep('gateway-core-smoke', 'gateway:core-smoke'),
    npmStep('gateway-command-smoke', 'gateway:command-smoke'),
    npmStep('gateway-delivery-smoke', 'gateway:delivery-smoke'),
    npmStep('gateway-approval-smoke', 'gateway:approval-smoke'),
    npmStep('gateway-recovery-smoke', 'gateway:recovery-smoke'),
    npmStep('model-router-smoke', 'model:router-smoke'),
    npmStep('model-capability-smoke', 'model:capability-smoke'),
    npmStep('model-fallback-smoke', 'model:fallback-smoke'),
    npmStep('model-budget-smoke', 'model:budget-smoke'),
    npmStep('model-profile-smoke', 'model:profile-smoke'),
    npmStep('replay-run-smoke', 'replay:run-smoke'),
    npmStep('replay-loop-smoke', 'replay:loop-smoke'),
    npmStep('replay-cross-core-smoke', 'replay:cross-core-smoke'),
    npmStep('replay-incident-smoke', 'replay:incident-smoke'),
    npmStep('replay-export-smoke', 'replay:export-smoke'),
    npmStep('replay-api-smoke', 'replay:api-smoke'),
    npmStep('replay-cli-smoke', 'replay:cli-smoke'),
  ]
}

function npmStep(id, scriptName) {
  if (typeof scripts[scriptName] !== 'string') {
    throw new Error(`package.json is missing script required by acceptance report: ${scriptName}`)
  }
  return {
    id,
    command: npmCommand(),
    args: ['run', scriptName],
  }
}

async function runStep(step) {
  const started = Date.now()
  const output = await spawnWithTimeout(step.command, step.args, options.timeoutMs)
  return {
    id: step.id,
    command: commandLine(step),
    status: output.timedOut ? 'timed_out' : output.exitCode === 0 ? 'passed' : 'failed',
    exitCode: output.exitCode,
    signal: output.signal,
    durationMs: Date.now() - started,
    stdoutPreview: preview(output.stdout),
    stderrPreview: preview(output.stderr),
  }
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
      terminateChild(child)
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
      resolveRun({ exitCode: 1, signal: undefined, timedOut, stdout, stderr: `${stderr}${stderr ? '\n' : ''}${errorMessage(error)}` })
    })
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({ exitCode, signal, timedOut, stdout, stderr })
    })
  })
}

function terminateChild(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    return
  }
  spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

function renderMarkdown(summary) {
  const lines = [
    '# Generated Acceptance Report',
    '',
    'This file is generated by `scripts/generate-acceptance-report.mjs`. Do not hand-edit pass/fail claims.',
    '',
    `- Status: ${summary.status}`,
    `- Started: ${new Date(summary.startedAtMs).toISOString()}`,
    `- Finished: ${new Date(summary.finishedAtMs).toISOString()}`,
    `- Duration: ${summary.durationMs}ms`,
    `- Cwd: ${summary.cwd}`,
    `- Steps: ${summary.passedStepCount}/${summary.stepCount} passed`,
    '',
    '## Steps',
    '',
    '| Step | Status | Duration | Command |',
    '| --- | --- | ---: | --- |',
  ]

  for (const step of summary.steps) {
    lines.push(`| ${step.id} | ${step.status} | ${step.durationMs}ms | \`${escapeMarkdown(step.command)}\` |`)
  }

  const failedSteps = summary.steps.filter(step => step.status !== 'passed')
  if (failedSteps.length > 0) {
    lines.push('', '## Failed Output Preview', '')
    for (const step of failedSteps) {
      lines.push(`### ${step.id}`, '')
      if (step.stderrPreview) lines.push('stderr:', '', '```text', step.stderrPreview, '```', '')
      if (step.stdoutPreview) lines.push('stdout:', '', '```text', step.stdoutPreview, '```', '')
    }
  }

  return `${lines.join('\n')}\n`
}

function parseArgs(args) {
  const parsed = {
    only: [],
    stopOnFailure: false,
    timeoutMs: 180_000,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--only') {
      parsed.only = requiredValue(args, index, arg).split(',').map(item => item.trim()).filter(Boolean)
      index += 1
    } else if (arg === '--stop-on-failure') {
      parsed.stopOnFailure = true
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number(requiredValue(args, index, arg))
      index += 1
    } else if (arg === '--profile') {
      const profile = requiredValue(args, index, arg)
      if (profile !== 'full') throw new Error(`Unsupported acceptance report profile: ${profile}`)
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 1000) {
    throw new Error(`Invalid --timeout-ms: ${parsed.timeoutMs}`)
  }
  return parsed
}

function commandLine(step) {
  return [step.command, ...step.args].map(quoteArg).join(' ')
}

function spawnSpec(command, args) {
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] }
  }
  return { command, args }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function preview(value) {
  const trimmed = value.trim()
  if (trimmed.length <= 2000) return trimmed
  return trimmed.slice(-2000)
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, '\\|').replace(/`/g, '\\`')
}

function requiredValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing path outside workspace: ${targetPath}`)
  }
}

assertInside(root, reportPath)
assertInside(root, summaryPath)

