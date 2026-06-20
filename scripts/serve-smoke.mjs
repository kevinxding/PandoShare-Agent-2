#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { relative, resolve } from 'node:path'

const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')
const { LocalTaskStore } = await import('../dist/src/tasks/index.js')
const { LocalQuestionStore } = await import('../dist/src/services/questions/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-serve-smoke')
const pandoBin = resolve(root, 'bin/pando.js')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

let llm
let child
let sse
try {
  llm = await startFakeLlmServer()
  await new LocalTaskStore(smokeRoot).createTask({
    taskId: 'task_serve_smoke',
    title: 'Serve smoke task',
    cwd: smokeRoot,
    goalId: 'goal_serve_smoke',
    threadId: 'thread_serve_smoke',
  })
  await new LocalQuestionStore(smokeRoot).createQuestion({
    questionId: 'question_serve_smoke',
    question: 'Serve smoke question?',
    mode: 'blocking',
    goalId: 'goal_serve_smoke',
    taskId: 'task_serve_smoke',
    threadId: 'thread_serve_smoke',
    sessionId: 'serve-smoke-question',
  })
  const configPath = resolve(smokeRoot, 'pandoshare.config.json')
  await writeFile(configPath, JSON.stringify(fakeConfig(llm.url), null, 2), 'utf8')
  child = spawn(process.execPath, [pandoBin, 'serve', '--host', '127.0.0.1', '--port', '0', '--config', configPath], {
    cwd: smokeRoot,
    env: {
      ...process.env,
      PANDO_SERVE_GATEWAY_SECRET: 'serve-smoke-secret',
      PANDO_SERVE_GATEWAY_PAIRING_SECRET: 'serve-pair-code',
    },
    windowsHide: true,
  })
  const serverUrl = await waitForServerUrl(child)

  const doctor = await getJson(`${serverUrl}/api/doctor`)
  assert(doctor.ok === true, 'doctor should pass under fake config')
  const settings = await getJson(`${serverUrl}/api/settings`)
  assert(settings.ok === true, 'settings should return ok')
  assert(settings.model?.provider === 'fake-openai-compatible', 'settings should include resolved model')
  assert(settings.modelSettings?.catalog?.some(provider => provider.id === 'custom'), 'settings should expose custom provider option')
  assert(Array.isArray(settings.mcp), 'settings should include MCP report array')
  const acceptance = await getJson(`${serverUrl}/api/acceptance`)
  assert(acceptance.ok === true, 'acceptance status should return ok')
  assert(Array.isArray(acceptance.runs), 'acceptance status should expose recent runs array')
  const acceptanceDryRun = await postJson(`${serverUrl}/api/acceptance/run`, {
    mode: 'dry_run',
    profile: 'required',
  })
  assert(acceptanceDryRun.ok === true, `acceptance dry-run should succeed: ${JSON.stringify(acceptanceDryRun)}`)
  assert(acceptanceDryRun.acceptance?.latest?.status === 'dry_run', 'acceptance dry-run should update latest status')
  assert(
    acceptanceDryRun.acceptance?.latest?.steps?.some(step => step.id === 'typecheck' && step.status === 'skipped'),
    'acceptance dry-run should record planned required steps',
  )
  const updatedSettings = await postJson(`${serverUrl}/api/settings/model`, {
    provider: 'custom',
    providerName: 'Custom Serve Smoke',
    modelName: 'custom-smoke-model',
    baseURL: llm.url,
    protocol: 'openai-chat-completions',
    authType: 'none',
  })
  assert(updatedSettings.ok === true, `model settings update should succeed: ${JSON.stringify(updatedSettings)}`)
  assert(updatedSettings.model?.provider === 'custom', 'model settings should switch provider')
  assert(updatedSettings.model?.name === 'custom-smoke-model', 'model settings should switch model')
  assert(updatedSettings.config?.providers?.custom?.auth?.type === 'none', 'model settings should save auth type without API key')
  const runtimeSettings = await postJson(`${serverUrl}/api/settings/runtime`, {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalsReviewer: 'auto_review',
    trustedTools: ['file_read', 'grep'],
    gatewayEnabled: true,
    heartbeatIntervalMs: 1234,
    progressHeartbeatIntervalMs: 2345,
    wakeHeartbeatIntervalMs: 3456,
    allowUsers: ['local-user', 'serve-user'],
    pairingSecretEnv: 'PANDO_SERVE_GATEWAY_PAIRING_SECRET',
  })
  assert(runtimeSettings.ok === true, `runtime settings update should succeed: ${JSON.stringify(runtimeSettings)}`)
  assert(runtimeSettings.permissions?.approvalPolicy === 'on-request', 'runtime settings should save approval policy')
  assert(runtimeSettings.permissions?.sandboxMode === 'workspace-write', 'runtime settings should save sandbox mode')
  assert(runtimeSettings.permissions?.approvalsReviewer === 'auto_review', 'runtime settings should save approvals reviewer')
  assert(runtimeSettings.permissions?.trustedTools?.includes('grep'), 'runtime settings should save trusted tools')
  assert(runtimeSettings.gateway?.heartbeatIntervalMs === 1234, 'runtime settings should save gateway heartbeat interval')
  assert(runtimeSettings.gateway?.progressHeartbeatIntervalMs === 2345, 'runtime settings should save progress heartbeat interval')
  assert(runtimeSettings.gateway?.wakeHeartbeatIntervalMs === 3456, 'runtime settings should save wake heartbeat interval')
  assert(runtimeSettings.gateway?.allowUsers?.includes('serve-user'), 'runtime settings should save gateway allow users')
  const gui = await getJson(`${serverUrl}/api/gui`)
  assert(typeof gui.methods?.uia === 'boolean', 'gui report should expose uia method status')
  assert(typeof gui.dingxu?.ok === 'boolean', 'gui report should expose Dingxu health status')
  assert(Array.isArray(gui.dingxu?.missingTools), 'gui report should expose missing Dingxu tool diagnostics')
  const tools = await getJson(`${serverUrl}/api/tools`)
  assert(tools.ok === true, 'tools API should return ok')
  assert(tools.tools?.some(tool => tool.name === 'task_create' && tool.behavior?.background === true), 'tools API should expose task_create background capability')
  assert(tools.tools?.some(tool => tool.name === 'tool_search' && tool.safety === 'read_only'), 'tools API should expose tool_search safety')
  const tasks = await getJson(`${serverUrl}/api/tasks`)
  assert(tasks.ok === true, 'tasks API should return ok')
  assert(tasks.tasks?.some(task => task.taskId === 'task_serve_smoke' && task.goalId === 'goal_serve_smoke'), 'tasks API should expose linked task metadata')
  const taskDetail = await getJson(`${serverUrl}/api/tasks/task_serve_smoke`)
  assert(taskDetail.ok === true && taskDetail.task?.taskId === 'task_serve_smoke', 'task detail API should return task metadata')
  const taskOutput = await getJson(`${serverUrl}/api/tasks/task_serve_smoke/output`)
  assert(taskOutput.ok === true && typeof taskOutput.output === 'string', 'task output API should return output text')
  const questions = await getJson(`${serverUrl}/api/questions`)
  assert(questions.ok === true, 'questions API should return ok')
  assert(questions.questions?.some(question => question.questionId === 'question_serve_smoke' && question.goalId === 'goal_serve_smoke'), 'questions API should expose linked question metadata')
  const questionDetail = await getJson(`${serverUrl}/api/questions/question_serve_smoke`)
  assert(questionDetail.ok === true && questionDetail.question?.status === 'waiting', 'question detail API should expose waiting question')
  const questionAnswer = await postJson(`${serverUrl}/api/questions/question_serve_smoke/answer`, {
    answer: 'serve smoke answer',
    answeredBy: 'serve-smoke',
  })
  assert(questionAnswer.ok === true && questionAnswer.question?.status === 'answered', 'question answer API should mark question answered')
  const files = await getJson(`${serverUrl}/api/files`)
  assert(files.ok === true, 'files should return ok for workspace root')
  assert(files.entries?.some(entry => entry.name === 'pandoshare.config.json'), 'files should list workspace config')
  const stop = await postJson(`${serverUrl}/api/stop`, { threadId: 'thread_missing' })
  assert(stop.ok === true && stop.stopped === false, 'stop should be harmless when no run is active')
  const threads = await getJson(`${serverUrl}/api/threads`)
  assert(Array.isArray(threads), 'threads should return an array')
  const createdGoal = await postJson(`${serverUrl}/api/goals`, {
    goalId: 'goal_serve_smoke',
    title: 'Serve smoke goal',
    objective: 'Verify Web goal API wiring.',
    requirements: ['Goal API can create and resume'],
  })
  assert(createdGoal.ok === true, `goal create should succeed: ${JSON.stringify(createdGoal)}`)
  const goals = await getJson(`${serverUrl}/api/goals`)
  assert(goals.some(goal => goal.metadata?.goalId === 'goal_serve_smoke'), 'goals list should include created goal')
  const activeGoal = await getJson(`${serverUrl}/api/goals/active`)
  assert(activeGoal.goal?.metadata?.goalId === 'goal_serve_smoke', 'active goal should return created goal')
  const goalDetail = await getJson(`${serverUrl}/api/goals/goal_serve_smoke`)
  assert(goalDetail.requirements?.length === 1, 'goal detail should expose requirements')
  const pausedGoal = await postJson(`${serverUrl}/api/goals/goal_serve_smoke/pause`, {})
  assert(pausedGoal.ok === true && pausedGoal.summary?.metadata?.status === 'paused', 'goal pause should work')
  const resumedGoal = await postJson(`${serverUrl}/api/goals/goal_serve_smoke/resume`, {})
  assert(resumedGoal.ok === true && resumedGoal.summary?.metadata?.status === 'active', 'goal resume should work')
  const continuedGoal = await postJson(`${serverUrl}/api/goals/goal_serve_smoke/continue`, {})
  assert(continuedGoal.ok === true && continuedGoal.summary?.metadata?.usageRunCount >= 1, 'goal continue should run GoalRuntime')
  const continuedGoalDetail = await getJson(`${serverUrl}/api/goals/goal_serve_smoke`)
  assert(continuedGoalDetail.progress?.some(item => item.message.includes('Goal runtime')), 'goal continue should append progress')
  const incompleteComplete = await postJson(`${serverUrl}/api/goals/goal_serve_smoke/complete`, {})
  assert(incompleteComplete.ok === false, 'goal complete should reject missing acceptance evidence')

  const loopsBeforeCreate = await getJson(`${serverUrl}/api/loops`)
  assert(Array.isArray(loopsBeforeCreate), 'loops should return an array')
  const createdLoop = await postJson(`${serverUrl}/api/loops`, {
    title: 'Serve smoke loop',
    objective: 'Verify Web loop API wiring.',
    trigger: 'heartbeat',
    workspaceIsolation: 'temp_copy',
    verifyFilePath: 'pandoshare.config.json',
    maxIterations: 1,
  })
  assert(createdLoop.ok === true, `loop create should succeed: ${JSON.stringify(createdLoop)}`)
  const loopId = createdLoop.metadata?.loopId
  assert(loopId, 'loop create should return loopId')
  assert(createdLoop.metadata?.trigger === 'heartbeat', 'loop create should persist trigger')
  assert(createdLoop.metadata?.workspaceIsolation === 'temp_copy', 'loop create should persist workspace isolation')
  const loopDetail = await getJson(`${serverUrl}/api/loops/${encodeURIComponent(loopId)}`)
  assert(loopDetail.metadata?.loopId === loopId, 'loop detail should return created loop')
  assert(loopDetail.metadata?.workspaceIsolation === 'temp_copy', 'loop detail should expose workspace isolation')
  assert(loopDetail.metadata?.trigger === 'heartbeat', 'loop detail should expose trigger')
  assert(typeof loopDetail.state === 'string' && loopDetail.state.includes('Loop created'), 'loop detail should include state text')
  const pausedLoop = await postJson(`${serverUrl}/api/loops/${encodeURIComponent(loopId)}/pause`, {})
  assert(pausedLoop.ok === true && pausedLoop.metadata?.status === 'paused', 'loop pause should update status')
  const stoppedLoop = await postJson(`${serverUrl}/api/loops/${encodeURIComponent(loopId)}/stop`, {})
  assert(stoppedLoop.ok === true && stoppedLoop.metadata?.status === 'stopped', 'loop stop should update status')

  const gateway = await getJson(`${serverUrl}/api/gateway`)
  assert(Array.isArray(gateway.doctor?.channels), 'gateway status should include channel diagnostics')
  assert(gateway.doctor?.watchdog?.status === 'not_started', `gateway status should expose not_started watchdog: ${JSON.stringify(gateway.doctor?.watchdog)}`)
  assert(Array.isArray(gateway.pendingApprovals), 'gateway status should include shared pending approvals')
  assert(Array.isArray(gateway.inbox), 'gateway status should include inbound messages')
  assert(Array.isArray(gateway.recentRuns), 'gateway status should include recent run ledger entries')
  assert(Array.isArray(gateway.recentStaleRuns), 'gateway status should include stale run ledger entries')
  assert(gateway.worker?.running === false, 'gateway status should expose stopped Web worker state')
  const gatewayRecoverNoop = await postJson(`${serverUrl}/api/gateway/recover`, {})
  assert(gatewayRecoverNoop.ok === true, `gateway recover no-op should return ok: ${JSON.stringify(gatewayRecoverNoop)}`)
  assert(gatewayRecoverNoop.recovered === false, 'gateway recover should no-op when watchdog is not recoverable')
  await writeStaleGatewayState(smokeRoot)
  const gatewayRecover = await postJson(`${serverUrl}/api/gateway/recover`, {
    heartbeatIntervalMs: 50,
    progressHeartbeatIntervalMs: 50,
    wakeHeartbeatIntervalMs: 300000,
    tickIntervalMs: 25,
  })
  assert(gatewayRecover.ok === true && gatewayRecover.recovered === true, `gateway recover should start recovery: ${JSON.stringify(gatewayRecover)}`)
  assert(gatewayRecover.previousWatchdog?.status === 'stale', 'gateway recover should report stale previous watchdog')
  const recoveredGateway = await waitForGatewayState(serverUrl, status =>
    status.state?.recoveredFrom?.previousSessionId === 'serve-smoke-stale-session' &&
    status.state?.wakeCount >= 1 &&
    typeof status.state?.lastWakeAtMs === 'number'
  )
  assert(recoveredGateway.worker?.running === true, 'gateway recover should run a Web worker')
  const gatewayRecoverStop = await postJson(`${serverUrl}/api/gateway/stop`, {})
  assert(gatewayRecoverStop.ok === true, `gateway recover stop should succeed: ${JSON.stringify(gatewayRecoverStop)}`)
  await waitForGatewayWorkerStatus(serverUrl, 'stopped')
  const gatewayWorkerStart = await postJson(`${serverUrl}/api/gateway/start`, {
    heartbeatIntervalMs: 50,
    progressHeartbeatIntervalMs: 50,
    wakeHeartbeatIntervalMs: 1000,
    tickIntervalMs: 25,
  })
  assert(gatewayWorkerStart.ok === true, `gateway worker start should succeed: ${JSON.stringify(gatewayWorkerStart)}`)
  assert(gatewayWorkerStart.worker?.running === true, 'gateway worker should report running after start')
  const queuedGatewayCommand = await postJson(`${serverUrl}/api/gateway/message`, {
    text: '/status',
  })
  assert(queuedGatewayCommand.ok === true && queuedGatewayCommand.queued === true, 'running gateway worker should queue Web commands')
  const gatewayWorkerReply = await waitForGatewayReply(serverUrl, 'Pando gateway status')
  assert(gatewayWorkerReply.worker?.running === true, 'gateway worker should remain running while processing queued command')
  const gatewayWorkerStop = await postJson(`${serverUrl}/api/gateway/stop`, {})
  assert(gatewayWorkerStop.ok === true, `gateway worker stop should succeed: ${JSON.stringify(gatewayWorkerStop)}`)
  const gatewayAfterWorkerStop = await waitForGatewayWorkerStatus(serverUrl, 'stopped')
  assert(gatewayAfterWorkerStop.worker?.running === false, 'gateway worker should report stopped after stop')
  assert(gatewayAfterWorkerStop.doctor?.watchdog?.status === 'stopped', 'gateway watchdog should report stopped after worker stop')
  const gatewayCommand = await postJson(`${serverUrl}/api/gateway/message`, {
    text: '/status',
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(gatewayCommand.ok === true, `gateway message should succeed: ${JSON.stringify(gatewayCommand)}`)
  assert(
    gatewayCommand.outbox?.some(message => typeof message.text === 'string' && message.text.includes('Pando gateway status')),
    'gateway /status command should produce a status reply',
  )
  const gatewayUsageCommand = await postJson(`${serverUrl}/api/gateway/message`, {
    text: '/usage',
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(gatewayUsageCommand.ok === true, `gateway usage message should succeed: ${JSON.stringify(gatewayUsageCommand)}`)
  assert(
    gatewayUsageCommand.outbox?.some(message => typeof message.text === 'string' && message.text.includes('Pando gateway usage')),
    'gateway /usage command should produce a usage reply',
  )
  const rejectedInbound = await postJson(`${serverUrl}/api/gateway/inbound`, {
    channelId: 'telegram',
    secret: 'wrong-secret',
    message: {
      from: { id: 1234 },
      chat: { id: 1234 },
      text: '/status',
    },
  })
  assert(rejectedInbound.ok === false, 'gateway inbound webhook should reject a wrong secret')
  const acceptedInbound = await postJson(`${serverUrl}/api/gateway/inbound`, {
    channelId: 'telegram',
    secret: 'serve-smoke-secret',
    message: {
      from: { id: 1234 },
      chat: { id: 1234 },
      text: '/status',
    },
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(acceptedInbound.ok === true, `gateway inbound webhook should accept a valid secret: ${JSON.stringify(acceptedInbound)}`)
  assert(
    acceptedInbound.outbox?.some(message => message.channelId === 'telegram' && typeof message.text === 'string' && message.text.includes('Pando gateway status')),
    'gateway inbound webhook should produce a telegram status reply',
  )
  const acceptedFeishuInbound = await postJson(`${serverUrl}/api/gateway/inbound`, {
    channelId: 'feishu',
    secret: 'serve-smoke-secret',
    event: {
      sender: {
        sender_id: {
          open_id: 'feishu-user',
        },
      },
      message: {
        message_type: 'text',
        content: JSON.stringify({ text: '/status' }),
      },
    },
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(acceptedFeishuInbound.ok === true, `feishu inbound webhook should accept a valid secret: ${JSON.stringify(acceptedFeishuInbound)}`)
  assert(
    acceptedFeishuInbound.outbox?.some(message => message.channelId === 'feishu' && typeof message.text === 'string' && message.text.includes('Pando gateway status')),
    'feishu inbound webhook should produce a status reply',
  )
  const acceptedLarkInbound = await postJson(`${serverUrl}/api/gateway/inbound`, {
    channelId: 'lark',
    secret: 'serve-smoke-secret',
    event: {
      sender: {
        sender_id: {
          open_id: 'lark-user',
        },
      },
      message: {
        message_type: 'text',
        content: JSON.stringify({ text: '/status' }),
      },
    },
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(acceptedLarkInbound.ok === true, `lark inbound webhook should accept a valid secret: ${JSON.stringify(acceptedLarkInbound)}`)
  assert(
    acceptedLarkInbound.outbox?.some(message => message.channelId === 'lark' && typeof message.text === 'string' && message.text.includes('Pando gateway status')),
    'lark inbound webhook should produce a status reply',
  )
  const acceptedWeComInbound = await postJson(`${serverUrl}/api/gateway/inbound`, {
    channelId: 'wecom',
    secret: 'serve-smoke-secret',
    FromUserName: 'wecom-user',
    Content: '/status',
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(acceptedWeComInbound.ok === true, `wecom inbound webhook should accept a valid secret: ${JSON.stringify(acceptedWeComInbound)}`)
  assert(
    acceptedWeComInbound.outbox?.some(message => message.channelId === 'wecom' && typeof message.text === 'string' && message.text.includes('Pando gateway status')),
    'wecom inbound webhook should produce a status reply',
  )
  const pairedInbound = await postJson(`${serverUrl}/api/gateway/inbound`, {
    channelId: 'telegram',
    secret: 'serve-smoke-secret',
    message: {
      from: { id: 5678 },
      chat: { id: 5678 },
      text: '/pair serve-pair-code',
    },
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(pairedInbound.ok === true, `gateway inbound pairing should succeed: ${JSON.stringify(pairedInbound)}`)
  assert(
    pairedInbound.outbox?.some(message => message.channelId === 'telegram' && typeof message.text === 'string' && message.text.includes('Paired gateway user: telegram/5678')),
    'gateway inbound pairing should write a paired-user reply',
  )
  const gatewayAfterPairing = await getJson(`${serverUrl}/api/gateway`)
  assert(
    gatewayAfterPairing.pairedUsers?.some(user => user.channelId === 'telegram' && user.userId === '5678'),
    'gateway status should expose paired users',
  )

  const thread = await postJson(`${serverUrl}/api/threads`, { title: 'Serve smoke' })
  assert(thread.threadId, 'thread create should return threadId')
  assert(thread.model?.provider === 'custom', 'new thread should inherit updated default provider')
  const renamedThread = await postJson(`${serverUrl}/api/threads/${encodeURIComponent(thread.threadId)}/rename`, {
    title: 'Serve smoke renamed',
  })
  assert(renamedThread.ok === true, `thread rename should succeed: ${JSON.stringify(renamedThread)}`)
  assert(renamedThread.metadata?.title === 'Serve smoke renamed', 'thread rename should update metadata title')
  const threadModel = await postJson(`${serverUrl}/api/threads/${encodeURIComponent(thread.threadId)}/model`, {
    provider: 'fake-openai-compatible',
    modelName: 'thread-smoke-model',
  })
  assert(threadModel.ok === true, `thread model update should succeed: ${JSON.stringify(threadModel)}`)
  assert(threadModel.metadata?.model?.name === 'thread-smoke-model', 'thread metadata should store model override')
  await seedStructuredToolFailure(smokeRoot, thread.threadId)
  const gatewayWithFailure = await getJson(`${serverUrl}/api/gateway`)
  assert(
    gatewayWithFailure.recentToolFailures?.some(failure =>
      failure.threadId === thread.threadId &&
      failure.code === 'process_exit_nonzero' &&
      failure.category === 'process' &&
      failure.toolName === 'shell_command'
    ),
    'gateway status should expose recent structured tool failures',
  )
  const gatewayFailureCommand = await postJson(`${serverUrl}/api/gateway/message`, {
    text: '/status',
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(
    gatewayFailureCommand.outbox?.some(message =>
      typeof message.text === 'string' &&
      message.text.includes('recentToolFailures: 1') &&
      message.text.includes('shell_command process_exit_nonzero/process')
    ),
    'gateway /status reply should include recent structured tool failures',
  )
  sse = await collectSse(`${serverUrl}/api/events?threadId=${encodeURIComponent(thread.threadId)}`)

  const chat = await postJson(`${serverUrl}/api/chat`, { threadId: thread.threadId, prompt: 'hello from serve smoke' })
  assert(chat.ok === true, `chat should succeed: ${JSON.stringify(chat)}`)
  assert(chat.finalText === 'serve smoke ok', `unexpected final text: ${chat.finalText}`)
  const gatewayWithRuns = await getJson(`${serverUrl}/api/gateway`)
  assert(
    gatewayWithRuns.recentRuns?.some(run => run.threadId === thread.threadId && run.status === 'completed'),
    'gateway status should expose recent completed runs',
  )
  assert(Array.isArray(gatewayWithRuns.recentStaleRuns), 'gateway status should keep stale run data available after chat')
  const gatewayRunsCommand = await postJson(`${serverUrl}/api/gateway/message`, {
    text: '/status',
    durationMs: 120,
    heartbeatIntervalMs: 50,
  })
  assert(
    gatewayRunsCommand.outbox?.some(message =>
      typeof message.text === 'string' &&
      message.text.includes('recentRuns:') &&
      message.text.includes(thread.threadId)
    ),
    'gateway /status reply should include recent run ledger entries',
  )

  await waitFor(() => hasAgentEvent(sse.events, 'agent_message_delta'), 'SSE should receive agent_message_delta')
  await waitFor(() => hasAgentEvent(sse.events, 'turn_completed'), 'SSE should receive turn_completed')
  for (const type of ['turn_started', 'context_built', 'agent_message_completed', 'turn_completed']) {
    assert(hasAgentEvent(sse.events, type), `SSE should include ${type}`)
  }
  const deltas = sse.events
    .filter(event => event.event === 'agent_event' && event.data?.type === 'agent_message_delta')
    .map(event => event.data.delta)
  assert(deltas.join('') === 'serve smoke ok', `SSE should include streamed assistant deltas, got ${deltas.join('')}`)

  const detail = await getJson(`${serverUrl}/api/threads/${thread.threadId}`)
  assert(detail.messages?.some(message => message.content === 'serve smoke ok'), 'thread detail should include assistant message')
  assert(detail.metadata?.title === 'Serve smoke renamed', 'thread detail should include renamed title')
  const exportedMarkdown = await getJson(`${serverUrl}/api/threads/${encodeURIComponent(thread.threadId)}/export?format=md`)
  assert(exportedMarkdown.ok === true, `thread markdown export should succeed: ${JSON.stringify(exportedMarkdown)}`)
  assert(exportedMarkdown.content.includes('Serve smoke renamed'), 'markdown export should include renamed title')
  assert(exportedMarkdown.content.includes('serve smoke ok'), 'markdown export should include assistant message')
  const exportedJson = await getJson(`${serverUrl}/api/threads/${encodeURIComponent(thread.threadId)}/export?format=json`)
  assert(exportedJson.ok === true, `thread json export should succeed: ${JSON.stringify(exportedJson)}`)
  const parsedExport = JSON.parse(exportedJson.content)
  assert(parsedExport.metadata?.threadId === thread.threadId, 'json export should include metadata')
  const branch = await postJson(`${serverUrl}/api/threads/${encodeURIComponent(thread.threadId)}/branch`, {
    title: 'Serve smoke branch',
  })
  assert(branch.ok === true, `thread branch should succeed: ${JSON.stringify(branch)}`)
  assert(branch.metadata?.parentThreadId === thread.threadId, 'branch should record parentThreadId')
  const branchDetail = await getJson(`${serverUrl}/api/threads/${branch.metadata.threadId}`)
  assert(branchDetail.messages?.some(message => message.content === 'serve smoke ok'), 'branch should copy parent messages')
  console.log('serve smoke passed')
} finally {
  sse?.close()
  await stopChild(child)
  await closeServer(llm)
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

async function seedStructuredToolFailure(workspaceRoot, threadId) {
  const store = new LocalThreadStore(workspaceRoot)
  await store.appendEvent(threadId, {
    id: 'serve_smoke_tool_failure',
    type: 'tool_call_completed',
    threadId,
    sessionId: 'serve-smoke',
    toolUseId: 'call_serve_smoke_fail',
    toolName: 'shell_command',
    ok: false,
    contentPreview: 'exitCode: 7',
    createdAtMs: Date.now(),
    metadata: {
      type: 'tool_failure',
      code: 'process_exit_nonzero',
      category: 'process',
      message: 'Process exited with code 7.',
      toolName: 'shell_command',
      exitCode: 7,
    },
  })
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
        auth: { type: 'none' },
        capabilities: {
          streaming: true,
        },
      },
    },
    permissions: {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    },
    gateway: {
      allowUsers: ['local-user'],
      pairingSecretEnv: 'PANDO_SERVE_GATEWAY_PAIRING_SECRET',
      channels: {
        telegram: {
          kind: 'telegram',
          enabled: true,
          tokenEnv: 'PANDO_SERVE_MISSING_TELEGRAM_TOKEN',
          chatIdEnv: 'PANDO_SERVE_MISSING_TELEGRAM_CHAT_ID',
          ingressSecretEnv: 'PANDO_SERVE_GATEWAY_SECRET',
          allowedUsers: ['1234'],
        },
        feishu: {
          kind: 'feishu',
          enabled: true,
          ingressSecretEnv: 'PANDO_SERVE_GATEWAY_SECRET',
          allowedUsers: ['feishu-user'],
        },
        lark: {
          kind: 'lark',
          enabled: true,
          ingressSecretEnv: 'PANDO_SERVE_GATEWAY_SECRET',
          allowedUsers: ['lark-user'],
        },
        wecom: {
          kind: 'wecom',
          enabled: true,
          ingressSecretEnv: 'PANDO_SERVE_GATEWAY_SECRET',
          allowedUsers: ['wecom-user'],
        },
      },
    },
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
      assert(parsed.messages?.some(message => message.content === 'hello from serve smoke'), 'LLM request should include prompt')
      assert(parsed.model === 'thread-smoke-model', `LLM request should use thread model override, got ${parsed.model}`)
      assert(parsed.stream === true, 'LLM request should use streaming when provider declares streaming')
      assert(Array.isArray(parsed.tools) && parsed.tools.length > 0, 'streaming Web request should preserve tool definitions')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end([
        'data: {"choices":[{"delta":{"content":"serve smoke "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ].join(''))
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

async function waitForServerUrl(childProcess) {
  let stdout = ''
  let stderr = ''
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for pando serve\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 10000)
    childProcess.stdout.on('data', chunk => {
      stdout += String(chunk)
      const match = stdout.match(/Pando web GUI: (http:\/\/127\.0\.0\.1:\d+)/)
      if (!match) return
      clearTimeout(timeout)
      resolveUrl(match[1])
    })
    childProcess.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    childProcess.on('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    childProcess.on('close', code => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`pando serve exited early with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      }
    })
  })
}

async function collectSse(url) {
  const controller = new AbortController()
  const events = []
  let markReady
  const opened = new Promise(resolveOpen => {
    markReady = resolveOpen
  })
  const ready = (async () => {
    const response = await fetch(url, { signal: controller.signal })
    assert(response.ok, `SSE response should be ok: ${response.status}`)
    assert(response.body, 'SSE response should include a body')
    markReady()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const parsed = parseSseBlock(block)
        if (parsed) events.push(parsed)
      }
    }
  })().catch(error => {
    if (error.name !== 'AbortError') throw error
  })
  await opened
  return {
    events,
    close() {
      controller.abort()
      void ready
    },
  }
}

function parseSseBlock(block) {
  const event = block.match(/^event: (.+)$/m)?.[1] ?? 'message'
  const data = block.match(/^data: (.+)$/m)?.[1]
  if (!data) return undefined
  return { event, data: JSON.parse(data) }
}

function hasAgentEvent(events, type) {
  return events.some(event => event.event === 'agent_event' && event.data?.type === type)
}

async function getJson(url) {
  const response = await fetch(url)
  return response.json()
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

async function waitFor(predicate, message, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function waitForGatewayReply(serverUrl, expectedText, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await getJson(`${serverUrl}/api/gateway`)
    if (status.outbox?.some(message => typeof message.text === 'string' && message.text.includes(expectedText))) {
      return status
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for gateway reply: ${expectedText}`)
}

async function waitForGatewayWorkerStatus(serverUrl, expectedStatus, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await getJson(`${serverUrl}/api/gateway`)
    if (status.worker?.status === expectedStatus) return status
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for gateway worker status: ${expectedStatus}`)
}

async function waitForGatewayState(serverUrl, predicate, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await getJson(`${serverUrl}/api/gateway`)
    if (predicate(status)) return status
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for gateway state')
}

async function writeStaleGatewayState(workspaceRoot) {
  const gatewayRoot = resolve(workspaceRoot, '.pandoshare/gateway')
  await mkdir(gatewayRoot, { recursive: true })
  const now = Date.now()
  const statePath = resolve(gatewayRoot, 'state.json')
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 1,
    pid: 515151,
    sessionId: 'serve-smoke-stale-session',
    status: 'running',
    startedAtMs: now - 600_000,
    updatedAtMs: now - 600_000,
    lastHeartbeatAtMs: now - 600_000,
    heartbeatCount: 9,
    wakeCount: 1,
    cwd: workspaceRoot,
    statePath,
    connectedChannels: [
      {
        id: 'local',
        kind: 'local',
        status: 'connected',
      },
    ],
    activeLoops: [],
    pendingApprovals: [],
    pairedUsers: [],
  }, null, 2)}\n`, 'utf8')
}

async function closeServer(server) {
  if (server) await server.close()
}

function stopChild(childProcess) {
  if (!childProcess) return Promise.resolve()
  if (childProcess.exitCode !== null) return Promise.resolve()
  return new Promise(resolveStop => {
    childProcess.once('close', () => resolveStop())
    childProcess.kill()
    setTimeout(resolveStop, 3000)
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
