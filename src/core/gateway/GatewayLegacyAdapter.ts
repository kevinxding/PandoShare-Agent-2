import type { DurableRuntime } from '../durable/index.js'
import type { GatewayEvent, GatewayInboundMessage, GatewayOutboundMessage, GatewayPairedUser, GatewayState, GatewayWakeRun, LocalGatewayStore } from '../../services/gatewayRuntime/index.js'
import { GATEWAY_EVENT_TYPES } from './GatewayEventTypes.js'

export type GatewayLegacyProjection = {
  state?: GatewayState
  inbound: GatewayInboundMessage[]
  outbound: GatewayOutboundMessage[]
  events: GatewayEvent[]
  wakeRuns: GatewayWakeRun[]
  pairedUsers: GatewayPairedUser[]
}

export class GatewayLegacyAdapter {
  constructor(private readonly input: {
    workspaceId: string
    durable: DurableRuntime
    legacyStore: LocalGatewayStore
  }) {}

  async readProjection(): Promise<GatewayLegacyProjection> {
    return {
      state: await this.input.legacyStore.readState(),
      inbound: await this.input.legacyStore.readInbound(),
      outbound: await this.input.legacyStore.readOutbound(),
      events: await this.input.legacyStore.readEvents(),
      wakeRuns: await this.input.legacyStore.readWakeRuns(),
      pairedUsers: await this.input.legacyStore.readPairedUsers(),
    }
  }

  async bridgeLegacyEvents(limit = 100): Promise<number> {
    const projection = await this.readProjection()
    const recent = projection.events.slice(-limit)
    for (const event of recent) {
      await this.input.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.legacyEventBridged,
        workspaceId: this.input.workspaceId,
        payload: {
          legacyEventId: event.eventId,
          legacyType: event.type,
          legacyCreatedAtMs: event.createdAtMs,
          message: event.message,
          payload: sanitize(event.data),
        },
      })
    }
    return recent.length
  }

  async statusProjection(): Promise<Record<string, unknown>> {
    const projection = await this.readProjection()
    return {
      legacyGateway: true,
      stateStatus: projection.state?.status ?? 'missing',
      inboundCount: projection.inbound.length,
      outboundCount: projection.outbound.length,
      eventCount: projection.events.length,
      wakeRunCount: projection.wakeRuns.length,
      pairedUserCount: projection.pairedUsers.length,
      activeLoopCount: projection.state?.activeLoops.length ?? 0,
      pendingApprovalCount: projection.state?.pendingApprovals.length ?? 0,
    }
  }
}

function sanitize(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sanitize)
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|cookie|password|webhook/i.test(key)) continue
    out[key] = sanitize(item)
  }
  return out
}
