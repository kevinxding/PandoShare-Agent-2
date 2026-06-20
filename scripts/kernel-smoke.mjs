#!/usr/bin/env node
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-kernel-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeProtocol(core)
  await smokeRunStateMachine(core)
  await smokeStoreAndDurable(core, smokeRoot)
  await smokeAgentKernelSubmitRun(core, resolve(smokeRoot, 'agent-submit'))
  await smokeAgentKernelFailureCheckpoint(core, resolve(smokeRoot, 'agent-failed'))
  await smokeAgentKernelInterruptedCheckpoint(core, resolve(smokeRoot, 'agent-interrupted'))
  await smokeLoopRuntime(core, smokeRoot)
  await smokeGuiRuntime(core, smokeRoot)
  await smokeGatewayRouter(core)
  await smokeModelRouter(core)
  await smokeReplay(core, smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('kernel smoke passed')

async function smokeProtocol(core) {
  const command = core.createCommandEnvelope({
    commandType: 'agent.run',
    workspaceId: 'default',
    source: 'test',
    payload: { prompt: 'hello' },
  })
  assert(core.isCommandEnvelope(command), 'command envelope should validate')
  const event = core.createEventEnvelope({
    eventType: 'run_start',
    workspaceId: 'default',
    payload: { ok: true },
  })
  assert(core.isEventEnvelope(event), 'event envelope should validate')
  assert(event.seq > 0, 'event seq should be positive')
}

async function smokeRunStateMachine(core) {
  const events = []
  const stateMachine = new core.RunStateMachine(event => events.push(event))
  const command = core.createCommandEnvelope({
    commandType: 'agent.run',
    workspaceId: 'default',
    threadId: 'thread_smoke',
    runId: 'run_state_smoke',
    source: 'test',
    payload: { prompt: 'state smoke' },
  })
  const started = await stateMachine.startRun(command)
  assert(started.status === 'running', `expected running, got ${started.status}`)
  const completed = await stateMachine.completeRun(started.runId)
  assert(completed.status === 'completed', `expected completed, got ${completed.status}`)
  assert(events.some(event => event.eventType === 'run_start'), 'state machine should emit run_start')
  assert(events.some(event => event.eventType === 'run_running'), 'state machine should emit run_running')
  assert(events.filter(event => event.eventType === 'run_start' && event.runId === started.runId).length === 1, 'running must not emit duplicate run_start')
  assert(events.some(event => event.eventType === 'run_complete'), 'state machine should emit run_complete')
  let illegal = false
  try {
    await stateMachine.interruptRun(started.runId)
  } catch {
    illegal = true
  }
  assert(illegal, 'completed run should reject illegal transition')

  const interruptCommand = core.createCommandEnvelope({
    commandType: 'agent.run',
    workspaceId: 'default',
    threadId: 'thread_smoke',
    runId: 'run_state_interrupt_smoke',
    source: 'test',
    payload: { prompt: 'interrupt smoke' },
  })
  const interruptStarted = await stateMachine.startRun(interruptCommand)
  await stateMachine.interruptRun(interruptStarted.runId)
  assert(events.some(event => event.runId === interruptStarted.runId && event.eventType === 'run_interrupted'), 'interrupt should emit run_interrupted')
  assert(!events.some(event => event.runId === interruptStarted.runId && event.eventType === 'run_failed'), 'interrupt must not emit run_failed')
}

async function smokeStoreAndDurable(core, workspaceRoot) {
  const jsonlPath = resolve(workspaceRoot, 'records.jsonl')
  const jsonl = new core.JsonlStore(jsonlPath)
  await jsonl.append({ id: 1 })
  await jsonl.append({ id: 2 })
  await appendFile(jsonlPath, '{bad json\n', 'utf8')
  const read = await jsonl.read()
  assert(read.records.length === 2, `expected 2 valid records, got ${read.records.length}`)
  assert(read.corruptRecords.length === 1, `expected 1 corrupt record, got ${read.corruptRecords.length}`)

  const atomic = new core.AtomicFileStore()
  const atomicPath = resolve(workspaceRoot, 'atomic.json')
  const created = await atomic.writeIfMissing(atomicPath, '{"first":true}\n')
  const skipped = await atomic.writeIfMissing(atomicPath, '{"first":false}\n')
  assert(created === true && skipped === false, 'writeIfMissing should create once and never overwrite')

  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const checkpoint = await durable.createCheckpoint({
    workspaceId: 'default',
    threadId: 'thread_kernel_smoke',
    runId: 'run_kernel_smoke',
    payload: { ok: true },
  })
  const latest = await durable.checkpointManager.readLatestCheckpoint({ threadId: 'thread_kernel_smoke' })
  assert(latest?.checkpointId === checkpoint.checkpointId, 'latest checkpoint should be readable')
  const heartbeat = await durable.writeHeartbeat({
    workspaceId: 'default',
    runtimeId: 'runtime_kernel_smoke',
    kernel: 'gateway',
    status: 'running',
    createdAtMs: 1000,
  })
  assert(heartbeat.runtimeId === 'runtime_kernel_smoke', 'heartbeat should be written')
  assert(await durable.heartbeatManager.isStale('runtime_kernel_smoke', 100, 1200), 'heartbeat should be stale')
  const durableEvents = await durable.readEvents()
  assert(durableEvents.some(event => event.eventType === 'checkpoint'), 'checkpoint should also write EventEnvelope')
  assert(durableEvents.some(event => event.eventType === 'heartbeat'), 'heartbeat should also write EventEnvelope')
}

async function smokeAgentKernelSubmitRun(core, workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const kernel = new core.AgentKernel({
    cwd: workspaceRoot,
    sessionId: 'kernel-submit-smoke',
    workspaceId: 'default',
    commandSource: 'test',
    durable,
    config: fakeModelConfig(),
    fetch: fakeFetchReturning('kernel submit ok'),
  })
  const command = core.createCommandEnvelope({
    commandType: 'agent.run',
    workspaceId: 'default',
    source: 'test',
    payload: { prompt: 'submit run smoke' },
  })
  const result = await kernel.submitRun(command)
  assert(result.runId, 'submitRun should return runId')
  assert(result.finalText === 'kernel submit ok', `unexpected final text: ${result.finalText}`)
  assert(result.output.finalText === result.finalText, 'submitRun should include QueryTurnOutput')
  assert(Array.isArray(result.coreEvents) && result.coreEvents.length > 0, 'submitRun should return coreEvents')
  assert(result.coreEvents.some(event => event.runId === result.runId && event.eventType === 'run_start'), 'core events should include run_start')
  assert(result.coreEvents.some(event => event.runId === result.runId && event.eventType === 'run_running'), 'core events should include run_running')
  assert(result.coreEvents.some(event => event.eventId.startsWith('event-') && event.runId === result.runId), 'EventBridge should convert legacy events with canonical runId')
  assert(result.coreEvents.some(event => event.eventType === 'checkpoint'), 'checkpoint should be included in run coreEvents')
  assert(result.checkpointId, 'submitRun should return checkpointId')

  const ledger = core.RunLedger.fromRuntimePaths(durable.paths)
  const ledgerRun = await ledger.readRun(result.runId)
  assert(ledgerRun?.status === 'completed', `ledger should read completed run, got ${ledgerRun?.status}`)
}

async function smokeAgentKernelFailureCheckpoint(core, workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const kernel = new core.AgentKernel({
    cwd: workspaceRoot,
    sessionId: 'kernel-failed-smoke',
    workspaceId: 'default',
    commandSource: 'test',
    durable,
    config: fakeModelConfig(),
    fetch: async () => {
      throw new Error('fake model failure')
    },
  })
  const command = core.createCommandEnvelope({
    commandType: 'agent.run',
    workspaceId: 'default',
    runId: 'run_failed_checkpoint_smoke',
    source: 'test',
    payload: { prompt: 'failure smoke' },
  })
  let failed = false
  try {
    await kernel.submitRun(command)
  } catch {
    failed = true
  }
  assert(failed, 'failed AgentKernel run should throw')
  const checkpoint = await durable.checkpointManager.readLatestCheckpoint({ runId: command.runId })
  assert(checkpoint?.status === 'safe_to_replay', `failed checkpoint should be safe_to_replay, got ${checkpoint?.status}`)
  assert(String(checkpoint?.payload?.errorPreview ?? '').includes('fake model failure'), 'failed checkpoint should include error preview')
}

async function smokeAgentKernelInterruptedCheckpoint(core, workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true })
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  const kernel = new core.AgentKernel({
    cwd: workspaceRoot,
    sessionId: 'kernel-interrupted-smoke',
    workspaceId: 'default',
    commandSource: 'test',
    durable,
    config: fakeModelConfig(),
    fetch: fakeFetchReturning('should not be called'),
  })
  const command = core.createCommandEnvelope({
    commandType: 'agent.interrupt',
    workspaceId: 'default',
    runId: 'run_interrupted_checkpoint_smoke',
    source: 'test',
    payload: { reason: 'smoke_interrupt' },
  })
  const result = await kernel.submitRun(command)
  assert(result.runId === command.runId, 'interrupt should preserve canonical runId')
  const events = await durable.readEvents({ runId: command.runId })
  assert(events.some(event => event.eventType === 'run_interrupted'), 'interrupted run should write run_interrupted event')
  assert(!events.some(event => event.eventType === 'run_failed'), 'interrupted run must not write run_failed')
  const checkpoint = await durable.checkpointManager.readLatestCheckpoint({ runId: command.runId })
  assert(checkpoint?.status === 'unsafe_to_replay', `interrupted checkpoint should be unsafe_to_replay, got ${checkpoint?.status}`)
}

async function smokeLoopRuntime(core, workspaceRoot) {
  const mockAgent = {
    async submitRun(command) {
      assert(command.commandType === 'agent.run', 'loop should submit through AgentKernel command')
      assert(!command.runId, 'AttemptRunner should not generate runId itself')
      return {
        runId: 'run_loop_kernel_smoke',
        finalText: 'mock loop run completed',
        output: {
          finalText: 'mock loop run completed',
          toolResults: [],
        },
        coreEvents: [],
      }
    },
  }
  const runtime = new core.LoopRuntime({
    workspaceRoot,
    workspaceId: 'default',
    agentKernel: mockAgent,
  })
  const result = await runtime.runGoal({
    objective: 'Create one minimal task.',
    task: {
      verifier: { type: 'custom', name: 'kernel_smoke' },
    },
  })
  assert(result.goal.status === 'completed', `expected completed goal, got ${result.goal.status}`)
  assert(result.attempt.status === 'completed', `expected completed attempt, got ${result.attempt.status}`)
  assert(result.attempt.runId === 'run_loop_kernel_smoke', 'loop attempt should carry AgentKernel runId')
  assert(result.attempt.checkpointId, 'loop attempt should be checkpointed')
}

async function smokeGuiRuntime(core, workspaceRoot) {
  const runtime = new core.GuiRuntime({ workspaceRoot, workspaceId: 'default' })
  const record = await runtime.act({ action: 'click', x: 1, y: 2, verify: true })
  assert(record.verification.ok === true, 'mock GUI verification should pass')
  assert(record.eventId, 'GUI action should record an event id')
}

async function smokeGatewayRouter(core) {
  const router = new core.GatewayCommandRouter('default')
  const route = router.route({
    messageId: 'gw_msg_kernel_smoke',
    channel: 'local',
    userId: 'user',
    text: '/goal build the kernel',
    createdAtMs: Date.now(),
  })
  assert(route.command.commandType === 'loop.goal', `expected loop.goal, got ${route.command.commandType}`)
  assert(route.command.source === 'gateway', 'gateway command source should be gateway')
}

async function smokeModelRouter(core) {
  const router = core.ModelRouter.fromConfig({
    model: { provider: 'deepseek', name: 'deepseek-v4-flash' },
  })
  const cheap = router.selectModel({ taskType: 'cheap' })
  assert(cheap.provider.id === 'deepseek', `expected deepseek cheap model, got ${cheap.provider.id}`)
  const longContext = router.selectModel({ taskType: 'long_context' })
  assert(longContext.capabilities.longContext === true, 'long_context route should expose long context capability')
}

async function smokeReplay(core, workspaceRoot) {
  const durable = new core.DurableRuntime({ workspaceRoot, workspaceId: 'default' })
  await durable.appendEvent(core.createEventEnvelope({
    eventType: 'run_start',
    workspaceId: 'default',
    threadId: 'thread_replay_smoke',
    runId: 'run_replay_smoke',
    payload: { status: 'running' },
  }))
  await durable.appendEvent(core.createEventEnvelope({
    eventType: 'model_response',
    workspaceId: 'default',
    threadId: 'thread_replay_smoke',
    runId: 'run_replay_smoke',
    payload: { text: 'ok' },
  }))
  const reader = new core.ReplayReader(durable)
  const events = await reader.read({ runId: 'run_replay_smoke' })
  const timeline = new core.EventReplay().buildTimeline(events)
  const markdown = new core.ReplayReport().toMarkdown({ timeline })
  assert(timeline.length === 2, `expected 2 replay events, got ${timeline.length}`)
  assert(markdown.includes('model/model_response'), 'replay markdown should include model response timeline')
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

function fakeModelConfig() {
  return {
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    providers: {
      'fake-openai-compatible': {
        baseURL: 'https://example.invalid/v1',
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
    },
  }
}

function fakeFetchReturning(text) {
  return async () => jsonResponse({
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
        },
      },
    ],
    usage: {
      total_tokens: 1,
    },
  })
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
