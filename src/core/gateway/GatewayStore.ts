import { JsonlStore, ProcessFileLock, RuntimePaths, type CorruptJsonlRecord } from '../store/index.js'
import type { DurableRuntime } from '../durable/index.js'
import { GATEWAY_EVENT_TYPES } from './GatewayEventTypes.js'
import type { GatewayIdentity } from './GatewayIdentity.js'
import type { GatewayChannelKind, GatewayInboundEnvelope, GatewayOutboundEnvelope, GatewayOutboundStatus } from './GatewayEnvelope.js'

export type GatewayInboundFilter = {
  status?: 'pending' | 'routed'
  channelId?: string
  inboundId?: string
}

export type GatewayOutboundFilter = {
  status?: GatewayOutboundStatus | readonly GatewayOutboundStatus[]
  channelId?: string
  deliveryId?: string
  nowMs?: number
}

export type GatewayPairedUser = {
  channelId: string
  channelKind: GatewayChannelKind
  userId: string
  pairedAtMs: number
  lastSeenAtMs: number
  status: 'paired' | 'unpaired'
  metadata?: Record<string, unknown>
}

export type GatewayChannelState = {
  channelId: string
  channelKind: GatewayChannelKind
  status: 'registered' | 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'missing_config'
  updatedAtMs: number
  message?: string
  detail?: Record<string, unknown>
}

export type GatewayHealthSnapshot = {
  workspaceId: string
  gatewayId?: string
  sessionId?: string
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'recovered'
  updatedAtMs: number
  inboundCount: number
  pendingInboundCount: number
  outboundCount: number
  queuedOutboundCount: number
  retryOutboundCount: number
  corruptRecordCount: number
  channelStates: GatewayChannelState[]
}

type InboundRecord =
  | { recordType: 'inbound_appended'; envelope: GatewayInboundEnvelope; createdAtMs: number }
  | { recordType: 'inbound_routed'; inboundId: string; commandId: string; routedAtMs: number }

type OutboundRecord =
  | { recordType: 'outbound_appended'; envelope: GatewayOutboundEnvelope; createdAtMs: number }
  | { recordType: 'outbound_updated'; deliveryId: string; patch: Partial<GatewayOutboundEnvelope>; updatedAtMs: number }

type PairingRecord =
  | { recordType: 'pairing_upserted'; user: GatewayPairedUser; createdAtMs: number }
  | { recordType: 'pairing_removed'; channelId: string; userId: string; channelKind: GatewayChannelKind; createdAtMs: number }

type ChannelRecord = { recordType: 'channel_state'; state: GatewayChannelState; createdAtMs: number }

export class GatewayStore {
  private readonly inbound: JsonlStore<InboundRecord>
  private readonly outbound: JsonlStore<OutboundRecord>
  private readonly pairings: JsonlStore<PairingRecord>
  private readonly channels: JsonlStore<ChannelRecord>
  private readonly inboundLock: ProcessFileLock
  private readonly outboundLock: ProcessFileLock
  private readonly pairingsLock: ProcessFileLock
  private readonly channelsLock: ProcessFileLock
  readonly paths: RuntimePaths

  constructor(private readonly input: {
    workspaceRoot: string
    workspaceId?: string
    durable?: DurableRuntime
    identity?: GatewayIdentity
  }) {
    this.paths = new RuntimePaths({ workspaceRoot: input.workspaceRoot, workspaceId: input.workspaceId })
    this.inbound = new JsonlStore(this.paths.queuePath('gateway-v2-inbound'))
    this.outbound = new JsonlStore(this.paths.queuePath('gateway-v2-outbound'))
    this.pairings = new JsonlStore(this.paths.queuePath('gateway-v2-pairings'))
    this.channels = new JsonlStore(this.paths.queuePath('gateway-v2-channels'))
    this.inboundLock = new ProcessFileLock(this.paths.queuePath('gateway-v2-inbound'))
    this.outboundLock = new ProcessFileLock(this.paths.queuePath('gateway-v2-outbound'))
    this.pairingsLock = new ProcessFileLock(this.paths.queuePath('gateway-v2-pairings'))
    this.channelsLock = new ProcessFileLock(this.paths.queuePath('gateway-v2-channels'))
  }

  async appendInbound(envelope: GatewayInboundEnvelope): Promise<GatewayInboundEnvelope> {
    await this.inbound.appendLocked({ recordType: 'inbound_appended', envelope, createdAtMs: Date.now() }, this.inboundLock)
    await this.appendEvent(GATEWAY_EVENT_TYPES.inboundReceived, {
      inboundId: envelope.inboundId,
      dedupeKey: envelope.dedupeKey,
      channelId: envelope.channelId,
      channelKind: envelope.channelKind,
      userId: envelope.userId,
      textPreview: preview(envelope.text),
      externalMessageId: envelope.externalMessageId,
      paired: envelope.paired,
      allowed: envelope.allowed,
      rawRef: envelope.rawRef,
    })
    return envelope
  }

  async readInbound(filter: GatewayInboundFilter = {}): Promise<GatewayInboundEnvelope[]> {
    const read = await this.inbound.readWithCorruption()
    const routed = new Map<string, string>()
    const byId = new Map<string, GatewayInboundEnvelope>()
    for (const record of read.records) {
      if (record.recordType === 'inbound_appended') byId.set(record.envelope.inboundId, record.envelope)
      if (record.recordType === 'inbound_routed') routed.set(record.inboundId, record.commandId)
    }
    return [...byId.values()]
      .filter(item => filter.inboundId === undefined || item.inboundId === filter.inboundId)
      .filter(item => filter.channelId === undefined || item.channelId === filter.channelId)
      .filter(item => filter.status === undefined || (filter.status === 'routed' ? routed.has(item.inboundId) : !routed.has(item.inboundId)))
      .sort((left, right) => left.receivedAtMs - right.receivedAtMs)
  }

  async findInboundByDedupeKey(dedupeKey: string): Promise<GatewayInboundEnvelope | undefined> {
    return (await this.readInbound()).find(item => item.dedupeKey === dedupeKey)
  }

  async markInboundRouted(inboundId: string, commandId: string): Promise<void> {
    await this.inbound.appendLocked({ recordType: 'inbound_routed', inboundId, commandId, routedAtMs: Date.now() }, this.inboundLock)
    await this.appendEvent(GATEWAY_EVENT_TYPES.inboundRouted, { inboundId, commandId })
  }

  async appendOutbound(envelope: GatewayOutboundEnvelope): Promise<GatewayOutboundEnvelope> {
    await this.outbound.appendLocked({ recordType: 'outbound_appended', envelope, createdAtMs: Date.now() }, this.outboundLock)
    await this.appendEvent(GATEWAY_EVENT_TYPES.outboundQueued, summarizeOutbound(envelope))
    return envelope
  }

  async updateOutbound(deliveryId: string, patch: Partial<GatewayOutboundEnvelope>): Promise<GatewayOutboundEnvelope | undefined> {
    const updatedAtMs = patch.updatedAtMs ?? Date.now()
    await this.outbound.appendLocked({ recordType: 'outbound_updated', deliveryId, patch: { ...patch, updatedAtMs }, updatedAtMs }, this.outboundLock)
    const next = (await this.readOutbound({ deliveryId }))[0]
    if (next) await this.appendEvent(eventTypeForOutboundStatus(next.status), summarizeOutbound(next))
    return next
  }

  async readOutbound(filter: GatewayOutboundFilter = {}): Promise<GatewayOutboundEnvelope[]> {
    const read = await this.outbound.readWithCorruption()
    const byId = new Map<string, GatewayOutboundEnvelope>()
    for (const record of read.records) {
      if (record.recordType === 'outbound_appended') byId.set(record.envelope.deliveryId, record.envelope)
      if (record.recordType === 'outbound_updated') {
        const current = byId.get(record.deliveryId)
        if (current) byId.set(record.deliveryId, { ...current, ...record.patch, deliveryId: record.deliveryId })
      }
    }
    const statuses = Array.isArray(filter.status) ? filter.status : filter.status ? [filter.status] : undefined
    const nowMs = filter.nowMs ?? Date.now()
    return [...byId.values()]
      .filter(item => filter.deliveryId === undefined || item.deliveryId === filter.deliveryId)
      .filter(item => filter.channelId === undefined || item.channelId === filter.channelId)
      .filter(item => statuses === undefined || statuses.includes(item.status))
      .filter(item => item.status !== 'retry_scheduled' || filter.status !== undefined || filter.deliveryId !== undefined || (item.nextAttemptAtMs ?? 0) <= nowMs)
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
  }

  async appendPairing(pairing: GatewayPairedUser): Promise<GatewayPairedUser> {
    await this.pairings.appendLocked({ recordType: 'pairing_upserted', user: pairing, createdAtMs: Date.now() }, this.pairingsLock)
    await this.appendEvent(GATEWAY_EVENT_TYPES.userPaired, pairing)
    return pairing
  }

  async readPairedUsers(): Promise<GatewayPairedUser[]> {
    const read = await this.pairings.readWithCorruption()
    const latest = new Map<string, GatewayPairedUser>()
    for (const record of read.records) {
      if (record.recordType === 'pairing_upserted') latest.set(pairKey(record.user.channelId, record.user.userId), record.user)
      if (record.recordType === 'pairing_removed') {
        latest.set(pairKey(record.channelId, record.userId), {
          channelId: record.channelId,
          channelKind: record.channelKind,
          userId: record.userId,
          pairedAtMs: record.createdAtMs,
          lastSeenAtMs: record.createdAtMs,
          status: 'unpaired',
        })
      }
    }
    return [...latest.values()].filter(user => user.status === 'paired')
  }

  async upsertPairedUser(input: Omit<GatewayPairedUser, 'pairedAtMs' | 'lastSeenAtMs' | 'status'> & { pairedAtMs?: number; lastSeenAtMs?: number }): Promise<GatewayPairedUser> {
    const now = Date.now()
    const existing = (await this.readPairedUsers()).find(user => user.channelId === input.channelId && user.userId === input.userId)
    return this.appendPairing({
      channelId: input.channelId,
      channelKind: input.channelKind,
      userId: input.userId,
      pairedAtMs: input.pairedAtMs ?? existing?.pairedAtMs ?? now,
      lastSeenAtMs: input.lastSeenAtMs ?? now,
      status: 'paired',
      metadata: input.metadata,
    })
  }

  async removePairedUser(channelId: string, userId: string, channelKind: GatewayChannelKind = 'local'): Promise<void> {
    const createdAtMs = Date.now()
    await this.pairings.appendLocked({ recordType: 'pairing_removed', channelId, userId, channelKind, createdAtMs }, this.pairingsLock)
    await this.appendEvent(GATEWAY_EVENT_TYPES.userUnpaired, { channelId, channelKind, userId, createdAtMs })
  }

  async appendChannelState(state: GatewayChannelState): Promise<GatewayChannelState> {
    await this.channels.appendLocked({ recordType: 'channel_state', state, createdAtMs: Date.now() }, this.channelsLock)
    const eventType = state.status === 'connected'
      ? GATEWAY_EVENT_TYPES.channelConnected
      : state.status === 'disconnected'
        ? GATEWAY_EVENT_TYPES.channelDisconnected
        : state.status === 'reconnecting'
          ? GATEWAY_EVENT_TYPES.channelReconnecting
          : state.status === 'failed' || state.status === 'missing_config'
            ? GATEWAY_EVENT_TYPES.channelFailed
            : GATEWAY_EVENT_TYPES.channelRegistered
    await this.appendEvent(eventType, state)
    return state
  }

  async readChannelStates(): Promise<GatewayChannelState[]> {
    const read = await this.channels.readWithCorruption()
    const latest = new Map<string, GatewayChannelState>()
    for (const record of read.records) latest.set(record.state.channelId, record.state)
    return [...latest.values()].sort((left, right) => left.channelId.localeCompare(right.channelId))
  }

  async readHealthSnapshot(): Promise<GatewayHealthSnapshot> {
    const [inbound, outbound, channels, corruptRecordCount] = await Promise.all([
      this.readInbound(),
      this.readOutbound({ status: ['queued', 'retry_scheduled', 'sending', 'delivered', 'failed', 'skipped'] }),
      this.readChannelStates(),
      this.countCorruptRecords(),
    ])
    const pendingInbound = await this.readInbound({ status: 'pending' })
    return {
      workspaceId: this.input.workspaceId ?? 'default',
      gatewayId: this.input.identity?.gatewayId,
      sessionId: this.input.identity?.sessionId,
      status: corruptRecordCount > 0 ? 'failed' : 'running',
      updatedAtMs: Date.now(),
      inboundCount: inbound.length,
      pendingInboundCount: pendingInbound.length,
      outboundCount: outbound.length,
      queuedOutboundCount: outbound.filter(item => item.status === 'queued').length,
      retryOutboundCount: outbound.filter(item => item.status === 'retry_scheduled').length,
      corruptRecordCount,
      channelStates: channels,
    }
  }

  private async countCorruptRecords(): Promise<number> {
    const reads = await Promise.all([
      this.inbound.readWithCorruption(),
      this.outbound.readWithCorruption(),
      this.pairings.readWithCorruption(),
      this.channels.readWithCorruption(),
    ])
    return reads.reduce((total, read) => total + read.corruptRecords.length, 0)
  }

  private async appendEvent(eventType: string, payload: unknown): Promise<void> {
    if (!this.input.durable) return
    await this.input.durable.appendEvent({
      eventType,
      workspaceId: this.input.workspaceId ?? 'default',
      payload: withIdentity(this.input.identity, payload),
    })
  }
}

export function gatewayStoreCorruptionSummary(corruptRecords: readonly CorruptJsonlRecord[]): string[] {
  return corruptRecords.map(record => `line ${record.lineNumber}: ${record.message}`)
}

function withIdentity(identity: GatewayIdentity | undefined, payload: unknown): Record<string, unknown> {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload }
  return {
    workspaceId: identity?.workspaceId,
    gatewayId: identity?.gatewayId,
    sessionId: identity?.sessionId,
    runtimeId: identity?.runtimeId,
    ...base,
  }
}

function summarizeOutbound(envelope: GatewayOutboundEnvelope): Record<string, unknown> {
  return {
    deliveryId: envelope.deliveryId,
    dedupeKey: envelope.dedupeKey,
    channelId: envelope.channelId,
    channelKind: envelope.channelKind,
    userId: envelope.userId,
    replyToInboundId: envelope.replyToInboundId,
    status: envelope.status,
    attempt: envelope.attempt,
    nextAttemptAtMs: envelope.nextAttemptAtMs,
    textPreview: preview(envelope.text),
    lastError: envelope.lastError,
  }
}

function eventTypeForOutboundStatus(status: GatewayOutboundStatus): string {
  if (status === 'sending') return GATEWAY_EVENT_TYPES.outboundSending
  if (status === 'delivered') return GATEWAY_EVENT_TYPES.outboundDelivered
  if (status === 'retry_scheduled') return GATEWAY_EVENT_TYPES.outboundRetryScheduled
  if (status === 'failed' || status === 'skipped') return GATEWAY_EVENT_TYPES.outboundFailed
  return GATEWAY_EVENT_TYPES.outboundQueued
}

function pairKey(channelId: string, userId: string): string {
  return `${channelId}:${userId}`
}

function preview(value: string, maxChars = 500): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`
}
