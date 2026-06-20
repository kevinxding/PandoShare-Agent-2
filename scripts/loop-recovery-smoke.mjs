#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-loop-recovery-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeCompleted(core, resolve(smokeRoot, 'completed'))
  await smokeUnsafeCheckpoint(core, resolve(smokeRoot, 'unsafe'))
  await smokeCorrupted(core, resolve(smokeRoot, 'corrupt'))
  await smokeLegacyOnly(core, resolve(smokeRoot, 'legacy'))
  await smokeRecoverWritesOnly(core, resolve(smokeRoot, 'recover'))
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('loop recovery smoke passed')

async function smokeCompleted(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await seedQueuedTask(durable, 'loop_recovery_completed', 'goal_recovery_completed', 'task_recovery_completed')
  await durable.appendEvent({ eventType: 'loop_task_completed', workspaceId: 'default', loopId: 'loop_recovery_completed', goalId: 'goal_recovery_completed', taskId: 'task_recovery_completed', payload: { taskId: 'task_recovery_completed' } })
  await durable.appendEvent({ eventType: 'loop_completed', workspaceId: 'default', loopId: 'loop_recovery_completed', goalId: 'goal_recovery_completed', payload: { reason: 'done' } })
  const decision = await new core.LoopRecovery(durable).decideLoopRecovery('loop_recovery_completed')
  assert(decision.decision === 'already_completed', `expected already_completed, got ${decision.decision}`)
}

async function smokeUnsafeCheckpoint(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await seedQueuedTask(durable, 'loop_recovery_unsafe', 'goal_recovery_unsafe', 'task_recovery_unsafe')
  await durable.appendEvent({ eventType: 'loop_attempt_completed', workspaceId: 'default', loopId: 'loop_recovery_unsafe', goalId: 'goal_recovery_unsafe', runId: 'run_recovery_unsafe', taskId: 'task_recovery_unsafe', payload: { attemptId: 'attempt_recovery_unsafe', runId: 'run_recovery_unsafe' } })
  await durable.createCheckpoint({ workspaceId: 'default', loopId: 'loop_recovery_unsafe', goalId: 'goal_recovery_unsafe', runId: 'run_recovery_unsafe', status: 'unsafe_to_replay', reason: 'unsafe smoke', summary: 'unsafe checkpoint' })
  const decision = await new core.LoopRecovery(durable).decideLoopRecovery('loop_recovery_unsafe')
  assert(decision.decision === 'requires_human', `expected requires_human, got ${decision.decision}`)
}

async function smokeCorrupted(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const ledger = core.RunLedger.fromRuntimePaths(durable.paths)
  await seedQueuedTask(durable, 'loop_recovery_corrupt', 'goal_recovery_corrupt', 'task_recovery_corrupt')
  await durable.appendEvent({ eventType: 'loop_attempt_completed', workspaceId: 'default', loopId: 'loop_recovery_corrupt', goalId: 'goal_recovery_corrupt', runId: 'run_recovery_corrupt', taskId: 'task_recovery_corrupt', payload: { attemptId: 'attempt_recovery_corrupt', runId: 'run_recovery_corrupt' } })
  await durable.appendEvent({ eventType: 'run_complete', workspaceId: 'default', runId: 'run_recovery_corrupt', payload: { status: 'completed' } })
  await durable.appendEvent({ eventType: 'run_failed', workspaceId: 'default', runId: 'run_recovery_corrupt', payload: { status: 'failed' } })
  const now = Date.now()
  await ledger.append({ runId: 'run_recovery_corrupt', workspaceId: 'default', commandId: 'cmd_recovery_corrupt', commandType: 'agent.run', source: 'test', status: 'failed', createdAtMs: now, updatedAtMs: now })
  const decision = await new core.LoopRecovery(durable).decideLoopRecovery('loop_recovery_corrupt')
  assert(decision.decision === 'mark_corrupted', `expected mark_corrupted, got ${decision.decision}`)
}

async function smokeLegacyOnly(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const projection = await new core.LoopLegacyAdapter(durable).bridgeLegacyExport('default', {
    metadata: { loopId: 'loop_recovery_legacy', status: 'running' },
    runs: [{ runId: 'legacy_run', status: 'running' }],
    iterations: [{ index: 1 }],
    events: [{ type: 'loop_run_started', data: { runId: 'legacy_run' } }],
  })
  assert(projection.iterationCount === 1, 'legacy bridge should summarize iteration count')
  const decision = await new core.LoopRecovery(durable).decideLoopRecovery('loop_recovery_legacy')
  assert(decision.decision === 'requires_legacy_bridge', `expected requires_legacy_bridge, got ${decision.decision}`)
}

async function smokeRecoverWritesOnly(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await seedQueuedTask(durable, 'loop_recovery_auto', 'goal_recovery_auto', 'task_recovery_auto')
  const recovery = new core.LoopRecovery(durable)
  const result = await recovery.recoverLoop({ loopId: 'loop_recovery_auto', autoRun: false })
  assert(result.decision.decision === 'recoverable_auto', `expected recoverable_auto, got ${result.decision.decision}`)
  assert(result.autoRun === false, 'recoverLoop should default to autoRun=false behavior')
  const events = await durable.readEvents({ loopId: 'loop_recovery_auto' })
  assert(events.some(event => event.eventType === 'loop_resumed'), 'recoverLoop should write loop_resumed')
  assert(events.some(event => event.eventType === 'loop_recovery_decided'), 'recoverLoop should write loop_recovery_decided')
  assert(!events.some(event => event.eventType === 'loop_attempt_started'), 'recoverLoop autoRun=false must not execute AgentKernel')
}

async function seedQueuedTask(durable, loopId, goalId, taskId) {
  await durable.appendEvent({ eventType: 'loop_goal_created', workspaceId: 'default', loopId, goalId, payload: { objective: 'recovery smoke' } })
  await durable.appendEvent({ eventType: 'loop_plan_created', workspaceId: 'default', loopId, goalId, payload: { planId: `plan_${loopId}` } })
  await durable.appendEvent({ eventType: 'loop_task_created', workspaceId: 'default', loopId, goalId, taskId, payload: { taskId, title: 'Recovery task' } })
  await durable.appendEvent({ eventType: 'loop_task_queued', workspaceId: 'default', loopId, goalId, taskId, payload: { taskId, title: 'Recovery task' } })
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
