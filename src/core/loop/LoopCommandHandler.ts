import type { CommandEnvelope } from '../protocol/index.js'
import type { LoopRuntime } from './LoopRuntime.js'

export type LoopCommandResult = {
  ok: boolean
  commandType: string
  result: unknown
}

type LoopCommandRuntime = Pick<
  LoopRuntime,
  | 'createLoop'
  | 'runNext'
  | 'resumeLoop'
  | 'status'
  | 'recoverLoop'
  | 'pauseLoop'
  | 'stopLoop'
  | 'approveHumanGate'
  | 'rejectHumanGate'
>

export class LoopCommandHandler {
  constructor(private readonly runtime: LoopCommandRuntime) {}

  async handle(command: CommandEnvelope): Promise<LoopCommandResult> {
    const payload = recordPayload(command.payload)
    const loopId = stringPayload(payload, 'loopId') ?? command.loopId
    switch (command.commandType) {
      case 'loop.create':
        return { ok: true, commandType: command.commandType, result: await this.runtime.createLoop({
          objective: stringPayload(payload, 'objective') ?? 'Loop task',
          successCriteria: arrayPayload(payload, 'successCriteria'),
          constraints: arrayPayload(payload, 'constraints'),
          loopId,
          goalId: command.goalId ?? stringPayload(payload, 'goalId'),
          rootThreadId: command.threadId,
          createdByCommandId: command.commandId,
          source: command.source,
        }) }
      case 'loop.run':
        return { ok: true, commandType: command.commandType, result: await this.runtime.runNext(requireLoopId(loopId)) }
      case 'loop.resume':
        return { ok: true, commandType: command.commandType, result: await this.runtime.resumeLoop(requireLoopId(loopId)) }
      case 'loop.pause':
        return { ok: true, commandType: command.commandType, result: await this.runtime.pauseLoop(requireLoopId(loopId), stringPayload(payload, 'reason')) }
      case 'loop.stop':
        return { ok: true, commandType: command.commandType, result: await this.runtime.stopLoop(requireLoopId(loopId), stringPayload(payload, 'reason')) }
      case 'loop.status':
        return { ok: true, commandType: command.commandType, result: await this.runtime.status(requireLoopId(loopId)) }
      case 'loop.approve':
        return { ok: true, commandType: command.commandType, result: await this.runtime.approveHumanGate({ loopId: requireLoopId(loopId), gateId: stringPayload(payload, 'gateId'), resolvedBy: command.source, reason: stringPayload(payload, 'reason') }) }
      case 'loop.reject':
        return { ok: true, commandType: command.commandType, result: await this.runtime.rejectHumanGate({ loopId: requireLoopId(loopId), gateId: stringPayload(payload, 'gateId'), resolvedBy: command.source, reason: stringPayload(payload, 'reason') }) }
      default:
        throw new Error(`Unsupported loop command: ${command.commandType}`)
    }
  }
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requireLoopId(loopId: string | undefined): string {
  if (!loopId) throw new Error('Loop command requires loopId')
  return loopId
}

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function arrayPayload(payload: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = payload[key]
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : undefined
}
