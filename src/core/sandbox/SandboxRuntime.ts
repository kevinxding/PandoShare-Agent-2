import { SandboxPolicy, type GatewayActionCheckInput, type GuiActionCheckInput, type SandboxPolicyOptions, type ToolCheckInput } from './SandboxPolicy.js'
import { SandboxViolation } from './SandboxViolation.js'
import type { CommandCheckInput } from './CommandPolicy.js'
import type { PathCheckInput } from './PathPolicy.js'
import type { PolicyResult, PolicySubject, SandboxAuditRecord } from './SandboxTypes.js'

export class SandboxRuntime {
  private readonly policy: SandboxPolicy
  private readonly auditRecords: SandboxAuditRecord[] = []

  constructor(options: SandboxPolicyOptions) {
    this.policy = new SandboxPolicy(options)
  }

  checkTool(input: ToolCheckInput): PolicyResult {
    return this.record(this.policy.checkTool(input))
  }

  checkPath(input: PathCheckInput): PolicyResult {
    return this.record(this.policy.checkPath(input))
  }

  checkCommand(input: CommandCheckInput): PolicyResult {
    return this.record(this.policy.checkCommand(input))
  }

  checkGuiAction(input: GuiActionCheckInput): PolicyResult {
    return this.record(this.policy.checkGuiAction(input))
  }

  checkGatewayAction(input: GatewayActionCheckInput): PolicyResult {
    return this.record(this.policy.checkGatewayAction(input))
  }

  assertAllowed(subject: PolicySubject, result: PolicyResult): void {
    if (result.decision !== 'allow') {
      throw new SandboxViolation(subject, result)
    }
  }

  listAuditRecords(): SandboxAuditRecord[] {
    return [...this.auditRecords]
  }

  clearAuditRecords(): void {
    this.auditRecords.length = 0
  }

  private record(result: PolicyResult): PolicyResult {
    this.auditRecords.push(result.audit)
    return result
  }
}
