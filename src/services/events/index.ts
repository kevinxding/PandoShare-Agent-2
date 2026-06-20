import type {
  ApprovalPolicy,
  ApprovalsReviewer,
  SandboxMode,
  ToolApprovalRisk,
  ToolResult,
  ToolSafety,
  ToolUse,
  ToolUseContext,
} from '../../Tool.js'
import type { LLMToolCall } from '../llm/types.js'
import type { TokenBudgetStats } from '../tokenBudget/index.js'

export type AgentEventBase = {
  id: string
  type: string
  sessionId: string
  turnId?: string
  goalId?: string
  createdAtMs: number
}

export type AgentEvent =
  | (AgentEventBase & {
      type: 'run_started'
      threadId: string
      runId: string
      cwd: string
      promptPreview: string
    })
  | (AgentEventBase & {
      type: 'run_completed'
      threadId: string
      runId: string
      ok: true
      finalTextPreview: string
      durationMs: number
      eventCount: number
      messageCount: number
      toolCallCount: number
      toolResultCount: number
      failedToolResultCount: number
      approvalRequestCount: number
      resourceUsage?: AgentResourceUsage
    })
  | (AgentEventBase & {
      type: 'run_failed'
      threadId: string
      runId: string
      ok: false
      message: string
      durationMs: number
      eventCount: number
      toolCallCount: number
      toolResultCount: number
      failedToolResultCount: number
      approvalRequestCount: number
      resourceUsage?: AgentResourceUsage
    })
  | (AgentEventBase & {
      type: 'turn_started'
      promptPreview: string
    })
  | (AgentEventBase & {
      type: 'turn_completed'
      ok: true
      finalTextPreview: string
      rounds: number
      usage?: unknown
      durationMs: number
    })
  | (AgentEventBase & {
      type: 'turn_failed'
      ok: false
      message: string
      durationMs: number
    })
  | (AgentEventBase & {
      type: 'context_built'
      threadId: string
      sourceMessageCount: number
      retainedMessageCount: number
      droppedMessageCount: number
      estimatedChars: number
      maxContextChars: number
      checkpointIncluded: boolean
      insertedContextNote: boolean
      orphanedToolResultCount: number
      droppedUnpairedToolCallGroupCount: number
      compactionSummaryIncluded: boolean
      compactionId?: string
      compactionWindowId?: number
      compactedMessageCount: number
      tokenBudget?: TokenBudgetStats
      contextNotes: readonly string[]
    })
  | (AgentEventBase & {
      type: 'preflight_started'
      cwd: string
    })
  | (AgentEventBase & {
      type: 'preflight_completed'
      ok: boolean
      failedCheckIds: readonly string[]
    })
  | (AgentEventBase & {
      type: 'preflight_failed'
      message: string
    })
  | (AgentEventBase & {
      type: 'mcp_server_started'
      serverName: string
      command: string
    })
  | (AgentEventBase & {
      type: 'mcp_server_connected'
      serverName: string
      toolCount: number
      serverInfo?: {
        name?: string
        version?: string
      }
    })
  | (AgentEventBase & {
      type: 'mcp_server_failed'
      serverName: string
      message: string
    })
  | (AgentEventBase & {
      type: 'gui_action_started'
      toolUseId: string
      action: string
      target?: string
    })
  | (AgentEventBase & {
      type: 'gui_action_completed'
      toolUseId: string
      ok: boolean
      method: string
      fallbackUsed: boolean
      message: string
      screenshotPath?: string
      failureClass?: string
      audit?: unknown
    })
  | (AgentEventBase & {
      type: 'gui_action_failed'
      toolUseId: string
      method: string
      message: string
      failureClass?: string
      audit?: unknown
    })
  | (AgentEventBase & {
      type: 'gui_action_verified'
      toolUseId: string
      ok: boolean
      screenshotPath?: string
      message?: string
      audit?: unknown
    })
  | (AgentEventBase & {
      type: 'compaction_started'
      threadId: string
      compactionId: string
      trigger: 'manual' | 'auto'
      reason: 'manual' | 'context_limit' | 'retry_after_failure'
      phase: 'standalone' | 'pre_turn' | 'retry'
      windowId: number
      sourceMessageCount: number
      targetContextChars: number
    })
  | (AgentEventBase & {
      type: 'compaction_completed'
      threadId: string
      compactionId: string
      windowId: number
      coveredMessageCount: number
      retainedMessageCount: number
      summaryChars: number
      inputEstimatedChars: number
      outputModel?: {
        provider: string
        name?: string
      }
    })
  | (AgentEventBase & {
      type: 'compaction_failed'
      threadId: string
      compactionId: string
      windowId: number
      message: string
    })
  | (AgentEventBase & {
      type: 'model_request_started'
      provider: string
      model: string
      round: number
      toolCount: number
    })
  | (AgentEventBase & {
      type: 'model_response_completed'
      provider: string
      model: string
      round: number
      textPreview: string
      toolCalls: readonly AgentToolCallSummary[]
      usage?: unknown
    })
  | (AgentEventBase & {
      type: 'model_retry_scheduled'
      provider: string
      model: string
      round: number
      attempt: number
      nextAttempt: number
      maxRetries: number
      delayMs: number
      category: string
      status?: number
      retryable: boolean
      message: string
    })
  | (AgentEventBase & {
      type: 'agent_message_delta'
      delta: string
    })
  | (AgentEventBase & {
      type: 'agent_message_completed'
      textPreview: string
    })
  | (AgentEventBase & {
      type: 'tool_call_started'
      threadId?: string
      loopId?: string
      taskId?: string
      toolUseId: string
      toolName: string
      safety: ToolSafety
      input: Record<string, unknown>
    })
  | (AgentEventBase & {
      type: 'tool_result'
      threadId?: string
      loopId?: string
      taskId?: string
      toolUseId: string
      toolName: string
      ok: boolean
      contentPreview: string
      metadata?: Record<string, unknown>
    })
  | (AgentEventBase & {
      type: 'tool_call_completed'
      threadId?: string
      loopId?: string
      taskId?: string
      toolUseId: string
      toolName: string
      ok: boolean
      contentPreview: string
      metadata?: Record<string, unknown>
      durationMs: number
    })
  | (AgentEventBase & {
      type: 'tool_loop_stopped'
      message: string
      maxToolRounds: number
      pendingToolCallIds: readonly string[]
    })
  | (AgentEventBase & {
      type: 'approval_requested'
      toolUseId: string
      toolName: string
      safety: ToolSafety
      approvalPolicy: ApprovalPolicy
      approvalsReviewer: ApprovalsReviewer
      sandboxMode: SandboxMode
      risk: ToolApprovalRisk
      reason: string
      input: Record<string, unknown>
    })
  | (AgentEventBase & {
      type: 'approval_completed'
      toolUseId: string
      toolName: string
      approved: boolean
      reviewer: ApprovalsReviewer | 'sandbox' | 'auto_review'
      reason: string
    })

export type AgentToolCallSummary = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type AgentResourceUsage = {
  rssBytes: number
  heapTotalBytes: number
  heapUsedBytes: number
  externalBytes?: number
  arrayBuffersBytes?: number
}

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>

export type AgentEventRecorder = {
  readonly events: readonly AgentEvent[]
  emitEvent: AgentEventHandler
}

export type EventOutput = {
  write(text: string): void
}

let eventCounter = 0

export function createEventRecorder(forward?: AgentEventHandler): AgentEventRecorder {
  const events: AgentEvent[] = []
  return {
    events,
    async emitEvent(event) {
      events.push(event)
      await forward?.(event)
    },
  }
}

export async function emitAgentEvent(context: ToolUseContext | undefined, event: AgentEvent): Promise<void> {
  await context?.emitEvent?.(event)
}

export function eventBase(
  context: Pick<ToolUseContext, 'sessionId' | 'turnId' | 'metadata'>,
  type: AgentEvent['type'],
): AgentEventBase {
  const goalId = typeof context.metadata?.goalId === 'string' ? context.metadata.goalId : undefined
  return {
    id: `event-${Date.now()}-${++eventCounter}`,
    type,
    sessionId: context.sessionId,
    turnId: context.turnId,
    ...(goalId ? { goalId } : {}),
    createdAtMs: Date.now(),
  }
}

export function summarizeToolCalls(toolCalls: readonly LLMToolCall[]): readonly AgentToolCallSummary[] {
  return toolCalls.map(toolCall => ({
    id: toolCall.id,
    name: toolCall.name,
    input: redactRecord(toolCall.input),
  }))
}

export function summarizeToolUse(toolUse: ToolUse): Record<string, unknown> {
  return redactRecord(toolUse.input)
}

export function summarizeToolResult(result: ToolResult): Pick<
  Extract<AgentEvent, { type: 'tool_result' }>,
  'ok' | 'contentPreview' | 'metadata'
> {
  return {
    ok: result.ok,
    contentPreview: previewText(result.content),
    metadata: result.metadata,
  }
}

export function previewText(value: string, maxChars = 2000): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`
}

export function createTerminalEventHandler(output: EventOutput): AgentEventHandler {
  return event => {
    const line = formatEventForTerminal(event)
    if (line) output.write(`${line}\n`)
  }
}

export function formatEventForTerminal(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'run_started':
      return `run started: ${event.runId}`
    case 'run_completed':
      return `run completed: ${event.runId} in ${event.durationMs}ms`
    case 'run_failed':
      return `run failed: ${event.runId}: ${event.message}`
    case 'turn_started':
      return `turn started: ${event.promptPreview}`
    case 'context_built':
      return formatContextBuiltEvent(event)
    case 'compaction_started':
      return `compaction started: ${event.reason}, window ${event.windowId}`
    case 'compaction_completed':
      return `compaction completed: covered ${event.coveredMessageCount} message(s), window ${event.windowId}`
    case 'compaction_failed':
      return `compaction failed: ${event.message}`
    case 'preflight_started':
      return `preflight started: ${event.cwd}`
    case 'preflight_completed':
      return event.ok ? 'preflight completed' : `preflight failed checks: ${event.failedCheckIds.join(', ')}`
    case 'preflight_failed':
      return `preflight failed: ${event.message}`
    case 'mcp_server_started':
      return `mcp starting: ${event.serverName}`
    case 'mcp_server_connected':
      return `mcp connected: ${event.serverName} (${event.toolCount} tool(s))`
    case 'mcp_server_failed':
      return `mcp failed: ${event.serverName}: ${event.message}`
    case 'gui_action_started':
      return `gui action: ${event.action}`
    case 'gui_action_completed':
      return event.ok ? `gui completed: ${event.method}` : `gui failed: ${event.message}`
    case 'gui_action_failed':
      return `gui failed: ${event.message}`
    case 'gui_action_verified':
      return event.ok ? 'gui verified' : `gui verification failed: ${event.message ?? 'unknown'}`
    case 'model_request_started':
      return `model request: ${event.provider}/${event.model} round ${event.round}`
    case 'model_response_completed':
      return event.toolCalls.length
        ? `model requested ${event.toolCalls.length} tool call(s)`
        : 'model response completed'
    case 'model_retry_scheduled':
      return `model retry: ${event.provider}/${event.model} ${event.category} attempt ${event.nextAttempt} in ${event.delayMs}ms`
    case 'tool_call_started':
      return `tool started: ${event.toolName}`
    case 'approval_requested':
      return `approval requested: ${event.toolName} (${event.risk})`
    case 'approval_completed':
      return event.approved ? `approval granted: ${event.toolName}` : `approval denied: ${event.toolName}`
    case 'tool_call_completed':
      return event.ok ? `tool completed: ${event.toolName}` : `tool failed: ${event.toolName}`
    case 'tool_loop_stopped':
      return event.message
    case 'turn_completed':
      return `turn completed in ${event.durationMs}ms`
    case 'turn_failed':
      return `turn failed: ${event.message}`
    case 'agent_message_delta':
    case 'agent_message_completed':
    case 'tool_result':
      return undefined
  }
}

function formatContextBuiltEvent(event: Extract<AgentEvent, { type: 'context_built' }>): string {
  const base = event.compactionSummaryIncluded
        ? `context built: retained ${event.retainedMessageCount}/${event.sourceMessageCount} message(s), dropped ${event.droppedMessageCount}, compacted ${event.compactedMessageCount}`
        : `context built: retained ${event.retainedMessageCount}/${event.sourceMessageCount} message(s), dropped ${event.droppedMessageCount}`
  if (!event.tokenBudget?.enabled || event.tokenBudget.estimatedTokensLeft === undefined) return base
  return `${base}, tokens left ${event.tokenBudget.estimatedTokensLeft}`
}

function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input, redactSecrets)) as Record<string, unknown>
}

function redactSecrets(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase()
  if (
    normalized.includes('apikey') ||
    normalized.includes('api_key') ||
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('secret')
  ) {
    return '<redacted>'
  }
  return value
}
