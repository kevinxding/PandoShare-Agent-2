import { applyApprovalPolicy, rewriteResult } from './ApprovalPolicy.js'
import { PermissionAudit } from './PermissionAudit.js'
import { getPermissionProfile, type PermissionProfile, type PermissionProfileName } from './PermissionProfile.js'
import { assertPermissionProfile } from './PermissionInvariant.js'
import { SandboxPolicy, type GatewayActionCheckInput, type GuiActionCheckInput, type PolicyResult, type ToolCheckInput } from '../sandbox/index.js'
import type { CommandCheckInput } from '../sandbox/CommandPolicy.js'
import type { PathCheckInput } from '../sandbox/PathPolicy.js'

export type PermissionEngineOptions = {
  profile: PermissionProfileName | PermissionProfile
  workspaceRoot: string
  readableRoots?: readonly string[]
  writableRoots?: readonly string[]
}

export class PermissionEngine {
  readonly profile: PermissionProfile
  readonly audit = new PermissionAudit()
  private readonly sandbox: SandboxPolicy

  constructor(options: PermissionEngineOptions) {
    this.profile = typeof options.profile === 'string' ? getPermissionProfile(options.profile) : options.profile
    assertPermissionProfile(this.profile)
    this.sandbox = new SandboxPolicy({
      sandboxMode: this.profile.sandboxMode,
      workspaceRoot: options.workspaceRoot,
      readableRoots: options.readableRoots,
      writableRoots: options.writableRoots,
      profileName: this.profile.name,
    })
  }

  checkTool(input: ToolCheckInput & { trusted?: boolean }): PolicyResult {
    let result = this.sandbox.checkTool(input)
    if (input.safety === 'workspace_write' && !this.profile.allowWorkspaceWrite) {
      result = rewriteResult(result, 'deny', 'profile does not allow workspace write tools')
    }
    if (input.safety === 'external_write' && !this.profile.allowExternalWrite) {
      result = rewriteResult(result, result.decision === 'allow' ? 'ask' : result.decision, 'profile requires approval for external write tools')
    }
    if (input.safety === 'gui_write' && this.profile.guiMode !== 'write_approval') {
      result = rewriteResult(result, this.profile.guiMode === 'read' ? 'deny' : 'deny', 'profile does not allow GUI write tools')
    }
    return this.finalize(result, input.trusted)
  }

  checkPath(input: PathCheckInput & { trusted?: boolean }): PolicyResult {
    let result = this.sandbox.checkPath(input)
    if (input.operation !== 'read' && !this.profile.allowWorkspaceWrite) {
      result = rewriteResult(result, 'deny', 'profile does not allow workspace path writes')
    }
    return this.finalize(result, input.trusted)
  }

  checkCommand(input: CommandCheckInput & { trusted?: boolean }): PolicyResult {
    let result = this.sandbox.checkCommand(input)
    if (!this.profile.allowExternalWrite && result.decision === 'allow') {
      result = rewriteResult(result, 'ask', 'profile requires approval for shell commands')
    }
    return this.finalize(result, input.trusted)
  }

  checkGuiAction(input: GuiActionCheckInput & { trusted?: boolean }): PolicyResult {
    let result = this.sandbox.checkGuiAction(input)
    if (this.profile.guiMode === 'none') {
      result = rewriteResult(result, result.decision === 'allow' ? 'deny' : result.decision, 'profile does not allow GUI actions')
    }
    if (this.profile.guiMode === 'read' && result.decision !== 'allow') {
      result = rewriteResult(result, 'deny', 'profile only allows read-only GUI actions')
    }
    return this.finalize(result, input.trusted)
  }

  checkGatewayAction(input: GatewayActionCheckInput & { trusted?: boolean }): PolicyResult {
    let result = this.sandbox.checkGatewayAction(input)
    if (this.profile.gatewayMode === 'none') {
      result = rewriteResult(result, result.decision === 'allow' ? 'deny' : result.decision, 'profile does not allow gateway actions')
    }
    if (this.profile.gatewayMode === 'read' && result.decision !== 'allow') {
      result = rewriteResult(result, 'deny', 'profile only allows read-only gateway actions')
    }
    return this.finalize(result, input.trusted)
  }

  listAuditRecords() {
    return this.audit.list()
  }

  private finalize(result: PolicyResult, trusted = false): PolicyResult {
    const approved = applyApprovalPolicy(result, this.profile, trusted)
    this.audit.append(approved.audit)
    return approved
  }
}

export function createPermissionEngine(options: PermissionEngineOptions): PermissionEngine {
  return new PermissionEngine(options)
}
