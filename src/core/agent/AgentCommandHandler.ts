import type { QueryTurnOutput } from '../../query.js'
import type { CommandEnvelope } from '../protocol/index.js'
import { AgentKernelAdapter } from './AgentKernelAdapter.js'
import type { RunContext } from './RunContext.js'
import type { RunState } from './RunStateMachine.js'

export type AgentRunPayload = {
  prompt: string
}

export type AgentResumePayload = {
  threadId?: string
  prompt?: string
}

export type AgentControlPayload = {
  reason?: string
}

export type AgentCommandHandlerRuntime = {
  adapter: AgentKernelAdapter
  abort(reason?: unknown): void
  interruptRun(runId: string, reason?: string): Promise<RunState>
  readActiveRuns(): readonly RunState[]
  readRecentRuns(limit?: number): readonly RunState[]
}

export class AgentCommandHandler {
  constructor(private readonly runtime: AgentCommandHandlerRuntime) {}

  async handle(command: CommandEnvelope, context: RunContext): Promise<QueryTurnOutput> {
    switch (command.commandType) {
      case 'agent.run':
        return this.handleRun(command, context)
      case 'agent.resume':
        return this.handleResume(command, context)
      case 'agent.interrupt':
        return this.handleInterrupt(command, context, 'interrupted_by_user')
      case 'agent.stop':
        return this.handleInterrupt(command, context, 'stop_requested')
      case 'agent.status':
        return this.handleStatus()
      default:
        throw new Error(`Unsupported AgentKernel command: ${command.commandType}`)
    }
  }

  private handleRun(command: CommandEnvelope, context: RunContext): Promise<QueryTurnOutput> {
    const payload = command.payload as Partial<AgentRunPayload>
    const prompt = requiredPrompt(payload.prompt, 'agent.run command requires payload.prompt')
    return this.runtime.adapter.run(prompt, context)
  }

  private handleResume(command: CommandEnvelope, context: RunContext): Promise<QueryTurnOutput> {
    const payload = command.payload as Partial<AgentResumePayload>
    const threadId = command.threadId ?? payload.threadId
    if (typeof threadId !== 'string' || !threadId.trim()) {
      throw new Error('agent.resume command requires threadId or payload.threadId')
    }

    // TODO: replace this legacy resume path once QueryEngine exposes a first-class resume API.
    // For now the adapter initializes QueryEngine with the normalized command threadId.
    const prompt = typeof payload.prompt === 'string' && payload.prompt.trim()
      ? payload.prompt.trim()
      : `Resume thread ${threadId}.`
    return this.runtime.adapter.run(prompt, context)
  }

  private async handleInterrupt(
    command: CommandEnvelope,
    context: RunContext,
    defaultReason: string,
  ): Promise<QueryTurnOutput> {
    const payload = command.payload as Partial<AgentControlPayload>
    const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : defaultReason
    await this.runtime.interruptRun(context.identity.runId, reason)
    this.runtime.abort(reason)
    return syntheticOutput(`run interrupted: ${context.identity.runId}`)
  }

  private handleStatus(): QueryTurnOutput {
    const active = this.runtime.readActiveRuns()
    const recent = this.runtime.readRecentRuns(5)
    const activeText = active.length
      ? active.map(run => `${run.runId}:${run.status}`).join(', ')
      : 'none'
    const recentText = recent.length
      ? recent.map(run => `${run.runId}:${run.status}`).join(', ')
      : 'none'
    return syntheticOutput(`active runs: ${activeText}\nrecent runs: ${recentText}`)
  }
}

function requiredPrompt(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

function syntheticOutput(finalText: string): QueryTurnOutput {
  return {
    finalText,
    toolResults: [],
  }
}
