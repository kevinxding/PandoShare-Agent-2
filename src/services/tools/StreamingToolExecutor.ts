import type { ToolExecutionUpdate, ToolUse, ToolUseContext } from '../../Tool.js'
import type { ToolRegistry } from '../../tools.js'
import { runTools } from './toolOrchestration.js'

export class StreamingToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly context: ToolUseContext,
  ) {}

  async *run(toolUses: readonly ToolUse[]): AsyncIterable<ToolExecutionUpdate> {
    yield* runTools(toolUses, this.registry, this.context)
  }
}
