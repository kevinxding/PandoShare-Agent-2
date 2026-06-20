import { createProtocolId } from '../protocol/index.js'

export type GatewayChannelKind = 'local' | 'mock' | 'telegram' | 'feishu' | 'lark' | 'wecom'
export type GatewayOutboundStatus = 'queued' | 'sending' | 'delivered' | 'failed' | 'retry_scheduled' | 'skipped'

export type GatewayRawRef = {
  path?: string
  summary?: string
}

export type GatewayInboundEnvelope = {
  inboundId: string
  dedupeKey: string
  channelId: string
  channelKind: GatewayChannelKind
  externalMessageId?: string
  userId: string
  text: string
  createdAtMs: number
  receivedAtMs: number
  signatureVerified?: boolean
  paired?: boolean
  allowed?: boolean
  rawRef?: GatewayRawRef
  metadata?: Record<string, unknown>
}

export type GatewayOutboundEnvelope = {
  deliveryId: string
  dedupeKey: string
  channelId: string
  channelKind: GatewayChannelKind
  userId: string
  replyToInboundId?: string
  text: string
  status: GatewayOutboundStatus
  attempt: number
  nextAttemptAtMs?: number
  createdAtMs: number
  updatedAtMs: number
  lastError?: string
  metadata?: Record<string, unknown>
}

export type GatewayInboundInput = Omit<Partial<GatewayInboundEnvelope>, 'dedupeKey' | 'inboundId' | 'createdAtMs' | 'receivedAtMs'> & {
  channelId: string
  channelKind?: GatewayChannelKind
  userId: string
  text: string
  inboundId?: string
  dedupeKey?: string
  createdAtMs?: number
  receivedAtMs?: number
}

export type GatewayOutboundInput = Omit<Partial<GatewayOutboundEnvelope>, 'dedupeKey' | 'deliveryId' | 'createdAtMs' | 'updatedAtMs' | 'status' | 'attempt'> & {
  channelId: string
  channelKind?: GatewayChannelKind
  userId: string
  text: string
  deliveryId?: string
  dedupeKey?: string
  status?: GatewayOutboundStatus
  attempt?: number
  createdAtMs?: number
  updatedAtMs?: number
}

export function createInboundEnvelope(input: GatewayInboundInput): GatewayInboundEnvelope {
  const receivedAtMs = input.receivedAtMs ?? Date.now()
  const createdAtMs = input.createdAtMs ?? receivedAtMs
  const channelKind = input.channelKind ?? inferGatewayChannelKind(input.channelId)
  const base = { ...input, channelKind, createdAtMs, receivedAtMs }
  return {
    inboundId: input.inboundId ?? createProtocolId('inbound', receivedAtMs),
    dedupeKey: input.dedupeKey ?? createInboundDedupeKey(base),
    channelId: input.channelId,
    channelKind,
    externalMessageId: input.externalMessageId,
    userId: input.userId,
    text: input.text,
    createdAtMs,
    receivedAtMs,
    signatureVerified: input.signatureVerified,
    paired: input.paired,
    allowed: input.allowed,
    rawRef: sanitizeRawRef(input.rawRef),
    metadata: input.metadata,
  }
}

export function createOutboundEnvelope(input: GatewayOutboundInput): GatewayOutboundEnvelope {
  const createdAtMs = input.createdAtMs ?? Date.now()
  const updatedAtMs = input.updatedAtMs ?? createdAtMs
  const channelKind = input.channelKind ?? inferGatewayChannelKind(input.channelId)
  const dedupeKey = input.dedupeKey ?? createOutboundDedupeKey({ ...input, channelKind, createdAtMs })
  return {
    deliveryId: input.deliveryId ?? createStableDeliveryId(dedupeKey, createdAtMs),
    dedupeKey,
    channelId: input.channelId,
    channelKind,
    userId: input.userId,
    replyToInboundId: input.replyToInboundId,
    text: input.text,
    status: input.status ?? 'queued',
    attempt: input.attempt ?? 0,
    nextAttemptAtMs: input.nextAttemptAtMs,
    createdAtMs,
    updatedAtMs,
    lastError: input.lastError,
    metadata: input.metadata,
  }
}

export function createInboundDedupeKey(input: {
  channelId: string
  channelKind?: GatewayChannelKind
  externalMessageId?: string
  userId: string
  text: string
  createdAtMs: number
}): string {
  if (input.externalMessageId) return stableKey(['external', input.channelId, input.externalMessageId])
  const bucketMs = Math.floor(input.createdAtMs / 30_000) * 30_000
  return stableKey(['fallback', input.channelId, input.userId, input.text, String(bucketMs)])
}

export function createOutboundDedupeKey(input: {
  channelId: string
  channelKind?: GatewayChannelKind
  userId: string
  text: string
  replyToInboundId?: string
  createdAtMs: number
}): string {
  const bucketMs = Math.floor(input.createdAtMs / 30_000) * 30_000
  return stableKey(['outbound', input.channelId, input.userId, input.replyToInboundId ?? '', input.text, String(bucketMs)])
}

export function inferGatewayChannelKind(channelId: string): GatewayChannelKind {
  if (channelId === 'mock' || channelId === 'telegram' || channelId === 'feishu' || channelId === 'lark' || channelId === 'wecom') return channelId
  return 'local'
}

function createStableDeliveryId(dedupeKey: string, createdAtMs: number): string {
  return `delivery_${createdAtMs}_${shortHash(dedupeKey)}`
}

function stableKey(parts: readonly string[]): string {
  return parts.map(part => encodeURIComponent(part)).join(':')
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(8, '0')
}

function sanitizeRawRef(rawRef: GatewayRawRef | undefined): GatewayRawRef | undefined {
  if (!rawRef) return undefined
  return {
    path: rawRef.path,
    summary: rawRef.summary,
  }
}
