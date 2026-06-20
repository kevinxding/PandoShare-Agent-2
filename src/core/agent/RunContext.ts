import type { CommandEnvelope } from '../protocol/index.js'
import type { RunStatus } from './RunStateMachine.js'
import type { RunIdentity } from './RunIdentity.js'

export type RunContext = {
  identity: RunIdentity
  command: CommandEnvelope
  status: RunStatus
  abortSignal?: AbortSignal
  metadata: Record<string, unknown>
}
