import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { resolveDefaultModel, type ProjectConfig } from '../config/index.js'
import { LocalApprovalStore, type StoredApprovalDecision, type StoredApprovalRecord } from '../approvalStore/index.js'
import { LocalAutomationQueue } from '../automationQueue/index.js'
import { compactThreadHistory } from '../compact/index.js'
import type { AgentEvent } from '../events/index.js'
import type { GenerateOptions } from '../llm/types.js'
import { LocalGoalStore } from '../goalStore/index.js'
import { GoalService } from '../goalService/index.js'
import { GoalRuntime } from '../goalRuntime/index.js'
import { LocalLoopStore, LoopRuntime, type LoopMetadata } from '../loopRuntime/index.js'
import { LocalQuestionStore } from '../questions/index.js'
import { LocalThreadStore } from '../threadStore/index.js'

export type GatewayChannelKind = 'local' | 'mock' | 'telegram' | 'feishu' | 'lark' | 'wecom'

export type GatewayChannelStatus = 'connected' | 'configured' | 'missing_config' | 'disabled' | 'failed'

export type GatewayRuntimeStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export type GatewayConfig = {
  enabled?: boolean
  heartbeatIntervalMs?: number
  progressHeartbeatIntervalMs?: number
  wakeHeartbeatIntervalMs?: number
  allowUsers?: readonly string[]
  pairingSecretEnv?: string
  channels?: Record<string, GatewayChannelConfig>
}

export type GatewayChannelConfig = {
  kind: GatewayChannelKind
  enabled?: boolean
  tokenEnv?: string
  chatIdEnv?: string
  webhookEnv?: string
  ingressSecretEnv?: string
  allowedUsers?: readonly string[]
}

export type GatewayState = {
  schemaVersion: 1
  pid: number
  sessionId: string
  status: GatewayRuntimeStatus
  startedAtMs: number
  updatedAtMs: number
  lastHeartbeatAtMs: number
  heartbeatCount: number
  lastWakeAtMs?: number
  wakeCount: number
  cwd: string
  statePath: string
  connectedChannels: readonly GatewayChannelSnapshot[]
  activeLoops: readonly GatewayLoopSnapshot[]
  pendingApprovals: readonly GatewayApprovalSnapshot[]
  pairedUsers: readonly GatewayPairedUser[]
  recoveredFrom?: GatewayRecoverySnapshot
  lastMessageId?: string
  lastCommand?: string
  lastError?: string
}

export type GatewayRecoverySnapshot = {
  previousSessionId: string
  previousPid: number
  previousStatus: GatewayRuntimeStatus
  previousStartedAtMs: number
  previousUpdatedAtMs: number
  previousHeartbeatAtMs: number
  staleMs: number
  recoveredAtMs: number
  previousActiveLoopCount: number
  previousPendingApprovalCount: number
  currentActiveLoopCount: number
  currentPendingApprovalCount: number
  pairedUserCount: number
}

export type GatewayChannelSnapshot = {
  id: string
  kind: GatewayChannelKind
  status: GatewayChannelStatus
  outboundStatus?: GatewayChannelStatus
  inboundStatus?: GatewayChannelStatus
  message?: string
}

export type GatewayLoopSnapshot = {
  loopId: string
  title: string
  status: string
  updatedAtMs: number
  currentRunId?: string
}

export type GatewayApprovalSnapshot = {
  approvalId: string
  threadId: string
  status: 'pending'
  createdAtMs: number
  toolName?: string
  risk?: string
  reason?: string
}

export type GatewayInboundMessage = {
  messageId: string
  channelId: string
  channelKind: GatewayChannelKind
  userId: string
  text: string
  createdAtMs: number
}

export type GatewayPairedUser = {
  channelId: string
  channelKind: GatewayChannelKind
  userId: string
  pairedAtMs: number
  lastSeenAtMs: number
  sourceMessageId?: string
}

export type GatewayOutboundMessage = {
  messageId: string
  replyToMessageId?: string
  channelId: string
  userId: string
  text: string
  createdAtMs: number
  deliveryStatus?: GatewayChannelDeliveryStatus
  deliveryMessage?: string
}

export type GatewayChannelDeliveryStatus = 'delivered' | 'queued' | 'skipped' | 'failed'

export type GatewayEvent = {
  eventId: string
  type: string
  createdAtMs: number
  message?: string
  data?: unknown
}

export type GatewayWakeRun = {
  wakeId: string
  sessionId: string
  createdAtMs: number
  status: 'ok' | 'attention_required' | 'failed'
  action: 'state_check'
  loopCount: number
  runningLoopCount: number
  heartbeatLoopCount?: number
  triggeredLoopCount?: number
  activeGoalId?: string
  goalRuntimeStatus?: 'no_active_goal' | 'continued' | 'usage_limited' | 'budget_limited' | 'failed'
  goalRuntimeMessage?: string
  goalProgressPercent?: number
  pendingApprovalCount: number
  channelCount: number
  message: string
  triggeredLoops?: readonly {
    loopId: string
    status: string
    iterationCount?: number
    message?: string
  }[]
}

export type GatewayToolFailureSummary = {
  threadId: string
  toolUseId?: string
  toolName: string
  code: string
  category: string
  message?: string
  contentPreview?: string
  createdAtMs: number
}

export type GatewayWatchdogReport = {
  status: 'not_started' | 'stopped' | 'healthy' | 'stale' | 'failed' | 'unknown'
  ok: boolean
  stale: boolean
  recoverable: boolean
  staleAfterMs: number
  heartbeatAgeMs?: number
  lastHeartbeatAtMs?: number
  message: string
}

export type GatewayDoctorReport = {
  ok: boolean
  cwd: string
  statePath: string
  channels: readonly GatewayChannelSnapshot[]
  watchdog: GatewayWatchdogReport
  lastState?: GatewayState
  checks: readonly {
    id: string
    ok: boolean
    message: string
  }[]
}

export type GatewayChannelDeliveryResult = {
  channelId: string
  status: GatewayChannelDeliveryStatus
  message?: string
}

export type GatewayChannelAdapter = {
  id: string
  kind: GatewayChannelKind
  status: GatewayChannelStatus
  snapshot(): GatewayChannelSnapshot
  receiveLocalMessage?(
    store: LocalGatewayStore,
    message: Omit<GatewayInboundMessage, 'messageId' | 'createdAtMs' | 'channelKind'>,
  ): Promise<GatewayInboundMessage>
  send(store: LocalGatewayStore, message: GatewayOutboundMessage): Promise<GatewayChannelDeliveryResult>
}

export type GatewayRuntimeOptions = {
  sessionId: string
  config?: ProjectConfig
  fetch?: GenerateOptions['fetch']
  heartbeatIntervalMs?: number
  progressHeartbeatIntervalMs?: number
  wakeHeartbeatIntervalMs?: number
  wakeOnStart?: boolean
  durationMs?: number
  tickIntervalMs?: number
  localMessages?: readonly Omit<GatewayInboundMessage, 'messageId' | 'createdAtMs' | 'channelKind'>[]
  allowUsers?: readonly string[]
  stdout?: {
    write(text: string): void
  }
}

type GatewayFetch = NonNullable<GenerateOptions['fetch']>

export type GatewayRunOutput = {
  state: GatewayState
  processedMessageCount: number
  outboundMessageCount: number
}

const GATEWAY_DIR = '.pandoshare/gateway'
const STATE_FILE = 'state.json'
const INBOX_FILE = 'inbox.jsonl'
const OUTBOX_FILE = 'outbox.jsonl'
const EVENTS_FILE = 'events.jsonl'
const WAKE_FILE = 'wake.jsonl'
const PAIRED_USERS_FILE = 'paired-users.jsonl'

export class LocalGatewayStore {
  readonly root: string

  constructor(readonly workspaceRoot: string) {
    this.root = resolve(workspaceRoot, GATEWAY_DIR)
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeIfMissing(this.filePath(INBOX_FILE), '')
    await writeIfMissing(this.filePath(OUTBOX_FILE), '')
    await writeIfMissing(this.filePath(EVENTS_FILE), '')
    await writeIfMissing(this.filePath(WAKE_FILE), '')
    await writeIfMissing(this.filePath(PAIRED_USERS_FILE), '')
  }

  async writeState(state: GatewayState): Promise<void> {
    await this.ensure()
    await writeFile(this.filePath(STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  async readState(): Promise<GatewayState | undefined> {
    try {
      return JSON.parse(await readFile(this.filePath(STATE_FILE), 'utf8')) as GatewayState
    } catch {
      return undefined
    }
  }

  async appendInbound(message: Omit<GatewayInboundMessage, 'messageId' | 'createdAtMs'> & { messageId?: string; createdAtMs?: number }): Promise<GatewayInboundMessage> {
    await this.ensure()
    const full: GatewayInboundMessage = {
      messageId: message.messageId ?? `gw_msg_${Date.now()}_${shortId()}`,
      createdAtMs: message.createdAtMs ?? Date.now(),
      ...message,
    }
    await appendJsonLine(this.filePath(INBOX_FILE), full)
    return full
  }

  async readInbound(): Promise<GatewayInboundMessage[]> {
    await this.ensure()
    return readJsonLines<GatewayInboundMessage>(this.filePath(INBOX_FILE))
  }

  async writeInbound(messages: readonly GatewayInboundMessage[]): Promise<void> {
    await this.ensure()
    await writeJsonLines(this.filePath(INBOX_FILE), messages)
  }

  async appendOutbound(message: GatewayOutboundMessage): Promise<void> {
    await this.ensure()
    await appendJsonLine(this.filePath(OUTBOX_FILE), message)
  }

  async readOutbound(): Promise<GatewayOutboundMessage[]> {
    await this.ensure()
    return readJsonLines<GatewayOutboundMessage>(this.filePath(OUTBOX_FILE))
  }

  async appendEvent(input: Omit<GatewayEvent, 'eventId' | 'createdAtMs'>): Promise<void> {
    await this.ensure()
    await appendJsonLine(this.filePath(EVENTS_FILE), {
      eventId: `gw_event_${Date.now()}_${shortId()}`,
      createdAtMs: Date.now(),
      ...input,
    } satisfies GatewayEvent)
  }

  async readEvents(): Promise<GatewayEvent[]> {
    await this.ensure()
    return readJsonLines<GatewayEvent>(this.filePath(EVENTS_FILE))
  }

  async appendWakeRun(run: GatewayWakeRun): Promise<void> {
    await this.ensure()
    await appendJsonLine(this.filePath(WAKE_FILE), run)
  }

  async readWakeRuns(): Promise<GatewayWakeRun[]> {
    await this.ensure()
    return readJsonLines<GatewayWakeRun>(this.filePath(WAKE_FILE))
  }

  async readPairedUsers(): Promise<GatewayPairedUser[]> {
    await this.ensure()
    const entries = await readJsonLines<GatewayPairedUser>(this.filePath(PAIRED_USERS_FILE))
    const latest = new Map<string, GatewayPairedUser>()
    for (const entry of entries) {
      latest.set(pairKey(entry.channelId, entry.userId), entry)
    }
    return Array.from(latest.values()).sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
  }

  async upsertPairedUser(input: Omit<GatewayPairedUser, 'pairedAtMs' | 'lastSeenAtMs'>): Promise<GatewayPairedUser> {
    await this.ensure()
    const now = Date.now()
    const existing = (await this.readPairedUsers()).find(user => pairKey(user.channelId, user.userId) === pairKey(input.channelId, input.userId))
    const paired: GatewayPairedUser = {
      ...input,
      pairedAtMs: existing?.pairedAtMs ?? now,
      lastSeenAtMs: now,
    }
    const next = [
      ...(await this.readPairedUsers()).filter(user => pairKey(user.channelId, user.userId) !== pairKey(input.channelId, input.userId)),
      paired,
    ]
    await writeJsonLines(this.filePath(PAIRED_USERS_FILE), next)
    return paired
  }

  filePath(filename: string): string {
    return join(this.root, filename)
  }
}

export class GatewayRuntime {
  private stopping = false

  constructor(
    readonly store: LocalGatewayStore,
    readonly loopStore = new LocalLoopStore(store.workspaceRoot),
    readonly approvalStore = new LocalApprovalStore(store.workspaceRoot),
    readonly threadStore = new LocalThreadStore(store.workspaceRoot),
    readonly goalStore = new LocalGoalStore(store.workspaceRoot),
    readonly goalService = new GoalService(goalStore),
  ) {}

  async doctor(config: ProjectConfig | undefined = undefined): Promise<GatewayDoctorReport> {
    await this.store.ensure()
    const adapters = createGatewayChannelAdapters(config)
    const channels = adapters.map(adapter => adapter.snapshot())
    const state = await this.store.readState()
    const watchdog = evaluateGatewayWatchdog(state, config)
    const checks = [
      {
        id: 'state_store',
        ok: true,
        message: this.store.root,
      },
      {
        id: 'local_channel',
        ok: channels.some(channel => channel.id === 'local' && channel.status === 'connected'),
        message: 'local mock channel is available',
      },
      {
        id: 'external_channels',
        ok: true,
        message: summarizeExternalChannels(channels),
      },
      {
        id: 'heartbeat_watchdog',
        ok: watchdog.ok,
        message: watchdog.message,
      },
    ]
    return {
      ok: checks.every(check => check.ok),
      cwd: this.store.workspaceRoot,
      statePath: this.store.filePath(STATE_FILE),
      channels,
      watchdog,
      lastState: state,
      checks,
    }
  }

  async readRecentToolFailures(limit = 5): Promise<GatewayToolFailureSummary[]> {
    const summaries = await this.threadStore.listThreadSummaries({ limit: Math.max(limit, 5) })
    const failures: GatewayToolFailureSummary[] = []
    for (const summary of summaries) {
      const events = await this.threadStore.readEvents(summary.metadata.threadId)
      for (const event of events) {
        const failure = summarizeToolFailureEvent(summary.metadata.threadId, event)
        if (failure) failures.push(failure)
      }
    }
    return failures
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit)
  }

  async start(options: GatewayRuntimeOptions): Promise<GatewayRunOutput> {
    await this.store.ensure()
    this.stopping = false
    const previousState = await this.store.readState()
    const adapters = createGatewayChannelAdapters(options.config, options.fetch)
    for (const message of options.localMessages ?? []) {
      await this.receiveLocalMessage(adapters, message)
    }

    let state = await this.createState(options, 'starting', previousState)
    await this.store.writeState(state)
    await this.store.appendEvent({
      type: 'gateway_started',
      message: 'Gateway started.',
      data: {
        sessionId: options.sessionId,
        recovered: Boolean(state.recoveredFrom),
      },
    })
    if (state.recoveredFrom) {
      await this.store.appendEvent({
        type: 'gateway_recovered',
        message: 'Gateway recovered a previous runtime state.',
        data: state.recoveredFrom,
      })
      options.stdout?.write(`gateway recovered: previous ${state.recoveredFrom.previousSessionId} stale ${state.recoveredFrom.staleMs}ms\n`)
    }
    state = await this.updateHeartbeat(state, options, 'running')
    const startedAtMs = Date.now()
    const heartbeatIntervalMs = Math.max(50, options.heartbeatIntervalMs ?? options.config?.gateway?.heartbeatIntervalMs ?? 60_000)
    const progressHeartbeatIntervalMs = Math.max(
      50,
      options.progressHeartbeatIntervalMs ?? options.config?.gateway?.progressHeartbeatIntervalMs ?? heartbeatIntervalMs,
    )
    const wakeHeartbeatIntervalMs = Math.max(
      50,
      options.wakeHeartbeatIntervalMs ?? options.config?.gateway?.wakeHeartbeatIntervalMs ?? 300_000,
    )
    const tickIntervalMs = Math.max(25, options.tickIntervalMs ?? Math.min(heartbeatIntervalMs, 500))
    let nextHeartbeatAtMs = Date.now() + heartbeatIntervalMs
    let nextProgressHeartbeatAtMs = Date.now() + progressHeartbeatIntervalMs
    let nextWakeHeartbeatAtMs = options.wakeOnStart ? Date.now() : Date.now() + wakeHeartbeatIntervalMs
    const progressState = new Map<string, GatewayProgressState>()
    let processedMessageCount = 0

    while (!this.stopping) {
      const now = Date.now()
      await this.processAutomationQueue(options, adapters)
      const processed = await this.processInbox(state, options, adapters)
      processedMessageCount += processed.count
      state = processed.state

      if (now >= nextHeartbeatAtMs) {
        state = await this.updateHeartbeat(state, options, 'running')
        nextHeartbeatAtMs = now + heartbeatIntervalMs
      }

      if (now >= nextProgressHeartbeatAtMs) {
        const progress = await this.sendProgressHeartbeats(options, adapters, progressState)
        if (progress.activeLoops !== undefined) {
          state = {
            ...state,
            updatedAtMs: Date.now(),
            activeLoops: progress.activeLoops,
            pendingApprovals: await this.pendingApprovalSnapshots(),
          }
          await this.store.writeState(state)
        }
        nextProgressHeartbeatAtMs = now + progressHeartbeatIntervalMs
      }

      if (now >= nextWakeHeartbeatAtMs) {
        const wake = await this.runWakeHeartbeat(options, adapters)
        state = {
          ...state,
          updatedAtMs: Date.now(),
          lastWakeAtMs: wake.createdAtMs,
          wakeCount: state.wakeCount + 1,
          activeLoops: await this.loopSnapshots(),
          pendingApprovals: await this.pendingApprovalSnapshots(),
        }
        await this.store.writeState(state)
        nextWakeHeartbeatAtMs = now + wakeHeartbeatIntervalMs
      }

      if (options.durationMs !== undefined && now - startedAtMs >= options.durationMs) break
      if (options.durationMs === undefined && processed.count === 0) {
        await delay(tickIntervalMs)
      } else if (options.durationMs !== undefined) {
        await delay(tickIntervalMs)
      }
    }

    state = await this.updateHeartbeat(state, options, 'stopped')
    await this.store.appendEvent({
      type: 'gateway_stopped',
      message: 'Gateway stopped.',
      data: {
        processedMessageCount,
      },
    })
    return {
      state,
      processedMessageCount,
      outboundMessageCount: (await this.store.readOutbound()).length,
    }
  }

  stop(): void {
    this.stopping = true
  }

  private async processInbox(
    state: GatewayState,
    options: GatewayRuntimeOptions,
    adapters: readonly GatewayChannelAdapter[],
  ): Promise<{ state: GatewayState; count: number }> {
    const inbox = await this.store.readInbound()
    if (!inbox.length) return { state, count: 0 }
    let nextState = state
    let count = 0
    const pairedUsers = new Set((await this.store.readPairedUsers()).map(user => pairKey(user.channelId, user.userId)))
    for (const message of inbox) {
      const pairAttempt = isPairCommand(message.text)
      const allowed = isMessageAllowed(message, options, pairedUsers)
      const replyText = allowed
        ? await this.handleCommand(message, options)
        : pairAttempt
          ? await this.pairUserReply(message, pairSecretInput(message.text), options)
        : `Denied: user ${message.userId} is not allowed to control this gateway.`
      if (!allowed && pairAttempt && replyText.startsWith('Paired gateway user: ')) {
        pairedUsers.add(pairKey(message.channelId, message.userId))
      }
      await this.sendOutbound(adapters, {
        replyToMessageId: message.messageId,
        channelId: message.channelId,
        userId: message.userId,
        text: replyText,
      })
      nextState = {
        ...nextState,
        updatedAtMs: Date.now(),
        lastMessageId: message.messageId,
        lastCommand: firstWord(message.text),
        activeLoops: await this.loopSnapshots(),
        pendingApprovals: await this.pendingApprovalSnapshots(),
        pairedUsers: await this.store.readPairedUsers(),
      }
      await this.store.writeState(nextState)
      await this.store.appendEvent({
        type: allowed || replyText.startsWith('Paired gateway user: ')
          ? 'gateway_message_processed'
          : 'gateway_message_denied',
        message: allowed || replyText.startsWith('Paired gateway user: ')
          ? 'Gateway message processed.'
          : 'Gateway message denied.',
        data: {
          messageId: message.messageId,
          command: firstWord(message.text),
          userId: message.userId,
          paired: replyText.startsWith('Paired gateway user: '),
        },
      })
      count += 1
    }
    await this.store.writeInbound([])
    return { state: nextState, count }
  }

  private async processAutomationQueue(
    options: GatewayRuntimeOptions,
    adapters: readonly GatewayChannelAdapter[],
  ): Promise<void> {
    const queue = new LocalAutomationQueue(this.store.workspaceRoot)
    const now = Date.now()
    for (const schedule of await queue.dueSchedules(now)) {
      try {
        const inbound = await this.receiveLocalMessage(adapters, {
          channelId: 'local',
          userId: 'local-user',
          text: schedule.command,
        })
        const updated = await queue.markScheduleRun(schedule.scheduleId, now)
        await this.store.appendEvent({
          type: 'gateway_schedule_enqueued',
          message: 'Gateway enqueued a due automation schedule.',
          data: {
            scheduleId: schedule.scheduleId,
            command: schedule.command,
            messageId: inbound.messageId,
            runCount: updated.runCount,
            status: updated.status,
            goalId: schedule.goalId,
            taskId: schedule.taskId,
            loopId: schedule.loopId,
          },
        })
        options.stdout?.write(`gateway schedule queued: ${schedule.scheduleId}\n`)
      } catch (error) {
        await this.store.appendEvent({
          type: 'gateway_schedule_failed',
          message: `Gateway failed to enqueue schedule ${schedule.scheduleId}: ${errorMessage(error)}`,
          data: {
            scheduleId: schedule.scheduleId,
            command: schedule.command,
            error: errorMessage(error),
          },
        })
      }
    }
    for (const trigger of await queue.queuedTriggers()) {
      try {
        const inbound = await this.receiveLocalMessage(adapters, {
          channelId: trigger.channel,
          userId: 'local-user',
          text: trigger.payload,
        })
        const updated = await queue.markTriggerProcessed(trigger.triggerId, 'processed')
        await this.store.appendEvent({
          type: 'gateway_trigger_enqueued',
          message: 'Gateway enqueued a remote automation trigger.',
          data: {
            triggerId: trigger.triggerId,
            channel: trigger.channel,
            payload: trigger.payload,
            messageId: inbound.messageId,
            status: updated.status,
            goalId: trigger.goalId,
            taskId: trigger.taskId,
          },
        })
        options.stdout?.write(`gateway trigger queued: ${trigger.triggerId}\n`)
      } catch (error) {
        await queue.markTriggerProcessed(trigger.triggerId, 'failed').catch(() => undefined)
        await this.store.appendEvent({
          type: 'gateway_trigger_failed',
          message: `Gateway failed to enqueue trigger ${trigger.triggerId}: ${errorMessage(error)}`,
          data: {
            triggerId: trigger.triggerId,
            channel: trigger.channel,
            error: errorMessage(error),
          },
        })
      }
    }
    for (const message of await queue.queuedMessages()) {
      try {
        const delivery = await this.sendOutbound(adapters, {
          channelId: message.channel,
          userId: message.recipient,
          text: message.text,
        })
        const updated = await queue.markMessageSent(message.messageId, delivery.status === 'failed' ? 'failed' : 'sent')
        await this.store.appendEvent({
          type: updated.status === 'sent' ? 'gateway_automation_message_sent' : 'gateway_automation_message_failed',
          message: updated.status === 'sent'
            ? 'Gateway sent a queued automation message.'
            : `Gateway failed to send queued message ${message.messageId}: ${delivery.message ?? delivery.status}`,
          data: {
            messageId: message.messageId,
            channel: message.channel,
            recipient: message.recipient,
            status: updated.status,
            deliveryStatus: delivery.status,
            deliveryMessage: delivery.message,
            goalId: message.goalId,
            taskId: message.taskId,
          },
        })
        options.stdout?.write(`gateway message sent: ${message.messageId}\n`)
      } catch (error) {
        await queue.markMessageSent(message.messageId, 'failed').catch(() => undefined)
        await this.store.appendEvent({
          type: 'gateway_automation_message_failed',
          message: `Gateway failed to send queued message ${message.messageId}: ${errorMessage(error)}`,
          data: {
            messageId: message.messageId,
            channel: message.channel,
            error: errorMessage(error),
          },
        })
      }
    }
  }

  private async handleCommand(message: GatewayInboundMessage, options: GatewayRuntimeOptions): Promise<string> {
    const text = message.text.trim()
    const [commandRaw, ...args] = text.split(/\s+/)
    const command = commandRaw.toLowerCase()
    switch (command) {
      case '/status':
        return this.statusReply(options)
      case '/loops':
        return this.loopsReply()
      case '/goals':
        return this.goalsReply()
      case '/goal':
        return this.goalReply(args, message.messageId)
      case '/questions':
        return this.questionsReply()
      case '/answer':
        return this.answerQuestionReply(args, message.userId)
      case '/model':
        return this.modelReply(args, options)
      case '/approve':
        return this.resolveApprovalReply(args[0], 'approve_once', message.userId)
      case '/deny':
        return this.resolveApprovalReply(args[0], 'reject', message.userId)
      case '/stop':
        this.stop()
        return 'Gateway stop requested.'
      case '/background':
        return this.backgroundReply(args[0])
      case '/resume':
        return this.resumeLoopReply(args[0], options)
      case '/compress':
        return this.compressThreadReply(args[0], options)
      case '/pair':
        return this.pairUserReply(message, args[0], options)
      case '/usage':
        return this.usageReply()
      default:
        return `Unknown gateway command: ${command || '(empty)'}. Try /status or /loops.`
    }
  }

  private async statusReply(options: GatewayRuntimeOptions): Promise<string> {
    const state = await this.store.readState()
    const loops = await this.loopSnapshots()
    const approvals = await this.pendingApprovalSnapshots()
    const pairedUsers = await this.store.readPairedUsers()
    const recentFailures = await this.readRecentToolFailures(3)
    const recentRuns = await this.threadStore.readRunLedger({ limit: 3 })
    const staleRuns = await this.threadStore.readStaleRuns({ limit: 3 })
    const pendingQuestions = await new LocalQuestionStore(this.store.workspaceRoot).listQuestions({ limit: 20 })
    const automation = await new LocalAutomationQueue(this.store.workspaceRoot).readSnapshot(100)
    return [
      'Pando gateway status',
      `state: ${state?.status ?? 'unknown'}`,
      `heartbeatCount: ${state?.heartbeatCount ?? 0}`,
      `lastHeartbeatAtMs: ${state?.lastHeartbeatAtMs ?? 0}`,
      `channels: ${resolveChannels(options.config).map(channel => `${channel.id}:${channel.status}`).join(', ')}`,
      `loops: ${loops.length}`,
      `pendingApprovals: ${approvals.length}`,
      `pendingQuestions: ${pendingQuestions.filter(question => question.status === 'waiting' || question.status === 'queued').length}`,
      `dueSchedules: ${automation.schedules.filter(schedule => schedule.status === 'scheduled' && schedule.nextRunAtMs <= Date.now()).length}`,
      `queuedTriggers: ${automation.triggers.filter(trigger => trigger.status === 'queued').length}`,
      `queuedMessages: ${automation.messages.filter(message => message.status === 'queued').length}`,
      `pairedUsers: ${pairedUsers.length}`,
      `recentRuns: ${recentRuns.length}`,
      ...recentRuns.map(run =>
        `run: ${run.status} ${run.threadId} ${run.runId}${run.durationMs !== undefined ? ` ${run.durationMs}ms` : ''}`,
      ),
      `staleRuns: ${staleRuns.length}`,
      ...staleRuns.map(run => `staleRun: ${run.threadId} ${run.runId} age=${run.ageMs}ms threshold=${run.staleAfterMs}ms`),
      `recentToolFailures: ${recentFailures.length}`,
      ...recentFailures.map(failure =>
        `failure: ${failure.threadId} ${failure.toolName} ${failure.code}/${failure.category}`,
      ),
    ].join('\n')
  }

  private async usageReply(): Promise<string> {
    const state = await this.store.readState()
    const threads = await this.threadStore.listThreadSummaries()
    const loops = await this.loopStore.listSummaries()
    const approvals = await this.pendingApprovalSnapshots()
    const pairedUsers = await this.store.readPairedUsers()
    const inbound = await this.store.readInbound()
    const outbound = await this.store.readOutbound()
    const events = await this.store.readEvents()
    const wakeRuns = await this.store.readWakeRuns()
    const questions = await new LocalQuestionStore(this.store.workspaceRoot).listQuestions({ limit: 1000 })
    const automation = await new LocalAutomationQueue(this.store.workspaceRoot).readSnapshot(1000)
    const recentFailures = await this.readRecentToolFailures(5)
    const runs = await this.threadStore.readRunLedger()
    const staleRuns = await this.threadStore.readStaleRuns()
    const threadTotals = threads.reduce(
      (totals, thread) => ({
        messages: totals.messages + thread.messageCount,
        events: totals.events + thread.eventCount,
        checkpoints: totals.checkpoints + thread.checkpointCount,
        compactions: totals.compactions + thread.compactionCount,
      }),
      { messages: 0, events: 0, checkpoints: 0, compactions: 0 },
    )
    return [
      'Pando gateway usage',
      `runtime: ${state?.status ?? 'unknown'}`,
      `heartbeatCount: ${state?.heartbeatCount ?? 0}`,
      `wakeCount: ${state?.wakeCount ?? 0}`,
      `threads: ${threads.length}`,
      `threadMessages: ${threadTotals.messages}`,
      `threadEvents: ${threadTotals.events}`,
      `checkpoints: ${threadTotals.checkpoints}`,
      `compactions: ${threadTotals.compactions}`,
      `loops: ${loops.length}`,
      `loopStatuses: ${formatStatusCounts(loops.map(loop => loop.metadata.status))}`,
      `pendingApprovals: ${approvals.length}`,
      `questions: ${questions.length}`,
      `pendingQuestions: ${questions.filter(question => question.status === 'waiting' || question.status === 'queued').length}`,
      `schedules: ${automation.schedules.length}`,
      `scheduleStatuses: ${formatStatusCounts(automation.schedules.map(schedule => schedule.status))}`,
      `triggers: ${automation.triggers.length}`,
      `triggerStatuses: ${formatStatusCounts(automation.triggers.map(trigger => trigger.status))}`,
      `queuedMessages: ${automation.messages.length}`,
      `messageStatuses: ${formatStatusCounts(automation.messages.map(message => message.status))}`,
      `pairedUsers: ${pairedUsers.length}`,
      `inbox: ${inbound.length}`,
      `outbox: ${outbound.length}`,
      `gatewayEvents: ${events.length}`,
      `wakeRuns: ${wakeRuns.length}`,
      `runs: ${runs.length}`,
      `runStatuses: ${formatStatusCounts(runs.map(run => run.status))}`,
      `staleRuns: ${staleRuns.length}`,
      `recentToolFailures: ${recentFailures.length}`,
    ].join('\n')
  }

  private async loopsReply(): Promise<string> {
    const loops = await this.loopSnapshots()
    if (!loops.length) return 'No loops found.'
    return loops.map(loop => `${loop.loopId} ${loop.status} ${loop.title}`).join('\n')
  }

  private async goalsReply(): Promise<string> {
    const goals = await this.goalStore.listGoals({ limit: 10 })
    if (!goals.length) return 'No goals found.'
    return goals.map(goal =>
      `${goal.metadata.goalId} ${goal.metadata.status} ${goal.metadata.progressPercent}% ${goal.metadata.title}`,
    ).join('\n')
  }

  private async questionsReply(): Promise<string> {
    const questions = await new LocalQuestionStore(this.store.workspaceRoot).listQuestions({ limit: 10 })
    if (!questions.length) return 'No user questions found.'
    return [
      'Pando questions',
      ...questions.map(question =>
        `${question.questionId} ${question.status} ${question.mode}: ${question.question}${question.answer ? ` -> ${question.answer}` : ''}`,
      ),
      'Reply with: /answer <questionId> <answer>',
    ].join('\n')
  }

  private async answerQuestionReply(args: readonly string[], userId: string | undefined): Promise<string> {
    const questionId = args[0]
    const answer = args.slice(1).join(' ').trim()
    if (!questionId || !answer) return 'Usage: /answer <questionId> <answer>'
    try {
      const question = await new LocalQuestionStore(this.store.workspaceRoot).answerQuestion(
        questionId,
        answer,
        userId ? `gateway:${userId}` : 'gateway',
      )
      await this.store.appendEvent({
        type: 'gateway_question_answered',
        message: 'Gateway answered a user question.',
        data: {
          questionId: question.questionId,
          status: question.status,
          answeredBy: question.answeredBy,
          goalId: question.goalId,
          taskId: question.taskId,
          threadId: question.threadId,
        },
      })
      return [
        `Question answered: ${question.questionId}`,
        `status: ${question.status}`,
        `answer: ${question.answer ?? ''}`,
      ].join('\n')
    } catch (error) {
      return `Question answer failed: ${errorMessage(error)}`
    }
  }

  private async goalReply(args: readonly string[], gatewayRunId: string): Promise<string> {
    const action = args[0]?.toLowerCase() || 'status'
    const goalIdInput = action === 'status' || action === 'resume' ? args[1] : args[0]
    try {
      if (action === 'resume') {
        const goalId = await this.resolveGoalId(goalIdInput)
        const summary = await this.goalService.resumeGoal(goalId, 'Goal resumed from Gateway.')
        await this.goalStore.appendRun(goalId, {
          runId: gatewayRunId,
          kind: 'gateway',
          status: 'completed',
          startedAtMs: Date.now(),
          completedAtMs: Date.now(),
          gatewayRunId,
          summary: 'Goal resumed from Gateway command.',
        })
        await this.store.appendEvent({
          type: 'gateway_goal_resumed',
          message: 'Gateway resumed a goal.',
          data: {
            goalId,
            status: summary.metadata.status,
            progressPercent: summary.metadata.progressPercent,
          },
        })
        return this.formatGoalReply(summary)
      }
      if (action !== 'status' && args.length > 1) return 'Usage: /goal [status <goalId>|resume <goalId>]'
      const goalId = await this.resolveGoalId(goalIdInput)
      return this.formatGoalReply(await this.goalStore.readSummary(goalId))
    } catch (error) {
      return `Goal command failed: ${errorMessage(error)}`
    }
  }

  private async resolveGoalId(goalId: string | undefined): Promise<string> {
    if (goalId) return goalId
    const active = await this.goalStore.activeGoal()
    if (!active) throw new Error('No active goal found.')
    return active.metadata.goalId
  }

  private formatGoalReply(goal: Awaited<ReturnType<LocalGoalStore['readSummary']>>): string {
    return [
      `Goal: ${goal.metadata.goalId}`,
      `status: ${goal.metadata.status}`,
      `progress: ${goal.metadata.progressPercent}%`,
      `requirements: ${goal.metadata.completedRequirementCount}/${goal.requirementCount}`,
      `blockers: ${goal.metadata.blockerCount}`,
      `evidence: ${goal.evidenceCount}`,
      `title: ${goal.metadata.title}`,
    ].join('\n')
  }

  private async backgroundReply(loopId: string | undefined): Promise<string> {
    if (!loopId) {
      const loops = await this.heartbeatLoopCandidates()
      if (!loops.length) return 'No background loops are enrolled. Usage: /background <loopId>'
      return [
        'Background heartbeat loops',
        ...loops.map(loop => `${loop.loopId} ${loop.status} ${loop.title}`),
      ].join('\n')
    }

    try {
      const metadata = await this.loopStore.readMetadata(loopId)
      if (metadata.status === 'completed' || metadata.status === 'failed' || metadata.status === 'blocked' || metadata.status === 'stopped') {
        return `Cannot background loop ${loopId} while status is ${metadata.status}. Resume or recreate it first.`
      }
      const nextStatus = metadata.status === 'running' ? 'running' : 'paused'
      const next = await this.loopStore.updateMetadata(loopId, {
        trigger: 'heartbeat',
        status: nextStatus,
        spec: {
          ...metadata.spec,
          trigger: 'heartbeat',
        },
      })
      await this.loopStore.writeState(next, 'Loop enrolled for Gateway heartbeat background execution.')
      await this.loopStore.appendEvent(loopId, {
        type: 'loop_background_enabled',
        status: next.status,
        message: 'Loop enrolled for Gateway heartbeat background execution.',
        data: {
          trigger: next.trigger,
          status: next.status,
        },
      })
      await this.store.appendEvent({
        type: 'gateway_background_enabled',
        message: 'Gateway enrolled a loop for heartbeat background execution.',
        data: {
          loopId,
          trigger: next.trigger,
          status: next.status,
        },
      })
      return [
        `Background enabled: ${next.loopId}`,
        `Trigger: ${next.trigger}`,
        `Status: ${next.status}`,
        'Wake heartbeat will resume this loop when the Gateway runs.',
      ].join('\n')
    } catch (error) {
      const message = errorMessage(error)
      await this.store.appendEvent({
        type: 'gateway_background_failed',
        message: 'Gateway failed to enroll a background loop.',
        data: {
          loopId,
          error: message,
        },
      })
      return `Background failed for ${loopId}: ${message}`
    }
  }

  private async modelReply(args: readonly string[], options: GatewayRuntimeOptions): Promise<string> {
    if (!args.length) return currentModelReply(options.config)

    const provider = args[0]?.trim()
    if (!provider || !/^[A-Za-z0-9_-]+$/.test(provider)) {
      return 'Usage: /model <provider> [model]. Provider must be an ASCII provider id.'
    }
    const model = args.slice(1).join(' ').trim() || undefined
    if (model && /[\r\n]/.test(model)) return 'Model name cannot contain line breaks.'

    const nextConfig: ProjectConfig = {
      ...(options.config ?? {}),
      model: {
        ...(options.config?.model ?? {}),
        provider,
        name: model,
      },
    }

    try {
      resolveDefaultModel(nextConfig)
    } catch (error) {
      return `Model switch rejected: ${errorMessage(error)}`
    }

    options.config ??= {}
    options.config.model = nextConfig.model
    await this.store.appendEvent({
      type: 'gateway_model_changed',
      message: 'Gateway model changed for the current runtime session.',
      data: {
        provider,
        model: model ?? 'default',
      },
    })
    return [
      'Model updated for current Gateway session.',
      currentModelReply(options.config),
      'Persistent config is unchanged; use Web Settings for permanent model changes.',
    ].join('\n')
  }

  private async resumeLoopReply(loopId: string | undefined, options: GatewayRuntimeOptions): Promise<string> {
    if (!loopId) return 'Usage: /resume <loopId>'
    try {
      const runtime = new LoopRuntime(this.loopStore)
      const output = await runtime.runLoop(loopId, {
        sessionId: options.sessionId,
        config: options.config,
        fetch: options.fetch,
        maxToolRounds: 4,
        resume: true,
      })
      await this.store.appendEvent({
        type: 'gateway_loop_resumed',
        message: 'Gateway resumed a loop.',
        data: {
          loopId,
          status: output.metadata.status,
          iterationCount: output.iterations.length,
          threadId: output.metadata.threadId,
        },
      })
      return [
        `Resumed loop: ${output.metadata.loopId}`,
        `Status: ${output.metadata.status}`,
        `Iterations: ${output.iterations.length}`,
        `Thread: ${output.metadata.threadId ?? 'none'}`,
      ].join('\n')
    } catch (error) {
      const message = errorMessage(error)
      await this.store.appendEvent({
        type: 'gateway_loop_resume_failed',
        message: 'Gateway loop resume failed.',
        data: {
          loopId,
          error: message,
        },
      })
      return `Loop resume failed: ${loopId} (${message})`
    }
  }

  private async compressThreadReply(threadIdInput: string | undefined, options: GatewayRuntimeOptions): Promise<string> {
    let threadId = threadIdInput
    if (!threadId) {
      const latest = await this.threadStore.openLastThread()
      threadId = latest?.metadata.threadId
    }
    if (!threadId) return 'No thread found to compress. Usage: /compress <threadId>'

    try {
      await this.threadStore.readMetadata(threadId)
      const compaction = await compactThreadHistory({
        store: this.threadStore,
        threadId,
        sessionId: options.sessionId,
        config: options.config,
        fetch: options.fetch,
        trigger: 'manual',
        reason: 'manual',
        phase: 'standalone',
        emitEvent: event => this.threadStore.appendEvent(threadId, event),
      })
      await this.store.appendEvent({
        type: 'gateway_thread_compacted',
        message: 'Gateway compacted a thread.',
        data: {
          threadId,
          compactionId: compaction.compactionId,
          coveredMessageCount: compaction.coveredMessageCount,
          retainedMessageCount: compaction.retainedMessageCount,
          windowId: compaction.windowId,
        },
      })
      return [
        `Compacted thread: ${threadId}`,
        `Compaction: ${compaction.compactionId}`,
        `Covered messages: ${compaction.coveredMessageCount}`,
        `Retained messages: ${compaction.retainedMessageCount}`,
        `Window: ${compaction.windowId}`,
      ].join('\n')
    } catch (error) {
      const message = errorMessage(error)
      await this.store.appendEvent({
        type: 'gateway_thread_compaction_failed',
        message: 'Gateway thread compaction failed.',
        data: {
          threadId,
          error: message,
        },
      })
      return `Compaction failed for thread ${threadId}: ${message}`
    }
  }

  private async resolveApprovalReply(
    approvalIdInput: string | undefined,
    decision: StoredApprovalDecision,
    userId: string,
  ): Promise<string> {
    const pending = await this.approvalStore.readPending()
    const approvalId = approvalIdInput ?? pending[0]?.approvalId
    if (!approvalId) return decision === 'reject' ? 'No pending approval to deny.' : 'No pending approval to approve.'
    const record = await this.approvalStore.resolveApproval(approvalId, {
      decision,
      resolvedBy: `gateway:${userId}`,
    })
    if (!record) return `Approval not found: ${approvalId}`
    if (record.status === 'pending') return `Approval is still pending: ${approvalId}`
    return [
      `${record.status === 'approved' ? 'Approved' : 'Rejected'} approval: ${record.approvalId}`,
      `Thread: ${record.threadId}`,
      `Tool: ${record.request.toolName}`,
      `Reason: ${record.reason ?? 'none'}`,
    ].join('\n')
  }

  private async pairUserReply(
    message: GatewayInboundMessage,
    inputSecret: string | undefined,
    options: GatewayRuntimeOptions,
  ): Promise<string> {
    if (message.channelKind === 'local' || message.channelKind === 'mock') {
      return 'Pairing is not required for local or mock gateway channels.'
    }
    const envKey = options.config?.gateway?.pairingSecretEnv
    if (!envKey) return 'Pairing is not configured.'
    const expectedSecret = runtimeEnv(envKey)
    if (!expectedSecret) return `Pairing is not available because ${envKey} is not set.`
    if (!inputSecret || inputSecret !== expectedSecret) return 'Pairing failed: invalid code.'
    const paired = await this.store.upsertPairedUser({
      channelId: message.channelId,
      channelKind: message.channelKind,
      userId: message.userId,
      sourceMessageId: message.messageId,
    })
    await this.store.appendEvent({
      type: 'gateway_user_paired',
      message: 'Gateway paired a user.',
      data: {
        channelId: paired.channelId,
        channelKind: paired.channelKind,
        userId: paired.userId,
      },
    })
    return `Paired gateway user: ${paired.channelId}/${paired.userId}`
  }

  private async createState(
    options: GatewayRuntimeOptions,
    status: GatewayState['status'],
    previousState?: GatewayState,
  ): Promise<GatewayState> {
    const now = Date.now()
    const activeLoops = await this.loopSnapshots()
    const pendingApprovals = await this.pendingApprovalSnapshots()
    const pairedUsers = await this.store.readPairedUsers()
    return {
      schemaVersion: 1,
      pid: runtimePid(),
      sessionId: options.sessionId,
      status,
      startedAtMs: now,
      updatedAtMs: now,
      lastHeartbeatAtMs: now,
      heartbeatCount: 0,
      wakeCount: 0,
      cwd: this.store.workspaceRoot,
      statePath: this.store.filePath(STATE_FILE),
      connectedChannels: resolveChannels(options.config),
      activeLoops,
      pendingApprovals,
      pairedUsers,
      recoveredFrom: createRecoverySnapshot(previousState, {
        recoveredAtMs: now,
        activeLoopCount: activeLoops.length,
        pendingApprovalCount: pendingApprovals.length,
        pairedUserCount: pairedUsers.length,
      }),
    }
  }

  private async updateHeartbeat(
    current: GatewayState,
    options: GatewayRuntimeOptions,
    status: GatewayState['status'],
  ): Promise<GatewayState> {
    const now = Date.now()
    const state: GatewayState = {
      ...current,
      status,
      updatedAtMs: now,
      lastHeartbeatAtMs: now,
      heartbeatCount: current.heartbeatCount + 1,
      connectedChannels: resolveChannels(options.config),
      activeLoops: await this.loopSnapshots(),
      pendingApprovals: await this.pendingApprovalSnapshots(),
      pairedUsers: await this.store.readPairedUsers(),
    }
    await this.store.writeState(state)
    await this.store.appendEvent({
      type: 'gateway_heartbeat',
      message: `Gateway heartbeat ${state.heartbeatCount}.`,
      data: {
        status,
        heartbeatCount: state.heartbeatCount,
      },
    })
    options.stdout?.write(`gateway heartbeat: ${state.heartbeatCount}\n`)
    return state
  }

  private async loopSnapshots(): Promise<GatewayLoopSnapshot[]> {
    try {
      const loops = await this.loopStore.listLoops()
      return loops.slice(0, 20).map(loopSnapshot)
    } catch {
      return []
    }
  }

  private async sendProgressHeartbeats(
    options: GatewayRuntimeOptions,
    adapters: readonly GatewayChannelAdapter[],
    progressState: Map<string, GatewayProgressState>,
  ): Promise<{ activeLoops?: GatewayLoopSnapshot[] }> {
    const loops = await this.loopSnapshots()
    const runningLoops = loops.filter(loop => loop.status === 'running' && loop.currentRunId)
    const runningKeys = new Set(runningLoops.map(loop => loop.loopId))
    for (const key of Array.from(progressState.keys())) {
      if (!runningKeys.has(key)) progressState.delete(key)
    }
    if (!runningLoops.length) return { activeLoops: loops }

    const recipients = progressRecipients(options, adapters)
    for (const loop of runningLoops) {
      const currentRunId = loop.currentRunId
      if (!currentRunId) continue
      const previous = progressState.get(loop.loopId)
      const count = previous?.runId === currentRunId ? previous.count + 1 : 1
      progressState.set(loop.loopId, {
        runId: currentRunId,
        count,
        lastSentAtMs: Date.now(),
      })
      const text = [
        `Still working: ${loop.loopId}`,
        `Title: ${loop.title}`,
        `Run: ${currentRunId}`,
        `Progress heartbeat: ${count}`,
      ].join('\n')
      for (const recipient of recipients) {
        await this.sendOutbound(adapters, {
          channelId: recipient.channelId,
          userId: recipient.userId,
          text,
        })
      }
      await this.store.appendEvent({
        type: 'gateway_progress_heartbeat',
        message: 'Gateway sent a progress heartbeat.',
        data: {
          loopId: loop.loopId,
          runId: currentRunId,
          progressHeartbeatCount: count,
          recipientCount: recipients.length,
        },
      })
      options.stdout?.write(`gateway progress: ${loop.loopId} run ${currentRunId} heartbeat ${count}\n`)
    }
    return { activeLoops: loops }
  }

  private async runWakeHeartbeat(
    options: GatewayRuntimeOptions,
    adapters: readonly GatewayChannelAdapter[],
  ): Promise<GatewayWakeRun> {
    try {
      const loops = await this.loopSnapshots()
      const approvals = await this.pendingApprovalSnapshots()
      const channels = resolveChannels(options.config)
      const heartbeatLoops = await this.heartbeatLoopCandidates()
      const triggeredLoops = await this.runHeartbeatTriggeredLoops(options, heartbeatLoops.slice(0, 1))
      const goalRuntime = new GoalRuntime(this.goalStore)
      const goalOutput = await goalRuntime.resumeActiveGoal({
        sessionId: options.sessionId,
        idle: true,
      })
      const wake: GatewayWakeRun = {
        wakeId: `gw_wake_${Date.now()}_${shortId()}`,
        sessionId: options.sessionId,
        createdAtMs: Date.now(),
        status: approvals.length ? 'attention_required' : goalOutput.ok ? 'ok' : 'failed',
        action: 'state_check',
        loopCount: loops.length,
        runningLoopCount: loops.filter(loop => loop.status === 'running').length,
        heartbeatLoopCount: heartbeatLoops.length,
        triggeredLoopCount: triggeredLoops.length,
        activeGoalId: goalOutput.goal?.metadata.goalId,
        goalRuntimeStatus: goalOutput.status,
        goalRuntimeMessage: goalOutput.message,
        goalProgressPercent: goalOutput.goal?.metadata.progressPercent,
        pendingApprovalCount: approvals.length,
        channelCount: channels.length,
        message: approvals.length
          ? `Wake heartbeat found ${approvals.length} pending approval(s).`
          : triggeredLoops.length
            ? `Wake heartbeat triggered ${triggeredLoops.length} heartbeat loop(s).`
            : goalOutput.status === 'continued'
              ? `Wake heartbeat continued goal ${goalOutput.goal?.metadata.goalId}.`
              : 'Wake heartbeat completed a state check.',
        triggeredLoops,
      }
      await this.store.appendWakeRun(wake)
      await this.store.appendEvent({
        type: 'gateway_wake_heartbeat',
        message: wake.message,
        data: wake,
      })
      if (approvals.length) {
        const text = [
          `Attention needed: ${approvals.length} pending approval(s).`,
          `Wake: ${wake.wakeId}`,
          `Running loops: ${wake.runningLoopCount}`,
        ].join('\n')
        for (const recipient of progressRecipients(options, adapters)) {
          await this.sendOutbound(adapters, {
            channelId: recipient.channelId,
            userId: recipient.userId,
            text,
          })
        }
      }
      options.stdout?.write(`gateway wake: ${wake.status} approvals ${wake.pendingApprovalCount}\n`)
      return wake
    } catch (error) {
      const wake: GatewayWakeRun = {
        wakeId: `gw_wake_${Date.now()}_${shortId()}`,
        sessionId: options.sessionId,
        createdAtMs: Date.now(),
        status: 'failed',
        action: 'state_check',
        loopCount: 0,
        runningLoopCount: 0,
        pendingApprovalCount: 0,
        channelCount: 0,
        message: `Wake heartbeat failed: ${errorMessage(error)}`,
      }
      await this.store.appendWakeRun(wake)
      await this.store.appendEvent({
        type: 'gateway_wake_heartbeat_failed',
        message: wake.message,
        data: wake,
      })
      return wake
    }
  }

  private async heartbeatLoopCandidates(): Promise<LoopMetadata[]> {
    try {
      const loops = await this.loopStore.listLoops()
      return loops.filter(loop => loop.trigger === 'heartbeat' && (loop.status === 'created' || loop.status === 'paused'))
    } catch {
      return []
    }
  }

  private async runHeartbeatTriggeredLoops(
    options: GatewayRuntimeOptions,
    loops: readonly LoopMetadata[],
  ): Promise<NonNullable<GatewayWakeRun['triggeredLoops']>> {
    const triggered: {
      loopId: string
      status: string
      iterationCount?: number
      message?: string
    }[] = []
    for (const loop of loops) {
      await this.store.appendEvent({
        type: 'gateway_heartbeat_loop_started',
        message: 'Gateway wake heartbeat started a heartbeat loop.',
        data: {
          loopId: loop.loopId,
          status: loop.status,
        },
      })
      try {
        const runtime = new LoopRuntime(this.loopStore)
        const output = await runtime.runLoop(loop.loopId, {
          sessionId: options.sessionId,
          config: options.config,
          fetch: options.fetch,
          maxToolRounds: 4,
          resume: loop.status === 'paused',
        })
        const result = {
          loopId: output.metadata.loopId,
          status: output.metadata.status,
          iterationCount: output.iterations.length,
          message: output.run.finalMessage,
        }
        triggered.push(result)
        await this.store.appendEvent({
          type: 'gateway_heartbeat_loop_completed',
          message: 'Gateway wake heartbeat completed a heartbeat loop.',
          data: result,
        })
      } catch (error) {
        const result = {
          loopId: loop.loopId,
          status: 'failed',
          message: errorMessage(error),
        }
        triggered.push(result)
        await this.store.appendEvent({
          type: 'gateway_heartbeat_loop_failed',
          message: 'Gateway wake heartbeat failed to run a heartbeat loop.',
          data: result,
        })
      }
    }
    return triggered
  }

  private async pendingApprovalSnapshots(): Promise<GatewayApprovalSnapshot[]> {
    try {
      return (await this.approvalStore.readPending()).slice(0, 20).map(approvalSnapshot)
    } catch {
      return []
    }
  }

  private async receiveLocalMessage(
    adapters: readonly GatewayChannelAdapter[],
    message: Omit<GatewayInboundMessage, 'messageId' | 'createdAtMs' | 'channelKind'>,
  ): Promise<GatewayInboundMessage> {
    const adapter = adapterForChannel(adapters, message.channelId)
      ?? adapterForChannel(adapters, 'local')
      ?? adapters[0]
    if (!adapter?.receiveLocalMessage) {
      return this.store.appendInbound({
        ...message,
        channelKind: adapter?.kind ?? (message.channelId === 'mock' ? 'mock' : 'local'),
      })
    }
    return adapter.receiveLocalMessage(this.store, message)
  }

  private async sendOutbound(
    adapters: readonly GatewayChannelAdapter[],
    input: Omit<GatewayOutboundMessage, 'messageId' | 'createdAtMs' | 'deliveryStatus' | 'deliveryMessage'>,
  ): Promise<GatewayChannelDeliveryResult> {
    const adapter = adapterForChannel(adapters, input.channelId)
      ?? adapterForChannel(adapters, 'local')
      ?? adapters[0]
    const message: GatewayOutboundMessage = {
      messageId: `gw_out_${Date.now()}_${shortId()}`,
      createdAtMs: Date.now(),
      ...input,
    }
    const delivery = adapter
      ? await adapter.send(this.store, message)
      : { channelId: input.channelId, status: 'failed' as const, message: 'No gateway channel adapter is available.' }
    await this.store.appendEvent({
      type: delivery.status === 'delivered' || delivery.status === 'queued'
        ? 'gateway_channel_message_sent'
        : 'gateway_channel_message_failed',
      message: delivery.message ?? `Gateway channel ${delivery.channelId} ${delivery.status}.`,
      data: {
        channelId: delivery.channelId,
        status: delivery.status,
        messageId: message.messageId,
      },
    })
    return delivery
  }
}

export function resolveChannels(config: ProjectConfig | undefined): GatewayChannelSnapshot[] {
  return createGatewayChannelAdapters(config).map(adapter => adapter.snapshot())
}

export function createGatewayChannelAdapters(
  config: ProjectConfig | undefined,
  fetcher?: GenerateOptions['fetch'],
): GatewayChannelAdapter[] {
  const configured = config?.gateway?.channels ?? {}
  const adapters: GatewayChannelAdapter[] = [
    createLocalLikeChannelAdapter('local', {
      kind: 'local',
      enabled: true,
    }),
  ]
  for (const [id, channel] of Object.entries(configured)) {
    if (id === 'local') {
      adapters[0] = createLocalLikeChannelAdapter(id, channel)
      continue
    }
    adapters.push(createChannelAdapter(id, channel, fetcher))
  }
  return adapters
}

export function formatGatewayDoctorReport(report: GatewayDoctorReport): string {
  const lines = [
    report.ok ? 'Pando gateway doctor: ok' : 'Pando gateway doctor: failed',
    `cwd: ${report.cwd}`,
    `state: ${report.statePath}`,
    `watchdog: ${report.watchdog.status} - ${report.watchdog.message}`,
    '',
  ]
  for (const channel of report.channels) {
    const statusParts = [`status=${channel.status}`]
    if (channel.outboundStatus) statusParts.push(`outbound=${channel.outboundStatus}`)
    if (channel.inboundStatus) statusParts.push(`inbound=${channel.inboundStatus}`)
    lines.push(`${channel.status === 'failed' ? 'FAIL' : 'INFO'} channel ${channel.id}: ${channel.kind} ${statusParts.join(', ')}${channel.message ? ` - ${channel.message}` : ''}`)
  }
  for (const check of report.checks) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.message}`)
  }
  lines.push('')
  return lines.join('\n')
}

function isMessageAllowed(
  message: GatewayInboundMessage,
  options: GatewayRuntimeOptions,
  pairedUsers: ReadonlySet<string>,
): boolean {
  if (message.channelKind === 'local' || message.channelKind === 'mock') return true
  if (pairedUsers.has(pairKey(message.channelId, message.userId))) return true
  const allowed = new Set([
    ...(options.allowUsers ?? []),
    ...(options.config?.gateway?.allowUsers ?? []),
    ...(options.config?.gateway?.channels?.[message.channelId]?.allowedUsers ?? []),
  ])
  return allowed.has(message.userId)
}

function isPairCommand(text: string): boolean {
  return firstWord(text).toLowerCase() === '/pair'
}

function pairSecretInput(text: string): string | undefined {
  const [, secret] = text.trim().split(/\s+/, 2)
  return secret
}

function pairKey(channelId: string, userId: string): string {
  return `${channelId}:${userId}`
}

function createRecoverySnapshot(
  previousState: GatewayState | undefined,
  current: {
    recoveredAtMs: number
    activeLoopCount: number
    pendingApprovalCount: number
    pairedUserCount: number
  },
): GatewayRecoverySnapshot | undefined {
  if (!previousState || !isRecoverableGatewayStatus(previousState.status)) return undefined
  return {
    previousSessionId: previousState.sessionId,
    previousPid: previousState.pid,
    previousStatus: previousState.status,
    previousStartedAtMs: previousState.startedAtMs,
    previousUpdatedAtMs: previousState.updatedAtMs,
    previousHeartbeatAtMs: previousState.lastHeartbeatAtMs,
    staleMs: Math.max(0, current.recoveredAtMs - previousState.lastHeartbeatAtMs),
    recoveredAtMs: current.recoveredAtMs,
    previousActiveLoopCount: previousState.activeLoops.length,
    previousPendingApprovalCount: previousState.pendingApprovals.length,
    currentActiveLoopCount: current.activeLoopCount,
    currentPendingApprovalCount: current.pendingApprovalCount,
    pairedUserCount: current.pairedUserCount,
  }
}

function isRecoverableGatewayStatus(status: GatewayRuntimeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'failed'
}

function currentModelReply(config: ProjectConfig | undefined): string {
  try {
    const model = resolveDefaultModel(config ?? {})
    return `model: ${model.provider.id}/${model.model ?? model.provider.defaultModel}`
  } catch (error) {
    const selection = config?.model
    return `model: ${selection?.provider ?? 'default'}/${selection?.name ?? 'default'} (${errorMessage(error)})`
  }
}

function loopSnapshot(loop: LoopMetadata): GatewayLoopSnapshot {
  return {
    loopId: loop.loopId,
    title: loop.title,
    status: loop.status,
    updatedAtMs: loop.updatedAtMs,
    currentRunId: loop.currentRunId,
  }
}

type GatewayProgressState = {
  runId: string
  count: number
  lastSentAtMs: number
}

function progressRecipients(
  options: GatewayRuntimeOptions,
  adapters: readonly GatewayChannelAdapter[],
): { channelId: string; userId: string }[] {
  const userId = options.allowUsers?.[0] ?? options.config?.gateway?.allowUsers?.[0] ?? 'local-user'
  const recipients: { channelId: string; userId: string }[] = []
  for (const adapter of adapters) {
    if (adapter.status !== 'connected') continue
    if (adapter.kind !== 'local' && adapter.kind !== 'mock') continue
    const channel = options.config?.gateway?.channels?.[adapter.id]
    recipients.push({
      channelId: adapter.id,
      userId: channel?.allowedUsers?.[0] ?? userId,
    })
  }
  return recipients.length ? recipients : [{ channelId: 'local', userId }]
}

function createChannelAdapter(
  id: string,
  channel: GatewayChannelConfig,
  fetcher?: GenerateOptions['fetch'],
): GatewayChannelAdapter {
  if (channel.kind === 'local' || channel.kind === 'mock') return createLocalLikeChannelAdapter(id, channel)
  return createExternalChannelAdapter(id, channel, fetcher)
}

function createLocalLikeChannelAdapter(id: string, channel: GatewayChannelConfig): GatewayChannelAdapter {
  const disabled = channel.enabled === false
  return {
    id,
    kind: channel.kind,
    status: disabled ? 'disabled' : 'connected',
    snapshot() {
      return {
        id,
        kind: channel.kind,
        status: disabled ? 'disabled' : 'connected',
        outboundStatus: disabled ? 'disabled' : 'connected',
        inboundStatus: disabled ? 'disabled' : 'connected',
        message: disabled ? 'Channel is disabled.' : `${channel.kind} channel uses the local gateway store.`,
      }
    },
    async receiveLocalMessage(store, message) {
      return store.appendInbound({
        ...message,
        channelKind: channel.kind,
      })
    },
    async send(store, message) {
      if (disabled) {
        const skipped: GatewayOutboundMessage = {
          ...message,
          deliveryStatus: 'skipped',
          deliveryMessage: 'Channel is disabled.',
        }
        await store.appendOutbound(skipped)
        return {
          channelId: id,
          status: 'skipped',
          message: 'Channel is disabled.',
        }
      }
      const delivered: GatewayOutboundMessage = {
        ...message,
        channelId: id,
        deliveryStatus: 'delivered',
        deliveryMessage: `${channel.kind} channel delivered through local outbox.`,
      }
      await store.appendOutbound(delivered)
      return {
        channelId: id,
        status: 'delivered',
        message: `${channel.kind} channel delivered through local outbox.`,
      }
    },
  }
}

function createExternalChannelAdapter(
  id: string,
  channel: GatewayChannelConfig,
  fetcher?: GenerateOptions['fetch'],
): GatewayChannelAdapter {
  const disabled = channel.enabled === false
  const missingConfig = disabled ? [] : missingExternalConfig(channel)
  const status: GatewayChannelStatus = disabled ? 'disabled' : missingConfig.length ? 'missing_config' : 'configured'
  const inboundStatus = disabled ? 'disabled' : externalInboundStatus(channel)
  const inboundMessage = disabled ? 'Channel is disabled.' : externalInboundMessage(channel, inboundStatus)
  return {
    id,
    kind: channel.kind,
    status,
    snapshot() {
      return {
        id,
        kind: channel.kind,
        status,
        outboundStatus: status,
        inboundStatus,
        message: disabled
          ? 'Channel is disabled.'
          : status === 'configured'
            ? `Outbound configured via ${configuredExternalEnvKeys(channel).join(', ')}. ${inboundMessage}`
            : `Outbound missing ${missingConfig.join(', ')}. ${inboundMessage}`,
      }
    },
    async send(store, message) {
      if (status !== 'configured') {
        const deliveryStatus: GatewayChannelDeliveryStatus = 'skipped'
        const deliveryMessage = `${channel.kind} channel is ${status}; outbound message skipped.`
        await store.appendOutbound({
          ...message,
          channelId: id,
          deliveryStatus,
          deliveryMessage,
        })
        return {
          channelId: id,
          status: deliveryStatus,
          message: deliveryMessage,
        }
      }

      const delivery = await deliverExternalGatewayMessage(channel, message, fetcher)
      await store.appendOutbound({
        ...message,
        channelId: id,
        deliveryStatus: delivery.status,
        deliveryMessage: delivery.message,
      })
      return {
        channelId: id,
        status: delivery.status,
        message: delivery.message,
      }
    },
  }
}

async function deliverExternalGatewayMessage(
  channel: GatewayChannelConfig,
  message: GatewayOutboundMessage,
  fetcher?: GenerateOptions['fetch'],
): Promise<{ status: GatewayChannelDeliveryStatus; message: string }> {
  const fetchImpl = resolveGatewayFetch(fetcher)
  if (!fetchImpl) {
    return {
      status: 'failed',
      message: `${channel.kind} channel is configured but fetch is unavailable.`,
    }
  }

  const request = buildExternalGatewayRequest(channel, message)
  if (!request) {
    return {
      status: 'skipped',
      message: `${channel.kind} channel is missing delivery configuration.`,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    })
    const responseText = await safeResponsePreview(response)
    if (!response.ok) {
      return {
        status: 'failed',
        message: `${request.label} delivery failed with HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`,
      }
    }
    return {
      status: 'delivered',
      message: `${request.label} delivery completed with HTTP ${response.status}.`,
    }
  } catch (error) {
    return {
      status: 'failed',
      message: `${request.label} delivery failed: ${errorMessage(error)}`,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function buildExternalGatewayRequest(
  channel: GatewayChannelConfig,
  message: GatewayOutboundMessage,
): { url: string; headers: Record<string, string>; body: unknown; label: string } | undefined {
  if (channel.kind === 'telegram') {
    const token = channel.tokenEnv ? runtimeEnv(channel.tokenEnv) : undefined
    const chatId = channel.chatIdEnv ? runtimeEnv(channel.chatIdEnv) : undefined
    if (!token || !chatId) return undefined
    return {
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        chat_id: chatId,
        text: message.text,
      },
      label: 'telegram',
    }
  }

  const webhookUrl = channel.webhookEnv ? runtimeEnv(channel.webhookEnv) : undefined
  if (!webhookUrl) return undefined
  return {
    url: webhookUrl,
    headers: {
      'Content-Type': 'application/json',
    },
    body: webhookPayload(channel.kind, message.text),
    label: channel.kind,
  }
}

function webhookPayload(kind: GatewayChannelKind, text: string): unknown {
  if (kind === 'wecom') {
    return {
      msgtype: 'text',
      text: {
        content: text,
      },
    }
  }
  if (kind === 'feishu' || kind === 'lark') {
    return {
      msg_type: 'text',
      content: {
        text,
      },
    }
  }
  return { text }
}

function missingExternalConfig(channel: GatewayChannelConfig): string[] {
  if (channel.kind === 'telegram') {
    const missing = []
    if (!channel.tokenEnv || !runtimeEnv(channel.tokenEnv)) missing.push(channel.tokenEnv ?? 'tokenEnv')
    if (!channel.chatIdEnv || !runtimeEnv(channel.chatIdEnv)) missing.push(channel.chatIdEnv ?? 'chatIdEnv')
    return missing
  }
  if (!channel.webhookEnv || !runtimeEnv(channel.webhookEnv)) return [channel.webhookEnv ?? 'webhookEnv']
  return []
}

function configuredExternalEnvKeys(channel: GatewayChannelConfig): string[] {
  if (channel.kind === 'telegram') {
    return [channel.tokenEnv, channel.chatIdEnv].filter((key): key is string => Boolean(key))
  }
  return [channel.webhookEnv].filter((key): key is string => Boolean(key))
}

function externalInboundStatus(channel: GatewayChannelConfig): GatewayChannelStatus {
  if (!channel.ingressSecretEnv) return 'missing_config'
  return runtimeEnv(channel.ingressSecretEnv) ? 'configured' : 'missing_config'
}

function externalInboundMessage(channel: GatewayChannelConfig, status: GatewayChannelStatus): string {
  if (status === 'configured') return `Inbound configured via ${channel.ingressSecretEnv}.`
  return `Inbound missing ${channel.ingressSecretEnv ?? 'ingressSecretEnv'}.`
}

function resolveGatewayFetch(fetcher: GenerateOptions['fetch'] | undefined): GatewayFetch | undefined {
  const runtime = globalThis as unknown as { fetch?: GatewayFetch }
  return fetcher ?? runtime.fetch
}

async function safeResponsePreview(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.replace(/\s+/g, ' ').trim().slice(0, 240)
  } catch {
    return ''
  }
}

function adapterForChannel(
  adapters: readonly GatewayChannelAdapter[],
  channelId: string,
): GatewayChannelAdapter | undefined {
  return adapters.find(adapter => adapter.id === channelId)
}

function approvalSnapshot(record: StoredApprovalRecord): GatewayApprovalSnapshot {
  return {
    approvalId: record.approvalId,
    threadId: record.threadId,
    status: 'pending',
    createdAtMs: record.createdAtMs,
    toolName: record.request.toolName,
    risk: record.request.risk,
    reason: record.request.reason,
  }
}

function summarizeToolFailureEvent(threadId: string, event: AgentEvent): GatewayToolFailureSummary | undefined {
  if (event.type !== 'tool_call_completed' && event.type !== 'tool_result') return undefined
  if (event.ok !== false) return undefined
  const metadata = recordValue(event.metadata)
  const code = stringValue(metadata?.code) ?? 'tool_failed'
  const category = stringValue(metadata?.category) ?? 'unknown'
  return {
    threadId,
    toolUseId: stringValue(event.toolUseId),
    toolName: stringValue(event.toolName) ?? 'tool',
    code,
    category,
    message: stringValue(metadata?.message),
    contentPreview: stringValue(event.contentPreview),
    createdAtMs: typeof event.createdAtMs === 'number' ? event.createdAtMs : 0,
  }
}

function summarizeExternalChannels(channels: readonly GatewayChannelSnapshot[]): string {
  const external = channels.filter(channel => channel.kind !== 'local' && channel.kind !== 'mock')
  if (!external.length) return 'No external channels configured; local mock channel is available.'
  return external.map(channel => `${channel.id}:${channel.status}`).join(', ')
}

function evaluateGatewayWatchdog(
  state: GatewayState | undefined,
  config: ProjectConfig | undefined,
): GatewayWatchdogReport {
  const staleAfterMs = gatewayStaleAfterMs(config)
  if (!state) {
    return {
      status: 'not_started',
      ok: true,
      stale: false,
      recoverable: false,
      staleAfterMs,
      message: 'Gateway has not been started in this workspace.',
    }
  }

  const lastHeartbeatAtMs = state.lastHeartbeatAtMs
  const heartbeatAgeMs = lastHeartbeatAtMs ? Math.max(0, Date.now() - lastHeartbeatAtMs) : undefined
  if (state.status === 'stopped') {
    return {
      status: 'stopped',
      ok: true,
      stale: false,
      recoverable: false,
      staleAfterMs,
      heartbeatAgeMs,
      lastHeartbeatAtMs,
      message: `Gateway is stopped after ${state.heartbeatCount} heartbeat(s).`,
    }
  }

  if (state.status === 'failed') {
    return {
      status: 'failed',
      ok: false,
      stale: true,
      recoverable: true,
      staleAfterMs,
      heartbeatAgeMs,
      lastHeartbeatAtMs,
      message: state.lastError
        ? `Gateway failed: ${state.lastError}`
        : 'Gateway last recorded a failed state; restart to recover.',
    }
  }

  if (!lastHeartbeatAtMs) {
    return {
      status: 'unknown',
      ok: false,
      stale: true,
      recoverable: isRecoverableGatewayStatus(state.status),
      staleAfterMs,
      message: `Gateway state is ${state.status} but has no heartbeat timestamp.`,
    }
  }

  if (heartbeatAgeMs !== undefined && heartbeatAgeMs > staleAfterMs) {
    return {
      status: 'stale',
      ok: false,
      stale: true,
      recoverable: isRecoverableGatewayStatus(state.status),
      staleAfterMs,
      heartbeatAgeMs,
      lastHeartbeatAtMs,
      message: `Gateway heartbeat is stale: age=${heartbeatAgeMs}ms, threshold=${staleAfterMs}ms.`,
    }
  }

  return {
    status: 'healthy',
    ok: true,
    stale: false,
    recoverable: false,
    staleAfterMs,
    heartbeatAgeMs,
    lastHeartbeatAtMs,
    message: `Gateway heartbeat is fresh: age=${heartbeatAgeMs ?? 0}ms, threshold=${staleAfterMs}ms.`,
  }
}

function gatewayStaleAfterMs(config: ProjectConfig | undefined): number {
  const heartbeatIntervalMs = Math.max(50, config?.gateway?.heartbeatIntervalMs ?? 60_000)
  return Math.max(30_000, heartbeatIntervalMs * 3)
}

function formatStatusCounts(statuses: readonly string[]): string {
  if (!statuses.length) return 'none'
  const counts = new Map<string, number>()
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}=${count}`)
    .join(', ')
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await exists(path)) return
  await writeFile(path, content, 'utf8')
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
  await writeFile(path, values.map(value => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf8')
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  if (!(await exists(path))) return []
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0] ?? ''
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function runtimePid(): number {
  const runtime = globalThis as unknown as { process?: { pid?: number } }
  return runtime.process?.pid ?? 0
}

function runtimeEnv(key: string): string | undefined {
  const runtime = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env?.[key]
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
