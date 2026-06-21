import { createPolicyResult, type PolicyResult, type SandboxMode } from './SandboxTypes.js'
import { isPathInside, isWindowsPath, normalizePolicyPath } from './PathPolicy.js'

export type CommandRiskLevel = 'ask' | 'deny'

export type CommandRisk = {
  code: string
  level: CommandRiskLevel
  reason: string
}

export type CommandPolicyOptions = {
  sandboxMode?: SandboxMode
  workspaceRoot?: string
  profileName?: string
}

export type CommandCheckInput = {
  command: string
  cwd?: string
  workspaceRoot?: string
}

export class CommandPolicy {
  private readonly sandboxMode: SandboxMode
  private readonly workspaceRoot?: string
  private readonly profileName?: string

  constructor(options: CommandPolicyOptions = {}) {
    this.sandboxMode = options.sandboxMode ?? 'workspace-write'
    this.workspaceRoot = options.workspaceRoot ? normalizePolicyPath(options.workspaceRoot) : undefined
    this.profileName = options.profileName
  }

  checkCommand(input: CommandCheckInput): PolicyResult {
    const risks = classifyCommand(input.command, {
      cwd: input.cwd,
      workspaceRoot: input.workspaceRoot ?? this.workspaceRoot,
    })
    const riskCodes = risks.map(risk => risk.code)
    const hasDeny = risks.some(risk => risk.level === 'deny')
    const hasAsk = risks.some(risk => risk.level === 'ask')

    if (hasDeny) {
      return createPolicyResult({
        subject: 'command',
        decision: this.sandboxMode === 'full-access' ? 'ask' : 'deny',
        reason: `dangerous command: ${risks.map(risk => risk.reason).join('; ')}`,
        target: input.command,
        profileName: this.profileName,
        metadata: { cwd: input.cwd },
        risks: riskCodes,
      })
    }

    if (hasAsk) {
      return createPolicyResult({
        subject: 'command',
        decision: this.sandboxMode === 'full-access' ? 'allow' : 'ask',
        reason: `command requires approval: ${risks.map(risk => risk.reason).join('; ')}`,
        target: input.command,
        profileName: this.profileName,
        metadata: { cwd: input.cwd },
        risks: riskCodes,
      })
    }

    if (this.sandboxMode === 'read-only') {
      return createPolicyResult({
        subject: 'command',
        decision: 'ask',
        reason: 'shell command requires approval in read-only sandbox',
        target: input.command,
        profileName: this.profileName,
        metadata: { cwd: input.cwd },
      })
    }

    return createPolicyResult({
      subject: 'command',
      decision: 'allow',
      reason: 'no dangerous command pattern matched',
      target: input.command,
      profileName: this.profileName,
      metadata: { cwd: input.cwd },
    })
  }
}

export function classifyCommand(command: string, context: { cwd?: string; workspaceRoot?: string } = {}): CommandRisk[] {
  const normalized = command.trim().replace(/\s+/g, ' ')
  const lower = normalized.toLowerCase()
  const risks: CommandRisk[] = []

  addIf(risks, /\brm\s+.*-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/.test(lower) || /\bremove-item\b.*\B-(?:recurse|r)\b.*\B-(?:force|f)\b/.test(lower), {
    code: 'rm_rf',
    level: 'deny',
    reason: 'recursive forced delete',
  })
  addIf(risks, /\bgit\s+reset\s+--hard\b/.test(lower), {
    code: 'git_reset_hard',
    level: 'deny',
    reason: 'git reset --hard discards local changes',
  })
  addIf(risks, /\bgit\s+push\b/.test(lower), {
    code: 'git_push',
    level: 'ask',
    reason: 'git push mutates a remote repository',
  })
  addIf(risks, /\bnpm\s+publish\b/.test(lower), {
    code: 'npm_publish',
    level: 'ask',
    reason: 'npm publish mutates a package registry',
  })
  addIf(risks, /\b(?:curl|wget)\b.+\|\s*(?:sh|bash|pwsh|powershell)\b/.test(lower), {
    code: 'curl_pipe_shell',
    level: 'ask',
    reason: 'downloaded script is piped into a shell',
  })
  addIf(risks, /\bsudo\b/.test(lower), {
    code: 'sudo',
    level: 'ask',
    reason: 'sudo requests elevated privileges',
  })
  addIf(risks, /\bchmod\s+-[a-z]*r[a-z]*\b/.test(lower), {
    code: 'chmod_recursive',
    level: 'ask',
    reason: 'recursive chmod can broadly change permissions',
  })
  addIf(risks, /\b(?:npm\s+(?:install|i)|pnpm\s+(?:add|install)|yarn\s+(?:add|global\s+add)|bun\s+add)\b.*(?:\s-g\b|\s--global\b)/.test(lower), {
    code: 'global_install',
    level: 'ask',
    reason: 'global package install changes machine state',
  })
  addIf(risks, isSensitiveDeletion(lower), {
    code: 'secret_or_ssh_key_deletion',
    level: 'deny',
    reason: 'command deletes environment or SSH key material',
  })

  const outsideMove = classifyOutsideMoveOrCopy(command, context)
  if (outsideMove) risks.push(outsideMove)
  return risks
}

function addIf(risks: CommandRisk[], condition: boolean, risk: CommandRisk): void {
  if (condition) risks.push(risk)
}

function isSensitiveDeletion(lower: string): boolean {
  const deletes = /\b(?:rm|del|erase|remove-item)\b/.test(lower)
  const sensitive = /(?:^|\s|[\\/])(?:\.env(?:\.[\w.-]+)?|\.ssh|id_rsa|id_ed25519|known_hosts|authorized_keys)(?:\s|$|[\\/])/.test(lower)
  return deletes && sensitive
}

function classifyOutsideMoveOrCopy(command: string, context: { cwd?: string; workspaceRoot?: string }): CommandRisk | undefined {
  const workspaceRoot = context.workspaceRoot ? normalizePolicyPath(context.workspaceRoot) : undefined
  if (!workspaceRoot) return undefined

  const tokens = tokenizeCommand(command)
  const firstCommandIndex = tokens.findIndex(token => !isAssignment(token))
  if (firstCommandIndex < 0) return undefined
  const executable = stripExecutable(tokens[firstCommandIndex])
  if (!['mv', 'move', 'cp', 'copy', 'xcopy', 'robocopy', 'move-item', 'copy-item'].includes(executable)) return undefined

  const paths = tokens
    .slice(firstCommandIndex + 1)
    .filter(token => token && !token.startsWith('-') && !token.startsWith('/'))
    .map(token => token.replace(/^['"]|['"]$/g, ''))
    .filter(token => isLikelyPath(token))

  const base = context.cwd ? normalizePolicyPath(context.cwd, workspaceRoot) : workspaceRoot
  const outside = paths
    .map(item => normalizePolicyPath(item, base))
    .filter(item => !isPathInside(item, workspaceRoot))

  if (!outside.length) return undefined
  return {
    code: 'outside_move_or_copy',
    level: 'deny',
    reason: `move/copy references outside workspace path: ${outside[0]}`,
  }
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g)
  return matches ?? []
}

function stripExecutable(input: string): string {
  const unquoted = input.replace(/^['"]|['"]$/g, '')
  const normalized = unquoted.toLowerCase().replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function isAssignment(token: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(token)
}

function isLikelyPath(token: string): boolean {
  return token.includes('/') || token.includes('\\') || token.startsWith('.') || isWindowsPath(token)
}
