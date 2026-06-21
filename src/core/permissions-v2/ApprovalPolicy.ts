import { createPolicyResult, type PolicyResult } from '../sandbox/index.js'
import type { PermissionProfile } from './PermissionProfile.js'

export type ApprovalPolicyName = 'never' | 'on-request' | 'unless-trusted' | 'on-failure' | 'granular'

export function applyApprovalPolicy(result: PolicyResult, profile: PermissionProfile, trusted = false): PolicyResult {
  if (result.decision !== 'ask') return result

  if (profile.approvalPolicy === 'never') {
    return rewriteResult(result, 'deny', `${result.reason}; approval policy never denies prompts`)
  }

  if (profile.approvalPolicy === 'unless-trusted' && trusted) {
    return rewriteResult(result, 'allow', `${result.reason}; trusted caller allowed by unless-trusted policy`)
  }

  return result
}

export function rewriteResult(result: PolicyResult, decision: PolicyResult['decision'], reason: string): PolicyResult {
  return createPolicyResult({
    subject: result.audit.subject,
    decision,
    reason,
    profileName: result.audit.profileName,
    target: result.audit.target,
    metadata: result.audit.metadata,
    risks: result.risks,
  })
}
