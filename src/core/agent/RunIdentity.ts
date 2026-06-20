import type { CommandEnvelope, CommandSource } from '../protocol/index.js'

export type RunIdentity = {
  workspaceId: string
  threadId?: string
  runId: string
  goalId?: string
  loopId?: string
  commandId: string
  commandType: string
  source: CommandSource
  createdAtMs: number
}

export function createRunIdentity(command: CommandEnvelope): RunIdentity {
  if (!command.runId) throw new Error('RunIdentity requires a canonical command.runId')
  return {
    workspaceId: command.workspaceId,
    threadId: command.threadId,
    runId: command.runId,
    goalId: command.goalId,
    loopId: command.loopId,
    commandId: command.commandId,
    commandType: command.commandType,
    source: command.source,
    createdAtMs: command.createdAtMs,
  }
}
