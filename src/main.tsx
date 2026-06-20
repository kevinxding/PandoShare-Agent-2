import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import { QueryEngine } from './QueryEngine.js'
import { compactThreadHistory } from './services/compact/index.js'
import { createTerminalEventHandler } from './services/events/index.js'
import { createGuiBackendFromMcpConnections, diagnoseGuiBackend, formatGuiDoctorReport } from './services/gui/index.js'
import {
  closeMcpConnections,
  connectConfiguredMcpServers,
  formatMcpReport,
  summarizeMcpConnections,
} from './services/mcp/index.js'
import {
  LocalLoopStore,
  LoopRuntime,
  type LoopExportFormat,
  type LoopTrigger,
  type LoopSpec,
  type LoopSummary,
  type LoopWorkspaceIsolation,
} from './services/loopRuntime/index.js'
import {
  LocalGoalStore,
  type GoalExportData,
  type GoalSummary,
} from './services/goalStore/index.js'
import { GoalService } from './services/goalService/index.js'
import { GoalRuntime } from './services/goalRuntime/index.js'
import {
  formatGatewayDoctorReport,
  GatewayRuntime,
  LocalGatewayStore,
} from './services/gatewayRuntime/index.js'
import { createTerminalApprovalHandler } from './services/permissions/terminalApproval.js'
import { formatPreflightReport, loadRuntimeConfig, runPreflight } from './services/preflight/index.js'
import type { ProjectConfig } from './services/config/index.js'
import {
  LocalThreadStore,
  type ThreadCompactionReason,
  type ThreadExportFormat,
  type ThreadSummary,
} from './services/threadStore/index.js'
import { createRuntimeToolRegistry } from './tools.js'
import { startPandoServer } from './server/index.js'

type RuntimeProcess = {
  argv: string[]
  cwd(): string
  stdout: {
    write(text: string): void
  }
  stderr?: {
    write(text: string): void
  }
  stdin: unknown
}

function getRuntimeProcess(): RuntimeProcess {
  const runtime = globalThis as unknown as { process?: RuntimeProcess }
  if (!runtime.process) {
    throw new Error('process runtime is unavailable')
  }
  return runtime.process
}

export async function main(argv = getRuntimeProcess().argv.slice(2)): Promise<void> {
  const runtimeProcess = getRuntimeProcess()
  const args = parseArgs(argv)
  if (args.kind === 'doctor') {
    await runDoctorCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'mcp') {
    await runMcpCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'gui') {
    await runGuiCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'gateway') {
    await runGatewayCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'thread') {
    await runThreadCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'goal') {
    await runGoalCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'loop') {
    await runLoopCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'serve') {
    await runServeCommand(args, runtimeProcess)
    return
  }

  if (args.kind === 'repl') {
    await runRepl(args, runtimeProcess)
    return
  }

  await runPrompt(args, runtimeProcess)
}

type CommonOptions = {
  configPath?: string
}

type GoalCommandArgs =
  | {
      kind: 'goal'
      command: 'create'
      goalId?: string
      title?: string
      objective?: string
      objectiveFile?: string
      requirements: string[]
    }
  | {
      kind: 'goal'
      command: 'list'
      limit?: number
    }
  | {
      kind: 'goal'
      command: 'inspect' | 'status' | 'resume' | 'pause' | 'complete' | 'export'
      goalId?: string
      format?: 'json' | 'md'
      out?: string
    }
  | {
      kind: 'goal'
      command: 'block'
      goalId?: string
      reason?: string
    }

type ThreadCommandArgs =
  | {
      kind: 'thread'
      command: 'list'
      limit?: number
    }
  | {
      kind: 'thread'
      command: 'inspect'
      threadId: string
    }
  | {
      kind: 'thread'
      command: 'rename'
      threadId: string
      title: string
    }
  | {
      kind: 'thread'
      command: 'export'
      threadId: string
      format: ThreadExportFormat
      out?: string
    }
  | {
      kind: 'thread'
      command: 'branch'
      threadId: string
      title?: string
    }
  | {
      kind: 'thread'
      command: 'compact'
      threadId: string
      reason: ThreadCompactionReason
    }

type LoopCommandArgs =
  | {
      kind: 'loop'
      command: 'create'
      configPath?: string
      specPath?: string
      title?: string
      objective?: string
      trigger?: LoopTrigger
      verifyCommand?: string
      maxIterations?: number
      maxTokens?: number
      manualInterventionAfterFailures?: number
      manualInterventionAfterIterations?: number
      manualInterventionPatterns?: string[]
      workspaceIsolation?: LoopWorkspaceIsolation
      goalId?: string
    }
  | {
      kind: 'loop'
      command: 'list'
      limit?: number
    }
  | {
      kind: 'loop'
      command: 'inspect'
      loopId: string
    }
  | {
      kind: 'loop'
      command: 'run' | 'resume'
      configPath?: string
      loopId: string
      goalId?: string
    }
  | {
      kind: 'loop'
      command: 'pause' | 'stop'
      loopId: string
    }
  | {
      kind: 'loop'
      command: 'export'
      loopId: string
      format: LoopExportFormat
      out?: string
    }

type GatewayCommandArgs =
  | {
      kind: 'gateway'
      command: 'doctor'
      configPath?: string
      json: boolean
    }
  | {
      kind: 'gateway'
      command: 'status'
      configPath?: string
      json: boolean
    }
  | {
      kind: 'gateway'
      command: 'start'
      configPath?: string
      json: boolean
      durationMs?: number
      heartbeatIntervalMs?: number
      progressHeartbeatIntervalMs?: number
      wakeHeartbeatIntervalMs?: number
      message?: string
      channelId: string
      userId: string
      allowUsers?: readonly string[]
    }
  | {
      kind: 'gateway'
      command: 'recover'
      configPath?: string
      json: boolean
      durationMs?: number
      heartbeatIntervalMs?: number
      progressHeartbeatIntervalMs?: number
      wakeHeartbeatIntervalMs?: number
      allowUsers?: readonly string[]
    }
  | {
      kind: 'gateway'
      command: 'stop'
      configPath?: string
      json: boolean
      channelId: string
      userId: string
    }

type ParsedArgs =
  | {
      kind: 'run'
      prompt: string
      mode: 'direct' | 'exec'
      configPath?: string
      provider?: string
      model?: string
      threadId?: string
      resumeLast?: boolean
      newThread?: boolean
      goalId?: string
    }
  | {
      kind: 'repl'
      configPath?: string
      provider?: string
      model?: string
      threadId?: string
      resumeLast?: boolean
      newThread?: boolean
      goalId?: string
    }
  | {
      kind: 'doctor'
      configPath?: string
      json: boolean
    }
  | {
      kind: 'mcp'
      command: 'doctor' | 'list'
      configPath?: string
      json: boolean
    }
  | {
      kind: 'gui'
      command: 'doctor'
      configPath?: string
      json: boolean
    }
  | {
      kind: 'serve'
      configPath?: string
      host?: string
      port?: number
      open: boolean
    }
  | GoalCommandArgs
  | ThreadCommandArgs
  | LoopCommandArgs
  | GatewayCommandArgs

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv[0] === 'doctor') return parseDoctorCommand(argv.slice(1))
  if (argv[0] === 'mcp') return parseMcpCommand(argv.slice(1))
  if (argv[0] === 'gui') return parseGuiCommand(argv.slice(1))
  if (argv[0] === 'gateway') return parseGatewayCommand(argv.slice(1))
  if (argv[0] === 'goal') return parseGoalCommand(argv.slice(1))
  if (argv[0] === 'thread') return parseThreadCommand(argv.slice(1))
  if (argv[0] === 'loop') return parseLoopCommand(argv.slice(1))
  if (argv[0] === 'serve') return parseServeCommand(argv.slice(1))
  if (argv[0] === 'exec') return parseRunArgs(argv.slice(1), 'exec')
  return parseRunArgs(argv, 'direct')
}

function parseRunArgs(argv: readonly string[], mode: 'direct' | 'exec'): Extract<ParsedArgs, { kind: 'run' | 'repl' }> {
  const common = parseCommonOptions(argv)
  const promptParts: string[] = []
  let provider: string | undefined
  let model: string | undefined
  let threadId: string | undefined
  let resumeLast = false
  let newThread = false
  let goalId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        index += 1
        break
      case '--provider':
        provider = parseProviderId(requiredArg(argv[index + 1], '--provider requires a provider id'))
        index += 1
        break
      case '--model':
        model = parseModelName(requiredArg(argv[index + 1], '--model requires a model name'))
        index += 1
        break
      case '--thread': {
        const value = argv[index + 1]
        if (!value || value.startsWith('--')) throw new Error('--thread requires a thread id')
        threadId = value
        index += 1
        break
      }
      case '--resume-last':
        resumeLast = true
        break
      case '--new-thread':
        newThread = true
        break
      case '--goal':
        goalId = requiredArg(argv[index + 1], '--goal requires a goal id')
        index += 1
        break
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`)
        promptParts.push(arg)
        break
    }
  }

  if (newThread && threadId) throw new Error('--new-thread cannot be combined with --thread')
  if (newThread && resumeLast) throw new Error('--new-thread cannot be combined with --resume-last')
  if (threadId && resumeLast) throw new Error('--thread cannot be combined with --resume-last')

  const prompt = promptParts.join(' ').trim()
  if (!prompt) {
    if (mode === 'exec') throw new Error('pando exec requires a prompt')
    return {
      kind: 'repl',
      configPath: common.configPath,
      provider,
      model,
      threadId,
      resumeLast,
      newThread,
      goalId,
    }
  }

  return {
    kind: 'run',
    mode,
    prompt,
    configPath: common.configPath,
    provider,
    model,
    threadId,
    resumeLast,
    newThread,
    goalId,
  }
}

function parseCommonOptions(argv: readonly string[]): CommonOptions {
  let configPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        configPath = requiredArg(argv[index + 1], '--config requires a path')
        index += 1
        break
      default:
        break
    }
  }
  return { configPath }
}

function parseDoctorCommand(argv: readonly string[]): Extract<ParsedArgs, { kind: 'doctor' }> {
  return {
    kind: 'doctor',
    configPath: parseCommonOptions(argv).configPath,
    json: argv.includes('--json'),
  }
}

function parseMcpCommand(argv: readonly string[]): Extract<ParsedArgs, { kind: 'mcp' }> {
  const command = argv[0]
  if (command !== 'doctor' && command !== 'list') {
    throw new Error(`Unknown mcp command: ${command ?? '(missing)'}`)
  }
  return {
    kind: 'mcp',
    command,
    configPath: parseCommonOptions(argv.slice(1)).configPath,
    json: argv.includes('--json'),
  }
}

function parseGuiCommand(argv: readonly string[]): Extract<ParsedArgs, { kind: 'gui' }> {
  const command = argv[0]
  if (command !== 'doctor') {
    throw new Error(`Unknown gui command: ${command ?? '(missing)'}`)
  }
  return {
    kind: 'gui',
    command,
    configPath: parseCommonOptions(argv.slice(1)).configPath,
    json: argv.includes('--json'),
  }
}

function parseGoalCommand(argv: readonly string[]): GoalCommandArgs {
  const command = argv[0]
  switch (command) {
    case 'create':
      return parseGoalCreate(argv.slice(1))
    case 'list':
      return {
        kind: 'goal',
        command,
        limit: parseLimitOption(argv.slice(1), 'goal list'),
      }
    case 'inspect':
      return {
        kind: 'goal',
        command,
        goalId: requiredArg(argv[1], 'goal inspect requires a goal id'),
      }
    case 'status':
    case 'resume':
    case 'pause':
    case 'complete':
      return {
        kind: 'goal',
        command,
        goalId: argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined,
      }
    case 'block':
      return parseGoalBlock(argv.slice(1))
    case 'export':
      return parseGoalExport(argv.slice(1))
    default:
      throw new Error(`Unknown goal command: ${command ?? '(missing)'}`)
  }
}

function parseGoalCreate(argv: readonly string[]): Extract<GoalCommandArgs, { command: 'create' }> {
  let goalId: string | undefined
  let title: string | undefined
  let objective: string | undefined
  let objectiveFile: string | undefined
  const requirements: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--id':
        goalId = requiredArg(argv[index + 1], '--id requires a goal id')
        index += 1
        break
      case '--title':
        title = requiredArg(argv[index + 1], '--title requires a title')
        index += 1
        break
      case '--objective':
        objective = requiredArg(argv[index + 1], '--objective requires text')
        index += 1
        break
      case '--objective-file':
        objectiveFile = requiredArg(argv[index + 1], '--objective-file requires a path')
        index += 1
        break
      case '--requirement':
        requirements.push(requiredArg(argv[index + 1], '--requirement requires text'))
        index += 1
        break
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown goal create option: ${arg}`)
        objective = objective ? `${objective} ${arg}` : arg
        break
    }
  }

  if (!objective && !objectiveFile) throw new Error('goal create requires --objective, --objective-file, or objective text')
  return {
    kind: 'goal',
    command: 'create',
    goalId,
    title,
    objective,
    objectiveFile,
    requirements,
  }
}

function parseGoalBlock(argv: readonly string[]): Extract<GoalCommandArgs, { command: 'block' }> {
  let goalId: string | undefined
  let reason: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--reason':
        reason = requiredArg(argv[index + 1], '--reason requires text')
        index += 1
        break
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown goal block option: ${arg}`)
        goalId = goalId ? goalId : arg
        break
    }
  }
  return {
    kind: 'goal',
    command: 'block',
    goalId,
    reason,
  }
}

function parseGoalExport(argv: readonly string[]): GoalCommandArgs {
  const goalId = requiredArg(argv[0], 'goal export requires a goal id')
  let format: 'json' | 'md' = 'md'
  let out: string | undefined

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--format': {
        const value = requiredArg(argv[index + 1], '--format requires json or md')
        if (value !== 'json' && value !== 'md') throw new Error('--format must be json or md')
        format = value
        index += 1
        break
      }
      case '--out':
        out = requiredArg(argv[index + 1], '--out requires a path')
        index += 1
        break
      default:
        throw new Error(`Unknown goal export option: ${arg}`)
    }
  }

  return {
    kind: 'goal',
    command: 'export',
    goalId,
    format,
    out,
  }
}

function parseGatewayCommand(argv: readonly string[]): GatewayCommandArgs {
  const command = argv[0]
  if (command === 'doctor') {
    return {
      kind: 'gateway',
      command,
      configPath: parseCommonOptions(argv.slice(1)).configPath,
      json: argv.includes('--json'),
    }
  }
  if (command === 'status') {
    return {
      kind: 'gateway',
      command,
      configPath: parseCommonOptions(argv.slice(1)).configPath,
      json: argv.includes('--json'),
    }
  }
  if (command === 'start') return parseGatewayStart(argv.slice(1))
  if (command === 'recover') return parseGatewayRecover(argv.slice(1))
  if (command === 'stop') return parseGatewayStop(argv.slice(1))
  throw new Error(`Unknown gateway command: ${command ?? '(missing)'}`)
}

function parseGatewayStart(argv: readonly string[]): Extract<GatewayCommandArgs, { command: 'start' }> {
  const common = parseCommonOptions(argv)
  let durationMs: number | undefined
  let heartbeatIntervalMs: number | undefined
  let progressHeartbeatIntervalMs: number | undefined
  let wakeHeartbeatIntervalMs: number | undefined
  let message: string | undefined
  let channelId = 'local'
  let userId = 'local-user'
  let allowUsers: string[] | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        index += 1
        break
      case '--json':
        break
      case '--duration-ms':
        durationMs = parsePositiveInteger(requiredArg(argv[index + 1], '--duration-ms requires a number'), '--duration-ms')
        index += 1
        break
      case '--heartbeat-interval-ms':
        heartbeatIntervalMs = parsePositiveInteger(requiredArg(argv[index + 1], '--heartbeat-interval-ms requires a number'), '--heartbeat-interval-ms')
        index += 1
        break
      case '--progress-heartbeat-interval-ms':
        progressHeartbeatIntervalMs = parsePositiveInteger(
          requiredArg(argv[index + 1], '--progress-heartbeat-interval-ms requires a number'),
          '--progress-heartbeat-interval-ms',
        )
        index += 1
        break
      case '--wake-heartbeat-interval-ms':
        wakeHeartbeatIntervalMs = parsePositiveInteger(
          requiredArg(argv[index + 1], '--wake-heartbeat-interval-ms requires a number'),
          '--wake-heartbeat-interval-ms',
        )
        index += 1
        break
      case '--message':
        message = requiredArg(argv[index + 1], '--message requires text')
        index += 1
        break
      case '--channel':
        channelId = requiredArg(argv[index + 1], '--channel requires an id')
        index += 1
        break
      case '--user':
        userId = requiredArg(argv[index + 1], '--user requires an id')
        index += 1
        break
      case '--allow-user':
        allowUsers ??= []
        allowUsers.push(requiredArg(argv[index + 1], '--allow-user requires an id'))
        index += 1
        break
      default:
        throw new Error(`Unknown gateway start option: ${arg}`)
    }
  }

  return {
    kind: 'gateway',
    command: 'start',
    configPath: common.configPath,
    json: argv.includes('--json'),
    durationMs,
    heartbeatIntervalMs,
    progressHeartbeatIntervalMs,
    wakeHeartbeatIntervalMs,
    message,
    channelId,
    userId,
    allowUsers,
  }
}

function parseGatewayRecover(argv: readonly string[]): Extract<GatewayCommandArgs, { command: 'recover' }> {
  const common = parseCommonOptions(argv)
  let durationMs: number | undefined
  let heartbeatIntervalMs: number | undefined
  let progressHeartbeatIntervalMs: number | undefined
  let wakeHeartbeatIntervalMs: number | undefined
  let allowUsers: string[] | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        index += 1
        break
      case '--json':
        break
      case '--duration-ms':
        durationMs = parsePositiveInteger(requiredArg(argv[index + 1], '--duration-ms requires a number'), '--duration-ms')
        index += 1
        break
      case '--heartbeat-interval-ms':
        heartbeatIntervalMs = parsePositiveInteger(requiredArg(argv[index + 1], '--heartbeat-interval-ms requires a number'), '--heartbeat-interval-ms')
        index += 1
        break
      case '--progress-heartbeat-interval-ms':
        progressHeartbeatIntervalMs = parsePositiveInteger(
          requiredArg(argv[index + 1], '--progress-heartbeat-interval-ms requires a number'),
          '--progress-heartbeat-interval-ms',
        )
        index += 1
        break
      case '--wake-heartbeat-interval-ms':
        wakeHeartbeatIntervalMs = parsePositiveInteger(
          requiredArg(argv[index + 1], '--wake-heartbeat-interval-ms requires a number'),
          '--wake-heartbeat-interval-ms',
        )
        index += 1
        break
      case '--allow-user':
        allowUsers ??= []
        allowUsers.push(requiredArg(argv[index + 1], '--allow-user requires an id'))
        index += 1
        break
      default:
        throw new Error(`Unknown gateway recover option: ${arg}`)
    }
  }

  return {
    kind: 'gateway',
    command: 'recover',
    configPath: common.configPath,
    json: argv.includes('--json'),
    durationMs,
    heartbeatIntervalMs,
    progressHeartbeatIntervalMs,
    wakeHeartbeatIntervalMs,
    allowUsers,
  }
}

function parseGatewayStop(argv: readonly string[]): Extract<GatewayCommandArgs, { command: 'stop' }> {
  const common = parseCommonOptions(argv)
  let channelId = 'local'
  let userId = 'local-user'

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        index += 1
        break
      case '--json':
        break
      case '--channel':
        channelId = requiredArg(argv[index + 1], '--channel requires an id')
        index += 1
        break
      case '--user':
        userId = requiredArg(argv[index + 1], '--user requires an id')
        index += 1
        break
      default:
        throw new Error(`Unknown gateway stop option: ${arg}`)
    }
  }

  return {
    kind: 'gateway',
    command: 'stop',
    configPath: common.configPath,
    json: argv.includes('--json'),
    channelId,
    userId,
  }
}

function parseServeCommand(argv: readonly string[]): Extract<ParsedArgs, { kind: 'serve' }> {
  const common = parseCommonOptions(argv)
  let host: string | undefined
  let port: number | undefined
  let open = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        index += 1
        break
      case '--host':
        host = requiredArg(argv[index + 1], '--host requires a host')
        index += 1
        break
      case '--port': {
        const value = Number(requiredArg(argv[index + 1], '--port requires a number'))
        if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('--port must be an integer from 0 to 65535')
        port = value
        index += 1
        break
      }
      case '--open':
        open = true
        break
      default:
        throw new Error(`Unknown serve option: ${arg}`)
    }
  }

  return {
    kind: 'serve',
    configPath: common.configPath,
    host,
    port,
    open,
  }
}

async function runPrompt(args: Extract<ParsedArgs, { kind: 'run' }>, runtimeProcess: RuntimeProcess): Promise<void> {
  const runtime = await createAgentRuntime(args, runtimeProcess)
  try {
    const result = await runtime.engine.run(args.prompt)
    runtimeProcess.stdout.write(`${result.finalText}\n`)
  } finally {
    runtime.close()
  }
}

async function runRepl(args: Extract<ParsedArgs, { kind: 'repl' }>, runtimeProcess: RuntimeProcess): Promise<void> {
  const runtime = await createAgentRuntime(args, runtimeProcess)
  const readline = createInterface({
    input: runtimeProcess.stdin,
    output: runtimeProcess.stdout,
  })
  runtimeProcess.stdout.write('Pando Agent. Type /exit to quit.\n')
  try {
    while (true) {
      const prompt = (await readline.question('pando> ')).trim()
      if (!prompt) continue
      if (prompt === '/exit' || prompt === '/quit') break
      const result = await runtime.engine.run(prompt)
      runtimeProcess.stdout.write(`${result.finalText}\n`)
    }
  } finally {
    readline.close()
    runtime.close()
  }
}

async function createAgentRuntime(
  args: Extract<ParsedArgs, { kind: 'run' | 'repl' }>,
  runtimeProcess: RuntimeProcess,
): Promise<{ engine: QueryEngine; close(): void }> {
  const cwd = runtimeProcess.cwd()
  const sessionId = `local-${Date.now()}`
  const { config } = await loadRuntimeConfig(cwd, args.configPath)
  const effectiveConfig = applyCliModelOverride(config, args)
  const terminalEvents = createTerminalEventHandler(runtimeProcess.stdout)
  const { registry, mcpConnections } = await createRuntimeToolRegistry({
    config: effectiveConfig,
    mcp: {
      sessionId,
      emitEvent: terminalEvents,
    },
  })
  const guiBackend = createGuiBackendFromMcpConnections(mcpConnections)
  const engine = new QueryEngine({
    cwd,
    sessionId,
    config: effectiveConfig,
    modelOverride: cliModelOverride(args),
    registry,
    threadId: args.threadId,
    resumeLast: args.resumeLast,
    newThread: args.newThread,
    goalId: args.goalId,
    requestToolApproval: createTerminalApprovalHandler({
      input: runtimeProcess.stdin,
      output: runtimeProcess.stdout,
    }),
    onEvent: terminalEvents,
    metadata: {
      guiBackend,
    },
  })
  return {
    engine,
    close() {
      closeMcpConnections(mcpConnections)
    },
  }
}

function cliModelOverride(args: { provider?: string; model?: string }): { provider?: string; name?: string } | undefined {
  if (!args.provider && !args.model) return undefined
  return {
    provider: args.provider,
    name: args.model,
  }
}

function applyCliModelOverride(config: ProjectConfig, args: { provider?: string; model?: string }): ProjectConfig {
  if (!args.provider && !args.model) return config
  return {
    ...config,
    model: {
      ...(config.model ?? {}),
      provider: args.provider ?? config.model?.provider,
      name: args.model ?? (args.provider ? undefined : config.model?.name),
    },
  }
}

async function runDoctorCommand(args: Extract<ParsedArgs, { kind: 'doctor' }>, runtimeProcess: RuntimeProcess): Promise<void> {
  const report = await runPreflight({
    cwd: runtimeProcess.cwd(),
    configPath: args.configPath,
  })
  runtimeProcess.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatPreflightReport(report))
}

async function runMcpCommand(args: Extract<ParsedArgs, { kind: 'mcp' }>, runtimeProcess: RuntimeProcess): Promise<void> {
  const { config } = await loadRuntimeConfig(runtimeProcess.cwd(), args.configPath)
  const connections = await connectConfiguredMcpServers(config)
  try {
    if (args.json) {
      runtimeProcess.stdout.write(`${JSON.stringify(summarizeMcpConnections(connections), null, 2)}\n`)
    } else {
      runtimeProcess.stdout.write(formatMcpReport(connections))
    }
  } finally {
    closeMcpConnections(connections)
  }
}

async function runGuiCommand(args: Extract<ParsedArgs, { kind: 'gui' }>, runtimeProcess: RuntimeProcess): Promise<void> {
  const { config } = await loadRuntimeConfig(runtimeProcess.cwd(), args.configPath)
  const connections = await connectConfiguredMcpServers(config)
  try {
    const backend = createGuiBackendFromMcpConnections(connections)
    const report = diagnoseGuiBackend(backend)
    runtimeProcess.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatGuiDoctorReport(report))
  } finally {
    closeMcpConnections(connections)
  }
}

async function runGatewayCommand(args: GatewayCommandArgs, runtimeProcess: RuntimeProcess): Promise<void> {
  const workspaceRoot = runtimeProcess.cwd()
  const { config } = await loadRuntimeConfig(workspaceRoot, args.configPath)
  const store = new LocalGatewayStore(workspaceRoot)
  const gateway = new GatewayRuntime(store)

  switch (args.command) {
    case 'doctor': {
      const report = await gateway.doctor(config)
      runtimeProcess.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatGatewayDoctorReport(report))
      return
    }
    case 'status': {
      const report = await gateway.doctor(config)
      const status = {
        ok: report.ok,
        doctor: report,
        watchdog: report.watchdog,
        state: await store.readState(),
        inbox: (await store.readInbound()).slice(-20),
        outbox: (await store.readOutbound()).slice(-20),
        pairedUsers: await store.readPairedUsers(),
        events: (await store.readEvents()).slice(-50),
        wakeRuns: (await store.readWakeRuns()).slice(-20),
      }
      runtimeProcess.stdout.write(args.json ? `${JSON.stringify(status, null, 2)}\n` : formatGatewayStatusReport(status))
      return
    }
    case 'start': {
      const output = await gateway.start({
        sessionId: `gateway-${Date.now()}`,
        config,
        durationMs: args.durationMs,
        heartbeatIntervalMs: args.heartbeatIntervalMs,
        progressHeartbeatIntervalMs: args.progressHeartbeatIntervalMs,
        wakeHeartbeatIntervalMs: args.wakeHeartbeatIntervalMs,
        allowUsers: args.allowUsers,
        localMessages: args.message
          ? [
              {
                channelId: args.channelId,
                userId: args.userId,
                text: args.message,
              },
            ]
          : [],
        stdout: args.json ? undefined : runtimeProcess.stdout,
      })
      if (args.json) {
        runtimeProcess.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
      } else {
        runtimeProcess.stdout.write(
          [
            `Gateway stopped: ${output.state.status}`,
            `Heartbeat count: ${output.state.heartbeatCount}`,
            `Processed messages: ${output.processedMessageCount}`,
            `Outbox messages: ${output.outboundMessageCount}`,
            `State: ${output.state.statePath}`,
            '',
          ].join('\n'),
        )
      }
      return
    }
    case 'recover': {
      const report = await gateway.doctor(config)
      if (!report.watchdog.recoverable) {
        const output = {
          ok: true,
          recovered: false,
          watchdog: report.watchdog,
          note: `Gateway recovery is not required for watchdog status ${report.watchdog.status}.`,
        }
        runtimeProcess.stdout.write(args.json ? `${JSON.stringify(output, null, 2)}\n` : formatGatewayRecoverReport(output))
        return
      }
      const output = await gateway.start({
        sessionId: `gateway-recover-${Date.now()}`,
        config,
        durationMs: args.durationMs,
        heartbeatIntervalMs: args.heartbeatIntervalMs,
        progressHeartbeatIntervalMs: args.progressHeartbeatIntervalMs,
        wakeHeartbeatIntervalMs: args.wakeHeartbeatIntervalMs,
        wakeOnStart: true,
        allowUsers: args.allowUsers,
        stdout: args.json ? undefined : runtimeProcess.stdout,
      })
      const result = {
        ok: true,
        recovered: Boolean(output.state.recoveredFrom),
        previousWatchdog: report.watchdog,
        output,
      }
      runtimeProcess.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : formatGatewayRecoverReport(result))
      return
    }
    case 'stop': {
      const message = await store.appendInbound({
        channelId: args.channelId,
        channelKind: 'local',
        userId: args.userId,
        text: '/stop',
      })
      const state = await store.readState()
      const output = {
        ok: true,
        messageId: message.messageId,
        state,
        note: state?.status === 'running'
          ? 'Stop request queued. The running gateway will process /stop from its inbox.'
          : 'Stop request queued. Start the gateway to process pending inbox commands.',
      }
      runtimeProcess.stdout.write(args.json ? `${JSON.stringify(output, null, 2)}\n` : formatGatewayStopReport(output))
      return
    }
  }
}

async function runServeCommand(args: Extract<ParsedArgs, { kind: 'serve' }>, runtimeProcess: RuntimeProcess): Promise<void> {
  await startPandoServer({
    cwd: runtimeProcess.cwd(),
    configPath: args.configPath,
    host: args.host,
    port: args.port,
    open: args.open,
    stdout: runtimeProcess.stdout,
  })
}

function parseThreadCommand(argv: readonly string[]): ThreadCommandArgs {
  const command = argv[0]
  switch (command) {
    case 'list':
      return {
        kind: 'thread',
        command,
        limit: parseLimitOption(argv.slice(1)),
      }
    case 'inspect':
      return {
        kind: 'thread',
        command,
        threadId: requiredArg(argv[1], 'thread inspect requires a thread id'),
      }
    case 'rename':
      return {
        kind: 'thread',
        command,
        threadId: requiredArg(argv[1], 'thread rename requires a thread id'),
        title: requiredTitle(argv.slice(2)),
      }
    case 'export':
      return parseThreadExport(argv.slice(1))
    case 'branch':
      return parseThreadBranch(argv.slice(1))
    case 'compact':
      return parseThreadCompact(argv.slice(1))
    default:
      throw new Error(`Unknown thread command: ${command ?? '(missing)'}`)
  }
}

function parseThreadExport(argv: readonly string[]): Extract<ThreadCommandArgs, { command: 'export' }> {
  const threadId = requiredArg(argv[0], 'thread export requires a thread id')
  let format: ThreadExportFormat = 'md'
  let out: string | undefined

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--format': {
        const value = requiredArg(argv[index + 1], '--format requires json or md')
        if (value !== 'json' && value !== 'md') throw new Error('--format must be json or md')
        format = value
        index += 1
        break
      }
      case '--out':
        out = requiredArg(argv[index + 1], '--out requires a path')
        index += 1
        break
      default:
        throw new Error(`Unknown thread export option: ${arg}`)
    }
  }

  return {
    kind: 'thread',
    command: 'export',
    threadId,
    format,
    out,
  }
}

function parseThreadBranch(argv: readonly string[]): Extract<ThreadCommandArgs, { command: 'branch' }> {
  const threadId = requiredArg(argv[0], 'thread branch requires a thread id')
  let title: string | undefined

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--title':
        title = requiredArg(argv[index + 1], '--title requires a title')
        index += 1
        break
      default:
        throw new Error(`Unknown thread branch option: ${arg}`)
    }
  }

  return {
    kind: 'thread',
    command: 'branch',
    threadId,
    title,
  }
}

function parseThreadCompact(argv: readonly string[]): Extract<ThreadCommandArgs, { command: 'compact' }> {
  const threadId = requiredArg(argv[0], 'thread compact requires a thread id')
  let reason: ThreadCompactionReason = 'manual'

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--reason': {
        const value = requiredArg(argv[index + 1], '--reason requires manual, context_limit, or retry_after_failure')
        if (value !== 'manual' && value !== 'context_limit' && value !== 'retry_after_failure') {
          throw new Error('--reason must be manual, context_limit, or retry_after_failure')
        }
        reason = value
        index += 1
        break
      }
      default:
        throw new Error(`Unknown thread compact option: ${arg}`)
    }
  }

  return {
    kind: 'thread',
    command: 'compact',
    threadId,
    reason,
  }
}

function parseLoopCommand(argv: readonly string[]): LoopCommandArgs {
  const command = argv[0]
  switch (command) {
    case 'create':
      return parseLoopCreate(argv.slice(1))
    case 'list':
      return {
        kind: 'loop',
        command,
        limit: parseLimitOption(argv.slice(1)),
      }
    case 'inspect':
      return {
        kind: 'loop',
        command,
        loopId: requiredArg(argv[1], 'loop inspect requires a loop id'),
      }
    case 'run':
    case 'resume':
      return parseLoopRun(command, argv.slice(1))
    case 'pause':
    case 'stop':
      return {
        kind: 'loop',
        command,
        loopId: requiredArg(argv[1], `loop ${command} requires a loop id`),
      }
    case 'export':
      return parseLoopExport(argv.slice(1))
    default:
      throw new Error(`Unknown loop command: ${command ?? '(missing)'}`)
  }
}

function parseLoopCreate(argv: readonly string[]): Extract<LoopCommandArgs, { command: 'create' }> {
  const common = parseCommonOptions(argv)
  let specPath: string | undefined
  let title: string | undefined
  let objective: string | undefined
  let trigger: LoopTrigger | undefined
  let verifyCommand: string | undefined
  let maxIterations: number | undefined
  let maxTokens: number | undefined
  let manualInterventionAfterFailures: number | undefined
  let manualInterventionAfterIterations: number | undefined
  const manualInterventionPatterns: string[] = []
  let workspaceIsolation: LoopWorkspaceIsolation | undefined
  let goalId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        index += 1
        break
      case '--spec':
        specPath = requiredArg(argv[index + 1], '--spec requires a path')
        index += 1
        break
      case '--title':
        title = requiredArg(argv[index + 1], '--title requires a title')
        index += 1
        break
      case '--objective':
        objective = requiredArg(argv[index + 1], '--objective requires text')
        index += 1
        break
      case '--trigger':
        trigger = parseLoopTrigger(requiredArg(argv[index + 1], '--trigger requires manual, schedule, or heartbeat'))
        index += 1
        break
      case '--verify-command':
        verifyCommand = requiredArg(argv[index + 1], '--verify-command requires a command')
        index += 1
        break
      case '--max-iterations': {
        const value = Number(requiredArg(argv[index + 1], '--max-iterations requires a number'))
        if (!Number.isInteger(value) || value < 1) throw new Error('--max-iterations must be a positive integer')
        maxIterations = value
        index += 1
        break
      }
      case '--max-tokens': {
        const value = Number(requiredArg(argv[index + 1], '--max-tokens requires a number'))
        if (!Number.isInteger(value) || value < 1) throw new Error('--max-tokens must be a positive integer')
        maxTokens = value
        index += 1
        break
      }
      case '--manual-intervention-after-failures': {
        const value = Number(requiredArg(argv[index + 1], '--manual-intervention-after-failures requires a number'))
        if (!Number.isInteger(value) || value < 1) throw new Error('--manual-intervention-after-failures must be a positive integer')
        manualInterventionAfterFailures = value
        index += 1
        break
      }
      case '--manual-intervention-after-iterations': {
        const value = Number(requiredArg(argv[index + 1], '--manual-intervention-after-iterations requires a number'))
        if (!Number.isInteger(value) || value < 1) throw new Error('--manual-intervention-after-iterations must be a positive integer')
        manualInterventionAfterIterations = value
        index += 1
        break
      }
      case '--manual-intervention-pattern':
        manualInterventionPatterns.push(requiredArg(argv[index + 1], '--manual-intervention-pattern requires text'))
        index += 1
        break
      case '--workspace-isolation':
        workspaceIsolation = parseLoopWorkspaceIsolation(requiredArg(argv[index + 1], '--workspace-isolation requires none, temp_copy, or git_worktree'))
        index += 1
        break
      case '--goal':
        goalId = requiredArg(argv[index + 1], '--goal requires a goal id')
        index += 1
        break
      default:
        throw new Error(`Unknown loop create option: ${arg}`)
    }
  }

  if (!specPath && !objective) throw new Error('loop create requires --spec or --objective')
  return {
    kind: 'loop',
    command: 'create',
    configPath: common.configPath,
    specPath,
    title,
    objective,
    trigger,
    verifyCommand,
    maxIterations,
    maxTokens,
    manualInterventionAfterFailures,
    manualInterventionAfterIterations,
    manualInterventionPatterns,
    workspaceIsolation,
    goalId,
  }
}

function parseLoopRun(command: 'run' | 'resume', argv: readonly string[]): Extract<LoopCommandArgs, { command: 'run' | 'resume' }> {
  const loopId = requiredArg(argv[0], `loop ${command} requires a loop id`)
  let configPath: string | undefined
  let goalId: string | undefined
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        configPath = requiredArg(argv[index + 1], '--config requires a path')
        index += 1
        break
      case '--goal':
        goalId = requiredArg(argv[index + 1], '--goal requires a goal id')
        index += 1
        break
      default:
        throw new Error(`Unknown loop ${command} option: ${arg}`)
    }
  }
  return {
    kind: 'loop',
    command,
    loopId,
    configPath,
    goalId,
  }
}

function parseLoopExport(argv: readonly string[]): Extract<LoopCommandArgs, { command: 'export' }> {
  const loopId = requiredArg(argv[0], 'loop export requires a loop id')
  let format: LoopExportFormat = 'md'
  let out: string | undefined

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--format': {
        const value = requiredArg(argv[index + 1], '--format requires json or md')
        if (value !== 'json' && value !== 'md') throw new Error('--format must be json or md')
        format = value
        index += 1
        break
      }
      case '--out':
        out = requiredArg(argv[index + 1], '--out requires a path')
        index += 1
        break
      default:
        throw new Error(`Unknown loop export option: ${arg}`)
    }
  }

  return {
    kind: 'loop',
    command: 'export',
    loopId,
    format,
    out,
  }
}

function parseLimitOption(argv: readonly string[], label = 'thread list'): number | undefined {
  let limit: number | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--limit') throw new Error(`Unknown ${label} option: ${arg}`)
    const value = Number(requiredArg(argv[index + 1], '--limit requires a number'))
    if (!Number.isInteger(value) || value < 1) throw new Error('--limit must be a positive integer')
    limit = value
    index += 1
  }
  return limit
}

async function runThreadCommand(args: ThreadCommandArgs, runtimeProcess: RuntimeProcess): Promise<void> {
  const workspaceRoot = runtimeProcess.cwd()
  const store = new LocalThreadStore(workspaceRoot)

  switch (args.command) {
    case 'list': {
      const summaries = await store.listThreadSummaries({ limit: args.limit })
      runtimeProcess.stdout.write(formatThreadList(summaries))
      return
    }
    case 'inspect': {
      const summary = await store.readThreadSummary(args.threadId)
      runtimeProcess.stdout.write(formatThreadInspect(summary))
      return
    }
    case 'rename': {
      const metadata = await store.renameThread(args.threadId, args.title)
      runtimeProcess.stdout.write(`Renamed thread: ${metadata.threadId}\nTitle: ${metadata.title}\n`)
      return
    }
    case 'export': {
      const content = await store.exportThread(args.threadId, args.format)
      if (!args.out) {
        runtimeProcess.stdout.write(content)
        return
      }
      const outPath = resolveWorkspaceOutputPath(workspaceRoot, args.out)
      await writeFile(outPath, content, 'utf8')
      runtimeProcess.stdout.write(`Exported thread: ${args.threadId}\nPath: ${outPath}\n`)
      return
    }
    case 'branch': {
      const record = await store.branchThread(args.threadId, {
        sessionId: `local-${Date.now()}`,
        title: args.title,
      })
      runtimeProcess.stdout.write(
        `Created branch thread: ${record.metadata.threadId}\nParent: ${args.threadId}\nResume: --thread ${record.metadata.threadId}\n`,
      )
      return
    }
    case 'compact': {
      const sessionId = `local-${Date.now()}`
      const compaction = await compactThreadHistory({
        store,
        threadId: args.threadId,
        sessionId,
        trigger: 'manual',
        reason: args.reason,
        phase: 'standalone',
        emitEvent: event => store.appendEvent(args.threadId, event),
      })
      runtimeProcess.stdout.write(
        [
          `Compacted thread: ${args.threadId}`,
          `Compaction: ${compaction.compactionId}`,
          `Covered messages: ${compaction.coveredMessageCount}`,
          `Retained messages: ${compaction.retainedMessageCount}`,
          `Window: ${compaction.windowId}`,
          '',
        ].join('\n'),
      )
      return
    }
  }
}

async function runGoalCommand(args: GoalCommandArgs, runtimeProcess: RuntimeProcess): Promise<void> {
  const workspaceRoot = runtimeProcess.cwd()
  const store = new LocalGoalStore(workspaceRoot)
  const service = new GoalService(store)

  switch (args.command) {
    case 'create': {
      const objective = args.objectiveFile
        ? await readFile(resolveWorkspaceInputPath(workspaceRoot, args.objectiveFile), 'utf8')
        : args.objective ?? ''
      const summary = await service.createGoal({
        goalId: args.goalId,
        sessionId: `local-${Date.now()}`,
        cwd: workspaceRoot,
        title: args.title,
        objective,
        requirements: args.requirements,
      })
      runtimeProcess.stdout.write(
        [
          `Created goal: ${summary.metadata.goalId}`,
          `Title: ${summary.metadata.title}`,
          `Progress: ${summary.metadata.progressPercent}%`,
          `Requirements: ${summary.requirementCount}`,
          '',
        ].join('\n'),
      )
      return
    }
    case 'list': {
      const summaries = await service.listGoals({ limit: args.limit })
      runtimeProcess.stdout.write(formatGoalList(summaries))
      return
    }
    case 'inspect': {
      const data = await service.readGoal(await resolveGoalId(store, args.goalId))
      runtimeProcess.stdout.write(formatGoalInspect(data))
      return
    }
    case 'status': {
      const summary = await service.readSummary(await resolveGoalId(store, args.goalId))
      runtimeProcess.stdout.write(formatGoalSummary(summary))
      return
    }
    case 'resume': {
      const goalId = await resolveGoalId(store, args.goalId)
      await service.resumeGoal(goalId, 'Goal resumed from CLI.')
      const runtime = new GoalRuntime(store)
      const output = await runtime.continueGoal(goalId, {
        sessionId: `local-${Date.now()}`,
        idle: false,
      })
      runtimeProcess.stdout.write(`${formatGoalSummary(output.goal ?? await service.readSummary(goalId))}Runtime: ${output.status} - ${output.message}\n`)
      return
    }
    case 'pause': {
      const goalId = await resolveGoalId(store, args.goalId)
      const summary = await service.pauseGoal(goalId, 'Goal paused from CLI.')
      runtimeProcess.stdout.write(formatGoalSummary(summary))
      return
    }
    case 'block': {
      const goalId = await resolveGoalId(store, args.goalId)
      const summary = await service.blockGoal(goalId, args.reason ?? 'Goal blocked from CLI.', 'user')
      runtimeProcess.stdout.write(formatGoalSummary(summary))
      return
    }
    case 'complete': {
      const summary = await service.completeGoal(await resolveGoalId(store, args.goalId))
      runtimeProcess.stdout.write(formatGoalSummary(summary))
      return
    }
    case 'export': {
      const content = await service.exportGoal(await resolveGoalId(store, args.goalId), args.format ?? 'md')
      if (!args.out) {
        runtimeProcess.stdout.write(content)
        return
      }
      const outPath = resolveWorkspaceOutputPath(workspaceRoot, args.out)
      await writeFile(outPath, content, 'utf8')
      runtimeProcess.stdout.write(`Exported goal: ${args.goalId}\nPath: ${outPath}\n`)
      return
    }
  }
}

async function runLoopCommand(args: LoopCommandArgs, runtimeProcess: RuntimeProcess): Promise<void> {
  const workspaceRoot = runtimeProcess.cwd()
  const store = new LocalLoopStore(workspaceRoot)

  switch (args.command) {
    case 'create': {
      const spec = await buildLoopSpec(args, workspaceRoot)
      const metadata = await store.createLoop(spec, {
        sessionId: `local-${Date.now()}`,
        cwd: workspaceRoot,
      })
      runtimeProcess.stdout.write(`Created loop: ${metadata.loopId}\nRun: pando loop run ${metadata.loopId}\n`)
      return
    }
    case 'list': {
      const summaries = await store.listSummaries({ limit: args.limit })
      runtimeProcess.stdout.write(formatLoopList(summaries))
      return
    }
    case 'inspect': {
      const summary = await store.readSummary(args.loopId)
      runtimeProcess.stdout.write(formatLoopInspect(summary))
      return
    }
    case 'pause': {
      const metadata = await store.updateStatus(args.loopId, 'paused', 'Loop paused by user command.')
      runtimeProcess.stdout.write(`Paused loop: ${metadata.loopId}\n`)
      return
    }
    case 'stop': {
      const metadata = await store.updateStatus(args.loopId, 'stopped', 'Loop stopped by user command.')
      runtimeProcess.stdout.write(`Stopped loop: ${metadata.loopId}\n`)
      return
    }
    case 'export': {
      const content = await store.exportLoop(args.loopId, args.format)
      if (!args.out) {
        runtimeProcess.stdout.write(content)
        return
      }
      const outPath = resolveWorkspaceOutputPath(workspaceRoot, args.out)
      await writeFile(outPath, content, 'utf8')
      runtimeProcess.stdout.write(`Exported loop: ${args.loopId}\nPath: ${outPath}\n`)
      return
    }
    case 'run':
    case 'resume': {
      const sessionId = `local-${Date.now()}`
      const { config } = await loadRuntimeConfig(workspaceRoot, args.configPath)
      const terminalEvents = createTerminalEventHandler(runtimeProcess.stdout)
      const { registry, mcpConnections } = await createRuntimeToolRegistry({
        config,
        mcp: {
          sessionId,
          emitEvent: terminalEvents,
        },
      })
      try {
        const guiBackend = createGuiBackendFromMcpConnections(mcpConnections)
        const runtime = new LoopRuntime(store)
        const output = await runtime.runLoop(args.loopId, {
          sessionId,
          config,
          registry,
          maxToolRounds: 4,
          requestToolApproval: createTerminalApprovalHandler({
            input: runtimeProcess.stdin,
            output: runtimeProcess.stdout,
          }),
          onEvent: terminalEvents,
          metadata: {
            guiBackend,
          },
          resume: args.command === 'resume',
          goalId: args.goalId,
        })
        runtimeProcess.stdout.write(
          [
            `Loop: ${output.metadata.loopId}`,
            `Status: ${output.metadata.status}`,
            `Iterations: ${output.iterations.length}`,
            `Workspace: ${output.run.workspaceIsolation ?? output.metadata.workspaceIsolation}`,
            `Workspace cwd: ${output.run.workspaceCwd ?? output.metadata.cwd}`,
            `Thread: ${output.metadata.threadId ?? 'none'}`,
            output.run.finalMessage ? `Message: ${output.run.finalMessage}` : undefined,
            '',
          ].filter((line): line is string => Boolean(line)).join('\n'),
        )
      } finally {
        closeMcpConnections(mcpConnections)
      }
      return
    }
  }
}

async function buildLoopSpec(args: Extract<LoopCommandArgs, { command: 'create' }>, workspaceRoot: string): Promise<LoopSpec> {
  const base = args.specPath
    ? JSON.parse(await readFile(resolveWorkspaceInputPath(workspaceRoot, args.specPath), 'utf8')) as LoopSpec
    : {
        objective: args.objective ?? '',
      }
  const manualIntervention = args.manualInterventionAfterFailures || args.manualInterventionAfterIterations || args.manualInterventionPatterns?.length
    ? {
        ...(base.failurePolicy?.manualIntervention ?? {}),
        afterConsecutiveFailures: args.manualInterventionAfterFailures ?? base.failurePolicy?.manualIntervention?.afterConsecutiveFailures,
        afterIterations: args.manualInterventionAfterIterations ?? base.failurePolicy?.manualIntervention?.afterIterations,
        failureTextPatterns: args.manualInterventionPatterns?.length
          ? [
              ...(base.failurePolicy?.manualIntervention?.failureTextPatterns ?? []),
              ...args.manualInterventionPatterns,
            ]
          : base.failurePolicy?.manualIntervention?.failureTextPatterns,
      }
    : base.failurePolicy?.manualIntervention
  return {
    ...base,
    title: args.title ?? base.title,
    objective: args.objective ?? base.objective,
    trigger: args.trigger ?? base.trigger,
    workspaceIsolation: args.workspaceIsolation ?? base.workspaceIsolation,
    goalId: args.goalId ?? base.goalId,
    verification: args.verifyCommand
      ? [
          ...(base.verification ?? []),
          {
            type: 'command',
            command: args.verifyCommand,
          },
        ]
      : base.verification,
    failurePolicy: args.maxIterations || args.maxTokens || manualIntervention
      ? {
          ...(base.failurePolicy ?? {}),
          maxIterations: args.maxIterations ?? base.failurePolicy?.maxIterations,
          maxTokens: args.maxTokens ?? base.failurePolicy?.maxTokens,
          manualIntervention,
        }
      : base.failurePolicy,
  }
}

function parseLoopWorkspaceIsolation(value: string): LoopWorkspaceIsolation {
  if (value === 'none' || value === 'temp_copy' || value === 'git_worktree') return value
  throw new Error('--workspace-isolation must be one of: none, temp_copy, git_worktree')
}

function parseLoopTrigger(value: string): LoopTrigger {
  if (value === 'manual' || value === 'schedule' || value === 'heartbeat') return value
  throw new Error('--trigger must be one of: manual, schedule, heartbeat')
}

function formatGatewayStatusReport(status: {
  ok: boolean
  watchdog?: {
    status: string
    message: string
  }
  state?: {
    status: string
    sessionId: string
    heartbeatCount: number
    lastHeartbeatAtMs: number
    wakeCount: number
    statePath: string
    activeLoops: readonly unknown[]
    pendingApprovals: readonly unknown[]
  }
  inbox: readonly unknown[]
  outbox: readonly unknown[]
  pairedUsers: readonly unknown[]
  events: readonly unknown[]
  wakeRuns: readonly unknown[]
}): string {
  const state = status.state
  return [
    status.ok ? 'Pando gateway status: ok' : 'Pando gateway status: check required',
    `State: ${state?.status ?? 'not started'}`,
    `Session: ${state?.sessionId ?? 'none'}`,
    `Heartbeat count: ${state?.heartbeatCount ?? 0}`,
    `Last heartbeat: ${state?.lastHeartbeatAtMs ? formatTime(state.lastHeartbeatAtMs) : 'none'}`,
    `Watchdog: ${status.watchdog?.status ?? 'unknown'}${status.watchdog?.message ? ` - ${status.watchdog.message}` : ''}`,
    `Wake count: ${state?.wakeCount ?? 0}`,
    `Active loops: ${state?.activeLoops.length ?? 0}`,
    `Pending approvals: ${state?.pendingApprovals.length ?? 0}`,
    `Inbox messages: ${status.inbox.length}`,
    `Outbox messages: ${status.outbox.length}`,
    `Paired users: ${status.pairedUsers.length}`,
    `Events: ${status.events.length}`,
    `Wake runs: ${status.wakeRuns.length}`,
    `State path: ${state?.statePath ?? 'none'}`,
    '',
  ].join('\n')
}

function formatGatewayRecoverReport(output: {
  ok: boolean
  recovered: boolean
  note?: string
  watchdog?: {
    status: string
    message: string
  }
  previousWatchdog?: {
    status: string
    message: string
  }
  output?: {
    state: {
      status: string
      sessionId: string
      heartbeatCount: number
      statePath: string
      recoveredFrom?: {
        previousSessionId: string
        staleMs: number
      }
    }
    processedMessageCount: number
    outboundMessageCount: number
  }
}): string {
  const recoveredFrom = output.output?.state.recoveredFrom
  return [
    output.recovered ? 'Gateway recovered.' : 'Gateway recovery not required.',
    output.note ? `Note: ${output.note}` : undefined,
    output.previousWatchdog ? `Previous watchdog: ${output.previousWatchdog.status} - ${output.previousWatchdog.message}` : undefined,
    output.watchdog ? `Watchdog: ${output.watchdog.status} - ${output.watchdog.message}` : undefined,
    recoveredFrom ? `Recovered from: ${recoveredFrom.previousSessionId}, stale ${recoveredFrom.staleMs}ms` : undefined,
    output.output ? `State: ${output.output.state.status}` : undefined,
    output.output ? `Heartbeat count: ${output.output.state.heartbeatCount}` : undefined,
    output.output ? `Processed messages: ${output.output.processedMessageCount}` : undefined,
    output.output ? `Outbox messages: ${output.output.outboundMessageCount}` : undefined,
    output.output ? `State path: ${output.output.state.statePath}` : undefined,
    '',
  ].filter((line): line is string => Boolean(line)).join('\n')
}

function formatGatewayStopReport(output: { ok: boolean; messageId: string; note: string; state?: { status: string; statePath: string } }): string {
  return [
    output.ok ? 'Gateway stop requested.' : 'Gateway stop request failed.',
    `Message: ${output.messageId}`,
    `Current state: ${output.state?.status ?? 'not started'}`,
    output.note,
    output.state?.statePath ? `State: ${output.state.statePath}` : undefined,
    '',
  ].filter((line): line is string => Boolean(line)).join('\n')
}

async function resolveGoalId(store: LocalGoalStore, goalId: string | undefined): Promise<string> {
  if (goalId) return goalId
  const active = await store.activeGoal()
  if (!active) throw new Error('No active goal found. Pass a goal id.')
  return active.metadata.goalId
}

function formatGoalList(summaries: readonly GoalSummary[]): string {
  if (!summaries.length) return 'No goals found.\n'
  return `${summaries.map(formatGoalListItem).join('\n')}\n`
}

function formatGoalListItem(summary: GoalSummary): string {
  const metadata = summary.metadata
  return [
    `${metadata.goalId}  ${metadata.status}  ${metadata.title}`,
    `  progress: ${metadata.progressPercent}%  requirements: ${metadata.completedRequirementCount}/${summary.requirementCount}`,
    `  blockers: ${metadata.blockerCount}  evidence: ${summary.evidenceCount}  runs: ${summary.runCount}`,
    `  updated: ${formatTime(metadata.updatedAtMs)}`,
  ].join('\n')
}

function formatGoalSummary(summary: GoalSummary): string {
  const metadata = summary.metadata
  return [
    `Goal: ${metadata.goalId}`,
    `Title: ${metadata.title}`,
    `Status: ${metadata.status}`,
    `Progress: ${metadata.progressPercent}%`,
    `Requirements: ${metadata.completedRequirementCount}/${summary.requirementCount} completed`,
    `Blockers: ${metadata.blockerCount}`,
    `Evidence: ${summary.evidenceCount}`,
    `Runs: ${summary.runCount}`,
    `Latest checkpoint: ${summary.latestCheckpoint?.summary ?? 'none'}`,
    '',
  ].join('\n')
}

function formatGoalInspect(data: GoalExportData): string {
  const metadata = data.metadata
  const lines = [
    `Goal: ${metadata.goalId}`,
    `Title: ${metadata.title}`,
    `Status: ${metadata.status}`,
    `Created: ${formatTime(metadata.createdAtMs)}`,
    `Updated: ${formatTime(metadata.updatedAtMs)}`,
    `Cwd: ${metadata.cwd}`,
    `Progress: ${metadata.progressPercent}%`,
    `Requirements: ${metadata.completedRequirementCount}/${data.requirements.length} completed`,
    `Blockers: ${metadata.blockerCount}`,
    `Evidence: ${data.evidence.length}`,
    `Runs: ${data.runs.length}`,
    `Checkpoints: ${data.checkpoints.length}`,
    `Related threads: ${metadata.relatedThreadIds.join(', ') || 'none'}`,
    `Related loops: ${metadata.relatedLoopIds.join(', ') || 'none'}`,
    '',
    'Objective:',
    data.objective,
    '',
    'Requirements:',
    ...data.requirements.map(requirement =>
      `- ${requirement.requirementId} [${requirement.status}] ${requirement.text}${requirement.blocker ? ` (blocker: ${requirement.blocker})` : ''}`,
    ),
    '',
    'Latest evidence:',
    ...(data.evidence.length
      ? data.evidence.slice(-5).map(evidence => `- ${evidence.evidenceId} ${evidence.type}/${evidence.strength}: ${evidence.summary}`)
      : ['- none']),
    '',
  ]
  return `${lines.join('\n')}\n`
}

function formatLoopList(summaries: readonly LoopSummary[]): string {
  if (!summaries.length) return 'No loops found.\n'
  return `${summaries.map(formatLoopListItem).join('\n')}\n`
}

function formatLoopListItem(summary: LoopSummary): string {
  const metadata = summary.metadata
  return [
    `${metadata.loopId}  ${metadata.status}  ${metadata.title}`,
    `  updated: ${formatTime(metadata.updatedAtMs)}  trigger: ${metadata.trigger}`,
    `  workspace: ${metadata.workspaceIsolation}`,
    `  cwd: ${metadata.cwd}`,
    `  runs: ${summary.runCount}  iterations: ${summary.iterationCount}`,
  ].join('\n')
}

function formatLoopInspect(summary: LoopSummary): string {
  const metadata = summary.metadata
  const lines = [
    `Loop: ${metadata.loopId}`,
    `Title: ${metadata.title}`,
    `Status: ${metadata.status}`,
    `Trigger: ${metadata.trigger}`,
    `Workspace: ${metadata.workspaceIsolation}`,
    `Current workspace: ${metadata.currentWorkspaceCwd ?? 'none'}`,
    `Session: ${metadata.sessionId}`,
    `Created: ${formatTime(metadata.createdAtMs)}`,
    `Updated: ${formatTime(metadata.updatedAtMs)}`,
    `Cwd: ${metadata.cwd}`,
    `Thread: ${metadata.threadId ?? 'none'}`,
    `Runs: ${summary.runCount}`,
    `Iterations: ${summary.iterationCount}`,
    `Events: ${summary.eventCount}`,
    `Objective: ${metadata.objective}`,
  ]
  if (summary.lastRun) {
    lines.push(`Last run: ${summary.lastRun.runId}`)
    lines.push(`Last run status: ${summary.lastRun.status}`)
    if (summary.lastRun.finalMessage) lines.push(`Last run message: ${summary.lastRun.finalMessage}`)
  } else {
    lines.push('Last run: none')
  }
  if (summary.lastIteration) {
    lines.push(`Last iteration: ${summary.lastIteration.iterationId}`)
    lines.push(`Last iteration status: ${summary.lastIteration.status}`)
  } else {
    lines.push('Last iteration: none')
  }
  return `${lines.join('\n')}\n`
}

function resolveWorkspaceInputPath(workspaceRoot: string, inputPath: string): string {
  return resolveWorkspaceOutputPath(workspaceRoot, inputPath)
}

function formatThreadList(summaries: readonly ThreadSummary[]): string {
  if (!summaries.length) return 'No threads found.\n'
  return `${summaries.map(formatThreadListItem).join('\n')}\n`
}

function formatThreadListItem(summary: ThreadSummary): string {
  const metadata = summary.metadata
  return [
    `${metadata.threadId}  ${metadata.title}`,
    `  updated: ${formatTime(metadata.updatedAtMs)}  model: ${formatModel(metadata.model)}`,
    `  cwd: ${metadata.cwd}`,
    `  checkpoint: ${summary.lastCheckpoint?.finalTextPreview ?? 'none'}`,
  ].join('\n')
}

function formatThreadInspect(summary: ThreadSummary): string {
  const metadata = summary.metadata
  const lines = [
    `Thread: ${metadata.threadId}`,
    `Title: ${metadata.title}`,
    `Session: ${metadata.sessionId}`,
    `Created: ${formatTime(metadata.createdAtMs)}`,
    `Updated: ${formatTime(metadata.updatedAtMs)}`,
    `Model: ${formatModel(metadata.model)}`,
    `Cwd: ${metadata.cwd}`,
    `Parent: ${metadata.parentThreadId ?? 'none'}`,
    `Messages: ${summary.messageCount}`,
    `Events: ${summary.eventCount}`,
    `Checkpoints: ${summary.checkpointCount}`,
    `Compactions: ${summary.compactionCount}`,
  ]

  if (summary.lastCheckpoint) {
    lines.push(`Last checkpoint: ${summary.lastCheckpoint.checkpointId}`)
    lines.push(`Last checkpoint preview: ${summary.lastCheckpoint.finalTextPreview}`)
  } else {
    lines.push('Last checkpoint: none')
  }

  if (summary.latestCompaction) {
    lines.push(`Latest compaction: ${summary.latestCompaction.compactionId}`)
    lines.push(`Latest compaction window: ${summary.latestCompaction.windowId}`)
  } else {
    lines.push('Latest compaction: none')
  }

  return `${lines.join('\n')}\n`
}

function resolveWorkspaceOutputPath(workspaceRoot: string, outputPath: string): string {
  const workspace = resolve(workspaceRoot)
  const target = isAbsolute(outputPath) ? resolve(outputPath) : resolve(workspace, outputPath)
  const relativePath = relative(workspace, target)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`--out must stay inside the current workspace: ${outputPath}`)
  }
  return target
}

function formatModel(model: { provider: string; name?: string } | undefined): string {
  if (!model) return 'unknown'
  return model.name ? `${model.provider}/${model.name}` : model.provider
}

function formatTime(value: number): string {
  return new Date(value).toISOString()
}

function requiredArg(value: string | undefined, message: string): string {
  if (!value || value.startsWith('--')) throw new Error(message)
  return value
}

function parseProviderId(value: string): string {
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) throw new Error('--provider must be an ASCII provider id')
  return trimmed
}

function parseModelName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('--model requires a model name')
  if (/[\r\n]/.test(trimmed)) throw new Error('--model cannot contain line breaks')
  return trimmed
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`)
  return parsed
}

function requiredTitle(parts: readonly string[]): string {
  const title = parts.join(' ').trim()
  if (!title) throw new Error('thread rename requires a title')
  return title
}

function isMainModule(): boolean {
  const entrypoint = getRuntimeProcess().argv[1]
  return Boolean(entrypoint && resolve(fileURLToPath(import.meta.url)) === resolve(entrypoint))
}

if (isMainModule()) {
  await main()
}
