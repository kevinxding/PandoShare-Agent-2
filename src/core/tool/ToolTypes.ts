import type { GuiRuntimeAction, GuiRuntimeActionRecord } from '../gui/index.js'

export type ToolApprovalPolicy = 'ask' | 'trusted' | 'never'
export type ToolApprovalStatus = 'not_required' | 'waiting' | 'approved' | 'rejected'
export type ToolRiskLevel = 'read_only' | 'low_write' | 'write' | 'dangerous_write'
export type ToolExecutionState = 'waiting_approval' | 'rejected' | 'completed' | 'failed'
export type ToolVerificationStatus = 'passed' | 'failed' | 'inconclusive'

export type ToolName = 'file_read' | 'file_write' | 'apply_patch' | 'shell' | 'gui_action'

export type ToolMetadata = {
  name: ToolName
  description: string
  category: 'file' | 'process' | 'gui'
  risk: ToolRiskLevel
  offline: true
  writesFiles?: boolean
  delegatesTo?: 'GuiRuntime'
}

export type ToolRuntimeRequest = {
  toolCallId?: string
  toolName: ToolName | string
  input?: Record<string, unknown>
  approvalPolicy?: ToolApprovalPolicy
  runId?: string
  loopId?: string
  goalId?: string
  taskId?: string
  parentEventId?: string
  metadata?: Record<string, unknown>
}

export type ToolRuntimeIdentity = {
  workspaceId: string
  toolCallId: string
  toolName: string
  runId?: string
  loopId?: string
  goalId?: string
  taskId?: string
  parentEventId?: string
  createdAtMs: number
}

export type ToolClassification = {
  risk: ToolRiskLevel
  reason: string
  approvalRequired: boolean
  metadata: ToolMetadata
}

export type ToolApprovalRecord = {
  required: boolean
  status: ToolApprovalStatus
  policy: ToolApprovalPolicy
  reason?: string
  approvedByPolicy?: boolean
  decidedAtMs?: number
}

export type FileHashSnapshot = {
  path: string
  exists: boolean
  sha256?: string
  bytes?: number
}

export type ToolFileChange = {
  path: string
  before: FileHashSnapshot
  after: FileHashSnapshot
}

export type ShellToolResult = {
  command: string
  args: string[]
  cwd: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
}

export type ToolExecutionResult = {
  ok: boolean
  message: string
  output?: unknown
  fileChanges?: ToolFileChange[]
  shell?: ShellToolResult
  gui?: GuiRuntimeActionRecord
}

export type ToolResultRef = {
  refId: string
  relativePath: string
  absolutePath: string
  sha256: string
  bytes: number
  preview: string
}

export type ToolVerification = {
  ok: boolean
  status: ToolVerificationStatus
  message: string
  fileChanges?: ToolFileChange[]
  verifierCommand?: ShellToolResult
}

export type ToolExecutionRecord = {
  schemaVersion: 1
  identity: ToolRuntimeIdentity
  state: ToolExecutionState
  classification?: ToolClassification
  approval?: ToolApprovalRecord
  result?: ToolExecutionResult
  resultRef?: ToolResultRef
  verification?: ToolVerification
  checkpointId?: string
  eventIds: string[]
  createdAtMs: number
  completedAtMs?: number
}

export type FileReadInput = {
  path: string
  maxBytes?: number
}

export type FileWriteInput = {
  path: string
  content: string
  createParents?: boolean
  expectedOldSha256?: string
}

export type ApplyPatchInput = {
  path: string
  oldText?: string
  newText?: string
  search?: string
  replace?: string
  expectedOldSha256?: string
  allowMultiple?: boolean
}

export type ShellInput = {
  command: string
  args?: string[]
  cwd?: string
  timeoutMs?: number
  maxOutputChars?: number
}

export type GuiToolInput = {
  action: GuiRuntimeAction
}
