import type { ToolRegistry } from '../../tools.js'
import type { ToolContextModifier, ToolExecutionUpdate, ToolUse, ToolUseContext } from '../../Tool.js'
import { all } from '../../utils/generators.js'
import { getNumericEnv } from '../../utils/env.js'
import { runToolUse } from './toolExecution.js'

export type ToolBatch = {
  isConcurrencySafe: boolean
  toolUses: ToolUse[]
}

export async function* runTools(
  toolUses: readonly ToolUse[],
  registry: ToolRegistry,
  context: ToolUseContext,
): AsyncIterable<ToolExecutionUpdate> {
  let currentContext = context

  for (const batch of partitionToolCalls(toolUses, registry, currentContext)) {
    if (batch.isConcurrencySafe) {
      const queuedModifiers = new Map<string, ToolContextModifier[]>()

      for await (const update of runToolsConcurrently(batch.toolUses, registry, currentContext)) {
        const toolUseId = update.result.toolUseId
        if (update.contextModifier) {
          const modifiers = queuedModifiers.get(toolUseId) ?? []
          modifiers.push(update.contextModifier)
          queuedModifiers.set(toolUseId, modifiers)
        }
        yield update
      }

      for (const toolUse of batch.toolUses) {
        for (const modifier of queuedModifiers.get(toolUse.id) ?? []) {
          currentContext = modifier(currentContext)
        }
      }
    } else {
      for await (const update of runToolsSerially(batch.toolUses, registry, currentContext)) {
        if (update.contextModifier) {
          currentContext = update.contextModifier(currentContext)
        }
        yield update
      }
    }
  }
}

export function partitionToolCalls(
  toolUses: readonly ToolUse[],
  registry: ToolRegistry,
  context: ToolUseContext,
): ToolBatch[] {
  const batches: ToolBatch[] = []

  for (const toolUse of toolUses) {
    const tool = registry.get(toolUse.name)
    const isConcurrencySafe = Boolean(
      tool &&
        (tool.isConcurrencySafe?.(toolUse.input, context) ??
          tool.isReadOnly?.(toolUse.input, context) ??
          tool.safety === 'read_only'),
    )
    const previous = batches[batches.length - 1]

    if (isConcurrencySafe && previous?.isConcurrencySafe) {
      previous.toolUses.push(toolUse)
    } else {
      batches.push({ isConcurrencySafe, toolUses: [toolUse] })
    }
  }

  return batches
}

async function* runToolsSerially(
  toolUses: readonly ToolUse[],
  registry: ToolRegistry,
  context: ToolUseContext,
): AsyncIterable<ToolExecutionUpdate> {
  for (const toolUse of toolUses) {
    markToolInProgress(context, toolUse.id)
    for await (const update of runToolUse(toolUse, registry, context)) {
      context.recordToolResult?.(update.result)
      yield update
    }
    markToolComplete(context, toolUse.id)
  }
}

async function* runToolsConcurrently(
  toolUses: readonly ToolUse[],
  registry: ToolRegistry,
  context: ToolUseContext,
): AsyncIterable<ToolExecutionUpdate> {
  const runners = toolUses.map(async function* (toolUse): AsyncIterable<ToolExecutionUpdate> {
    markToolInProgress(context, toolUse.id)
    for await (const update of runToolUse(toolUse, registry, context)) {
      context.recordToolResult?.(update.result)
      yield update
    }
    markToolComplete(context, toolUse.id)
  })

  yield* all(runners, getMaxToolUseConcurrency())
}

function getMaxToolUseConcurrency(): number {
  return Math.max(1, getNumericEnv('PANDOSHARE_MAX_TOOL_USE_CONCURRENCY', 10))
}

function markToolInProgress(context: ToolUseContext, toolUseId: string): void {
  context.inProgressToolUseIds?.add(toolUseId)
  context.markToolInProgress?.(toolUseId)
}

function markToolComplete(context: ToolUseContext, toolUseId: string): void {
  context.inProgressToolUseIds?.delete(toolUseId)
  context.markToolComplete?.(toolUseId)
}
