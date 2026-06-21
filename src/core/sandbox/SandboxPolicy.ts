import { CommandPolicy, type CommandCheckInput } from './CommandPolicy.js'
import { PathPolicy, type PathCheckInput } from './PathPolicy.js'
import { createPolicyResult, type PolicyResult, type SandboxMode, type ToolSafety } from './SandboxTypes.js'

export type SandboxPolicyOptions = {
  sandboxMode?: SandboxMode
  workspaceRoot: string
  readableRoots?: readonly string[]
  writableRoots?: readonly string[]
  profileName?: string
}

export type ToolCheckInput = {
  name: string
  safety: ToolSafety
}

export type GuiActionCheckInput = {
  action: string
  riskHint?: 'read_only' | 'write' | 'dangerous_write'
}

export type GatewayActionCheckInput = {
  action: string
}

const GUI_READ = new Set(['observe', 'screenshot', 'compare_observations', 'analyze_grid'])
const GUI_WRITE = new Set(['click', 'fast_click', 'type', 'type_text', 'key', 'hotkey', 'drag', 'press_key', 'shortcut'])
const GUI_DANGEROUS = new Set(['submit', 'delete', 'publish', 'payment', 'confirm', 'install', 'system_setting'])
const GATEWAY_READ = new Set(['read', 'list', 'status', 'observe', 'get', 'search'])
const GATEWAY_WRITE = new Set(['send', 'approve', 'resolve', 'retry', 'dispatch', 'wake'])
const GATEWAY_DANGEROUS = new Set(['delete', 'purge', 'publish', 'admin', 'rotate_secret'])

export class SandboxPolicy {
  private readonly sandboxMode: SandboxMode
  private readonly profileName?: string
  private readonly pathPolicy: PathPolicy
  private readonly commandPolicy: CommandPolicy

  constructor(options: SandboxPolicyOptions) {
    this.sandboxMode = options.sandboxMode ?? 'workspace-write'
    this.profileName = options.profileName
    this.pathPolicy = new PathPolicy(options)
    this.commandPolicy = new CommandPolicy({
      sandboxMode: this.sandboxMode,
      workspaceRoot: options.workspaceRoot,
      profileName: options.profileName,
    })
  }

  checkTool(input: ToolCheckInput): PolicyResult {
    if (input.safety === 'read_only') {
      return createPolicyResult({
        subject: 'tool',
        decision: 'allow',
        reason: 'read-only tool is allowed',
        target: input.name,
        profileName: this.profileName,
        metadata: { safety: input.safety },
      })
    }

    if (this.sandboxMode === 'full-access') {
      return createPolicyResult({
        subject: 'tool',
        decision: 'allow',
        reason: `${input.safety} tool is allowed by full-access sandbox`,
        target: input.name,
        profileName: this.profileName,
        metadata: { safety: input.safety },
      })
    }

    if (input.safety === 'workspace_write' && this.sandboxMode === 'workspace-write') {
      return createPolicyResult({
        subject: 'tool',
        decision: 'allow',
        reason: 'workspace write tool is allowed by workspace-write sandbox',
        target: input.name,
        profileName: this.profileName,
        metadata: { safety: input.safety },
      })
    }

    return createPolicyResult({
      subject: 'tool',
      decision: 'ask',
      reason: `${input.safety} tool requires approval in ${this.sandboxMode} sandbox`,
      target: input.name,
      profileName: this.profileName,
      metadata: { safety: input.safety },
    })
  }

  checkPath(input: PathCheckInput): PolicyResult {
    return this.pathPolicy.checkPath(input)
  }

  checkCommand(input: CommandCheckInput): PolicyResult {
    return this.commandPolicy.checkCommand(input)
  }

  checkGuiAction(input: GuiActionCheckInput): PolicyResult {
    const action = normalizeAction(input.action)
    if (input.riskHint === 'read_only' || GUI_READ.has(action)) {
      return createPolicyResult({
        subject: 'gui',
        decision: 'allow',
        reason: 'GUI action is read-only',
        target: action,
        profileName: this.profileName,
        metadata: { riskHint: input.riskHint },
      })
    }

    if (input.riskHint === 'dangerous_write' || GUI_DANGEROUS.has(action)) {
      return createPolicyResult({
        subject: 'gui',
        decision: this.sandboxMode === 'full-access' ? 'ask' : 'ask',
        reason: `dangerous GUI action requires approval: ${action}`,
        target: action,
        profileName: this.profileName,
        metadata: { riskHint: input.riskHint },
        risks: ['dangerous_gui_write'],
      })
    }

    if (input.riskHint === 'write' || GUI_WRITE.has(action)) {
      return createPolicyResult({
        subject: 'gui',
        decision: this.sandboxMode === 'full-access' ? 'allow' : 'ask',
        reason: `GUI write action ${this.sandboxMode === 'full-access' ? 'is allowed by full-access sandbox' : 'requires approval'}`,
        target: action,
        profileName: this.profileName,
        metadata: { riskHint: input.riskHint },
      })
    }

    return createPolicyResult({
      subject: 'gui',
      decision: 'ask',
      reason: `unknown GUI action requires approval: ${action}`,
      target: action,
      profileName: this.profileName,
    })
  }

  checkGatewayAction(input: GatewayActionCheckInput): PolicyResult {
    const action = normalizeAction(input.action)
    if (GATEWAY_READ.has(action)) {
      return createPolicyResult({
        subject: 'gateway',
        decision: 'allow',
        reason: 'gateway read action is allowed',
        target: action,
        profileName: this.profileName,
      })
    }
    if (GATEWAY_DANGEROUS.has(action)) {
      return createPolicyResult({
        subject: 'gateway',
        decision: this.sandboxMode === 'full-access' ? 'ask' : 'deny',
        reason: `dangerous gateway action: ${action}`,
        target: action,
        profileName: this.profileName,
        risks: ['dangerous_gateway_action'],
      })
    }
    if (GATEWAY_WRITE.has(action)) {
      return createPolicyResult({
        subject: 'gateway',
        decision: this.sandboxMode === 'full-access' ? 'allow' : 'ask',
        reason: `gateway write action ${this.sandboxMode === 'full-access' ? 'is allowed by full-access sandbox' : 'requires approval'}`,
        target: action,
        profileName: this.profileName,
      })
    }
    return createPolicyResult({
      subject: 'gateway',
      decision: 'ask',
      reason: `unknown gateway action requires approval: ${action}`,
      target: action,
      profileName: this.profileName,
    })
  }
}

function normalizeAction(action: string): string {
  return action.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}
