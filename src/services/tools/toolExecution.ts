import type { ToolRegistry } from '../../tools.js'
import type { ToolExecutionUpdate, ToolResult, ToolUse, ToolUseContext } from '../../Tool.js'
import {
  classifyToolFailure,
  createStructuredErrorResult,
  createTextResult,
  isAsyncIterable,
  isToolExecutionUpdate,
} from '../../Tool.js'
import {
  emitAgentEvent,
  eventBase,
  summarizeToolResult,
  summarizeToolUse,
} from '../events/index.js'
import { authorizeToolUse } from '../permissions/index.js'
import { maybeStoreLargeToolResult } from '../toolResultStorage/index.js'

export async function* runToolUse(
  toolUse: ToolUse,
  registry: ToolRegistry,
  context: ToolUseContext,
): AsyncIterable<ToolExecutionUpdate> {
  const tool = registry.get(toolUse.name)
  if (!tool) {
    yield await normalizeUpdate(createStructuredErrorResult(toolUse.id, `No such tool: ${toolUse.name}`), context, toolUse.name)
    return
  }

  const startedAtMs = Date.now()
  await emitAgentEvent(context, {
    ...eventBase(context, 'tool_call_started'),
    type: 'tool_call_started',
    ...toolLinkFields(context),
    toolUseId: toolUse.id,
    toolName: tool.name,
    safety: tool.safety,
    input: summarizeToolUse(toolUse),
  })

  try {
    const validation = tool.validateInput ? await tool.validateInput(toolUse, context) : { ok: true as const }
    if (!validation.ok) {
      const result = createStructuredErrorResult(
        toolUse.id,
        validation.message,
        validation.code ? { code: validation.code, category: 'invalid_input' } : {},
      )
      const normalized = await normalizeUpdate(result, context, tool.name)
      await emitToolCompleted(context, toolUse, tool.name, normalized.result, startedAtMs)
      yield normalized
      return
    }

    const permission = await authorizeToolUse(tool, toolUse, context)
    if (!permission.approved) {
      const result: ToolResult = {
        toolUseId: toolUse.id,
        ok: false,
        isError: true,
        content: permission.reason,
        metadata: {
          code: permission.code,
          approvalPolicy: permission.permissions.approvalPolicy,
          approvalsReviewer: permission.permissions.approvalsReviewer ?? 'user',
          sandboxMode: permission.permissions.sandboxMode,
          toolName: tool.name,
          toolSafety: tool.safety,
          approvalRisk: permission.request?.risk,
        },
      }
      const normalized = await normalizeUpdate(result, context, tool.name)
      await emitToolCompleted(context, toolUse, tool.name, normalized.result, startedAtMs)
      yield normalized
      return
    }

    const result = await tool.execute(toolUse, context)
    if (isAsyncIterable<ToolResult | ToolExecutionUpdate>(result)) {
      let yielded = false
      let lastResult: ToolResult | undefined
      for await (const update of result) {
        yielded = true
        const normalized = await normalizeUpdate(update, context, tool.name)
        lastResult = normalized.result
        await emitToolResult(context, toolUse, tool.name, normalized.result)
        yield normalized
      }
      if (!yielded) {
        const emptyResult = createTextResult(toolUse.id, `Tool returned no result: ${toolUse.name}`, false)
        const normalized = await normalizeUpdate(emptyResult, context, tool.name)
        await emitToolCompleted(context, toolUse, tool.name, normalized.result, startedAtMs)
        yield normalized
        return
      }
      if (lastResult) await emitToolCompleted(context, toolUse, tool.name, lastResult, startedAtMs)
      return
    }

    const normalized = await normalizeUpdate(result, context, tool.name)
    await emitToolCompleted(context, toolUse, tool.name, normalized.result, startedAtMs)
    yield normalized
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result = createStructuredErrorResult(toolUse.id, `Tool failed: ${message}`)
    const normalized = await normalizeUpdate(result, context, tool.name)
    await emitToolCompleted(context, toolUse, tool.name, normalized.result, startedAtMs)
    yield normalized
  }
}

async function normalizeUpdate(
  update: ToolResult | ToolExecutionUpdate,
  context?: ToolUseContext,
  toolName?: string,
): Promise<ToolExecutionUpdate> {
  const normalized = isToolExecutionUpdate(update) ? update : { result: update }
  if (!context || !toolName) return normalized
  const result = addStructuredToolMetadata(normalized.result, toolName)
  return {
    ...normalized,
    result: await maybeStoreLargeToolResult(result, context, toolName),
  }
}

function addStructuredToolMetadata(result: ToolResult, toolName: string): ToolResult {
  if (result.ok) return result
  const classified = classifyToolFailure(result.metadata?.message ?? result.content)
  return {
    ...result,
    metadata: {
      ...classified,
      ...(result.metadata ?? {}),
      type: 'tool_failure',
      category: result.metadata?.category ?? classified.category,
      message: result.metadata?.message ?? classified.message,
      toolName,
    },
  }
}

async function emitToolResult(
  context: ToolUseContext,
  toolUse: ToolUse,
  toolName: string,
  result: ToolResult,
): Promise<void> {
  await emitAgentEvent(context, {
    ...eventBase(context, 'tool_result'),
    type: 'tool_result',
    ...toolLinkFields(context),
    toolUseId: toolUse.id,
    toolName,
    ...summarizeToolResult(result),
  })
}

async function emitToolCompleted(
  context: ToolUseContext,
  toolUse: ToolUse,
  toolName: string,
  result: ToolResult,
  startedAtMs: number,
): Promise<void> {
  await emitToolResult(context, toolUse, toolName, result)
  await emitAgentEvent(context, {
    ...eventBase(context, 'tool_call_completed'),
    type: 'tool_call_completed',
    ...toolLinkFields(context),
    toolUseId: toolUse.id,
    toolName,
    ...summarizeToolResult(result),
    durationMs: Date.now() - startedAtMs,
  })
}

function toolLinkFields(context: ToolUseContext): { threadId?: string; loopId?: string; taskId?: string } {
  const loopId = typeof context.metadata?.loopId === 'string' ? context.metadata.loopId : undefined
  const taskId = typeof context.metadata?.taskId === 'string' ? context.metadata.taskId : undefined
  return {
    ...(context.threadId ? { threadId: context.threadId } : {}),
    ...(loopId ? { loopId } : {}),
    ...(taskId ? { taskId } : {}),
  }
}
