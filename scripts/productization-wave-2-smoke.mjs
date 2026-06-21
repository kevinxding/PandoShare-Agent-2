#!/usr/bin/env node
import { mkdir, rm, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-productization-wave-2-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeLoopEngineering(resolve(smokeRoot, 'loop'))
  await smokeGuiBenchmark(resolve(smokeRoot, 'gui'))
  await smokeGatewayService(resolve(smokeRoot, 'gateway'))
  await smokeModelProbe(resolve(smokeRoot, 'model'))
  await smokeGoldenTrace()
  await assertReports()
  console.log('productization wave 2 smoke passed')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

async function smokeLoopEngineering(workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const runtime = new core.LoopEngineeringRuntime({ workspaceRoot, jsonlPath: 'loop-engineering.jsonl' })
  const spec = makeSpec()
  const validation = core.validateLoopSpecV3(spec)
  assert(validation.ok === true, 'LoopEngineeringRuntime should validate LoopSpecV3')
  await runtime.recordSpec(spec)
  const tick = await runtime.tick({ spec, manual: true, nowMs: 1000, tasks: [{ taskId: 'safe_task', title: 'Safe task', sideEffect: 'none' }] })
  assert(tick.status === 'selected', 'LoopEngineeringRuntime should select one safe task')
}

async function smokeGuiBenchmark(workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const run = await new core.GuiBenchmarkRunner({
    workspaceRoot,
    manifestPath: resolve(root, 'benchmarks/gui-real/gui-benchmark-manifest.json'),
    outputDir: resolve(workspaceRoot, 'report'),
    runId: 'wave_2_gui_benchmark',
    ids: ['mock-click'],
  }).run()
  assert(run.status === 'passed', 'GuiBenchmarkRunner should pass mock benchmark')
  assert(run.successRate === 1, 'GuiBenchmarkRunner mock success rate should be 1')
}

async function smokeGatewayService(workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const runtime = new core.GatewayServiceRuntime({ workspaceRoot, workspaceId: 'default', runtimeId: 'wave-2-gateway', maxTicks: 1, intervalMs: 0 })
  const output = await runtime.run({ maxTicks: 1, intervalMs: 0 })
  assert(output.ticks.length === 1, 'GatewayServiceRuntime should perform one foreground tick')
  assert(output.health.daemon.status === 'stopped', 'GatewayServiceRuntime should stop cleanly after bounded run')
}

async function smokeModelProbe(workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const run = await new core.ModelProbeRunner({ workspaceRoot, workspaceId: 'wave-2-model', outputDir: resolve(workspaceRoot, 'report'), config: modelConfig() }).run()
  assert(run.providers.length >= 2, 'ModelProbeRunner should list offline providers')
  assert(run.results.some(result => result.type === 'online_minimal' && result.status === 'skipped'), 'online probe should skip by default')
}

async function smokeGoldenTrace() {
  const traces = await core.loadAllGoldenTraces(core.defaultGoldenTraceRoot(root))
  assert(traces.length >= 6, 'GoldenTraceValidator should load at least six traces')
  const result = core.validateGoldenTrace(traces[0])
  assert(result.ok === true, 'GoldenTraceValidator should validate at least one golden trace')
}

async function assertReports() {
  const reports = [
    'docs/delegation/wave-2-subagent-a-loop-v3-report.md',
    'docs/delegation/wave-2-subagent-b-gui-benchmark-report.md',
    'docs/delegation/wave-2-subagent-c-gateway-daemon-report.md',
    'docs/delegation/wave-2-subagent-d-model-probes-report.md',
    'docs/delegation/wave-2-subagent-e-replay-golden-report.md',
  ]
  for (const report of reports) assert(await exists(resolve(root, report)), 'missing Wave 2 report: ' + report)
}

function makeSpec() {
  return {
    loopId: 'wave_2_loop',
    goalId: 'wave_2_goal',
    objective: 'Validate Wave 2 loop engineering baseline.',
    successCriteria: ['spec validates', 'one safe task can be selected'],
    verificationPlan: { graphId: 'wave_2_graph', nodes: [{ nodeId: 'mock_node', type: 'model_mock', mockOutput: 'ok', expectedContains: 'ok' }] },
    automationTrigger: 'manual',
    workspaceIsolation: 'none',
    subagents: [
      { agentId: 'builder', role: 'builder', family: 'builder-family' },
      { agentId: 'verifier', role: 'verifier', family: 'verifier-family' },
    ],
    skillPolicy: { enabled: true, writeCandidates: true, tags: ['wave-2'] },
    connectorPolicy: { requirePlan: true, allowMcp: true, allowGateway: true, allowFile: true, allowGui: true },
    statePolicy: { journal: 'jsonl', replayReadable: true },
    budgetPolicy: { maxTicks: 3, maxVerifierNodes: 3, maxSubagents: 3 },
    humanGatePolicy: { approvalMode: 'manual', requireBeforeUnsafeConnector: true, requireOnVerifierFailure: true },
  }
}

function modelConfig() {
  return {
    model: { provider: 'wave-2-a', name: 'wave-2-a-model' },
    providers: {
      'wave-2-a': modelProvider('Wave 2 A', 'wave-2-a-model'),
      'wave-2-b': modelProvider('Wave 2 B', 'wave-2-b-model'),
    },
  }
}

function modelProvider(name, model) {
  return {
    name,
    baseURL: 'https://example.invalid/v1',
    model,
    protocol: 'openai-chat-completions',
    auth: { type: 'none' },
    capabilities: { tools: true, reasoning: true, contextWindowTokens: 64000 },
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error('Refusing to use path outside workspace: ' + targetPath)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
