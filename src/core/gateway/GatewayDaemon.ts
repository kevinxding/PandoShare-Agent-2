import { DurableRuntime } from '../durable/index.js'
import { JsonlStore, RuntimePaths } from '../store/index.js'
import { GatewayApprovalBridge } from './GatewayApprovalBridge.js'
import { createGatewayChannelAdapter, type GatewayAdapterHealth, type GatewayAdapterSendResult, type GatewayChannelAdapter, type GatewayChannelAdapterConfig } from './GatewayChannelAdapter.js'
import { GatewayCommandRouter } from './GatewayCommandRouter.js'
import { GatewayDeliveryQueue } from './GatewayDeliveryQueue.js'
import { GatewayDispatcher, type GatewayDispatcherInput, type GatewayDispatchResult } from './GatewayDispatcher.js'
import { createInboundEnvelope, createOutboundEnvelope, type GatewayChannelKind, type GatewayInboundEnvelope, type GatewayInboundInput, type GatewayOutboundEnvelope, type GatewayOutboundInput } from './GatewayEnvelope.js'
import { GATEWAY_EVENT_TYPES } from './GatewayEventTypes.js'
import { createGatewayIdentity, type GatewayIdentity, type GatewaySource } from './GatewayIdentity.js'
import { GatewayStore, type GatewayHealthSnapshot } from './GatewayStore.js'
import type { GatewayCommandRoute, GatewayInboundMessage } from './GatewayTypes.js'
import { ReconnectPolicy } from './ReconnectPolicy.js'
import { GatewayWakeScheduler } from './GatewayWakeScheduler.js'

export type GatewayDaemonOptions = {
  workspaceRoot: string
  workspaceId?: string
  runtimeId?: string
  gatewayId?: string
  sessionId?: string
  source?: GatewaySource
  adapters?: readonly GatewayChannelAdapter[]
  adapterConfigs?: Record<string, GatewayChannelAdapterConfig>
  dispatcher?: Partial<Omit<GatewayDispatcherInput, 'workspaceId' | 'durable' | 'approvalBridge' | 'statusProvider' | 'healthProvider' | 'backgroundEnroll'>> & {
    approvalBridge?: GatewayApprovalBridge
  }
}

export type GatewayTickResult = {
  inboundProcessed: number
  outboundProcessed: number
  wake: { ok: boolean; loopId?: string; message: string }
  health: GatewayHealthSnapshot
}

export class GatewayDaemon {
  readonly queue: GatewayDeliveryQueue
  readonly durable: DurableRuntime
  readonly store: GatewayStore
  readonly router: GatewayCommandRouter
  readonly identity: GatewayIdentity
  readonly approvalBridge: GatewayApprovalBridge
  readonly dispatcher: GatewayDispatcher
  readonly wakeScheduler: GatewayWakeScheduler
  private readonly reconnect = new ReconnectPolicy()
  private readonly adapters = new Map<string, GatewayChannelAdapter>()

  constructor(private readonly input: GatewayDaemonOptions | { workspaceRoot: string; workspaceId?: string; runtimeId?: string }) {
    const workspaceId = input.workspaceId ?? 'default'
    const paths = new RuntimePaths({ workspaceRoot: input.workspaceRoot, workspaceId })
    this.queue = new GatewayDeliveryQueue(
      new JsonlStore(paths.queuePath('gateway-inbound')),
      new JsonlStore(paths.queuePath('gateway-outbound')),
    )
    this.identity = createGatewayIdentity({
      workspaceId,
      gatewayId: 'gatewayId' in input ? input.gatewayId : undefined,
      sessionId: 'sessionId' in input ? input.sessionId : undefined,
      runtimeId: input.runtimeId ?? 'gateway',
      source: 'source' in input ? input.source : undefined,
    })
    this.durable = new DurableRuntime({ workspaceRoot: input.workspaceRoot, workspaceId })
    this.store = new GatewayStore({ workspaceRoot: input.workspaceRoot, workspaceId, durable: this.durable, identity: this.identity })
    this.router = new GatewayCommandRouter(workspaceId)
    this.approvalBridge = 'dispatcher' in input && input.dispatcher?.approvalBridge
      ? input.dispatcher.approvalBridge
      : new GatewayApprovalBridge({ workspaceId, durable: this.durable })
    this.wakeScheduler = new GatewayWakeScheduler({
      workspaceId,
      durable: this.durable,
      store: this.store,
      loopCommandHandler: 'dispatcher' in input ? input.dispatcher?.loopCommandHandler : undefined,
    })
    this.dispatcher = new GatewayDispatcher({
      workspaceId,
      durable: this.durable,
      ...('dispatcher' in input ? input.dispatcher : {}),
      approvalBridge: this.approvalBridge,
      statusProvider: () => this.status(),
      healthProvider: () => this.health(),
      backgroundEnroll: loopId => this.wakeScheduler.enroll(loopId),
    })
    this.installAdapters('adapters' in input ? input.adapters : undefined, 'adapterConfigs' in input ? input.adapterConfigs : undefined)
  }

  async start(_options: { reason?: string } = {}): Promise<GatewayHealthSnapshot> {
    await this.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.daemonStarted,
      workspaceId: this.identity.workspaceId,
      payload: this.identity,
    })
    for (const adapter of this.adapters.values()) {
      const health: GatewayAdapterHealth = await adapter.connect().catch(error => ({ ok: false, status: 'failed' as const, message: errorMessage(error) }))
      await this.store.appendChannelState({
        channelId: adapter.id,
        channelKind: adapter.kind,
        status: health.status === 'connected' ? 'connected' : health.status === 'missing_config' ? 'missing_config' : 'failed',
        updatedAtMs: Date.now(),
        message: health.message,
        detail: health.detail,
      })
    }
    await this.writeGatewayHeartbeat('running', 'Gateway daemon started.')
    return this.status()
  }

  async stop(reason = 'Gateway daemon stopped.'): Promise<GatewayHealthSnapshot> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect().catch(() => undefined)
      await this.store.appendChannelState({
        channelId: adapter.id,
        channelKind: adapter.kind,
        status: 'disconnected',
        updatedAtMs: Date.now(),
        message: reason,
      })
    }
    await this.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.daemonStopped,
      workspaceId: this.identity.workspaceId,
      payload: { ...this.identity, reason },
    })
    await this.writeGatewayHeartbeat('stopped', reason)
    return this.status()
  }

  async status(): Promise<GatewayHealthSnapshot> {
    const health = await this.store.readHealthSnapshot()
    await this.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.healthReported,
      workspaceId: this.identity.workspaceId,
      payload: health,
    })
    return health
  }

  async health(): Promise<GatewayHealthSnapshot> {
    return this.status()
  }

  async receiveInbound(input: GatewayInboundInput): Promise<{ envelope: GatewayInboundEnvelope; duplicate: boolean; denied: boolean }> {
    const envelope = createInboundEnvelope(input)
    const existing = await this.store.findInboundByDedupeKey(envelope.dedupeKey)
    if (existing) {
      await this.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.inboundDeduped,
        workspaceId: this.identity.workspaceId,
        payload: { ...identityPayload(this.identity), inboundId: existing.inboundId, dedupeKey: envelope.dedupeKey, channelId: envelope.channelId, userId: envelope.userId },
      })
      return { envelope: existing, duplicate: true, denied: false }
    }
    const allowed = await this.isAllowed(envelope)
    const stored = { ...envelope, allowed }
    await this.store.appendInbound(stored)
    if (!allowed) {
      await this.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.inboundDenied,
        workspaceId: this.identity.workspaceId,
        payload: { ...identityPayload(this.identity), inboundId: stored.inboundId, channelId: stored.channelId, channelKind: stored.channelKind, userId: stored.userId },
      })
      await this.enqueueOutbound({
        channelId: stored.channelId,
        channelKind: stored.channelKind,
        userId: stored.userId,
        replyToInboundId: stored.inboundId,
        text: `Denied: user ${stored.userId} is not paired for ${stored.channelId}. Use /pair <secret>.`,
      })
      return { envelope: stored, duplicate: false, denied: true }
    }
    return { envelope: stored, duplicate: false, denied: false }
  }

  async dispatchNextInbound(): Promise<GatewayDispatchResult | undefined> {
    const [inbound] = await this.store.readInbound({ status: 'pending' })
    if (!inbound) return undefined
    if (inbound.allowed === false) {
      await this.store.markInboundRouted(inbound.inboundId, 'denied')
      return undefined
    }
    const route = this.router.route(inbound)
    await this.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.commandCreated,
      workspaceId: this.identity.workspaceId,
      loopId: route.command.loopId,
      payload: { ...identityPayload(this.identity), inboundId: inbound.inboundId, commandId: route.command.commandId, commandType: route.command.commandType },
    })
    await this.store.markInboundRouted(inbound.inboundId, route.command.commandId)
    const result = await this.dispatcher.dispatch(route)
    if (result.replyText) {
      await this.enqueueOutbound({
        channelId: inbound.channelId,
        channelKind: inbound.channelKind,
        userId: inbound.userId,
        replyToInboundId: inbound.inboundId,
        text: result.replyText,
      })
    }
    return result
  }

  async sendNextOutbound(): Promise<GatewayOutboundEnvelope | undefined> {
    const [outbound] = await this.store.readOutbound({ status: ['queued', 'retry_scheduled'], nowMs: Date.now() })
    if (!outbound || (outbound.status !== 'queued' && outbound.status !== 'retry_scheduled')) return undefined
    const adapter = this.adapters.get(outbound.channelId) ?? this.adapters.get(outbound.channelKind) ?? this.adapters.get('local')
    if (!adapter) {
      return this.store.updateOutbound(outbound.deliveryId, { status: 'failed', lastError: 'No gateway adapter configured.', updatedAtMs: Date.now() })
    }
    await this.store.updateOutbound(outbound.deliveryId, { status: 'sending', attempt: outbound.attempt + 1, updatedAtMs: Date.now() })
    const sending = (await this.store.readOutbound({ deliveryId: outbound.deliveryId }))[0] ?? outbound
    const sent: GatewayAdapterSendResult = await adapter.send(sending).catch(error => ({ ok: false, status: 'failed' as const, failureClass: 'unknown' as const, message: errorMessage(error) }))
    if (sent.ok) {
      return this.store.updateOutbound(outbound.deliveryId, { status: 'delivered', lastError: undefined, updatedAtMs: Date.now(), metadata: { ...outbound.metadata, externalMessageId: sent.externalMessageId } })
    }
    const retry = this.reconnect.next(sending.attempt, { failureClass: sent.failureClass, retryAfterMs: sent.retryAfterMs })
    return this.store.updateOutbound(outbound.deliveryId, {
      status: retry.status,
      nextAttemptAtMs: retry.nextAttemptAtMs,
      lastError: sent.message ?? retry.reason,
      updatedAtMs: Date.now(),
    })
  }

  async tick(input: { maxInbound?: number; maxOutbound?: number } = {}): Promise<GatewayTickResult> {
    let inboundProcessed = 0
    let outboundProcessed = 0
    const maxInbound = input.maxInbound ?? 5
    const maxOutbound = input.maxOutbound ?? 5
    for (let index = 0; index < maxInbound; index += 1) {
      const result = await this.dispatchNextInbound()
      if (!result) break
      inboundProcessed += 1
    }
    for (let index = 0; index < maxOutbound; index += 1) {
      const result = await this.sendNextOutbound()
      if (!result) break
      outboundProcessed += 1
    }
    await this.writeGatewayHeartbeat('running', 'Gateway daemon tick.')
    const wake = await this.wakeScheduler.tick()
    return { inboundProcessed, outboundProcessed, wake, health: await this.status() }
  }

  async recover(): Promise<GatewayHealthSnapshot> {
    const health = await this.store.readHealthSnapshot()
    await this.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.daemonRecovered,
      workspaceId: this.identity.workspaceId,
      payload: { ...identityPayload(this.identity), health },
    })
    for (const run of await this.durable.readRecentRuns(20)) {
      const decision = await this.durable.decideRecovery({ runId: run.runId }).catch(() => undefined)
      if (!decision || (decision.decision !== 'requires_human' && decision.decision !== 'mark_corrupted')) continue
      const approvalId = `recovery_${run.runId}`
      await this.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.recoveryEscalated,
        workspaceId: this.identity.workspaceId,
        runId: run.runId,
        payload: { ...identityPayload(this.identity), approvalId, runId: run.runId, decision: decision.decision, reason: decision.reason },
      })
      await this.enqueueOutbound({
        channelId: 'local',
        channelKind: 'local',
        userId: 'operator',
        text: `Recovery requires human decision: ${run.runId} (${decision.reason})`,
        metadata: { approvalId, runId: run.runId },
      })
    }
    await this.writeGatewayHeartbeat('running', 'Gateway daemon recovered.')
    return this.status()
  }

  listPendingApprovals() {
    return this.approvalBridge.listPendingApprovals()
  }

  enqueueOutbound(input: GatewayOutboundInput): Promise<GatewayOutboundEnvelope> {
    return this.store.appendOutbound(createOutboundEnvelope(input))
  }

  async receive(message: Omit<GatewayInboundMessage, 'messageId' | 'createdAtMs'>): Promise<GatewayCommandRoute> {
    const fullMessage: GatewayInboundMessage = {
      messageId: `gw_msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      createdAtMs: Date.now(),
      ...message,
    }
    await this.queue.enqueueInbound(fullMessage)
    const received = await this.receiveInbound({
      channelId: fullMessage.channel,
      channelKind: fullMessage.channel,
      userId: fullMessage.userId,
      text: fullMessage.text,
      externalMessageId: fullMessage.messageId,
      createdAtMs: fullMessage.createdAtMs,
    })
    const route = this.router.route(received.envelope)
    await this.dispatchNextInbound()
    return route
  }

  writeHeartbeat(status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed', message?: string) {
    return this.writeGatewayHeartbeat(status, message)
  }

  private async writeGatewayHeartbeat(status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed', message?: string) {
    await this.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.heartbeat,
      workspaceId: this.identity.workspaceId,
      payload: { ...identityPayload(this.identity), status, message, heartbeatAtMs: Date.now() },
    })
    return this.durable.writeHeartbeat({
      workspaceId: this.identity.workspaceId,
      runtimeId: this.identity.runtimeId,
      workerId: this.identity.runtimeId,
      kernel: 'gateway',
      workerType: 'gateway',
      status,
      message,
    })
  }

  private installAdapters(adapters: readonly GatewayChannelAdapter[] | undefined, configs: Record<string, GatewayChannelAdapterConfig> | undefined): void {
    const installed = adapters?.length ? adapters : [
      createGatewayChannelAdapter('local'),
      createGatewayChannelAdapter('mock'),
      createGatewayChannelAdapter('telegram'),
      createGatewayChannelAdapter('feishu'),
      createGatewayChannelAdapter('lark'),
      createGatewayChannelAdapter('wecom'),
    ]
    for (const adapter of installed) {
      adapter.configure(configs?.[adapter.id] ?? configs?.[adapter.kind] ?? {})
      this.adapters.set(adapter.id, adapter)
      this.adapters.set(adapter.kind, adapter)
    }
  }

  private async isAllowed(envelope: GatewayInboundEnvelope): Promise<boolean> {
    if (envelope.channelKind === 'local' || envelope.channelKind === 'mock') return true
    if (envelope.text.trim().startsWith('/pair')) return true
    const paired = await this.store.readPairedUsers()
    return paired.some(user => user.channelId === envelope.channelId && user.userId === envelope.userId)
  }
}

function identityPayload(identity: GatewayIdentity): Record<string, unknown> {
  return {
    workspaceId: identity.workspaceId,
    gatewayId: identity.gatewayId,
    sessionId: identity.sessionId,
    runtimeId: identity.runtimeId,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
