import type { DurableRuntime } from '../durable/index.js'
import { createCommandEnvelope } from '../protocol/index.js'
import { GATEWAY_EVENT_TYPES } from './GatewayEventTypes.js'
import type { GatewayStore } from './GatewayStore.js'

type WakeLoopHandler = {
  handle(command: ReturnType<typeof createCommandEnvelope>): Promise<{ ok: boolean; result: unknown }>
}

export class GatewayWakeScheduler {
  private readonly backgroundLoopIds = new Set<string>()

  constructor(private readonly input: {
    workspaceId: string
    durable: DurableRuntime
    store: GatewayStore
    loopCommandHandler?: WakeLoopHandler
  }) {}

  enroll(loopId: string): { loopId: string; status: 'enrolled' } {
    this.backgroundLoopIds.add(loopId)
    return { loopId, status: 'enrolled' }
  }

  list(): string[] {
    return [...this.backgroundLoopIds]
  }

  async tick(): Promise<{ ok: boolean; loopId?: string; message: string }> {
    const loopId = this.backgroundLoopIds.values().next().value as string | undefined
    if (!loopId) return { ok: true, message: 'no background loop enrolled' }
    await this.input.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.loopWakeRequested,
      workspaceId: this.input.workspaceId,
      loopId,
      payload: { loopId, reason: 'gateway heartbeat' },
    })
    if (!this.input.loopCommandHandler) {
      await this.input.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.loopWakeCompleted,
        workspaceId: this.input.workspaceId,
        loopId,
        payload: { loopId, ok: false, message: 'loop command handler not configured' },
      })
      return { ok: false, loopId, message: 'loop command handler not configured' }
    }
    const command = createCommandEnvelope({
      commandType: 'loop.run',
      workspaceId: this.input.workspaceId,
      source: 'daemon',
      loopId,
      payload: { loopId, reason: 'gateway heartbeat' },
    })
    const result = await this.input.loopCommandHandler.handle(command)
    await this.input.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.loopWakeCompleted,
      workspaceId: this.input.workspaceId,
      loopId,
      payload: { loopId, ok: result.ok, result: summarize(result.result) },
    })
    return { ok: result.ok, loopId, message: result.ok ? 'background loop tick completed' : 'background loop tick failed' }
  }
}

function summarize(value: unknown): unknown {
  if (value === undefined || value === null) return value
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length <= 1000 ? value : `${text.slice(0, 1000)}...`
}
