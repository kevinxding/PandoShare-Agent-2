import type { DurableRuntime } from '../durable/index.js'
import { GUI_EVENT_TYPES } from './GuiEventTypes.js'
import type { GuiActionIdentity } from './GuiIdentity.js'

export class GuiStuckDetector {
  constructor(private readonly durable: DurableRuntime) {}

  async runWithTimeout<T>(input: {
    identity: GuiActionIdentity
    timeoutMs?: number
    action: string
    run: () => Promise<T>
  }): Promise<{ status: 'completed'; value: T } | { status: 'stuck'; message: string }> {
    const timeoutMs = input.timeoutMs ?? 30_000
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        input.run().then(value => ({ status: 'completed' as const, value })),
        new Promise<{ status: 'stuck'; message: string }>(resolve => {
          timeout = setTimeout(() => resolve({ status: 'stuck', message: `GUI action timed out after ${timeoutMs}ms: ${input.action}` }), timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async writeStuck(input: { identity: GuiActionIdentity; action: string; message: string }): Promise<string> {
    const event = await this.durable.appendEvent({
      eventType: GUI_EVENT_TYPES.actionStuck,
      workspaceId: input.identity.workspaceId,
      runId: input.identity.runId,
      loopId: input.identity.loopId,
      goalId: input.identity.goalId,
      taskId: input.identity.taskId,
      payload: {
        guiActionId: input.identity.guiActionId,
        action: input.action,
        message: input.message,
      },
    })
    return event.eventId
  }
}
