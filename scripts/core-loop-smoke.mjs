#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-core-loop-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeCoreLoopV2(core, smokeRoot)
  await smokeCommandHandler(core, resolve(smokeRoot, 'commands'))
  await smokeRunGoalCompatibility(core, resolve(smokeRoot, 'compat'))
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('core loop smoke passed')

async function smokeCoreLoopV2(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  let submitCount = 0
  const agent = {
    async submitRun(command) {
      submitCount += 1
      assert(command.commandType === 'agent.run', 'AttemptRunner must use AgentKernel.submitRun command')
      assert(command.loopId === 'loop_core_smoke', 'agent command should carry loopId')
      assert(command.goalId === 'goal_core_smoke', 'agent command should carry goalId')
      return {
        runId: 'run_core_loop_smoke',
        finalText: 'core loop task completed',
        output: { finalText: 'core loop task completed', toolResults: [] },
        coreEvents: [],
        checkpointId: 'checkpoint_from_agent',
      }
    },
    async recordCoreEvent(input) {
      return durable.appendEvent(input)
    },
  }
  const runtime = new core.LoopRuntime({ workspaceRoot, workspaceId: 'default', agentKernel: agent })
  const created = await runtime.createLoop({
    loopId: 'loop_core_smoke',
    goalId: 'goal_core_smoke',
    objective: 'Complete one core loop task.',
    task: { verifier: { type: 'custom', name: 'core_loop_smoke' } },
    source: 'test',
  })
  assert(created.state.status === 'planned', `expected planned after createLoop, got ${created.state.status}`)
  const createEvents = await durable.readEvents({ loopId: 'loop_core_smoke' })
  assert(createEvents.some(event => event.eventType === 'loop_goal_created'), 'createLoop should write loop_goal_created')
  assert(createEvents.some(event => event.eventType === 'loop_plan_created'), 'createLoop should write loop_plan_created')
  assert(createEvents.some(event => event.eventType === 'loop_task_created'), 'createLoop should write loop_task_created')
  assert(createEvents.some(event => event.eventType === 'loop_task_queued'), 'createLoop should write loop_task_queued')

  const result = await runtime.runNext('loop_core_smoke')
  assert('attempt' in result, `runNext should execute one attempt, got decision ${result.decision.type}`)
  assert(submitCount === 1, `runNext should execute exactly one attempt, got ${submitCount}`)
  assert(result.attempt.runId === 'run_core_loop_smoke', 'attempt should carry AgentKernel runId')
  assert(result.attempt.checkpointId, 'runNext should attach loop checkpoint')

  const events = await durable.readEvents({ loopId: 'loop_core_smoke' })
  for (const type of [
    'loop_task_started',
    'loop_attempt_started',
    'loop_attempt_completed',
    'loop_verification_started',
    'loop_verification_completed',
    'loop_checkpoint_created',
    'loop_task_completed',
    'loop_completed',
  ]) {
    assert(events.some(event => event.eventType === type), `missing ${type}`)
  }
  const checkpoints = await durable.readCheckpoints({ runId: 'run_core_loop_smoke' })
  assert(checkpoints.length === 1, `expected one loop checkpoint, got ${checkpoints.length}`)
  const projected = await runtime.status('loop_core_smoke')
  assert(projected.status === 'completed', `expected projected completed, got ${projected.status}`)
  const replayMarkdown = await new core.ReplayReader(durable).buildLoopReplayMarkdown('loop_core_smoke')
  assert(replayMarkdown.includes('## Loop Projection'), 'loop replay markdown should include projection summary')
}


async function smokeCommandHandler(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const agent = {
    async submitRun() {
      throw new Error('approval command smoke must not execute AgentKernel')
    },
    async recordCoreEvent(input) {
      return durable.appendEvent(input)
    },
  }
  const runtime = new core.LoopRuntime({ workspaceRoot, workspaceId: 'default', agentKernel: agent })
  const handler = new core.LoopCommandHandler(runtime)
  await handler.handle(core.createCommandEnvelope({
    commandType: 'loop.create',
    workspaceId: 'default',
    loopId: 'loop_command_smoke',
    goalId: 'goal_command_smoke',
    source: 'test',
    payload: {
      objective: 'Wait for approval.',
    },
  }))
  const created = await runtime.createLoop({
    loopId: 'loop_approval_smoke',
    goalId: 'goal_approval_smoke',
    objective: 'Approval task.',
    task: { requiresApproval: true },
    source: 'test',
  })
  const wait = await runtime.runNext(created.identity.loopId)
  assert(wait.decision.type === 'wait_human', `expected wait_human, got ${wait.decision.type}`)
  await handler.handle(core.createCommandEnvelope({
    commandType: 'loop.approve',
    workspaceId: 'default',
    loopId: created.identity.loopId,
    goalId: created.identity.goalId,
    source: 'test',
    payload: { gateId: wait.gateId, reason: 'approved in smoke' },
  }))
  let events = await durable.readEvents({ loopId: created.identity.loopId })
  assert(events.some(event => event.eventType === 'loop_human_gate_resolved'), 'loop.approve should resolve human gate')
  await handler.handle(core.createCommandEnvelope({
    commandType: 'loop.pause',
    workspaceId: 'default',
    loopId: 'loop_command_smoke',
    source: 'test',
    payload: { reason: 'pause smoke' },
  }))
  await handler.handle(core.createCommandEnvelope({
    commandType: 'loop.stop',
    workspaceId: 'default',
    loopId: 'loop_command_smoke',
    source: 'test',
    payload: { reason: 'stop smoke' },
  }))
  events = await durable.readEvents({ loopId: 'loop_command_smoke' })
  assert(events.filter(event => event.eventType === 'loop_blocked').length >= 1, 'pause/stop should write loop_blocked events')
}

async function smokeRunGoalCompatibility(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const agent = {
    async submitRun() {
      return {
        runId: 'run_goal_compat_smoke',
        finalText: 'compat ok',
        output: { finalText: 'compat ok', toolResults: [] },
        coreEvents: [],
        checkpointId: 'checkpoint_from_agent',
      }
    },
    async recordCoreEvent(input) {
      return durable.appendEvent(input)
    },
  }
  const runtime = new core.LoopRuntime({ workspaceRoot, workspaceId: 'default', agentKernel: agent })
  const result = await runtime.runGoal({
    objective: 'Compatibility path should still run one task.',
    task: { verifier: { type: 'custom', name: 'compat_smoke' } },
  })
  assert(result.goal.status === 'completed', `expected completed goal, got ${result.goal.status}`)
  assert(result.attempt.status === 'completed', `expected completed attempt, got ${result.attempt.status}`)
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
