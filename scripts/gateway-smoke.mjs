#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { relative, resolve } from 'node:path'

const { GatewayRuntime, LocalGatewayStore } = await import('../dist/src/services/gatewayRuntime/index.js')
const { LocalApprovalStore } = await import('../dist/src/services/approvalStore/index.js')
const { LocalAutomationQueue } = await import('../dist/src/services/automationQueue/index.js')
const { LocalGoalStore } = await import('../dist/src/services/goalStore/index.js')
const { LocalLoopStore } = await import('../dist/src/services/loopRuntime/index.js')
const { LocalQuestionStore } = await import('../dist/src/services/questions/index.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')

const root = process.cwd()
const mainPath = resolve(root, 'dist/src/main.js')
const smokeRoot = resolve(root, '.tmp-gateway-smoke')
const runtimeRoot = resolve(smokeRoot, 'runtime')
const cliRoot = resolve(smokeRoot, 'cli')

assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })
await mkdir(cliRoot, { recursive: true })

try {
  await smokeRuntime(runtimeRoot)
  await smokeCli(cliRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway smoke passed')

async function smokeRuntime(workspaceRoot) {
  const webhook = await startWebhookServer()
  const previousFeishuWebhook = process.env.PANDO_GATEWAY_FEISHU_WEBHOOK
  const previousLarkWebhook = process.env.PANDO_GATEWAY_LARK_WEBHOOK
  const previousWeComWebhook = process.env.PANDO_GATEWAY_WECOM_WEBHOOK
  const previousPairingSecret = process.env.PANDO_GATEWAY_PAIRING_SECRET
  process.env.PANDO_GATEWAY_FEISHU_WEBHOOK = webhook.url
  process.env.PANDO_GATEWAY_LARK_WEBHOOK = webhook.url
  process.env.PANDO_GATEWAY_WECOM_WEBHOOK = webhook.url
  process.env.PANDO_GATEWAY_PAIRING_SECRET = 'gateway-pair-code'
  try {
  const loopStore = new LocalLoopStore(workspaceRoot)
  await loopStore.createLoop(
    {
      loopId: 'loop_gateway_smoke',
      title: 'Gateway loop smoke',
      objective: 'Expose this loop through gateway status commands.',
      verification: [
        {
          type: 'file',
          path: 'missing.txt',
          exists: false,
        },
      ],
    },
    {
      sessionId: 'gateway-smoke-loop',
      cwd: workspaceRoot,
    },
  )

  const store = new LocalGatewayStore(workspaceRoot)
  const approvalStore = new LocalApprovalStore(workspaceRoot)
  const threadStore = new LocalThreadStore(workspaceRoot)
  const goalStore = new LocalGoalStore(workspaceRoot)
  await goalStore.createGoal({
    goalId: 'goal_gateway_smoke',
    sessionId: 'gateway-goal-create',
    cwd: workspaceRoot,
    objective: 'Exercise Gateway goal commands.',
    requirements: ['Gateway goal status and resume should work'],
  })
  const questionStore = new LocalQuestionStore(workspaceRoot)
  await questionStore.createQuestion({
    questionId: 'question_gateway_smoke',
    question: 'Should Gateway answer this question?',
    mode: 'blocking',
    goalId: 'goal_gateway_smoke',
    sessionId: 'gateway-question-create',
  })
  await createFailureThread(threadStore, workspaceRoot)
  await approvalStore.createPending({
    approvalId: 'approval_gateway_approve',
    threadId: 'thread_gateway_smoke',
    request: fakeApprovalRequest('call_gateway_approve'),
  })
  await approvalStore.createPending({
    approvalId: 'approval_gateway_deny',
    threadId: 'thread_gateway_smoke',
    request: fakeApprovalRequest('call_gateway_deny'),
  })
  const storedPending = await approvalStore.readPending()
  assert(storedPending.length === 2, `expected 2 pending approvals, got ${storedPending.length}`)
  assert(
    storedPending[0].request.toolUse.input.token === '<redacted>' || storedPending[1].request.toolUse.input.token === '<redacted>',
    'approval store should redact token-like input',
  )

  const automationQueue = new LocalAutomationQueue(workspaceRoot)
  await automationQueue.createSchedule({
    scheduleId: 'schedule_gateway_smoke',
    schedule: '@once',
    command: '/usage',
    goalId: 'goal_gateway_smoke',
  })
  await automationQueue.createTrigger({
    triggerId: 'trigger_gateway_smoke',
    channel: 'local',
    payload: '/model',
    goalId: 'goal_gateway_smoke',
  })
  await automationQueue.createMessage({
    messageId: 'message_gateway_smoke',
    channel: 'local',
    recipient: 'local-user',
    text: 'Gateway queued automation message',
    goalId: 'goal_gateway_smoke',
  })

  const runtime = new GatewayRuntime(store, loopStore, approvalStore)
  const config = fakeConfig()
  const doctor = await runtime.doctor(config)
  assert(doctor.ok === true, 'gateway doctor should pass with local channel')
  assert(doctor.watchdog?.status === 'not_started', `expected not_started watchdog, got ${doctor.watchdog?.status}`)
  assert(doctor.channels.some(channel => channel.id === 'mock' && channel.status === 'connected'), 'mock channel should connect')
  assert(doctor.channels.some(channel => channel.id === 'telegram' && channel.status === 'missing_config'), 'telegram should report missing config')
  assert(doctor.channels.some(channel => channel.id === 'feishu' && channel.status === 'configured'), 'feishu webhook channel should be configured')
  assert(doctor.channels.some(channel => channel.id === 'lark' && channel.status === 'configured'), 'lark webhook channel should be configured')
  assert(doctor.channels.some(channel => channel.id === 'wecom' && channel.status === 'configured'), 'wecom webhook channel should be configured')
  await store.writeState(fakeStaleGatewayState(workspaceRoot))
  const staleDoctor = await runtime.doctor(config)
  assert(staleDoctor.ok === false, 'gateway doctor should fail when the previous heartbeat is stale')
  assert(staleDoctor.watchdog?.status === 'stale', `expected stale watchdog, got ${staleDoctor.watchdog?.status}`)
  assert(staleDoctor.watchdog?.recoverable === true, 'stale gateway state should be marked recoverable')
  assert(
    staleDoctor.checks.some(check => check.id === 'heartbeat_watchdog' && check.ok === false),
    'gateway doctor checks should include a failed heartbeat watchdog check',
  )
  await store.writeState(fakeRunningGatewayState(workspaceRoot))

  const output = await runtime.start({
    sessionId: 'gateway-smoke-run',
    config,
    durationMs: 180,
    heartbeatIntervalMs: 50,
    tickIntervalMs: 25,
    localMessages: [
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/status',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/loops',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/goals',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/goal resume goal_gateway_smoke',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/questions',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/answer question_gateway_smoke yes from gateway',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/resume loop_gateway_smoke',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/model',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/usage',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/model fake-alt alt-model',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/model',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/approve approval_gateway_approve',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/deny approval_gateway_deny',
      },
    ],
    fetch: fakeGatewayLoopFetch,
  })

  assert(output.state.status === 'stopped', `expected stopped state, got ${output.state.status}`)
  assert(output.state.heartbeatCount >= 2, `expected at least 2 heartbeats, got ${output.state.heartbeatCount}`)
  assert(output.state.recoveredFrom?.previousSessionId === 'gateway-smoke-previous-session', 'gateway start should recover previous running state')
  assert(output.state.recoveredFrom?.previousActiveLoopCount === 1, 'recovery should preserve previous active loop count')
  assert(output.processedMessageCount === 15, `expected 15 processed messages, got ${output.processedMessageCount}`)
  assert(output.outboundMessageCount === 16, `expected 16 outbound messages, got ${output.outboundMessageCount}`)

  const outbox = await store.readOutbound()
  assert(outbox.some(message => message.text === 'Gateway queued automation message'), 'queued automation message should be sent through gateway outbox')
  assert(outbox.some(message => message.text.includes('Pando gateway status')), 'status reply should be in outbox')
  assert(
    outbox.some(message =>
      message.text.includes('recentToolFailures: 1') &&
      message.text.includes('failure: thread_gateway_failure shell_command process_exit_nonzero/process')
    ),
    'status reply should include recent structured tool failures',
  )
  assert(
    outbox.some(message =>
      message.text.includes('recentRuns:') &&
      message.text.includes('run: completed thread_gateway_failure run_gateway_failure_completed')
    ),
    'status reply should include recent run ledger entries',
  )
  assert(
    outbox.some(message =>
      message.text.includes('staleRuns: 1') &&
      message.text.includes('staleRun: thread_gateway_failure run_gateway_stale_started')
    ),
    'status reply should include stale run ledger entries',
  )
  assert(outbox.some(message => message.deliveryStatus === 'delivered'), 'local adapter should mark delivered messages')
  assert(outbox.some(message => message.text.includes('loop_gateway_smoke')), 'loops reply should include loop id')
  assert(outbox.some(message => message.text.includes('goal_gateway_smoke')), 'goals reply should include goal id')
  assert(outbox.some(message => message.text.includes('Goal: goal_gateway_smoke')), 'goal resume reply should include goal id')
  assert(outbox.some(message => message.text.includes('Pando questions') && message.text.includes('question_gateway_smoke')), 'questions reply should include question id')
  assert(outbox.some(message => message.text.includes('Question answered: question_gateway_smoke')), 'answer reply should confirm question answer')
  assert(outbox.some(message => message.text.includes('Resumed loop: loop_gateway_smoke')), 'resume reply should report loop id')
  assert(outbox.some(message => message.text.includes('model: fake-openai-compatible/fake-model')), 'model reply should include model')
  assert(outbox.some(message => message.text.includes('Model updated for current Gateway session.')), 'model switch should report a session update')
  assert(outbox.some(message => message.text.includes('model: fake-alt/alt-model')), 'model switch should update subsequent gateway model replies')
  assert(outbox.filter(message => message.text.startsWith('model: ')).length >= 3, 'automation trigger should enqueue an additional model command reply')
  const usageReply = outbox.find(message => message.text.includes('Pando gateway usage'))
  assert(usageReply, 'usage reply should be in outbox')
  assert(
    usageReply.text.includes('threads:') &&
      usageReply.text.includes('loops:') &&
      usageReply.text.includes('pendingApprovals: 2') &&
      usageReply.text.includes('runs:') &&
      /runStatuses: .*completed=/.test(usageReply.text) &&
      usageReply.text.includes('staleRuns: 1') &&
      usageReply.text.includes('recentToolFailures: 1'),
    `usage reply should include runtime, loop, approval, run, and failure counts: ${usageReply.text}`,
  )
  const automationSnapshot = await automationQueue.readSnapshot()
  assert(automationSnapshot.schedules.some(schedule => schedule.scheduleId === 'schedule_gateway_smoke' && schedule.status === 'processed' && schedule.runCount === 1), 'one-shot schedule should be marked processed after gateway consumption')
  assert(automationSnapshot.triggers.some(trigger => trigger.triggerId === 'trigger_gateway_smoke' && trigger.status === 'processed'), 'remote trigger should be marked processed after gateway consumption')
  assert(automationSnapshot.messages.some(message => message.messageId === 'message_gateway_smoke' && message.status === 'sent'), 'queued message should be marked sent after gateway consumption')
  assert(outbox.some(message => message.text.includes('Approved approval: approval_gateway_approve')), 'approval command should approve pending approval')
  assert(outbox.some(message => message.text.includes('Rejected approval: approval_gateway_deny')), 'deny command should reject pending approval')

  const approved = await approvalStore.readApproval('approval_gateway_approve')
  const rejected = await approvalStore.readApproval('approval_gateway_deny')
  assert(approved?.status === 'approved', `expected approved status, got ${approved?.status}`)
  assert(rejected?.status === 'rejected', `expected rejected status, got ${rejected?.status}`)
  const answeredQuestion = await questionStore.readQuestion('question_gateway_smoke')
  assert(answeredQuestion.status === 'answered' && answeredQuestion.answer === 'yes from gateway', 'gateway /answer should persist question answer')

  await createCompressThread(threadStore, workspaceRoot)

  const compactOutput = await runtime.start({
    sessionId: 'gateway-smoke-compress',
    config,
    durationMs: 120,
    heartbeatIntervalMs: 50,
    tickIntervalMs: 25,
    localMessages: [
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/compress thread_gateway_compress',
      },
    ],
    fetch: fakeCompactFetch,
  })
  assert(compactOutput.processedMessageCount === 1, 'compress run should process one message')
  const compactOutbox = await store.readOutbound()
  assert(compactOutbox.some(message => message.text.includes('Compacted thread: thread_gateway_compress')), 'compress reply should report thread id')
  const compactions = await threadStore.readCompactions('thread_gateway_compress')
  assert(compactions.length === 1, `expected 1 compaction, got ${compactions.length}`)
  assert(compactions[0].status === 'completed', 'gateway compaction should complete')

  await loopStore.createLoop(
    {
      loopId: 'loop_gateway_progress',
      title: 'Gateway progress smoke',
      objective: 'Stay marked as running long enough for a gateway progress heartbeat.',
      verification: [
        {
          type: 'file',
          path: 'progress.txt',
          exists: false,
        },
      ],
    },
    {
      sessionId: 'gateway-smoke-progress-create',
      cwd: workspaceRoot,
    },
  )
  await loopStore.updateMetadata('loop_gateway_progress', {
    status: 'running',
    currentRunId: 'loop_run_gateway_progress',
  })
  const beforeProgressCount = (await store.readOutbound()).filter(isProgressMessage).length
  const progressOutput = await runtime.start({
    sessionId: 'gateway-smoke-progress',
    config,
    durationMs: 130,
    heartbeatIntervalMs: 50,
    progressHeartbeatIntervalMs: 50,
    tickIntervalMs: 25,
  })
  assert(
    progressOutput.state.activeLoops.some(loop => loop.loopId === 'loop_gateway_progress' && loop.currentRunId === 'loop_run_gateway_progress'),
    'progress state should include the running loop run id',
  )
  const progressOutbox = await store.readOutbound()
  const progressMessages = progressOutbox.filter(isProgressMessage)
  assert(progressMessages.length > beforeProgressCount, 'running loop should produce progress heartbeat messages')
  assert(progressMessages.some(message => message.text.includes('Run: loop_run_gateway_progress')), 'progress message should include run id')

  await loopStore.updateMetadata('loop_gateway_progress', {
    status: 'completed',
    currentRunId: undefined,
  })
  const completedProgressCount = progressMessages.length
  await runtime.start({
    sessionId: 'gateway-smoke-progress-completed',
    config,
    durationMs: 90,
    heartbeatIntervalMs: 50,
    progressHeartbeatIntervalMs: 50,
    tickIntervalMs: 25,
  })
  const stoppedProgressCount = (await store.readOutbound()).filter(isProgressMessage).length
  assert(stoppedProgressCount === completedProgressCount, 'completed loop should not emit more progress heartbeat messages')

  await approvalStore.createPending({
    approvalId: 'approval_gateway_wake',
    threadId: 'thread_gateway_smoke',
    request: fakeApprovalRequest('call_gateway_wake'),
  })
  const wakeOutput = await runtime.start({
    sessionId: 'gateway-smoke-wake',
    config,
    durationMs: 130,
    heartbeatIntervalMs: 50,
    wakeHeartbeatIntervalMs: 50,
    tickIntervalMs: 25,
  })
  assert(wakeOutput.state.wakeCount >= 1, `expected at least 1 wake heartbeat, got ${wakeOutput.state.wakeCount}`)
  assert(typeof wakeOutput.state.lastWakeAtMs === 'number', 'wake heartbeat should update lastWakeAtMs')
  const wakeRuns = await store.readWakeRuns()
  assert(wakeRuns.some(run => run.status === 'attention_required' && run.pendingApprovalCount === 1), 'wake run should detect pending approval')
  assert(
    wakeRuns.some(run => run.activeGoalId === 'goal_gateway_smoke' && run.goalRuntimeStatus === 'continued'),
    'wake run should continue the active goal',
  )
  const gatewayGoalAfterWake = await goalStore.readExport('goal_gateway_smoke')
  assert(
    gatewayGoalAfterWake.progress.some(progress => progress.message.includes('Goal runtime checked active goal while idle')),
    'wake heartbeat should append goal runtime progress',
  )
  const wakeOutbox = await store.readOutbound()
  assert(wakeOutbox.some(message => message.text.includes('Attention needed: 1 pending approval(s).')), 'wake heartbeat should notify pending approvals')

  await loopStore.createLoop(
    {
      loopId: 'loop_gateway_heartbeat',
      title: 'Gateway heartbeat loop smoke',
      objective: 'Run when the gateway wake heartbeat sees this loop.',
      verification: [
        {
          type: 'file',
          path: 'missing-heartbeat.txt',
          exists: false,
        },
      ],
      failurePolicy: {
        maxIterations: 1,
      },
    },
    {
      sessionId: 'gateway-smoke-heartbeat-loop-create',
      cwd: workspaceRoot,
    },
  )
  const backgroundOutput = await runtime.start({
    sessionId: 'gateway-smoke-background',
    config,
    durationMs: 120,
    heartbeatIntervalMs: 50,
    tickIntervalMs: 25,
    localMessages: [
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/background loop_gateway_heartbeat',
      },
      {
        channelId: 'local',
        userId: 'local-user',
        text: '/background',
      },
    ],
  })
  assert(backgroundOutput.processedMessageCount === 2, 'background run should process two messages')
  const backgroundMetadata = await loopStore.readMetadata('loop_gateway_heartbeat')
  assert(backgroundMetadata.trigger === 'heartbeat', 'background command should set heartbeat trigger')
  assert(backgroundMetadata.status === 'paused', `background command should pause resumable loop, got ${backgroundMetadata.status}`)
  const backgroundOutbox = await store.readOutbound()
  assert(backgroundOutbox.some(message => message.text.includes('Background enabled: loop_gateway_heartbeat')), 'background command should acknowledge enrollment')
  assert(backgroundOutbox.some(message => message.text.includes('Background heartbeat loops')), 'background list should show enrolled loops')
  await store.writeState(fakeStaleGatewayState(workspaceRoot))
  const heartbeatLoopWakeOutput = await runtime.start({
    sessionId: 'gateway-smoke-heartbeat-loop-recover',
    config,
    durationMs: 140,
    heartbeatIntervalMs: 50,
    wakeHeartbeatIntervalMs: 300_000,
    wakeOnStart: true,
    tickIntervalMs: 25,
    fetch: fakeGatewayHeartbeatLoopFetch,
  })
  assert(heartbeatLoopWakeOutput.state.recoveredFrom?.previousSessionId === 'gateway-smoke-stale-session', 'heartbeat loop wake should recover stale gateway state')
  assert(heartbeatLoopWakeOutput.state.wakeCount >= 1, 'recover wake-on-start should run an immediate wake heartbeat')
  assert(typeof heartbeatLoopWakeOutput.state.lastWakeAtMs === 'number', 'recover wake-on-start should update lastWakeAtMs')
  const heartbeatLoopMetadata = await loopStore.readMetadata('loop_gateway_heartbeat')
  assert(heartbeatLoopMetadata.status === 'completed', `expected heartbeat loop completed, got ${heartbeatLoopMetadata.status}`)
  const heartbeatWakeRuns = await store.readWakeRuns()
  assert(
    heartbeatWakeRuns.some(run => run.triggeredLoopCount >= 1 && run.triggeredLoops?.some(loop => loop.loopId === 'loop_gateway_heartbeat')),
    'wake heartbeat should record triggered heartbeat loop',
  )

  const externalOutput = await runtime.start({
    sessionId: 'gateway-smoke-external-channel',
    config,
    durationMs: 90,
    heartbeatIntervalMs: 50,
    tickIntervalMs: 25,
    localMessages: [
      {
        channelId: 'telegram',
        userId: 'telegram-user',
        text: '/status',
      },
      {
        channelId: 'feishu',
        userId: 'feishu-user',
        text: '/status',
      },
      {
        channelId: 'lark',
        userId: 'lark-user',
        text: '/status',
      },
      {
        channelId: 'wecom',
        userId: 'wecom-user',
        text: '/status',
      },
    ],
  })
  assert(externalOutput.processedMessageCount === 4, 'external channel injected messages should be processed')
  const externalOutbox = await store.readOutbound()
  assert(
    externalOutbox.some(message => message.channelId === 'telegram' && message.deliveryStatus === 'skipped' && message.deliveryMessage?.includes('missing_config')),
    'missing external adapter config should skip outbound delivery without crashing',
  )
  assert(
    externalOutbox.some(message => message.channelId === 'feishu' && message.deliveryStatus === 'delivered' && message.deliveryMessage?.includes('HTTP 200')),
    'configured feishu webhook should mark outbound delivery as delivered',
  )
  assert(
    externalOutbox.some(message => message.channelId === 'lark' && message.deliveryStatus === 'delivered' && message.deliveryMessage?.includes('HTTP 200')),
    'configured lark webhook should mark outbound delivery as delivered',
  )
  assert(
    externalOutbox.some(message => message.channelId === 'wecom' && message.deliveryStatus === 'delivered' && message.deliveryMessage?.includes('HTTP 200')),
    'configured wecom webhook should mark outbound delivery as delivered',
  )
  const feishuLarkWebhookRequests = webhook.requests.filter(request => {
    return request.method === 'POST'
      && request.body?.msg_type === 'text'
      && String(request.body?.content?.text ?? '').includes('Pando gateway status')
  })
  assert(feishuLarkWebhookRequests.length >= 2, 'configured feishu and lark webhooks should receive text payloads')
  assert(webhook.requests.some(request => {
    return request.method === 'POST'
      && request.body?.msgtype === 'text'
      && String(request.body?.text?.content ?? '').includes('Pando gateway status')
  }), 'configured wecom webhook should receive a text payload')

  const pairingOutput = await runtime.start({
    sessionId: 'gateway-smoke-pairing',
    config,
    durationMs: 120,
    heartbeatIntervalMs: 50,
    tickIntervalMs: 25,
    localMessages: [
      {
        channelId: 'telegram',
        userId: 'paired-telegram-user',
        text: '/status',
      },
      {
        channelId: 'telegram',
        userId: 'paired-telegram-user',
        text: '/pair wrong-code',
      },
      {
        channelId: 'telegram',
        userId: 'paired-telegram-user',
        text: '/pair gateway-pair-code',
      },
    ],
  })
  assert(pairingOutput.processedMessageCount === 3, 'pairing run should process three external messages')
  const pairingOutbox = await store.readOutbound()
  assert(
    pairingOutbox.some(message => message.channelId === 'telegram' && message.text.includes('Denied: user paired-telegram-user')),
    'unpaired external user should be denied before pairing',
  )
  assert(
    pairingOutbox.some(message => message.channelId === 'telegram' && message.text.includes('Pairing failed: invalid code.')),
    'wrong pairing code should be rejected',
  )
  assert(
    pairingOutbox.some(message => message.channelId === 'telegram' && message.text.includes('Paired gateway user: telegram/paired-telegram-user')),
    'correct pairing code should pair external user',
  )
  const pairedUsers = await store.readPairedUsers()
  assert(
    pairedUsers.some(user => user.channelId === 'telegram' && user.userId === 'paired-telegram-user'),
    'paired external user should be persisted',
  )

  const restartedRuntime = new GatewayRuntime(store, loopStore, approvalStore)
  await restartedRuntime.start({
    sessionId: 'gateway-smoke-pairing-restart',
    config: fakeConfig(),
    durationMs: 90,
    heartbeatIntervalMs: 50,
    tickIntervalMs: 25,
    localMessages: [
      {
        channelId: 'telegram',
        userId: 'paired-telegram-user',
        text: '/model',
      },
    ],
  })
  const restartedOutbox = await store.readOutbound()
  assert(
    restartedOutbox.some(message => message.channelId === 'telegram' && message.text.includes('model: fake-openai-compatible/fake-model')),
    'paired external user should remain authorized after runtime restart',
  )

  for (const file of ['state.json', 'inbox.jsonl', 'outbox.jsonl', 'events.jsonl', 'wake.jsonl', 'paired-users.jsonl']) {
    await readFile(resolve(workspaceRoot, '.pandoshare/gateway', file), 'utf8')
  }

  const events = await store.readEvents()
  assert(events.some(event => event.type === 'gateway_started'), 'events should include gateway_started')
  assert(events.some(event => event.type === 'gateway_recovered'), 'events should include gateway_recovered')
  assert(events.some(event => event.type === 'gateway_message_processed'), 'events should include message processing')
  assert(events.some(event => event.type === 'gateway_loop_resumed'), 'events should include gateway_loop_resumed')
  assert(events.some(event => event.type === 'gateway_model_changed'), 'events should include gateway_model_changed')
  assert(events.some(event => event.type === 'gateway_background_enabled'), 'events should include gateway_background_enabled')
  assert(events.some(event => event.type === 'gateway_schedule_enqueued'), 'events should include gateway_schedule_enqueued')
  assert(events.some(event => event.type === 'gateway_trigger_enqueued'), 'events should include gateway_trigger_enqueued')
  assert(events.some(event => event.type === 'gateway_automation_message_sent'), 'events should include gateway_automation_message_sent')
  assert(events.some(event => event.type === 'gateway_thread_compacted'), 'events should include gateway_thread_compacted')
  assert(events.some(event => event.type === 'gateway_channel_message_sent'), 'events should include gateway_channel_message_sent')
  assert(events.some(event => event.type === 'gateway_channel_message_failed'), 'events should include gateway_channel_message_failed')
  assert(events.some(event => event.type === 'gateway_progress_heartbeat'), 'events should include gateway_progress_heartbeat')
  assert(events.some(event => event.type === 'gateway_wake_heartbeat'), 'events should include gateway_wake_heartbeat')
  assert(events.some(event => event.type === 'gateway_heartbeat_loop_completed'), 'events should include gateway_heartbeat_loop_completed')
  assert(events.some(event => event.type === 'gateway_user_paired'), 'events should include gateway_user_paired')
  assert(events.some(event => event.type === 'gateway_stopped'), 'events should include gateway_stopped')
  } finally {
    if (previousFeishuWebhook === undefined) {
      delete process.env.PANDO_GATEWAY_FEISHU_WEBHOOK
    } else {
      process.env.PANDO_GATEWAY_FEISHU_WEBHOOK = previousFeishuWebhook
    }
    if (previousLarkWebhook === undefined) {
      delete process.env.PANDO_GATEWAY_LARK_WEBHOOK
    } else {
      process.env.PANDO_GATEWAY_LARK_WEBHOOK = previousLarkWebhook
    }
    if (previousWeComWebhook === undefined) {
      delete process.env.PANDO_GATEWAY_WECOM_WEBHOOK
    } else {
      process.env.PANDO_GATEWAY_WECOM_WEBHOOK = previousWeComWebhook
    }
    if (previousPairingSecret === undefined) {
      delete process.env.PANDO_GATEWAY_PAIRING_SECRET
    } else {
      process.env.PANDO_GATEWAY_PAIRING_SECRET = previousPairingSecret
    }
    await webhook.close()
  }
}

async function fakeGatewayLoopFetch(_url, init) {
  const request = JSON.parse(String(init.body ?? '{}'))
  assert(request.messages?.some(message => String(message.content).includes('loop_gateway_smoke')), 'resume request should include loop id')
  return new Response(JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Gateway resumed loop iteration.',
        },
      },
    ],
    usage: {
      total_tokens: 7,
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function fakeGatewayHeartbeatLoopFetch(_url, init) {
  const request = JSON.parse(String(init.body ?? '{}'))
  assert(
    request.messages?.some(message => String(message.content).includes('loop_gateway_heartbeat')),
    'heartbeat loop request should include loop id',
  )
  return new Response(JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Gateway heartbeat loop iteration.',
        },
      },
    ],
    usage: {
      total_tokens: 7,
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function createCompressThread(threadStore, workspaceRoot) {
  await threadStore.createThread({
    threadId: 'thread_gateway_compress',
    sessionId: 'gateway-smoke-thread',
    title: 'Gateway compress smoke',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  const messages = []
  for (let index = 0; index < 20; index += 1) {
    messages.push({
      role: 'user',
      content: `gateway compress user ${index}: ${'x'.repeat(5000)}`,
    })
    messages.push({
      role: 'assistant',
      content: `gateway compress assistant ${index}`,
    })
  }
  await threadStore.writeMessages('thread_gateway_compress', messages)
}

async function createFailureThread(threadStore, workspaceRoot) {
  await threadStore.createThread({
    threadId: 'thread_gateway_failure',
    sessionId: 'gateway-smoke-failure-thread',
    title: 'Gateway failure smoke',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  await threadStore.appendEvent('thread_gateway_failure', {
    id: 'gateway_smoke_tool_failure',
    type: 'tool_call_completed',
    threadId: 'thread_gateway_failure',
    sessionId: 'gateway-smoke',
    toolUseId: 'call_gateway_failure',
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
  const now = Date.now()
  await threadStore.appendRunLedger({
    runId: 'run_gateway_failure_completed',
    sessionId: 'gateway-smoke-run-ledger',
    threadId: 'thread_gateway_failure',
    cwd: workspaceRoot,
    status: 'completed',
    startedAtMs: now - 42,
    updatedAtMs: now,
    completedAtMs: now,
    durationMs: 42,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    promptPreview: 'gateway status run ledger smoke',
    finalTextPreview: 'gateway run completed',
    eventCount: 3,
    messageCount: 2,
    toolCallCount: 1,
    toolResultCount: 1,
    failedToolResultCount: 0,
    approvalRequestCount: 0,
    resourceUsage: {
      rssBytes: 1024,
      heapUsedBytes: 512,
      heapTotalBytes: 1024,
    },
  })
  const staleUpdatedAtMs = now - 20 * 60_000
  await threadStore.appendRunLedger({
    runId: 'run_gateway_stale_started',
    sessionId: 'gateway-smoke-stale-run',
    threadId: 'thread_gateway_failure',
    cwd: workspaceRoot,
    status: 'started',
    startedAtMs: staleUpdatedAtMs,
    updatedAtMs: staleUpdatedAtMs,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    promptPreview: 'gateway stale run smoke',
    eventCount: 1,
    messageCount: 1,
    toolCallCount: 0,
    toolResultCount: 0,
    failedToolResultCount: 0,
    approvalRequestCount: 0,
  })
}

async function fakeCompactFetch(_url, init) {
  const request = JSON.parse(String(init.body ?? '{}'))
  assert(request.messages?.some(message => String(message.content).includes('gateway compress user 0')), 'compact request should include old thread history')
  return new Response(JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Gateway compacted summary for thread_gateway_compress.',
        },
      },
    ],
    usage: {
      total_tokens: 9,
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function fakeApprovalRequest(toolUseId) {
  return {
    toolUse: {
      id: toolUseId,
      name: 'file_write',
      input: {
        path: 'approval-output.txt',
        token: 'test-token-should-not-be-stored',
      },
    },
    toolName: 'file_write',
    safety: 'workspace_write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'read-only',
    reason: 'Gateway smoke approval.',
    risk: 'medium',
  }
}

async function smokeCli(workspaceRoot) {
  const previousFeishuWebhook = process.env.PANDO_GATEWAY_FEISHU_WEBHOOK
  process.env.PANDO_GATEWAY_FEISHU_WEBHOOK = 'https://example.invalid/feishu-webhook'
  try {
  const configPath = resolve(workspaceRoot, 'pandoshare.config.json')
  await writeFile(configPath, JSON.stringify(fakeConfig(), null, 2), 'utf8')

  const doctorOutput = runCli(['gateway', 'doctor', '--json', '--config', configPath], workspaceRoot)
  const doctor = JSON.parse(doctorOutput)
  assert(doctor.ok === true, 'CLI gateway doctor should pass')
  assert(doctor.channels.some(channel => channel.id === 'local' && channel.status === 'connected'), 'CLI doctor should include local channel')
  const telegramDoctor = doctor.channels.find(channel => channel.id === 'telegram')
  assert(telegramDoctor?.outboundStatus === 'missing_config', 'CLI doctor should show missing telegram outbound config')
  assert(telegramDoctor?.inboundStatus === 'missing_config', 'CLI doctor should show missing telegram inbound secret')
  const feishuDoctor = doctor.channels.find(channel => channel.id === 'feishu')
  assert(feishuDoctor?.outboundStatus === 'configured', 'CLI doctor should show configured feishu outbound webhook')
  assert(feishuDoctor?.inboundStatus === 'missing_config', 'CLI doctor should show missing feishu inbound secret')

  const cliStore = new LocalGatewayStore(workspaceRoot)
  await cliStore.writeState(fakeStaleGatewayState(workspaceRoot))
  const recoverOutput = runCli(
    [
      'gateway',
      'recover',
      '--json',
      '--config',
      configPath,
      '--duration-ms',
      '120',
      '--heartbeat-interval-ms',
      '40',
    ],
    workspaceRoot,
  )
  const recovered = JSON.parse(recoverOutput)
  assert(recovered.ok === true, 'CLI gateway recover should return ok')
  assert(recovered.recovered === true, 'CLI gateway recover should recover stale state')
  assert(recovered.previousWatchdog?.status === 'stale', `expected stale previous watchdog, got ${recovered.previousWatchdog?.status}`)
  assert(recovered.output?.state?.recoveredFrom?.previousSessionId === 'gateway-smoke-stale-session', 'CLI recover should preserve recovered previous session id')
  assert(recovered.output?.state?.wakeCount >= 1, 'CLI recover should run an immediate wake heartbeat')
  assert(typeof recovered.output?.state?.lastWakeAtMs === 'number', 'CLI recover should update lastWakeAtMs')

  const startOutput = runCli(
    [
      'gateway',
      'start',
      '--json',
      '--config',
      configPath,
      '--duration-ms',
      '140',
      '--heartbeat-interval-ms',
      '40',
      '--message',
      '/status',
    ],
    workspaceRoot,
  )
  const output = JSON.parse(startOutput)
  assert(output.state.status === 'stopped', 'CLI gateway start should stop after duration')
  assert(output.processedMessageCount === 1, 'CLI gateway start should process one local message')
  assert(output.outboundMessageCount === 1, 'CLI gateway start should write one reply')

  const statusOutput = runCli(['gateway', 'status', '--json', '--config', configPath], workspaceRoot)
  const status = JSON.parse(statusOutput)
  assert(status.ok === true, 'CLI gateway status should return ok')
  assert(status.watchdog?.status === 'stopped', `CLI gateway status should expose stopped watchdog, got ${status.watchdog?.status}`)
  assert(status.state.status === 'stopped', 'CLI gateway status should include last stopped state')
  assert(Array.isArray(status.outbox) && status.outbox.length >= 1, 'CLI gateway status should include outbox history')

  const stopOutput = runCli(['gateway', 'stop', '--json', '--config', configPath], workspaceRoot)
  const stop = JSON.parse(stopOutput)
  assert(stop.ok === true, 'CLI gateway stop should queue a stop request')
  assert(stop.messageId, 'CLI gateway stop should return queued message id')

  const stopDrainOutput = runCli(
    [
      'gateway',
      'start',
      '--json',
      '--config',
      configPath,
      '--duration-ms',
      '140',
      '--heartbeat-interval-ms',
      '40',
    ],
    workspaceRoot,
  )
  const stopDrain = JSON.parse(stopDrainOutput)
  assert(stopDrain.state.status === 'stopped', 'gateway should stop after processing queued /stop')
  assert(stopDrain.processedMessageCount === 1, 'gateway should process one queued stop message')
  } finally {
    if (previousFeishuWebhook === undefined) {
      delete process.env.PANDO_GATEWAY_FEISHU_WEBHOOK
    } else {
      process.env.PANDO_GATEWAY_FEISHU_WEBHOOK = previousFeishuWebhook
    }
  }
}

function fakeRunningGatewayState(workspaceRoot) {
  const now = Date.now()
  return {
    schemaVersion: 1,
    pid: 424242,
    sessionId: 'gateway-smoke-previous-session',
    status: 'running',
    startedAtMs: now - 10_000,
    updatedAtMs: now - 5_000,
    lastHeartbeatAtMs: now - 5_000,
    heartbeatCount: 9,
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
        loopId: 'loop_gateway_smoke',
        title: 'Gateway loop smoke',
        status: 'running',
        updatedAtMs: now - 5_000,
        currentRunId: 'previous_run',
      },
    ],
    pendingApprovals: [],
    pairedUsers: [],
  }
}

function fakeStaleGatewayState(workspaceRoot) {
  const state = fakeRunningGatewayState(workspaceRoot)
  return {
    ...state,
    sessionId: 'gateway-smoke-stale-session',
    updatedAtMs: Date.now() - 60_000,
    lastHeartbeatAtMs: Date.now() - 60_000,
  }
}

function fakeConfig() {
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
      'fake-alt': {
        baseURL: 'https://example.invalid/v1',
        model: 'alt-default',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
    },
    gateway: {
      enabled: true,
      heartbeatIntervalMs: 50,
      progressHeartbeatIntervalMs: 25,
      allowUsers: ['local-user'],
      pairingSecretEnv: 'PANDO_GATEWAY_PAIRING_SECRET',
      channels: {
        mock: {
          kind: 'mock',
          enabled: true,
        },
        telegram: {
          kind: 'telegram',
          enabled: true,
          tokenEnv: 'PANDO_GATEWAY_MISSING_TOKEN',
          chatIdEnv: 'PANDO_GATEWAY_MISSING_CHAT_ID',
          allowedUsers: ['telegram-user'],
        },
        feishu: {
          kind: 'feishu',
          enabled: true,
          webhookEnv: 'PANDO_GATEWAY_FEISHU_WEBHOOK',
          allowedUsers: ['feishu-user'],
        },
        lark: {
          kind: 'lark',
          enabled: true,
          webhookEnv: 'PANDO_GATEWAY_LARK_WEBHOOK',
          allowedUsers: ['lark-user'],
        },
        wecom: {
          kind: 'wecom',
          enabled: true,
          webhookEnv: 'PANDO_GATEWAY_WECOM_WEBHOOK',
          allowedUsers: ['wecom-user'],
        },
      },
    },
  }
}

async function startWebhookServer() {
  const requests = []
  const server = createServer(async (request, response) => {
    let rawBody = ''
    request.setEncoding('utf8')
    for await (const chunk of request) {
      rawBody += chunk
    }
    let body = rawBody
    try {
      body = JSON.parse(rawBody)
    } catch {
      // Keep the raw body for debugging if a sender posts non-JSON content.
    }
    requests.push({
      method: request.method,
      url: request.url,
      body,
    })
    response.writeHead(200, {
      'Content-Type': 'application/json',
    })
    response.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to allocate webhook smoke server port')
  return {
    url: `http://127.0.0.1:${address.port}/webhook`,
    requests,
    close: () => new Promise((resolvePromise, reject) => {
      server.close(error => error ? reject(error) : resolvePromise())
    }),
  }
}

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [mainPath, ...args], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `CLI failed: node ${mainPath} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result.stdout
}

function isProgressMessage(message) {
  return message.text.includes('Still working: loop_gateway_progress')
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
