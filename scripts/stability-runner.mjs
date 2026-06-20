#!/usr/bin/env node
import { createServer } from 'node:http'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { startPandoServer } = await import('../dist/src/server/index.js')
const { LocalApprovalStore } = await import('../dist/src/services/approvalStore/index.js')
const { GatewayRuntime, LocalGatewayStore } = await import('../dist/src/services/gatewayRuntime/index.js')
const { LocalLoopStore, LoopRuntime } = await import('../dist/src/services/loopRuntime/index.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')
const { createDefaultToolRegistry } = await import('../dist/src/tools.js')

const root = process.cwd()
const options = parseArgs(process.argv.slice(2))
const startedAtMs = Date.now()
const runId = options.runId ?? `stability_${startedAtMs}_${shortId()}`
const evidenceRoot = resolve(root, '.pandoshare/stability', runId)
const workspaceRoot = resolve(root, '.tmp-stability-workspaces', runId)
const configPath = resolve(workspaceRoot, 'pandoshare.config.json')
const ledgerPath = resolve(evidenceRoot, 'ledger.jsonl')
const summaryPath = resolve(evidenceRoot, 'summary.json')
const reportPath = resolve(evidenceRoot, 'report.md')

assertInside(root, evidenceRoot)
assertInside(root, workspaceRoot)
await mkdir(evidenceRoot, { recursive: true })
await rm(workspaceRoot, { recursive: true, force: true })
await mkdir(workspaceRoot, { recursive: true })

const summary = {
  runId,
  label: options.label,
  status: 'running',
  startedAtMs,
  finishedAtMs: undefined,
  durationMs: options.durationMs,
  monitorIntervalMs: options.monitorIntervalMs,
  heartbeatIntervalMs: options.heartbeatIntervalMs,
  staleActiveRunMs: options.staleActiveRunMs,
  workspaceRoot,
  evidenceRoot,
  checks: [],
  errors: [],
  watchdog: {
    tickCount: 0,
    maxHeartbeatStaleMs: 0,
    maxActiveRunAgeMs: 0,
    staleActiveRunDetections: 0,
  },
  resourceUsage: {
    start: resourceSample(),
    end: undefined,
    maxRssBytes: 0,
    maxHeapUsedBytes: 0,
    maxExternalBytes: 0,
    sampleCount: 0,
  },
  gatewaySignals: {
    progressHeartbeatCount: 0,
    wakeHeartbeatCount: 0,
    recoveryEventCount: 0,
    pairedUserCount: 0,
  },
}

let llm
let pando
let gatewayOutput
let monitorOutput
let previousPairingSecret

try {
  await appendLedger('run_started', { runId, workspaceRoot, durationMs: options.durationMs })
  llm = await startFakeLlmServer()
  await appendLedger('fake_llm_started', { url: llm.url })
  const config = fakeConfig(llm.url)
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

  pando = await startPandoServer({
    cwd: workspaceRoot,
    configPath,
    port: 0,
    staticRoot: resolve(root, 'web/dist'),
  })
  await appendLedger('web_started', { url: pando.url })

  const gatewayStore = new LocalGatewayStore(workspaceRoot)
  const approvalStore = new LocalApprovalStore(workspaceRoot)
  const loopStore = new LocalLoopStore(workspaceRoot)
  previousPairingSecret = process.env.PANDO_STABILITY_GATEWAY_PAIRING_SECRET
  process.env.PANDO_STABILITY_GATEWAY_PAIRING_SECRET = 'stability-pair-code'
  await gatewayStore.writeState(fakeRunningGatewayState(workspaceRoot))
  const gateway = new GatewayRuntime(gatewayStore, loopStore, approvalStore)
  const gatewayPromise = gateway.start({
    sessionId: `stability-gateway-${Date.now()}`,
    config,
    durationMs: options.durationMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    progressHeartbeatIntervalMs: options.heartbeatIntervalMs,
    wakeHeartbeatIntervalMs: options.heartbeatIntervalMs,
    tickIntervalMs: Math.min(options.monitorIntervalMs, 100),
  })
  await appendLedger('gateway_started', {
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    progressHeartbeatIntervalMs: options.heartbeatIntervalMs,
    wakeHeartbeatIntervalMs: options.heartbeatIntervalMs,
  })

  const monitorPromise = monitorRuntime({
    serverUrl: pando.url,
    gatewayStore,
    durationMs: options.durationMs,
    monitorIntervalMs: options.monitorIntervalMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    staleActiveRunMs: options.staleActiveRunMs,
  })

  await verifyWebHealth(pando.url)
  await verifyThreadChat(pando.url)
  await verifyGatewayApproval(pando.url, gatewayStore, approvalStore)
  await verifyGatewayHeartbeatSignals(gatewayStore, loopStore, approvalStore, options.heartbeatIntervalMs)
  await verifyGatewayPairing(gatewayStore, options.heartbeatIntervalMs)
  await verifyLoopRuntime(config)

  gatewayOutput = await gatewayPromise
  monitorOutput = await monitorPromise
  verifyResourceUsage(monitorOutput)
  await verifyStoredState(gatewayOutput)

  summary.status = 'passed'
  summary.finishedAtMs = Date.now()
  await appendLedger('run_completed', {
    status: summary.status,
    heartbeatCount: gatewayOutput.state.heartbeatCount,
    monitorTicks: monitorOutput.tickCount,
  })
} catch (error) {
  summary.status = 'failed'
  summary.finishedAtMs = Date.now()
  summary.errors.push(errorMessage(error))
  await appendLedger('run_failed', { error: errorMessage(error) })
  throw error
} finally {
  const finalResourceSample = resourceSample()
  updateResourceUsage(finalResourceSample)
  summary.resourceUsage.end = finalResourceSample
  await writeSummaryAndReport()
  await pando?.close()
  await closeServer(llm)
  if (previousPairingSecret === undefined) {
    delete process.env.PANDO_STABILITY_GATEWAY_PAIRING_SECRET
  } else {
    process.env.PANDO_STABILITY_GATEWAY_PAIRING_SECRET = previousPairingSecret
  }
  if (!options.keepWorkspace) {
    assertInside(root, workspaceRoot)
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

console.log(`stability ${options.label} passed`)
console.log(`summary: ${summaryPath}`)
console.log(`report: ${reportPath}`)

async function verifyWebHealth(serverUrl) {
  const doctor = await getJson(`${serverUrl}/api/doctor`)
  assert(doctor.ok === true, 'doctor should pass during stability run')
  recordCheck('web_doctor', true, 'Web doctor passed.')
  const settings = await getJson(`${serverUrl}/api/settings`)
  assert(settings.ok === true, 'settings should return ok during stability run')
  assert(settings.model?.provider === 'fake-openai-compatible', 'settings should expose fake provider')
  recordCheck('web_settings', true, 'Web settings returned model/runtime state.')
  await appendLedger('web_health_checked', {
    model: settings.model,
    pendingApprovalCount: settings.pendingApprovalCount,
  })
}

async function verifyThreadChat(serverUrl) {
  const thread = await postJson(`${serverUrl}/api/threads`, { title: 'Stability chat smoke' })
  assert(thread.threadId, 'thread create should return threadId')
  const result = await postJson(`${serverUrl}/api/chat`, {
    threadId: thread.threadId,
    prompt: 'stability plain chat',
  })
  assert(result.ok === true, `plain chat should succeed: ${JSON.stringify(result)}`)
  assert(result.finalText === 'stability chat ok', `unexpected plain chat text: ${result.finalText}`)
  const detail = await getJson(`${serverUrl}/api/threads/${thread.threadId}`)
  assert(detail.messages?.some(message => message.content === 'stability chat ok'), 'thread history should persist assistant message')
  recordCheck('thread_chat', true, `Thread ${thread.threadId} persisted chat messages.`)
  await appendLedger('thread_chat_verified', { threadId: thread.threadId })
}

async function verifyGatewayApproval(serverUrl, gatewayStore, approvalStore) {
  const thread = await postJson(`${serverUrl}/api/threads`, { title: 'Stability approval smoke' })
  const chat = postJson(`${serverUrl}/api/chat`, {
    threadId: thread.threadId,
    prompt: 'please write stability approval file',
  })
  const approval = await waitForPendingApproval(approvalStore, 8_000)
  await appendLedger('approval_pending', {
    approvalId: approval.approvalId,
    threadId: approval.threadId,
    toolName: approval.request.toolName,
  })
  await gatewayStore.appendInbound({
    channelId: 'local',
    channelKind: 'local',
    userId: 'local-user',
    text: `/approve ${approval.approvalId}`,
  })
  const result = await chat
  assert(result.ok === true, `approval chat should complete: ${JSON.stringify(result)}`)
  const fileText = await readFile(resolve(workspaceRoot, 'stability-approved.txt'), 'utf8')
  assert(fileText === 'approved by gateway', 'gateway approval should allow file write')
  const resolved = await approvalStore.readApproval(approval.approvalId)
  assert(resolved?.status === 'approved', `approval should be approved, got ${resolved?.status}`)
  recordCheck('gateway_approval', true, `Gateway approved ${approval.approvalId}.`)
  await appendLedger('approval_resolved', {
    approvalId: approval.approvalId,
    status: resolved.status,
    resolvedBy: resolved.resolvedBy,
  })
}

async function verifyLoopRuntime(config) {
  const loopStore = new LocalLoopStore(workspaceRoot)
  const metadata = await loopStore.createLoop(
    {
      loopId: 'loop_stability_smoke',
      title: 'Stability loop smoke',
      objective: 'Create stability-loop-output.txt with the exact text stability-loop-ok.',
      successCriteria: 'stability-loop-output.txt must contain stability-loop-ok.',
      verification: [
        {
          type: 'file',
          path: 'stability-loop-output.txt',
          exists: true,
          contains: 'stability-loop-ok',
        },
      ],
      failurePolicy: {
        maxIterations: 1,
        maxConsecutiveFailures: 1,
      },
    },
    {
      sessionId: 'stability-loop-create',
      cwd: workspaceRoot,
    },
  )
  const runtime = new LoopRuntime(loopStore)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'stability-loop-run',
    config: {
      ...config,
      permissions: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxMode: 'danger-full-access',
      },
    },
    registry: createDefaultToolRegistry(),
    maxToolRounds: 2,
  })
  assert(output.metadata.status === 'completed', `loop should complete, got ${output.metadata.status}`)
  const summaryRecord = await loopStore.readSummary(metadata.loopId)
  assert(summaryRecord.iterationCount === 1, `loop should run exactly one iteration, got ${summaryRecord.iterationCount}`)
  assert(summaryRecord.lastRun?.status === 'completed', 'loop last run should be completed')
  recordCheck('loop_runtime', true, `Loop ${metadata.loopId} completed with one iteration.`)
  await appendLedger('loop_verified', {
    loopId: metadata.loopId,
    status: output.metadata.status,
    iterationCount: summaryRecord.iterationCount,
  })
}

async function verifyGatewayHeartbeatSignals(gatewayStore, loopStore, approvalStore, heartbeatIntervalMs) {
  await loopStore.createLoop(
    {
      loopId: 'loop_stability_gateway_progress',
      title: 'Stability gateway progress',
      objective: 'Stay running briefly so the gateway can emit progress heartbeat messages.',
      verification: [
        {
          type: 'file',
          path: 'gateway-progress.txt',
          exists: false,
        },
      ],
    },
    {
      sessionId: 'stability-gateway-progress-create',
      cwd: workspaceRoot,
    },
  )
  await loopStore.updateMetadata('loop_stability_gateway_progress', {
    status: 'running',
    currentRunId: 'loop_run_stability_gateway_progress',
  })
  await approvalStore.createPending({
    approvalId: 'approval_stability_wake',
    threadId: 'thread_stability_wake',
    request: fakeApprovalRequest('call_stability_wake'),
  })

  await waitForGatewaySignal(gatewayStore, async () => {
    const outbox = await gatewayStore.readOutbound()
    const wakeRuns = await gatewayStore.readWakeRuns()
    return outbox.some(message => message.text.includes('Still working: loop_stability_gateway_progress'))
      && outbox.some(message => message.text.includes('Attention needed: 1 pending approval(s).'))
      && wakeRuns.some(run => run.status === 'attention_required' && run.pendingApprovalCount >= 1)
  }, gatewaySignalTimeoutMs(heartbeatIntervalMs))

  const events = await gatewayStore.readEvents()
  const progressEvents = events.filter(event => event.type === 'gateway_progress_heartbeat')
  const wakeEvents = events.filter(event => event.type === 'gateway_wake_heartbeat')
  const recoveryEvents = events.filter(event => event.type === 'gateway_recovered')
  assert(progressEvents.length >= 1, 'gateway progress heartbeat event should be recorded')
  assert(wakeEvents.length >= 1, 'gateway wake heartbeat event should be recorded')
  assert(recoveryEvents.length >= 1, 'gateway recovery event should be recorded')
  summary.gatewaySignals = {
    ...summary.gatewaySignals,
    progressHeartbeatCount: progressEvents.length,
    wakeHeartbeatCount: wakeEvents.length,
    recoveryEventCount: recoveryEvents.length,
  }

  await loopStore.updateMetadata('loop_stability_gateway_progress', {
    status: 'completed',
    currentRunId: undefined,
  })
  await approvalStore.resolveApproval('approval_stability_wake', {
    decision: 'reject',
    resolvedBy: 'stability-runner',
  })
  recordCheck('gateway_heartbeats', true, `Gateway emitted ${progressEvents.length} progress heartbeat(s) and ${wakeEvents.length} wake heartbeat(s).`)
  await appendLedger('gateway_heartbeats_verified', summary.gatewaySignals)
}

async function verifyGatewayPairing(gatewayStore, heartbeatIntervalMs) {
  await gatewayStore.appendInbound({
    channelId: 'telegram',
    channelKind: 'telegram',
    userId: 'stability-mobile-user',
    text: '/status',
  })
  await gatewayStore.appendInbound({
    channelId: 'telegram',
    channelKind: 'telegram',
    userId: 'stability-mobile-user',
    text: '/pair wrong-code',
  })
  await gatewayStore.appendInbound({
    channelId: 'telegram',
    channelKind: 'telegram',
    userId: 'stability-mobile-user',
    text: '/pair stability-pair-code',
  })

  await waitForGatewaySignal(gatewayStore, async () => {
    const outbox = await gatewayStore.readOutbound()
    return outbox.some(message => message.channelId === 'telegram' && message.text.includes('Denied: user stability-mobile-user'))
      && outbox.some(message => message.channelId === 'telegram' && message.text.includes('Pairing failed: invalid code.'))
      && outbox.some(message => message.channelId === 'telegram' && message.text.includes('Paired gateway user: telegram/stability-mobile-user'))
  }, gatewaySignalTimeoutMs(heartbeatIntervalMs))

  const pairedUsers = await gatewayStore.readPairedUsers()
  assert(
    pairedUsers.some(user => user.channelId === 'telegram' && user.userId === 'stability-mobile-user'),
    'gateway pairing should persist mobile user',
  )
  const events = await gatewayStore.readEvents()
  assert(events.some(event => event.type === 'gateway_user_paired'), 'gateway pairing event should be recorded')
  summary.gatewaySignals = {
    ...summary.gatewaySignals,
    pairedUserCount: pairedUsers.length,
  }
  recordCheck('gateway_pairing', true, `Gateway paired ${pairedUsers.length} user(s) and persisted paired-users.jsonl.`)
  await appendLedger('gateway_pairing_verified', {
    pairedUserCount: pairedUsers.length,
    pairedUsers: pairedUsers.map(user => ({
      channelId: user.channelId,
      channelKind: user.channelKind,
      userId: user.userId,
    })),
  })
}

async function verifyStoredState(gatewayRunOutput) {
  const threadStore = new LocalThreadStore(workspaceRoot)
  const loopStore = new LocalLoopStore(workspaceRoot)
  const approvalStore = new LocalApprovalStore(workspaceRoot)
  const threads = await threadStore.listThreadSummaries()
  const loops = await loopStore.listSummaries()
  const pendingApprovals = await approvalStore.readPending()
  assert(threads.length >= 2, `expected at least two threads, got ${threads.length}`)
  assert(loops.some(loop => loop.metadata.loopId === 'loop_stability_smoke'), 'loop summary should persist')
  assert(pendingApprovals.length === 0, `pending approvals should be resolved, got ${pendingApprovals.length}`)
  assert(gatewayRunOutput.state.heartbeatCount >= 2, `expected at least 2 heartbeats, got ${gatewayRunOutput.state.heartbeatCount}`)
  assert(gatewayRunOutput.state.recoveredFrom?.previousSessionId === 'stability-previous-gateway', 'gateway output should include recovery snapshot')
  recordCheck('stored_state', true, 'Thread, loop, approval, and gateway state persisted.')
  await appendLedger('stored_state_verified', {
    threadCount: threads.length,
    loopCount: loops.length,
    pendingApprovalCount: pendingApprovals.length,
    heartbeatCount: gatewayRunOutput.state.heartbeatCount,
    recoveredFrom: gatewayRunOutput.state.recoveredFrom,
  })
}

function verifyResourceUsage(monitorOutput) {
  assert(summary.resourceUsage.sampleCount >= monitorOutput.tickCount, `expected at least ${monitorOutput.tickCount} resource samples, got ${summary.resourceUsage.sampleCount}`)
  assert(summary.resourceUsage.maxRssBytes > 0, 'resource usage should track RSS')
  assert(summary.resourceUsage.maxHeapUsedBytes > 0, 'resource usage should track heap usage')
  assert(monitorOutput.staleActiveRunDetections === 0, `expected no stale active run detections, got ${monitorOutput.staleActiveRunDetections}`)
  recordCheck('resource_usage', true, `Resource usage sampled ${summary.resourceUsage.sampleCount} time(s); max RSS ${summary.resourceUsage.maxRssBytes} bytes.`)
}

async function monitorRuntime(input) {
  const started = Date.now()
  let tickCount = 0
  let lastHeartbeatCount = 0
  let maxHeartbeatStaleMs = 0
  const activeRunFirstSeen = new Map()
  let maxActiveRunAgeMs = 0
  let staleActiveRunDetections = 0
  while (Date.now() - started < input.durationMs) {
    await delay(input.monitorIntervalMs)
    const settings = await getJson(`${input.serverUrl}/api/settings`)
    assert(settings.ok === true, 'web settings should remain available during monitor tick')
    const state = await input.gatewayStore.readState()
    assert(state, 'gateway state should exist during monitor tick')
    const staleMs = Date.now() - state.lastHeartbeatAtMs
    maxHeartbeatStaleMs = Math.max(maxHeartbeatStaleMs, staleMs)
    assert(staleMs <= Math.max(input.heartbeatIntervalMs * 4, 1_000), `gateway heartbeat is stale by ${staleMs}ms`)
    const activeRunIds = Array.isArray(settings.activeRuns) ? settings.activeRuns : []
    const activeRunIdSet = new Set(activeRunIds)
    for (const runId of activeRunIds) {
      if (!activeRunFirstSeen.has(runId)) activeRunFirstSeen.set(runId, Date.now())
      const ageMs = Date.now() - activeRunFirstSeen.get(runId)
      maxActiveRunAgeMs = Math.max(maxActiveRunAgeMs, ageMs)
      if (ageMs > input.staleActiveRunMs) {
        staleActiveRunDetections += 1
        await appendLedger('stale_active_run_detected', {
          runId,
          ageMs,
          staleActiveRunMs: input.staleActiveRunMs,
        })
        throw new Error(`active run ${runId} is stale by ${ageMs}ms`)
      }
    }
    for (const runId of activeRunFirstSeen.keys()) {
      if (!activeRunIdSet.has(runId)) activeRunFirstSeen.delete(runId)
    }
    lastHeartbeatCount = state.heartbeatCount
    tickCount += 1
    const usage = resourceSample()
    updateResourceUsage(usage)
    await appendLedger('monitor_tick', {
      tickCount,
      heartbeatCount: state.heartbeatCount,
      staleMs,
      activeRuns: activeRunIds.length,
      maxActiveRunAgeMs,
      pendingApprovalCount: settings.pendingApprovalCount,
      resource: usage,
    })
  }
  summary.watchdog = {
    tickCount,
    maxHeartbeatStaleMs,
    maxActiveRunAgeMs,
    staleActiveRunDetections,
  }
  recordCheck('monitor', true, `Monitor observed ${tickCount} tick(s), last heartbeat ${lastHeartbeatCount}, max stale ${maxHeartbeatStaleMs}ms.`)
  return {
    tickCount,
    lastHeartbeatCount,
    maxHeartbeatStaleMs,
    maxActiveRunAgeMs,
    staleActiveRunDetections,
  }
}

function fakeConfig(baseURL) {
  return {
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    providers: {
      'fake-openai-compatible': {
        baseURL,
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
    },
    permissions: {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'read-only',
    },
    gateway: {
      enabled: true,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      progressHeartbeatIntervalMs: options.heartbeatIntervalMs,
      wakeHeartbeatIntervalMs: options.heartbeatIntervalMs,
      allowUsers: ['local-user'],
      pairingSecretEnv: 'PANDO_STABILITY_GATEWAY_PAIRING_SECRET',
      channels: {
        mock: {
          kind: 'mock',
          enabled: true,
        },
        telegram: {
          kind: 'telegram',
          enabled: true,
          tokenEnv: 'PANDO_STABILITY_MISSING_TELEGRAM_TOKEN',
          allowedUsers: ['telegram-user'],
        },
        feishu: {
          kind: 'feishu',
          enabled: true,
          webhookEnv: 'PANDO_STABILITY_MISSING_FEISHU_WEBHOOK',
          allowedUsers: ['feishu-user'],
        },
      },
    },
  }
}

function fakeRunningGatewayState(workspaceRoot) {
  const now = Date.now()
  return {
    schemaVersion: 1,
    pid: 525252,
    sessionId: 'stability-previous-gateway',
    status: 'running',
    startedAtMs: now - 20_000,
    updatedAtMs: now - 10_000,
    lastHeartbeatAtMs: now - 10_000,
    heartbeatCount: 7,
    wakeCount: 1,
    cwd: workspaceRoot,
    statePath: resolve(workspaceRoot, '.pandoshare/gateway/state.json'),
    connectedChannels: [
      {
        id: 'local',
        kind: 'local',
        status: 'connected',
      },
    ],
    activeLoops: [
      {
        loopId: 'loop_stability_previous',
        title: 'Previous stability loop',
        status: 'running',
        updatedAtMs: now - 10_000,
        currentRunId: 'previous_stability_run',
      },
    ],
    pendingApprovals: [],
    pairedUsers: [],
  }
}

function startFakeLlmServer() {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      const messages = parsed.messages ?? []
      const joined = messages.map(message => `${message.role}:${message.content ?? ''}`).join('\n')
      const toolMessage = messages.find(message => message.role === 'tool')
      res.writeHead(200, { 'Content-Type': 'application/json' })

      if (!toolMessage && joined.includes('stability plain chat')) {
        res.end(JSON.stringify(textResponse('stability chat ok')))
        return
      }
      if (!toolMessage && joined.includes('stability approval file')) {
        res.end(JSON.stringify(toolCallResponse('call_stability_approval', 'stability-approved.txt', 'approved by gateway')))
        return
      }
      if (!toolMessage && joined.includes('stability-loop-output.txt')) {
        res.end(JSON.stringify(toolCallResponse('call_stability_loop', 'stability-loop-output.txt', 'stability-loop-ok')))
        return
      }
      if (toolMessage) {
        res.end(JSON.stringify(textResponse('stability tool result observed')))
        return
      }
      res.end(JSON.stringify(textResponse('stability default ok')))
    })
  })
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolveServer({
        url: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise(resolveClose => server.close(resolveClose)),
      })
    })
  })
}

function toolCallResponse(id, path, content) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name: 'file_write',
                arguments: JSON.stringify({ path, content }),
              },
            },
          ],
        },
      },
    ],
    usage: { total_tokens: 12 },
  }
}

function textResponse(content) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
        },
      },
    ],
    usage: { total_tokens: 5 },
  }
}

async function waitForPendingApproval(store, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const approvals = await store.readPending()
    const approval = approvals.find(item => item.request.toolName === 'file_write')
    if (approval) return approval
    await delay(50)
  }
  throw new Error('Timed out waiting for pending approval')
}

async function waitForGatewaySignal(store, predicate, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await delay(50)
  }
  const state = await store.readState()
  throw new Error(`Timed out waiting for gateway signal; heartbeatCount=${state?.heartbeatCount ?? 0}`)
}

function gatewaySignalTimeoutMs(heartbeatIntervalMs) {
  return Math.max(heartbeatIntervalMs * 3, 8_000)
}

function fakeApprovalRequest(toolUseId) {
  return {
    toolUse: {
      id: toolUseId,
      name: 'file_write',
      input: {
        path: 'wake-output.txt',
        token: 'test-token-stability-wake-should-redact',
      },
    },
    toolName: 'file_write',
    safety: 'workspace_write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'read-only',
    reason: 'Stability wake heartbeat approval.',
    risk: 'medium',
  }
}

async function getJson(url) {
  const response = await fetch(url)
  assert(response.ok, `GET ${url} failed with ${response.status}`)
  return response.json()
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert(response.ok, `POST ${url} failed with ${response.status}`)
  return response.json()
}

async function appendLedger(type, data = {}) {
  await appendFile(ledgerPath, `${JSON.stringify({
    type,
    createdAtMs: Date.now(),
    ...data,
  })}\n`, 'utf8')
}

function recordCheck(id, ok, message) {
  summary.checks.push({
    id,
    ok,
    message,
    createdAtMs: Date.now(),
  })
}

async function writeSummaryAndReport() {
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  const checks = summary.checks.map(check => `- ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.message}`).join('\n')
  const errors = summary.errors.length ? summary.errors.map(error => `- ${error}`).join('\n') : '- none'
  await writeFile(
    reportPath,
    [
      `# Pando Stability ${options.label}`,
      '',
      `Run: ${runId}`,
      `Status: ${summary.status}`,
      `Started: ${new Date(summary.startedAtMs).toISOString()}`,
      `Finished: ${summary.finishedAtMs ? new Date(summary.finishedAtMs).toISOString() : 'not finished'}`,
      `Duration target ms: ${summary.durationMs}`,
      `Workspace: ${workspaceRoot}`,
      '',
      '## Watchdog',
      `- Ticks: ${summary.watchdog.tickCount}`,
      `- Max heartbeat stale ms: ${summary.watchdog.maxHeartbeatStaleMs}`,
      `- Max active run age ms: ${summary.watchdog.maxActiveRunAgeMs}`,
      `- Stale active run detections: ${summary.watchdog.staleActiveRunDetections}`,
      '',
      '## Resource Usage',
      `- Samples: ${summary.resourceUsage.sampleCount}`,
      `- Max RSS bytes: ${summary.resourceUsage.maxRssBytes}`,
      `- Max heap used bytes: ${summary.resourceUsage.maxHeapUsedBytes}`,
      `- Max external bytes: ${summary.resourceUsage.maxExternalBytes}`,
      '',
      '## Gateway Signals',
      `- Progress heartbeat events: ${summary.gatewaySignals.progressHeartbeatCount}`,
      `- Wake heartbeat events: ${summary.gatewaySignals.wakeHeartbeatCount}`,
      `- Recovery events: ${summary.gatewaySignals.recoveryEventCount}`,
      `- Paired users: ${summary.gatewaySignals.pairedUserCount}`,
      '',
      '## Checks',
      checks || '- none',
      '',
      '## Errors',
      errors,
      '',
      '## Evidence',
      `- Ledger: ${ledgerPath}`,
      `- Summary: ${summaryPath}`,
      `- Report: ${reportPath}`,
      '',
    ].join('\n'),
    'utf8',
  )
}

function parseArgs(argv) {
  const parsed = {
    label: 'smoke',
    durationMs: 2_500,
    monitorIntervalMs: 250,
    heartbeatIntervalMs: 100,
    staleActiveRunMs: 600_000,
    keepWorkspace: false,
    runId: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--label':
        parsed.label = requiredArg(argv[index + 1], '--label requires a value')
        index += 1
        break
      case '--duration-ms':
        parsed.durationMs = positiveInteger(requiredArg(argv[index + 1], '--duration-ms requires a number'), '--duration-ms')
        index += 1
        break
      case '--monitor-interval-ms':
        parsed.monitorIntervalMs = positiveInteger(requiredArg(argv[index + 1], '--monitor-interval-ms requires a number'), '--monitor-interval-ms')
        index += 1
        break
      case '--heartbeat-interval-ms':
        parsed.heartbeatIntervalMs = positiveInteger(requiredArg(argv[index + 1], '--heartbeat-interval-ms requires a number'), '--heartbeat-interval-ms')
        index += 1
        break
      case '--stale-active-run-ms':
        parsed.staleActiveRunMs = positiveInteger(requiredArg(argv[index + 1], '--stale-active-run-ms requires a number'), '--stale-active-run-ms')
        index += 1
        break
      case '--run-id':
        parsed.runId = requiredArg(argv[index + 1], '--run-id requires a value')
        if (!/^[A-Za-z0-9_-]+$/.test(parsed.runId)) throw new Error('--run-id must be ASCII')
        index += 1
        break
      case '--keep-workspace':
        parsed.keepWorkspace = true
        break
      default:
        throw new Error(`Unknown stability option: ${arg}`)
    }
  }
  if (parsed.monitorIntervalMs > parsed.durationMs) {
    parsed.monitorIntervalMs = parsed.durationMs
  }
  return parsed
}

function requiredArg(value, message) {
  if (!value || value.startsWith('--')) throw new Error(message)
  return value
}

function positiveInteger(value, option) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`)
  return parsed
}

async function closeServer(server) {
  if (server) await server.close()
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
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

function shortId() {
  return Math.random().toString(36).slice(2, 10)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function resourceSample() {
  const usage = process.memoryUsage()
  return {
    timestampMs: Date.now(),
    uptimeMs: Math.round(process.uptime() * 1000),
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
  }
}

function updateResourceUsage(sample) {
  summary.resourceUsage.sampleCount += 1
  summary.resourceUsage.maxRssBytes = Math.max(summary.resourceUsage.maxRssBytes, sample.rssBytes)
  summary.resourceUsage.maxHeapUsedBytes = Math.max(summary.resourceUsage.maxHeapUsedBytes, sample.heapUsedBytes)
  summary.resourceUsage.maxExternalBytes = Math.max(summary.resourceUsage.maxExternalBytes, sample.externalBytes)
}
