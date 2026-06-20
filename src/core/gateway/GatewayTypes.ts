import type { CommandEnvelope } from '../protocol/index.js'
import type { GatewayChannelKind } from './GatewayEnvelope.js'

export type GatewayMessageKind = GatewayChannelKind

export type GatewayInboundMessage = {
  messageId: string
  channel: GatewayMessageKind
  userId: string
  text: string
  createdAtMs: number
}

export type GatewayOutboundDelivery = {
  deliveryId: string
  replyToMessageId?: string
  channel: GatewayMessageKind
  userId: string
  text: string
  createdAtMs: number
  status: 'queued' | 'delivered' | 'failed'
}

export type GatewayCommandRoute = {
  command: CommandEnvelope
  replyText?: string
  inboundId?: string
  known: boolean
}
