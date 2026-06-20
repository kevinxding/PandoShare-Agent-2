import type { AgentEventHandler } from './services/events/index.js'

export type ToolSafety = 'read_only' | 'workspace_write' | 'gui_write' | 'external_write'

export type ToolPlatform = 'all' | 'windows' | 'linux' | 'darwin'

export type ToolBehavior = {
  reads?: boolean
  writes?: boolean
  network?: boolean
  gui?: boolean
  background?: boolean
}

export type ToolConcurrency = 'safe' | 'serial' | 'background'

export type PermissionMode = 'default' | 'plan' | 'auto' | 'restricted'

export type ApprovalPolicy = 'unless-trusted' | 'on-failure' | 'on-request' | 'granular' | 'never'

export type ApprovalsReviewer = 'user' | 'auto_review'

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type GranularApprovalConfig = {
  sandboxApproval?: boolean
  rules?: boolean
  skillApproval?: boolean
  requestPermissions?: boolean
  mcpElicitations?: boolean
}

export type PermissionConfig = {
  approvalPolicy: ApprovalPolicy
  approvalsReviewer?: ApprovalsReviewer
  sandboxMode: SandboxMode
  granular?: GranularApprovalConfig
  trustedTools?: readonly string[]
}

export type ToolResult = {
  toolUseId: string
  ok: boolean
  content: string
  isError?: boolean
  metadata?: Record<string, unknown>
}

export type ToolFailureCategory =
  | 'invalid_input'
  | 'path_safety'
  | 'filesystem'
  | 'permission'
  | 'process'
  | 'edit_conflict'
  | 'tool'
  | 'unknown'

export type ToolFailureMetadata = {
  type: 'tool_failure'
  code: string
  category: ToolFailureCategory
  message: string
}

export type ToolResultStorageOptions = {
  enabled?: boolean
  inlineCharLimit?: number
  previewChars?: number
}

export type ToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolApprovalRisk = 'low' | 'medium' | 'high'

export type ToolApprovalRequest = {
  toolUse: ToolUse
  toolName: string
  safety: ToolSafety
  approvalPolicy: ApprovalPolicy
  approvalsReviewer: ApprovalsReviewer
  sandboxMode: SandboxMode
  reason: string
  risk: ToolApprovalRisk
}

export type ToolApprovalDecision =
  | boolean
  | {
      approved: boolean
      reason?: string
    }

export type ToolApprovalHandler = (
  request: ToolApprovalRequest,
) => ToolApprovalDecision | Promise<ToolApprovalDecision>

export type ValidationResult =
  | { ok: true }
  | {
      ok: false
      message: string
      code?: string
    }

export type ToolUseContext = {
  cwd: string
  sessionId: string
  threadId?: string
  turnId?: string
  permissionMode: PermissionMode
  permissions?: PermissionConfig
  toolResultStorage?: ToolResultStorageOptions
  requestToolApproval?: ToolApprovalHandler
  emitEvent?: AgentEventHandler
  abortSignal?: AbortSignal
  inProgressToolUseIds?: Set<string>
  markToolInProgress?: (toolUseId: string) => void
  markToolComplete?: (toolUseId: string) => void
  recordToolResult?: (result: ToolResult) => void
  metadata?: Record<string, unknown>
}

export type ToolContextModifier = (context: ToolUseContext) => ToolUseContext

export type ToolExecutionUpdate = {
  result: ToolResult
  contextModifier?: ToolContextModifier
}

export type ToolExecutionOutput =
  | ToolResult
  | ToolExecutionUpdate
  | AsyncIterable<ToolResult | ToolExecutionUpdate>
  | Promise<ToolResult | ToolExecutionUpdate | AsyncIterable<ToolResult | ToolExecutionUpdate>>

export type ToolDefinition = {
  name: string
  description: string
  safety: ToolSafety
  platforms?: readonly ToolPlatform[]
  behavior?: ToolBehavior
  concurrency?: ToolConcurrency
  inputSchema?: Record<string, unknown>
  validateInput?: (toolUse: ToolUse, context: ToolUseContext) => ValidationResult | Promise<ValidationResult>
  isReadOnly?: (input: Record<string, unknown>, context: ToolUseContext) => boolean
  isConcurrencySafe?: (input: Record<string, unknown>, context: ToolUseContext) => boolean
  execute(toolUse: ToolUse, context: ToolUseContext): ToolExecutionOutput
}

export function createTextResult(
  toolUseId: string,
  content: string,
  ok = true,
  metadata?: Record<string, unknown>,
): ToolResult {
  return {
    toolUseId,
    ok,
    content,
    isError: !ok,
    ...(metadata ? { metadata } : {}),
  }
}

export function createStructuredErrorResult(
  toolUseId: string,
  error: unknown,
  metadata: Record<string, unknown> = {},
): ToolResult {
  const failure = classifyToolFailure(error)
  return createTextResult(toolUseId, failure.message, false, {
    ...failure,
    ...metadata,
  })
}

export function classifyToolFailure(error: unknown): ToolFailureMetadata {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const systemCode = extractSystemErrorCode(error)

  if (lower.includes('no such tool')) {
    return failure('tool_not_found', 'tool', message)
  }
  if (lower.includes('path is outside workspace')) {
    return failure('path_outside_workspace', 'path_safety', message)
  }
  if (lower.includes('not allowed') || lower.includes('blocked by') || lower.includes('requires approval')) {
    return failure('permission_denied', 'permission', message)
  }
  if (lower.includes('oldtext was not found')) {
    return failure('patch_old_text_not_found', 'edit_conflict', message)
  }
  if (lower.includes('oldtext matched') || lower.includes('provide a unique oldtext')) {
    return failure('patch_ambiguous_match', 'edit_conflict', message)
  }
  if (lower.includes('must be') || lower.includes('must use')) {
    return failure('invalid_input', 'invalid_input', message)
  }
  if (lower.includes('is not a file')) {
    return failure('not_file', 'filesystem', message)
  }
  if (systemCode === 'ENOENT' || lower.includes('no such file') || lower.includes('cannot find')) {
    return failure('not_found', 'filesystem', message)
  }
  if (systemCode === 'EACCES' || systemCode === 'EPERM' || lower.includes('access is denied')) {
    return failure('filesystem_permission_denied', 'filesystem', message)
  }
  return failure('tool_exception', 'unknown', message)
}

function failure(code: string, category: ToolFailureCategory, message: string): ToolFailureMetadata {
  return {
    type: 'tool_failure',
    code,
    category,
    message,
  }
}

function extractSystemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function isToolExecutionUpdate(value: ToolResult | ToolExecutionUpdate): value is ToolExecutionUpdate {
  return 'result' in value
}

export function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return Boolean(value && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function')
}

export function toolMatchesName(tool: ToolDefinition, name: string): boolean {
  return tool.name === name || tool.name.toLowerCase() === name.toLowerCase()
}
