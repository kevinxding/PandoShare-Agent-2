import { MockGatewayChannelAdapter, type GatewayAdapterFailureClass, type GatewayChannelAdapter } from '../gateway/index.js'

export type GatewayServiceConfig = {
  workspaceRoot: string
  workspaceId?: string
  runtimeId?: string
  gatewayId?: string
  sessionId?: string
  intervalMs?: number
  maxTicks?: number
  maxInboundPerTick?: number
  maxOutboundPerTick?: number
  staleAfterMs?: number
  continuous?: boolean
  adapters?: readonly GatewayChannelAdapter[]
  outboundFailureMode?: GatewayAdapterFailureClass
}

export type NormalizedGatewayServiceConfig = Required<Pick<GatewayServiceConfig,
  'workspaceRoot' | 'workspaceId' | 'runtimeId' | 'intervalMs' | 'maxInboundPerTick' | 'maxOutboundPerTick' | 'staleAfterMs'
>> & Omit<GatewayServiceConfig, 'workspaceRoot' | 'workspaceId' | 'runtimeId' | 'intervalMs' | 'maxInboundPerTick' | 'maxOutboundPerTick' | 'staleAfterMs'>

export function normalizeGatewayServiceConfig(input: GatewayServiceConfig): NormalizedGatewayServiceConfig {
  return {
    ...input,
    workspaceRoot: input.workspaceRoot,
    workspaceId: input.workspaceId ?? 'default',
    runtimeId: input.runtimeId ?? 'gateway-service',
    intervalMs: Math.max(0, input.intervalMs ?? 100),
    maxInboundPerTick: Math.max(0, input.maxInboundPerTick ?? 5),
    maxOutboundPerTick: Math.max(0, input.maxOutboundPerTick ?? 5),
    staleAfterMs: Math.max(1, input.staleAfterMs ?? 30_000),
  }
}

export function createDefaultGatewayServiceAdapters(input: { outboundFailureMode?: GatewayAdapterFailureClass } = {}): GatewayChannelAdapter[] {
  const mock = new MockGatewayChannelAdapter('mock')
  mock.configure({ failMode: input.outboundFailureMode })
  return [mock]
}
