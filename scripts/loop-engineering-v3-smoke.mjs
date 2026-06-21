#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/loop-engineering/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-productization-smoke', 'loop-engineering-v3')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const spec = makeSpec({ loopId: 'loop_v3_smoke', automationTrigger: 'manual' })
  const validation = core.validateLoopSpecV3(spec)
  assert(validation.ok === true, 'LoopSpecV3 should validate')

  const runtime = new core.LoopEngineeringRuntime({ workspaceRoot: smokeRoot, jsonlPath: 'events.jsonl' })
  await runtime.recordSpec(spec)
  const tick = await runtime.tick({
    spec,
    manual: true,
    nowMs: 1000,
    tasks: [
      { taskId: 'unsafe_write', title: 'Unsafe write', sideEffect: 'workspace_write' },
      { taskId: 'safe_read', title: 'Safe read', sideEffect: 'read' },
      { taskId: 'safe_second', title: 'Safe second', sideEffect: 'none' },
    ],
  })
  assert(tick.eventType === 'loop_engineering_automation_tick', 'scheduler should emit automation tick event')
  assert(tick.status === 'selected', 'manual tick should select one task')
  assert(tick.selectedTaskId === 'safe_read', 'scheduler should select first safe task only')
  assert(tick.skippedUnsafeTaskIds.includes('unsafe_write'), 'scheduler should report unsafe skipped task')

  runtime.scheduler.pause(spec.loopId)
  const paused = await runtime.tick({ spec, manual: true, nowMs: 1100, tasks: [{ taskId: 'safe_paused', title: 'Safe paused', sideEffect: 'none' }] })
  assert(paused.status === 'skipped' && paused.reason === 'loop_paused', 'paused loop should skip ticks')
  runtime.scheduler.resume(spec.loopId)

  const intervalSpec = makeSpec({ loopId: 'loop_v3_interval', automationTrigger: 'interval', automationIntervalMs: 5000 })
  const firstInterval = await runtime.tick({ spec: intervalSpec, nowMs: 2000, tasks: [{ taskId: 'interval_task', title: 'Interval task', sideEffect: 'none' }] })
  const earlyInterval = await runtime.tick({ spec: intervalSpec, nowMs: 3000, tasks: [{ taskId: 'interval_task_2', title: 'Interval task 2', sideEffect: 'none' }] })
  assert(firstInterval.status === 'selected', 'first interval tick should be due')
  assert(earlyInterval.status === 'skipped' && earlyInterval.reason === 'trigger_not_due', 'early interval tick should skip')

  const gatewaySpec = makeSpec({ loopId: 'loop_v3_gateway', automationTrigger: 'gateway' })
  const gatewayTick = await runtime.tick({ spec: gatewaySpec, nowMs: 4000, tasks: [{ taskId: 'gateway_task', title: 'Gateway task', sideEffect: 'none' }] })
  assert(gatewayTick.status === 'skipped' && gatewayTick.reason.includes('unsupported_automation_trigger'), 'gateway trigger should be explicit unsupported baseline')

  const connectorPlan = runtime.createConnectorPlan({
    spec,
    requirements: [
      { connectorId: 'mcp_read', kind: 'mcp', access: 'read', purpose: 'Inspect context', requiredCapability: 'resources.read' },
      { connectorId: 'gateway_send', kind: 'gateway', access: 'deliver', purpose: 'Send report', requiredCapability: 'message.deliver' },
    ],
  })
  assert(connectorPlan.executionAllowed === false, 'connector plan should never allow execution')
  assert(connectorPlan.risks.some(risk => risk.connectorId === 'gateway_send' && risk.requiresHumanGate), 'gateway delivery should require a human gate')

  const records = await runtime.journal.readRecords()
  assert(records.some(record => record.eventType === 'loop_engineering_spec_recorded'), 'journal should record spec')
  assert(records.filter(record => record.eventType === 'loop_engineering_automation_tick').length >= 4, 'journal should record automation ticks')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('loop engineering v3 smoke passed')

function makeSpec(overrides = {}) {
  return {
    loopId: 'loop_v3_base',
    goalId: 'goal_v3_base',
    objective: 'Exercise Loop Engineering V3 baseline.',
    successCriteria: ['scheduler records safe ticks', 'connector requirements stay plan-only'],
    verificationPlan: {
      graphId: 'graph_v3_base',
      nodes: [{ nodeId: 'mock_node', type: 'model_mock', mockOutput: 'ok', expectedContains: 'ok' }],
    },
    automationTrigger: 'manual',
    workspaceIsolation: 'none',
    subagents: [
      { agentId: 'builder_a', role: 'builder', family: 'builder-family' },
      { agentId: 'verifier_a', role: 'verifier', family: 'verifier-family' },
    ],
    skillPolicy: { enabled: true, writeCandidates: true, tags: ['smoke'] },
    connectorPolicy: { requirePlan: true, allowMcp: true, allowGateway: true, allowFile: true, allowGui: true },
    statePolicy: { journal: 'jsonl', replayReadable: true },
    budgetPolicy: { maxTicks: 10, maxVerifierNodes: 5, maxSubagents: 4 },
    humanGatePolicy: { approvalMode: 'manual', requireBeforeUnsafeConnector: true, requireOnVerifierFailure: true },
    ...overrides,
  }
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error('Refusing to use path outside workspace: ' + targetPath)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}