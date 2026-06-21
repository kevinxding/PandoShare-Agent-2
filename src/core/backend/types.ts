import type { AgentKernel, AgentKernelOptions } from '../agent/index.js'
import type { DurableRuntime } from '../durable/index.js'
import type { GatewayDaemon } from '../gateway/index.js'
import type { GuiAdapter, GuiRuntime } from '../gui/index.js'
import type { LoopRuntime } from '../loop/index.js'
import type { ModelRouter } from '../model/index.js'
import type { CommandSource } from '../protocol/index.js'
import type { ReplayService } from '../replay/index.js'
import type { ProjectConfig } from '../../services/config/index.js'

export const BACKEND_ACTIONS = [
  'agent.run',
  'agent.resume',
  'agent.interrupt',
  'loop.create',
  'loop.runNext',
  'loop.status',
  'loop.recover',
  'gui.observe',
  'gui.requestAction',
  'gui.approve',
  'gui.reject',
  'gateway.status',
  'gateway.tick',
  'model.route',
  'model.status',
  'replay.run',
  'replay.loop',
  'replay.export',
  'system.health',
  'system.acceptance',
] as const

export type BackendAction = typeof BACKEND_ACTIONS[number]

export type BackendRequest<TPayload = unknown> = {
  schemaVersion?: 1
  requestId?: string
  action: BackendAction | string
  payload?: TPayload
  context?: Partial<BackendRequestContext>
  createdAtMs?: number
}

export type BackendRequestContext = {
  workspaceId: string
  sessionId: string
  source: CommandSource
  threadId?: string
  runId?: string
  goalId?: string
  loopId?: string
}

export type BackendContext = Required<Pick<BackendRequestContext, 'workspaceId' | 'sessionId' | 'source'>> & {
  workspaceRoot: string
  cwd: string
  threadId?: string
  runId?: string
  goalId?: string
  loopId?: string
}

export type BackendErrorResponse = {
  code: string
  message: string
  status: number
  detail?: unknown
}

export type BackendTelemetryRecord = {
  stage: 'started' | 'completed' | 'failed'
  eventId: string
  eventType: string
  createdAtMs: number
}

export type BackendResponse<TData = unknown> = {
  schemaVersion: 1
  ok: boolean
  requestId: string
  action: string
  createdAtMs: number
  completedAtMs: number
  eventIds: string[]
  telemetry: BackendTelemetryRecord[]
  data?: TData
  error?: BackendErrorResponse
}

export type BackendHandlerResult<TData = unknown> = {
  data: TData
  eventIds?: readonly string[]
}

export type BackendHandler = (
  request: NormalizedBackendRequest,
  execution: BackendExecution,
) => Promise<BackendHandlerResult>

export type BackendHandlerMap = Partial<Record<BackendAction, BackendHandler>>

export type NormalizedBackendRequest<TPayload = unknown> = {
  schemaVersion: 1
  requestId: string
  action: BackendAction
  payload: TPayload
  context: Partial<BackendRequestContext>
  createdAtMs: number
}

export type BackendAdapters = {
  durable: DurableRuntime
  agent: AgentKernel
  loop: LoopRuntime
  gui: GuiRuntime
  gateway: GatewayDaemon
  model: ModelRouter
  replay: ReplayService
}

export type BackendExecution = {
  context: BackendContext
  adapters: BackendAdapters
}

export type BackendServiceOptions = {
  workspaceRoot: string
  workspaceId?: string
  sessionId?: string
  source?: CommandSource
  cwd?: string
  config?: ProjectConfig
  fetch?: AgentKernelOptions['fetch']
  agentKernel?: AgentKernel
  durable?: DurableRuntime
  loopRuntime?: LoopRuntime
  guiRuntime?: GuiRuntime
  guiAdapter?: GuiAdapter
  gatewayDaemon?: GatewayDaemon
  modelRouter?: ModelRouter
  replayService?: ReplayService
}

export function isBackendAction(value: string): value is BackendAction {
  return (BACKEND_ACTIONS as readonly string[]).includes(value)
}
