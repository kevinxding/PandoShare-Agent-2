import type { AgentEvent } from '../../services/events/index.js'
import { agentEventToEnvelope, type EventEnvelope } from '../protocol/index.js'
import type { RunContext } from './RunContext.js'

export class AgentKernelEventBridge {
  private readonly forwardedLegacyEventIds = new Set<string>()

  convert(events: readonly AgentEvent[], context: RunContext): EventEnvelope[] {
    const converted: EventEnvelope[] = []
    for (const event of events) {
      if (this.forwardedLegacyEventIds.has(event.id)) continue
      this.forwardedLegacyEventIds.add(event.id)
      converted.push(agentEventToEnvelope(event, {
        workspaceId: context.identity.workspaceId,
        threadId: context.identity.threadId,
        runId: context.identity.runId,
        goalId: context.identity.goalId,
        loopId: context.identity.loopId,
      }))
    }
    return converted
  }
}
