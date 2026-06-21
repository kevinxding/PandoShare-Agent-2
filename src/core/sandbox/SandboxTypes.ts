export type PolicyDecision = 'allow' | 'ask' | 'deny'
export type SandboxMode = 'read-only' | 'workspace-write' | 'full-access'
export type PolicySubject = 'tool' | 'path' | 'command' | 'gui' | 'gateway'
export type ToolSafety = 'read_only' | 'workspace_write' | 'gui_write' | 'external_write'

export type SandboxAuditRecord = {
  auditId: string
  subject: PolicySubject
  decision: PolicyDecision
  reason: string
  createdAtMs: number
  profileName?: string
  target?: string
  metadata?: Record<string, unknown>
}

export type PolicyResult = {
  decision: PolicyDecision
  reason: string
  audit: SandboxAuditRecord
  risks?: readonly string[]
}

let auditCounter = 0

export function createPolicyResult(input: {
  subject: PolicySubject
  decision: PolicyDecision
  reason: string
  profileName?: string
  target?: string
  metadata?: Record<string, unknown>
  risks?: readonly string[]
}): PolicyResult {
  auditCounter += 1
  return {
    decision: input.decision,
    reason: input.reason,
    risks: input.risks,
    audit: {
      auditId: `audit_${Date.now().toString(36)}_${auditCounter}`,
      subject: input.subject,
      decision: input.decision,
      reason: input.reason,
      createdAtMs: Date.now(),
      profileName: input.profileName,
      target: input.target,
      metadata: input.metadata,
    },
  }
}
