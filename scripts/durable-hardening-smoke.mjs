#!/usr/bin/env node
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const scriptPath = fileURLToPath(import.meta.url)

if (process.argv[2] === '--child-append') {
  await childAppend(process.argv[3], Number(process.argv[4]), process.argv[5])
  process.exit(0)
}

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-durable-hardening-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeCrossProcessSeq(resolve(smokeRoot, 'cross-process'))
  await smokeSeqCorruptionAndRepair(resolve(smokeRoot, 'seq-repair'))
  await smokeJsonlCorruption(resolve(smokeRoot, 'jsonl-corruption'))
  await smokeRunLedger(resolve(smokeRoot, 'run-ledger'))
  await smokeSideEffectsAndRecovery(resolve(smokeRoot, 'side-effects'))
  await smokeMaintenanceReport(resolve(smokeRoot, 'maintenance'))
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('durable hardening smoke passed')

async function smokeCrossProcessSeq(workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  await Promise.all([
    runChild(workspaceRoot, 100, 'a'),
    runChild(workspaceRoot, 100, 'b'),
  ])
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const events = await durable.readRunEvents('run_cross_process_seq')
  const seqs = events.map(event => event.seq).sort((left, right) => left - right)
  assert(seqs.length === 200, `expected 200 events, got ${seqs.length}`)
  for (let index = 0; index < 200; index += 1) {
    assert(seqs[index] === index + 1, `expected seq ${index + 1}, got ${seqs[index]}`)
  }
}

async function smokeSeqCorruptionAndRepair(workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await durable.appendEvent({
    eventType: 'run_start',
    workspaceId: 'default',
    runId: 'run_seq_repair',
    payload: { ok: true },
  })
  await writeFile(durable.paths.eventSeqPath(), '{bad json', 'utf8')
  let failed = false
  try {
    await durable.appendEvent({
      eventType: 'run_running',
      workspaceId: 'default',
      runId: 'run_seq_repair',
      payload: { ok: true },
    })
  } catch {
    failed = true
  }
  assert(failed, 'corrupt seq state should fail append instead of resetting')
  await durable.repairSeqFromEventsForMaintenance()
  const repaired = await durable.appendEvent({
    eventType: 'run_running',
    workspaceId: 'default',
    runId: 'run_seq_repair',
    payload: { ok: true },
  })
  assert(repaired.seq === 2, `repair should continue at seq 2, got ${repaired.seq}`)
}

async function smokeJsonlCorruption(workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await durable.appendEvent({
    eventType: 'run_start',
    workspaceId: 'default',
    runId: 'run_jsonl_corrupt',
    payload: { ok: true },
  })
  await appendFile(durable.paths.eventsPath(), '{bad json\n', 'utf8')
  const read = await durable.eventStore.readWithCorruption()
  assert(read.corruptRecords.length === 1, 'readWithCorruption should report bad jsonl line')
  const audit = await durable.auditRun('run_jsonl_corrupt')
  assert(audit.warnings.some(warning => warning.includes('jsonl corruption')), 'audit should include jsonl corruption warning')
}

async function smokeRunLedger(workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const now = Date.now()
  await durable.appendRunLedger({
    runId: 'run_ledger_active',
    workspaceId: 'default',
    commandId: 'cmd_ledger_active',
    commandType: 'agent.run',
    source: 'test',
    status: 'running',
    createdAtMs: now,
    updatedAtMs: now,
  })
  await durable.appendRunLedger({
    runId: 'run_ledger_done',
    workspaceId: 'default',
    commandId: 'cmd_ledger_done',
    commandType: 'agent.run',
    source: 'test',
    status: 'completed',
    createdAtMs: now,
    updatedAtMs: now + 1,
  })
  const active = await durable.readActiveRuns()
  const recent = await durable.readRecentRuns(2)
  assert(active.some(run => run.runId === 'run_ledger_active'), 'DurableRuntime should read active runs')
  assert(recent.length === 2, 'DurableRuntime should read recent runs')
}

async function smokeSideEffectsAndRecovery(workspaceRoot) {
  const classifier = new core.SideEffectClassifier()
  assert(classifier.classify({ source: 'shell', command: 'git push origin main' }).effectType === 'shell_write', 'git push should be shell_write')
  assert(classifier.classify({ source: 'gui', action: 'click' }).effectType === 'gui_write', 'click should be gui_write')
  assert(classifier.classify({ source: 'gateway', action: 'outbound' }).effectType === 'gateway_outbound', 'gateway outbound should classify')
  assert(classifier.classify({ toolName: 'list_files' }).effectType === 'readonly_tool', 'readonly tool should classify')

  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await durable.appendEvent({
    eventType: 'run_failed',
    workspaceId: 'default',
    runId: 'run_unsafe_effect',
    payload: { status: 'failed' },
  })
  await durable.appendRunLedger({
    runId: 'run_unsafe_effect',
    workspaceId: 'default',
    commandId: 'cmd_unsafe_effect',
    commandType: 'agent.run',
    source: 'test',
    status: 'failed',
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  })
  const checkpoint = await durable.createCheckpoint({
    workspaceId: 'default',
    runId: 'run_unsafe_effect',
    status: 'safe_to_replay',
    summary: 'unsafe effect checkpoint',
    effectHints: [
      { source: 'gateway', action: 'outbound', summary: 'send message' },
    ],
  })
  assert(checkpoint.status !== 'safe_to_replay', 'unsafe effect should downgrade safe checkpoint')
  assert(checkpoint.pendingExternalEffects.length === 1, 'unsafe effect should become pending external effect')
  const decision = await durable.decideRecovery({ runId: 'run_unsafe_effect' })
  assert(decision.decision === 'requires_human', `expected requires_human, got ${decision.decision}`)
}

async function smokeMaintenanceReport(workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await durable.appendEvent({
    eventType: 'run_start',
    workspaceId: 'default',
    runId: 'run_maintenance',
    payload: { ok: true },
  })
  await appendFile(durable.paths.eventsPath(), '{bad json\n', 'utf8')
  await durable.writeHeartbeat({
    workspaceId: 'default',
    workerId: 'worker_stale',
    workerType: 'agent',
    status: 'running',
    lastHeartbeatAtMs: 1000,
  })
  const report = await durable.createMaintenanceReport({ nowMs: 10_000, heartbeatTtlMs: 100 })
  assert(report.corruptRecordCount >= 1, 'maintenance report should include corrupt record count')
  assert(report.staleHeartbeats.some(heartbeat => heartbeat.workerId === 'worker_stale'), 'maintenance report should include stale heartbeat')
}

async function childAppend(workspaceRoot, count, label) {
  const childCore = await import('../dist/src/core/index.js')
  const durable = new childCore.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  for (let index = 0; index < count; index += 1) {
    await durable.appendEvent({
      eventType: 'model_response',
      workspaceId: 'default',
      runId: 'run_cross_process_seq',
      payload: { label, index },
    })
  }
}

function runChild(workspaceRoot, count, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, '--child-append', workspaceRoot, String(count), label], {
      cwd: dirname(scriptPath),
      windowsHide: true,
    })
    let stderr = ''
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', rejectPromise)
    child.on('close', code => {
      if (code === 0) resolvePromise(undefined)
      else rejectPromise(new Error(`child ${label} exited ${code}: ${stderr}`))
    })
  })
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
