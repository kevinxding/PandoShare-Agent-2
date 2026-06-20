import { createProtocolId } from '../protocol/index.js'

export type GatewaySource = 'daemon' | 'cli' | 'server' | 'test'

export type GatewayIdentity = {
  workspaceId: string
  gatewayId: string
  sessionId: string
  runtimeId: string
  startedAtMs: number
  source: GatewaySource
}

export type CreateGatewayIdentityInput = {
  workspaceId?: string
  gatewayId?: string
  sessionId?: string
  runtimeId?: string
  startedAtMs?: number
  source?: GatewaySource
}

export function createGatewayIdentity(input: CreateGatewayIdentityInput = {}): GatewayIdentity {
  const startedAtMs = input.startedAtMs ?? Date.now()
  return {
    workspaceId: input.workspaceId ?? 'default',
    gatewayId: input.gatewayId ?? createProtocolId('gateway', startedAtMs),
    sessionId: input.sessionId ?? createProtocolId('gateway_session', startedAtMs),
    runtimeId: input.runtimeId ?? 'gateway',
    startedAtMs,
    source: input.source ?? 'daemon',
  }
}
