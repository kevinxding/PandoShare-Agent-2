import { QueryEngine, type QueryEngineOptions } from '../../QueryEngine.js'
import type { QueryTurnOutput } from '../../query.js'
import type { AgentEvent } from '../../services/events/index.js'
import type { RunContext } from './RunContext.js'

// TODO: legacy adapter. QueryEngine remains the proven executor while core owns entry boundaries.
// This adapter only executes legacy turns; AgentKernel owns canonical run identity and state.
export class AgentKernelAdapter {
  private engine?: QueryEngine

  constructor(readonly options: QueryEngineOptions, initialContext?: RunContext) {
    if (initialContext) this.engine = this.createEngine(initialContext)
  }

  run(prompt: string, context?: RunContext): Promise<QueryTurnOutput> {
    return this.getEngine(context).run(prompt)
  }

  submitMessage(prompt: string, context?: RunContext): Promise<QueryTurnOutput> {
    return this.getEngine(context).submitMessage(prompt)
  }

  events(): readonly AgentEvent[] {
    return this.engine?.events() ?? []
  }

  threadId(): string | undefined {
    return this.engine?.threadId()
  }

  abort(reason?: unknown): void {
    this.engine?.abort(reason)
  }

  private getEngine(context?: RunContext): QueryEngine {
    this.engine ??= this.createEngine(context)
    return this.engine
  }

  private createEngine(context?: RunContext): QueryEngine {
    return new QueryEngine({
      ...this.options,
      threadId: context?.command.threadId ?? context?.identity.threadId ?? this.options.threadId,
      goalId: context?.identity.goalId ?? this.options.goalId,
      metadata: {
        ...(this.options.metadata ?? {}),
        kernelRunId: context?.identity.runId,
        kernelCommandId: context?.identity.commandId,
      },
    })
  }
}
