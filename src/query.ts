import type { ToolRegistry } from './tools.js'
import type { ToolResult, ToolUse, ToolUseContext } from './Tool.js'
import type { AgentSession, AgentTurnOutput } from './services/agent/index.js'
import { runTools } from './services/tools/toolOrchestration.js'

export type QueryTurnInput = {
  prompt: string
  registry: ToolRegistry
  context: ToolUseContext
  agentSession?: AgentSession
  maxToolRounds?: number
}

export type QueryTurnOutput = {
  finalText: string
  toolResults: ToolResult[]
  agent?: AgentTurnOutput
}

export async function runQueryTurn(input: QueryTurnInput): Promise<QueryTurnOutput> {
  if (input.agentSession) {
    const agent = await input.agentSession.runTurn({
      prompt: input.prompt,
      toolRegistry: input.registry,
      toolContext: input.context,
      maxToolRounds: input.maxToolRounds,
      abortSignal: input.context.abortSignal,
    })
    return {
      finalText: agent.finalText,
      toolResults: [...agent.toolResults],
      agent,
    }
  }

  const toolUses: ToolUse[] = []
  const toolResults: ToolResult[] = []

  for await (const update of runTools(toolUses, input.registry, input.context)) {
    toolResults.push(update.result)
  }

  return {
    finalText: input.prompt,
    toolResults,
  }
}
