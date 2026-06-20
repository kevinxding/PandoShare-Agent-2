import type { QueryEngineOptions } from '../../QueryEngine.js'
import type { QueryTurnOutput } from '../../query.js'
import type { AgentEvent } from '../../services/events/index.js'
import { DurableRuntime, type KernelCheckpoint } from '../durable/index.js'
import {
  createCommandEnvelope,
  createProtocolId,
  type CommandEnvelope,
  type CommandSource,
  type EventEnvelope,
} from '../protocol/index.js'
import { AgentCommandHandler } from './AgentCommandHandler.js'
import { AgentKernelAdapter } from './AgentKernelAdapter.js'
import { AgentKernelEventBridge } from './AgentKernelEventBridge.js'
import { RunLedger } from './RunLedger.js'
import type { RunContext } from './RunContext.js'
import { createRunIdentity } from './RunIdentity.js'
import { RunStateMachine, type RunState } from './RunStateMachine.js'

export type AgentKernelOptions = QueryEngineOptions & {
  workspaceId?: string
  commandSource?: CommandSource
  durable?: DurableRuntime
}

export type AgentKernelRunResult = {
  runId: string
  threadId?: string
  finalText: string
  output: QueryTurnOutput
  coreEvents: readonly EventEnvelope[]
  checkpointId?: string
}

export class AgentKernel {
  private readonly workspaceId: string
  private readonly durable: DurableRuntime
  private readonly adapter: AgentKernelAdapter
  private readonly commandHandler: AgentCommandHandler
  private readonly stateMachine: RunStateMachine
  private readonly runLedger: RunLedger
  private readonly eventBridge = new AgentKernelEventBridge()
  private readonly envelopeEvents: EventEnvelope[] = []

  constructor(private readonly options: AgentKernelOptions) {
    this.workspaceId = options.workspaceId ?? 'default'
    this.durable = options.durable ?? new DurableRuntime({ workspaceRoot: options.cwd, workspaceId: this.workspaceId })
    this.runLedger = RunLedger.fromRuntimePaths(this.durable.paths)
    this.adapter = new AgentKernelAdapter(options)
    this.stateMachine = new RunStateMachine(
      event => this.appendCoreEvent(event),
      async state => {
        await this.runLedger.append(state)
      },
    )
    this.commandHandler = new AgentCommandHandler({
      adapter: this.adapter,
      abort: reason => this.abort(reason),
      interruptRun: (runId, reason) => this.stateMachine.interruptRun(runId, reason),
      readActiveRuns: () => this.stateMachine.readActiveRuns(),
      readRecentRuns: limit => this.stateMachine.readRecentRuns(limit),
    })
  }

  submit(command: CommandEnvelope): Promise<AgentKernelRunResult> {
    return this.submitRun(command)
  }

  async submitRun(command: CommandEnvelope): Promise<AgentKernelRunResult> {
    const normalizedCommand = this.normalizeCommand(command)
    const run = await this.stateMachine.startRun(normalizedCommand)
    const context = this.createRunContext(normalizedCommand, run)

    try {
      const output = await this.commandHandler.handle(normalizedCommand, context)
      await this.forwardLegacyEvents(context)

      const current = this.stateMachine.readRun(run.runId)
      if (current?.status === 'interrupted') {
        const checkpoint = await this.createRunCheckpoint('interrupted', normalizedCommand, current, {
          output,
          reason: 'interrupted_by_user',
        })
        return this.buildResult(normalizedCommand, current, output, checkpoint)
      }

      const completed = await this.stateMachine.completeRun(run.runId, {
        threadId: this.threadId() ?? normalizedCommand.threadId,
        finalTextPreview: preview(output.finalText),
      })
      const checkpoint = await this.createRunCheckpoint('completed', normalizedCommand, completed, { output })
      return this.buildResult(normalizedCommand, completed, output, checkpoint)
    } catch (error) {
      await this.forwardLegacyEvents(context).catch(() => undefined)
      const current = this.stateMachine.readRun(run.runId)
      if (current?.status === 'interrupted') {
        const output = syntheticOutput(`run interrupted: ${run.runId}`)
        const checkpoint = await this.createRunCheckpoint('interrupted', normalizedCommand, current, {
          output,
          reason: 'interrupted_by_user',
        })
        return this.buildResult(normalizedCommand, current, output, checkpoint)
      }

      const failed = await this.stateMachine.failRun(run.runId, error, {
        threadId: this.threadId() ?? normalizedCommand.threadId,
      })
      await this.createRunCheckpoint('failed', normalizedCommand, failed, { error })
      throw error
    }
  }

  async submitMessage(prompt: string): Promise<QueryTurnOutput> {
    return this.run(prompt)
  }

  async run(prompt: string): Promise<QueryTurnOutput> {
    const command = createCommandEnvelope({
      commandType: 'agent.run',
      workspaceId: this.workspaceId,
      source: this.options.commandSource ?? 'cli',
      threadId: this.options.threadId,
      goalId: this.options.goalId,
      payload: {
        prompt,
      },
    })
    return (await this.submitRun(command)).output
  }

  events(): readonly AgentEvent[] {
    return this.adapter.events()
  }

  coreEvents(): readonly EventEnvelope[] {
    return this.envelopeEvents
  }

  threadId(): string | undefined {
    return this.adapter.threadId()
  }

  abort(reason?: unknown): void {
    this.adapter.abort(reason)
  }

  private normalizeCommand(command: CommandEnvelope): CommandEnvelope {
    const payloadThreadId = threadIdFromPayload(command.payload)
    return createCommandEnvelope({
      commandType: command.commandType,
      workspaceId: command.workspaceId || this.workspaceId,
      threadId: command.threadId ?? payloadThreadId ?? this.options.threadId,
      runId: command.runId ?? createProtocolId('run'),
      goalId: command.goalId ?? this.options.goalId,
      loopId: command.loopId,
      source: command.source,
      payload: command.payload,
      commandId: command.commandId,
      createdAtMs: command.createdAtMs,
    })
  }

  private createRunContext(command: CommandEnvelope, state: RunState): RunContext {
    return {
      identity: createRunIdentity(command),
      command,
      status: state.status,
      metadata: {
        ...(this.options.metadata ?? {}),
        runId: command.runId,
        threadId: command.threadId,
        goalId: command.goalId,
        loopId: command.loopId,
      },
    }
  }

  private async forwardLegacyEvents(context: RunContext): Promise<void> {
    const events = this.eventBridge.convert(this.adapter.events(), context)
    for (const event of events) {
      await this.appendCoreEvent(event)
    }
  }

  private async appendCoreEvent(event: EventEnvelope): Promise<void> {
    this.envelopeEvents.push(event)
    await this.durable.appendEvent(event)
  }

  private async createRunCheckpoint(
    status: 'completed' | 'failed' | 'interrupted',
    command: CommandEnvelope,
    state: RunState,
    input: {
      output?: QueryTurnOutput
      error?: unknown
      reason?: string
    },
  ): Promise<KernelCheckpoint> {
    const threadId = this.threadId() ?? state.threadId ?? command.threadId
    return this.durable.createCheckpoint({
      workspaceId: state.workspaceId,
      threadId,
      runId: state.runId,
      goalId: state.goalId,
      loopId: state.loopId,
      status: status === 'interrupted' ? 'unsafe_to_replay' : 'safe_to_replay',
      reason: status === 'interrupted' ? input.reason ?? 'interrupted_by_user' : undefined,
      payload: {
        runId: state.runId,
        threadId,
        commandId: command.commandId,
        commandType: command.commandType,
        finalTextPreview: input.output ? preview(input.output.finalText) : undefined,
        errorPreview: input.error ? preview(errorMessage(input.error)) : undefined,
      },
    })
  }

  private async buildResult(
    command: CommandEnvelope,
    state: RunState,
    output: QueryTurnOutput,
    checkpoint: KernelCheckpoint,
  ): Promise<AgentKernelRunResult> {
    const threadId = this.threadId() ?? state.threadId ?? command.threadId
    return {
      runId: state.runId,
      threadId,
      finalText: output.finalText,
      output,
      coreEvents: await this.durable.readEvents({ runId: state.runId }),
      checkpointId: checkpoint.checkpointId,
    }
  }
}

function threadIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const value = (payload as { threadId?: unknown }).threadId
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function preview(value: string, maxChars = 500): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function syntheticOutput(finalText: string): QueryTurnOutput {
  return {
    finalText,
    toolResults: [],
  }
}
